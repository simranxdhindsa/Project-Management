package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

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

	// Parse the morning assignments to extract task list
	taskTitles := parseTasksFromText(req.MorningAssignments)
	if len(taskTitles) == 0 {
		http.Error(w, "No tasks found in morning assignments", http.StatusBadRequest)
		return
	}

	// Create fake messages from the manual input for analysis
	messages := []ai.SlackMessageForAnalysis{
		{
			ID:        "manual-morning",
			UserName:  "Morning Assignment",
			Text:      req.MorningAssignments,
			Timestamp: "09:00",
		},
		{
			ID:        "manual-evening",
			UserName:  "Evening Update",
			Text:      req.EveningUpdates,
			Timestamp: "18:00",
		},
	}

	// Run AI analysis
	analyses, err := h.aiClient.AnalyzeMessages(r.Context(), messages, taskTitles)
	if err != nil {
		http.Error(w, "AI analysis failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Build status map from morning (all start as "assigned")
	morningStatuses := make(map[string]string)
	for _, title := range taskTitles {
		morningStatuses[title] = "todo"
	}

	// Compare with AI-detected statuses from evening update
	discrepancies := ai.CompareStatuses(analyses, morningStatuses)

	// Build per-person breakdown
	personBreakdown := buildPersonBreakdown(req.MorningAssignments, analyses)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":          true,
		"tasks_detected":   taskTitles,
		"analysis":         analyses,
		"discrepancies":    discrepancies,
		"person_breakdown": personBreakdown,
		"summary": map[string]interface{}{
			"total_tasks":   len(taskTitles),
			"completed":     countByStatus(analyses, "completed"),
			"in_progress":   countByStatus(analyses, "in_progress"),
			"blocked":       countByStatus(analyses, "blocked"),
			"not_mentioned": len(taskTitles) - len(analyses),
		},
	})
}

// parseTasksFromText extracts task titles from formatted text
func parseTasksFromText(text string) []string {
	var tasks []string
	lines := strings.Split(text, "\n")

	for _, line := range lines {
		line = strings.TrimSpace(line)

		// Skip empty lines, section headers with backticks, or lines that look like person names
		if line == "" ||
		   strings.HasPrefix(line, "`") ||
		   strings.HasPrefix(line, "@") ||
		   strings.Contains(strings.ToLower(line), "task list") {
			continue
		}

		// Look for bullet points or numbered lists
		if strings.HasPrefix(line, "•") || strings.HasPrefix(line, "-") || strings.HasPrefix(line, "*") {
			task := strings.TrimSpace(line[1:])
			// Remove priority markers like (High)
			task = strings.TrimSuffix(task, "(High)")
			task = strings.TrimSuffix(task, "(Medium)")
			task = strings.TrimSuffix(task, "(Low)")
			task = strings.TrimSpace(task)
			if task != "" {
				tasks = append(tasks, task)
			}
		} else {
			// Also accept plain text lines as tasks (for flexible format)
			// Skip very short lines or lines with common keywords
			if len(line) > 3 &&
			   !strings.Contains(strings.ToLower(line), "done:") &&
			   !strings.Contains(strings.ToLower(line), "pending:") &&
			   !strings.Contains(strings.ToLower(line), "in progress:") &&
			   !strings.Contains(strings.ToLower(line), "blocked:") {
				tasks = append(tasks, line)
			}
		}
	}

	return tasks
}

// buildPersonBreakdown groups tasks by person
func buildPersonBreakdown(morningText string, analyses []ai.TaskStatusAnalysis) []map[string]interface{} {
	type PersonTasks struct {
		Name      string
		Assigned  []string
		Completed []string
		Pending   []string
		Blocked   []string
	}

	people := make(map[string]*PersonTasks)
	currentPerson := ""

	lines := strings.Split(morningText, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)

		// Check if it's a person header - flexible format
		// Accepts: `@Name`, @Name, or just Name if line is short
		if strings.HasPrefix(line, "`@") && strings.HasSuffix(line, "`") {
			// Format: `@Name`
			currentPerson = strings.Trim(line, "`@")
		} else if strings.HasPrefix(line, "@") {
			// Format: @Name
			currentPerson = strings.TrimPrefix(line, "@")
			currentPerson = strings.TrimSpace(currentPerson)
			// Remove trailing colon if present
			currentPerson = strings.TrimSuffix(currentPerson, ":")
		}

		// Initialize person if new
		if currentPerson != "" {
			if _, exists := people[currentPerson]; !exists {
				people[currentPerson] = &PersonTasks{
					Name:      currentPerson,
					Assigned:  []string{},
					Completed: []string{},
					Pending:   []string{},
					Blocked:   []string{},
				}
			}
		}

		// Process task lines (with or without bullets)
		if currentPerson != "" && line != "" && !strings.HasPrefix(line, "@") && !strings.Contains(strings.ToLower(line), "task list") {
			var task string

			// Extract task from line with bullet
			if strings.HasPrefix(line, "•") || strings.HasPrefix(line, "-") || strings.HasPrefix(line, "*") {
				task = strings.TrimSpace(line[1:])
			} else if len(line) > 3 &&
			   !strings.Contains(strings.ToLower(line), "done:") &&
			   !strings.Contains(strings.ToLower(line), "pending:") &&
			   !strings.Contains(strings.ToLower(line), "in progress:") {
				// Accept plain text as task
				task = line
			}

			if task != "" {
				// Remove priority markers
				task = strings.TrimSuffix(task, "(High)")
				task = strings.TrimSuffix(task, "(Medium)")
				task = strings.TrimSuffix(task, "(Low)")
				task = strings.TrimSpace(task)

				if people[currentPerson] != nil {
					people[currentPerson].Assigned = append(people[currentPerson].Assigned, task)

					// Find status from analysis
					for _, analysis := range analyses {
						if strings.Contains(strings.ToLower(analysis.TaskTitle), strings.ToLower(task)) ||
						   strings.Contains(strings.ToLower(task), strings.ToLower(analysis.TaskTitle)) {
							switch normalizeStatus(analysis.DetectedStatus) {
							case "done":
								people[currentPerson].Completed = append(people[currentPerson].Completed, task)
							case "blocked":
								people[currentPerson].Blocked = append(people[currentPerson].Blocked, task)
							default:
								people[currentPerson].Pending = append(people[currentPerson].Pending, task)
							}
							break
						}
					}
				}
			}
		}
	}

	// Convert to slice
	result := make([]map[string]interface{}, 0, len(people))
	for _, person := range people {
		result = append(result, map[string]interface{}{
			"name":      person.Name,
			"assigned":  person.Assigned,
			"completed": person.Completed,
			"pending":   person.Pending,
			"blocked":   person.Blocked,
			"stats": map[string]int{
				"total":     len(person.Assigned),
				"completed": len(person.Completed),
				"pending":   len(person.Pending),
				"blocked":   len(person.Blocked),
			},
		})
	}

	return result
}

// countByStatus counts tasks with a specific status
func countByStatus(analyses []ai.TaskStatusAnalysis, status string) int {
	count := 0
	normalized := normalizeStatus(status)
	for _, analysis := range analyses {
		if normalizeStatus(analysis.DetectedStatus) == normalized {
			count++
		}
	}
	return count
}

// normalizeStatus helper function
func normalizeStatus(status string) string {
	status = strings.ToLower(status)
	switch status {
	case "completed", "done", "closed", "resolved":
		return "done"
	case "in_progress", "in progress", "working", "doing":
		return "in_progress"
	case "blocked", "stuck", "waiting":
		return "blocked"
	case "todo", "not_started", "new", "open":
		return "todo"
	default:
		return status
	}
}
