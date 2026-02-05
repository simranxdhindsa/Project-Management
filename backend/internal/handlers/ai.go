package handlers

import (
	"encoding/json"
	"net/http"

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
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Get project ID from query params
	projectID := r.URL.Query().Get("project_id")
	if projectID == "" {
		http.Error(w, "project_id is required", http.StatusBadRequest)
		return
	}

	// Get yesterday's Slack messages
	messages, err := h.slackService.GetYesterdayMessages(r.Context(), userID)
	if err != nil {
		http.Error(w, "Failed to get Slack messages: "+err.Error(), http.StatusInternalServerError)
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
		http.Error(w, "Failed to get tasks: "+err.Error(), http.StatusInternalServerError)
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
		http.Error(w, "AI analysis failed: "+err.Error(), http.StatusInternalServerError)
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
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	discrepancies, err := h.integrationRepo.GetDiscrepancies(r.Context())
	if err != nil {
		http.Error(w, "Failed to get discrepancies: "+err.Error(), http.StatusInternalServerError)
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
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		MorningAssignments string `json:"morning_assignments"`
		EveningUpdates     string `json:"evening_updates"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.MorningAssignments == "" || req.EveningUpdates == "" {
		http.Error(w, "Both morning_assignments and evening_updates are required", http.StatusBadRequest)
		return
	}

	// Send both texts to AI and let it do all the parsing
	fullResponse, err := h.aiClient.AnalyzeFullInput(r.Context(), req.MorningAssignments, req.EveningUpdates)
	if err != nil {
		http.Error(w, "AI analysis failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Post-process: merge in_progress into pending and add stats for frontend compatibility
	personBreakdown := make([]map[string]interface{}, 0, len(fullResponse.PersonBreakdown))
	for _, person := range fullResponse.PersonBreakdown {
		// Merge in_progress into pending (frontend only has completed/pending/blocked)
		allPending := append(person.Pending, person.InProgress...)

		personBreakdown = append(personBreakdown, map[string]interface{}{
			"name":      person.Name,
			"assigned":  person.Assigned,
			"completed": person.Completed,
			"pending":   allPending,
			"blocked":   person.Blocked,
			"stats": map[string]int{
				"total":     len(person.Assigned),
				"completed": len(person.Completed),
				"pending":   len(allPending),
				"blocked":   len(person.Blocked),
			},
		})
	}

	// Collect all task titles for the response
	var taskTitles []string
	for _, a := range fullResponse.Analysis {
		taskTitles = append(taskTitles, a.TaskTitle)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":          true,
		"tasks_detected":   taskTitles,
		"analysis":         fullResponse.Analysis,
		"person_breakdown": personBreakdown,
		"summary": map[string]interface{}{
			"total_tasks":   fullResponse.Summary.TotalTasks,
			"completed":     fullResponse.Summary.Completed,
			"in_progress":   fullResponse.Summary.InProgress,
			"pending":       fullResponse.Summary.Pending,
			"blocked":       fullResponse.Summary.Blocked,
			"not_mentioned": fullResponse.Summary.NotMentioned,
		},
	})
}
