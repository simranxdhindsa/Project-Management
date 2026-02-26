package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/dhindsa/project-management/internal/database"
	"github.com/dhindsa/project-management/internal/middleware"
	"github.com/dhindsa/project-management/internal/models"
	"github.com/dhindsa/project-management/internal/services/ai"
	"github.com/dhindsa/project-management/internal/services/slack"
)

// AIHandler handles AI analysis API requests
type AIHandler struct {
	aiClient        ai.AIClient
	slackService    *slack.Service
	taskRepo        *database.TaskRepository
	integrationRepo *database.IntegrationRepository
}

// NewAIHandler creates a new AI handler
func NewAIHandler() *AIHandler {
	return &AIHandler{
		aiClient:        ai.NewAIClient(), // Auto-selects provider based on env
		slackService:    slack.NewService(),
		taskRepo:        database.NewTaskRepository(),
		integrationRepo: database.NewIntegrationRepository(),
	}
}

// AnalyzeSlackMessages analyzes Slack messages to determine task statuses
func (h *AIHandler) AnalyzeSlackMessages(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "Unauthorized"})
		return
	}

	// Get project ID from query params
	projectID := r.URL.Query().Get("project_id")
	if projectID == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "project_id is required"})
		return
	}

	// Get yesterday's Slack messages
	messages, err := h.slackService.GetYesterdayMessages(r.Context(), userID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "Failed to get Slack messages: " + err.Error()})
		return
	}

	if len(messages) == 0 {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"message": "No messages found from yesterday",
			"analysis": []interface{}{},
		})
		return
	}

	// Get tasks for the project that are in progress or todo
	tasks, err := h.taskRepo.GetYesterdayPending(r.Context(), projectID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "Failed to get tasks: " + err.Error()})
		return
	}

	if len(tasks) == 0 {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"message": "No pending tasks to analyze",
			"analysis": []interface{}{},
		})
		return
	}

	// Convert messages to analysis format
	messagesForAnalysis := make([]ai.SlackMessageForAnalysis, 0, len(messages))
	for _, msg := range messages {
		messagesForAnalysis = append(messagesForAnalysis, ai.SlackMessageForAnalysis{
			ID:        msg.ID,
			UserName:  msg.UserName,
			Text:      msg.Text,
			Timestamp: msg.Timestamp.Format("15:04"),
		})
	}

	// Get task titles
	taskTitles := make([]string, 0, len(tasks))
	asanaStatuses := make(map[string]string)
	for _, task := range tasks {
		taskTitles = append(taskTitles, task.Title)
		asanaStatuses[task.Title] = string(task.Status)
	}

	// Run AI analysis
	analyses, err := h.aiClient.AnalyzeMessages(r.Context(), messagesForAnalysis, taskTitles)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "AI analysis failed: " + err.Error()})
		return
	}

	// Compare with Asana statuses to find discrepancies
	discrepancies := ai.CompareStatuses(analyses, asanaStatuses)

	// Save analysis results
	for _, analysis := range analyses {
		asanaStatus := asanaStatuses[analysis.TaskTitle]
		result := &models.SlackAnalysisResult{
			TaskTitle:   analysis.TaskTitle,
			SlackStatus: analysis.DetectedStatus,
			AsanaStatus: &asanaStatus,
			Confidence:  analysis.Confidence,
			MessageIDs:  analysis.MessageIDs,
			Discrepancy: false,
		}
		// Check if there's a discrepancy for this task
		for _, d := range discrepancies {
			if d.TaskTitle == analysis.TaskTitle {
				result.Discrepancy = true
				break
			}
		}
		h.integrationRepo.SaveAnalysisResult(r.Context(), result)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":       true,
		"analysis":      analyses,
		"discrepancies": discrepancies,
		"summary": map[string]interface{}{
			"tasks_analyzed":   len(analyses),
			"messages_read":    len(messages),
			"discrepancies":    len(discrepancies),
		},
	})
}

// GetDiscrepancies returns tasks with status discrepancies
func (h *AIHandler) GetDiscrepancies(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "Unauthorized"})
		return
	}

	discrepancies, err := h.integrationRepo.GetDiscrepancies(r.Context())
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "Failed to get discrepancies: " + err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":       true,
		"discrepancies": discrepancies,
	})
}

// AnalyzeManualInput analyzes manually pasted task assignments and updates
// Uses AI to do all text parsing - sends both morning + evening text to AI
// and gets back a structured JSON response with person breakdown
func (h *AIHandler) AnalyzeManualInput(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "Unauthorized"})
		return
	}

	var req struct {
		MorningAssignments string `json:"morning_assignments"`
		EveningUpdates     string `json:"evening_updates"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "Invalid request body"})
		return
	}

	if req.MorningAssignments == "" || req.EveningUpdates == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "Both morning_assignments and evening_updates are required"})
		return
	}

	// Send both texts to AI and let it do all the parsing
	fullResponse, err := h.aiClient.AnalyzeFullInput(r.Context(), req.MorningAssignments, req.EveningUpdates)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "AI analysis failed: " + err.Error()})
		return
	}

	// Post-process: dedup tasks within each person and build frontend response
	personBreakdown := make([]map[string]interface{}, 0, len(fullResponse.PersonBreakdown))
	for _, person := range fullResponse.PersonBreakdown {
		// Dedup: ensure each task appears in only one status category
		seen := make(map[string]bool)
		dedup := func(tasks []string) []string {
			var result []string
			for _, t := range tasks {
				if !seen[t] {
					seen[t] = true
					result = append(result, t)
				}
			}
			return result
		}

		// Priority: completed > in_progress > blocked > pending > not_mentioned
		completed := dedup(person.Completed)
		inProgress := dedup(person.InProgress)
		blocked := dedup(person.Blocked)
		pending := dedup(person.Pending)
		notMentioned := dedup(person.NotMentioned)

		// Merge in_progress into pending for frontend (frontend shows completed/pending/blocked/not_mentioned)
		allPending := append(inProgress, pending...)

		entry := map[string]interface{}{
			"name":               person.Name,
			"assigned":           person.Assigned,
			"completed":          completed,
			"pending":            allPending,
			"blocked":            blocked,
			"not_mentioned":      notMentioned,
			"no_update_received": person.NoUpdateReceived,
			"stats": map[string]int{
				"total":         len(person.Assigned),
				"completed":     len(completed),
				"pending":       len(allPending),
				"blocked":       len(blocked),
				"not_mentioned": len(notMentioned),
			},
		}
		personBreakdown = append(personBreakdown, entry)
	}

	// Dedup analysis array — keep first occurrence of each task title
	seenTasks := make(map[string]bool)
	dedupedAnalysis := make([]ai.TaskStatusAnalysis, 0, len(fullResponse.Analysis))
	for _, a := range fullResponse.Analysis {
		if !seenTasks[a.TaskTitle] {
			seenTasks[a.TaskTitle] = true
			dedupedAnalysis = append(dedupedAnalysis, a)
		}
	}

	// Collect all task titles for the response
	var taskTitles []string
	for _, a := range dedupedAnalysis {
		taskTitles = append(taskTitles, a.TaskTitle)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data": map[string]interface{}{
			"tasks_detected":   taskTitles,
			"analysis":         dedupedAnalysis,
			"person_breakdown": personBreakdown,
			"summary": map[string]interface{}{
				"total_tasks":   fullResponse.Summary.TotalTasks,
				"completed":     fullResponse.Summary.Completed,
				"in_progress":   fullResponse.Summary.InProgress,
				"pending":       fullResponse.Summary.Pending,
				"blocked":       fullResponse.Summary.Blocked,
				"not_mentioned": fullResponse.Summary.NotMentioned,
			},
		},
	})
}

// eodIssue is the subset of issue data the frontend sends for EOD plan generation.
type eodIssue struct {
	ID       string `json:"id"`
	Summary  string `json:"summary"`
	Status   string `json:"status"`
	Priority string `json:"priority"`
	Assignee string `json:"assignee"`
}

// GenerateEODPlan uses AI to draft a next-day action plan from today's EOD data.
// POST /api/ai/eod-plan
func (h *AIHandler) GenerateEODPlan(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		CompletedToday  []eodIssue `json:"completed_today"`
		StillInProgress []eodIssue `json:"still_in_progress"`
		NoMovement      []eodIssue `json:"no_movement"`
		NewBlockers     []eodIssue `json:"new_blockers"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	formatList := func(issues []eodIssue) string {
		if len(issues) == 0 {
			return "  (none)"
		}
		var sb strings.Builder
		for _, iss := range issues {
			sb.WriteString(fmt.Sprintf("  - %s %s (assignee: %s, priority: %s)\n", iss.ID, iss.Summary, iss.Assignee, iss.Priority))
		}
		return sb.String()
	}

	prompt := fmt.Sprintf(`You are a PM assistant. Today is %s.

Generate a concise next-day action plan based on the following EOD data. Output as a bullet list (max 10 items). Focus on: follow-ups for skipped items, resolving blockers, reviewing items done today, and next priorities.

Completed today:
%s
Still in progress (had some activity):
%s
No movement today (skipped/stale):
%s
New blockers raised today:
%s

Next-day action plan:`,
		time.Now().Format("2006-01-02"),
		formatList(req.CompletedToday),
		formatList(req.StillInProgress),
		formatList(req.NoMovement),
		formatList(req.NewBlockers),
	)

	apiKey := os.Getenv("GROQ_API_KEY")
	if apiKey == "" {
		apiKey = os.Getenv("OPENAI_API_KEY")
	}
	if apiKey == "" {
		http.Error(w, "No AI API key configured (GROQ_API_KEY or OPENAI_API_KEY)", http.StatusInternalServerError)
		return
	}

	apiURL := "https://api.groq.com/openai/v1/chat/completions"
	model := "llama-3.3-70b-versatile"
	if os.Getenv("GROQ_API_KEY") == "" {
		apiURL = "https://api.openai.com/v1/chat/completions"
		model = "gpt-4o-mini"
	}

	reqBody := map[string]interface{}{
		"model": model,
		"messages": []map[string]string{
			{"role": "user", "content": prompt},
		},
		"stream": false,
	}
	bodyBytes, _ := json.Marshal(reqBody)

	httpReq, err := http.NewRequestWithContext(r.Context(), http.MethodPost, apiURL, bytes.NewBuffer(bodyBytes))
	if err != nil {
		http.Error(w, "Failed to create AI request", http.StatusInternalServerError)
		return
	}
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	httpReq.Header.Set("Content-Type", "application/json")

	httpClient := &http.Client{Timeout: 60 * time.Second}
	resp, err := httpClient.Do(httpReq)
	if err != nil {
		http.Error(w, "AI request failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		http.Error(w, "Failed to read AI response", http.StatusInternalServerError)
		return
	}

	var aiResp struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error,omitempty"`
	}
	if err := json.Unmarshal(respBytes, &aiResp); err != nil {
		http.Error(w, "Failed to parse AI response", http.StatusInternalServerError)
		return
	}
	if aiResp.Error != nil {
		http.Error(w, "AI error: "+aiResp.Error.Message, http.StatusInternalServerError)
		return
	}
	if len(aiResp.Choices) == 0 {
		http.Error(w, "No response from AI", http.StatusInternalServerError)
		return
	}

	planText := strings.TrimSpace(aiResp.Choices[0].Message.Content)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":   true,
		"plan_text": planText,
	})
}
