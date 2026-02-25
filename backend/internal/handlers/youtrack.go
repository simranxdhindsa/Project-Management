package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/dhindsa/project-management/internal/database"
	"github.com/dhindsa/project-management/internal/middleware"
	"github.com/dhindsa/project-management/internal/models"
	"github.com/dhindsa/project-management/internal/services/ai"
	"github.com/dhindsa/project-management/internal/services/youtrack"
	"github.com/gorilla/mux"
)

// YouTrackHandler handles YouTrack integration API requests
type YouTrackHandler struct {
	taskRepo     *database.TaskRepository
	projectRepo  *database.ProjectRepository
	settingsRepo *database.SettingsRepository
	sectionRepo  *database.SectionRepository
	reportRepo   *database.ReportRepository
	notifHandler *NotificationHandler
	sseHub       *SSEHub
}

// NewYouTrackHandler creates a new YouTrack handler
func NewYouTrackHandler(sseHub ...*SSEHub) *YouTrackHandler {
	h := &YouTrackHandler{
		taskRepo:     database.NewTaskRepository(),
		projectRepo:  database.NewProjectRepository(),
		settingsRepo: database.NewSettingsRepository(),
		sectionRepo:  database.NewSectionRepository(),
		reportRepo:   database.NewReportRepository(),
	}
	if len(sseHub) > 0 {
		h.sseHub = sseHub[0]
	}
	return h
}

// SetNotificationHandler wires the notification handler for overdue alerts
func (h *YouTrackHandler) SetNotificationHandler(notifHandler *NotificationHandler) {
	h.notifHandler = notifHandler
}

// getYouTrackClient creates a YouTrack client from settings or environment
func (h *YouTrackHandler) getYouTrackClient(ctx context.Context) (*youtrack.Client, error) {
	// Try to get credentials from database first
	settings, _ := h.settingsRepo.GetYouTrackSettings(ctx)

	var baseURL, token, projectID, boardID string

	if settings != nil && settings.Configured {
		baseURL = settings.BaseURL
		token = settings.Token
		projectID = settings.ProjectID
		boardID = settings.BoardID
	}

	// Fallback to environment variables if DB not configured
	if baseURL == "" {
		baseURL = os.Getenv("YOUTRACK_BASE_URL")
	}
	if token == "" {
		token = os.Getenv("YOUTRACK_TOKEN")
	}
	if projectID == "" {
		projectID = os.Getenv("YOUTRACK_PROJECT_ID")
	}
	if boardID == "" {
		boardID = os.Getenv("YOUTRACK_BOARD_ID")
	}

	if baseURL == "" || token == "" || projectID == "" {
		return nil, nil // Not configured
	}

	client := youtrack.NewClient(baseURL, token, projectID)
	if boardID != "" {
		client.SetBoardID(boardID)
	}

	return client, nil
}

// GetStatus returns the current YouTrack connection status
func (h *YouTrackHandler) GetStatus(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	client, err := h.getYouTrackClient(r.Context())
	if err != nil || client == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"connected":  false,
			"configured": false,
		})
		return
	}

	// Test connection
	err = client.TestConnection(r.Context())
	connected := err == nil

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"connected":  connected,
		"configured": true,
		"error":      func() string { if err != nil { return err.Error() }; return "" }(),
	})
}

// TestConnection tests the YouTrack connection with provided credentials
func (h *YouTrackHandler) TestConnection(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		BaseURL   string `json:"base_url"`
		Token     string `json:"token"`
		ProjectID string `json:"project_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	client := youtrack.NewClient(req.BaseURL, req.Token, req.ProjectID)
	err := client.TestConnection(r.Context())
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Connection successful",
	})
}

// GetProjects returns available YouTrack projects
func (h *YouTrackHandler) GetProjects(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	client, err := h.getYouTrackClient(r.Context())
	if err != nil || client == nil {
		http.Error(w, "YouTrack is not configured", http.StatusBadRequest)
		return
	}

	projects, err := client.GetProjects(r.Context())
	if err != nil {
		http.Error(w, "Failed to get projects: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    projects,
	})
}

// GetBoards returns available YouTrack agile boards
func (h *YouTrackHandler) GetBoards(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	client, err := h.getYouTrackClient(r.Context())
	if err != nil || client == nil {
		http.Error(w, "YouTrack is not configured", http.StatusBadRequest)
		return
	}

	boards, err := client.GetBoards(r.Context())
	if err != nil {
		http.Error(w, "Failed to get boards: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    boards,
	})
}

// GetStates returns workflow states for the configured project
func (h *YouTrackHandler) GetStates(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	client, err := h.getYouTrackClient(r.Context())
	if err != nil || client == nil {
		http.Error(w, "YouTrack is not configured", http.StatusBadRequest)
		return
	}

	states, err := client.GetStates(r.Context())
	if err != nil {
		http.Error(w, "Failed to get states: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    states,
	})
}

// GetBoardColumns returns columns from a specific agile board
func (h *YouTrackHandler) GetBoardColumns(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	vars := mux.Vars(r)
	boardID := vars["board_id"]

	client, err := h.getYouTrackClient(r.Context())
	if err != nil || client == nil {
		http.Error(w, "YouTrack is not configured", http.StatusBadRequest)
		return
	}

	columns, err := client.GetBoardColumns(r.Context(), boardID)
	if err != nil {
		http.Error(w, "Failed to get columns: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    columns,
	})
}

// GetUsers returns all YouTrack users
func (h *YouTrackHandler) GetUsers(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	client, err := h.getYouTrackClient(r.Context())
	if err != nil || client == nil {
		http.Error(w, "YouTrack is not configured", http.StatusBadRequest)
		return
	}

	users, err := client.GetUsers(r.Context())
	if err != nil {
		http.Error(w, "Failed to get users: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    users,
	})
}

// GetIssues returns all issues from the configured project
func (h *YouTrackHandler) GetIssues(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	client, err := h.getYouTrackClient(r.Context())
	if err != nil || client == nil {
		http.Error(w, "YouTrack is not configured", http.StatusBadRequest)
		return
	}

	issues, err := client.GetIssues(r.Context())
	if err != nil {
		http.Error(w, "Failed to get issues: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Transform issues to include extracted fields
	baseURL := client.GetBaseURL()
	var response []map[string]interface{}
	for _, issue := range issues {
		assignee := youtrack.GetAssignee(issue)
		if assignee != nil && assignee.AvatarUrl != "" && !strings.HasPrefix(assignee.AvatarUrl, "http") {
			assignee.AvatarUrl = baseURL + assignee.AvatarUrl
		}
		response = append(response, map[string]interface{}{
			"id":          issue.ID,
			"summary":     issue.Summary,
			"description": issue.Description,
			"status":      youtrack.GetStatus(issue),
			"subsystem":   youtrack.GetSubsystem(issue),
			"priority":    youtrack.GetPriority(issue),
			"assignee":    assignee,
			"created":     issue.Created,
			"updated":     issue.Updated,
			"attachments": issue.Attachments,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    response,
	})
}

// GetIssue returns a single issue by ID
func (h *YouTrackHandler) GetIssue(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	vars := mux.Vars(r)
	issueID := vars["issue_id"]

	client, err := h.getYouTrackClient(r.Context())
	if err != nil || client == nil {
		http.Error(w, "YouTrack is not configured", http.StatusBadRequest)
		return
	}

	issue, err := client.GetIssue(r.Context(), issueID)
	if err != nil {
		http.Error(w, "Failed to get issue: "+err.Error(), http.StatusInternalServerError)
		return
	}

	assignee := youtrack.GetAssignee(*issue)
	if assignee != nil && assignee.AvatarUrl != "" && !strings.HasPrefix(assignee.AvatarUrl, "http") {
		assignee.AvatarUrl = client.GetBaseURL() + assignee.AvatarUrl
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data": map[string]interface{}{
			"id":          issue.ID,
			"summary":     issue.Summary,
			"description": issue.Description,
			"status":      youtrack.GetStatus(*issue),
			"subsystem":   youtrack.GetSubsystem(*issue),
			"priority":    youtrack.GetPriority(*issue),
			"assignee":    assignee,
			"created":     issue.Created,
			"updated":     issue.Updated,
			"attachments": issue.Attachments,
		},
	})
}

// CreateIssue creates a new issue in YouTrack
func (h *YouTrackHandler) CreateIssue(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		Summary             string `json:"summary"`
		Description         string `json:"description"`
		State               string `json:"state,omitempty"`
		Priority            string `json:"priority,omitempty"`
		AssigneeLogin       string `json:"assignee_login,omitempty"`
		Subsystem           string `json:"subsystem,omitempty"`
		DueDate             *int64 `json:"due_date,omitempty"`       // Unix ms timestamp
		EstimationMinutes   *int   `json:"estimation_minutes,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	client, err := h.getYouTrackClient(r.Context())
	if err != nil || client == nil {
		http.Error(w, "YouTrack is not configured", http.StatusBadRequest)
		return
	}

	createReq := youtrack.CreateIssueRequest{
		Summary:     req.Summary,
		Description: req.Description,
	}

	var fields []youtrack.CustomField
	if req.State != "" {
		fields = append(fields, youtrack.CustomField{
			Type:  "StateIssueCustomField",
			Name:  "State",
			Value: map[string]string{"name": req.State},
		})
	}
	if req.Priority != "" {
		fields = append(fields, youtrack.CustomField{
			Type:  "SingleEnumIssueCustomField",
			Name:  "Priority",
			Value: map[string]string{"name": req.Priority},
		})
	}
	if req.AssigneeLogin != "" {
		fields = append(fields, youtrack.CustomField{
			Type:  "SingleUserIssueCustomField",
			Name:  "Assignee",
			Value: map[string]string{"login": req.AssigneeLogin},
		})
	}
	if req.Subsystem != "" {
		fields = append(fields, youtrack.CustomField{
			Type:  "MultiOwnedIssueCustomField",
			Name:  "Subsystem",
			Value: []map[string]string{{"name": req.Subsystem}},
		})
	}
	if req.DueDate != nil {
		fields = append(fields, youtrack.CustomField{
			Type:  "DateIssueCustomField",
			Name:  "Due Date",
			Value: *req.DueDate,
		})
	}
	if req.EstimationMinutes != nil {
		fields = append(fields, youtrack.CustomField{
			Type:  "PeriodIssueCustomField",
			Name:  "Estimation",
			Value: map[string]interface{}{"minutes": *req.EstimationMinutes},
		})
	}
	if len(fields) > 0 {
		createReq.CustomFields = fields
	}

	issue, err := client.CreateIssue(r.Context(), createReq)
	if err != nil {
		http.Error(w, "Failed to create issue: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    issue,
	})
}

// UpdateIssue updates an existing issue
func (h *YouTrackHandler) UpdateIssue(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	vars := mux.Vars(r)
	issueID := vars["issue_id"]

	var req struct {
		Summary     string `json:"summary,omitempty"`
		Description string `json:"description,omitempty"`
		State       string `json:"state,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	client, err := h.getYouTrackClient(r.Context())
	if err != nil || client == nil {
		http.Error(w, "YouTrack is not configured", http.StatusBadRequest)
		return
	}

	updateReq := youtrack.UpdateIssueRequest{
		Summary:     req.Summary,
		Description: req.Description,
	}

	if req.State != "" {
		updateReq.CustomFields = []youtrack.CustomField{
			{
				Name:  "State",
				Value: map[string]string{"name": req.State},
			},
		}
	}

	issue, err := client.UpdateIssue(r.Context(), issueID, updateReq)
	if err != nil {
		http.Error(w, "Failed to update issue: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    issue,
	})
}

// UpdateIssueState updates just the state of an issue
func (h *YouTrackHandler) UpdateIssueState(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	vars := mux.Vars(r)
	issueID := vars["issue_id"]

	var req struct {
		State string `json:"state"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	client, err := h.getYouTrackClient(r.Context())
	if err != nil || client == nil {
		http.Error(w, "YouTrack is not configured", http.StatusBadRequest)
		return
	}

	if err := client.UpdateIssueState(r.Context(), issueID, req.State); err != nil {
		http.Error(w, "Failed to update state: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "State updated successfully",
	})
}

// DeleteIssue deletes an issue from YouTrack
func (h *YouTrackHandler) DeleteIssue(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	vars := mux.Vars(r)
	issueID := vars["issue_id"]

	client, err := h.getYouTrackClient(r.Context())
	if err != nil || client == nil {
		http.Error(w, "YouTrack is not configured", http.StatusBadRequest)
		return
	}

	if err := client.DeleteIssue(r.Context(), issueID); err != nil {
		http.Error(w, "Failed to delete issue: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Issue deleted successfully",
	})
}

// ImportFromYouTrack imports issues from YouTrack to local database
func (h *YouTrackHandler) ImportFromYouTrack(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	client, err := h.getYouTrackClient(r.Context())
	if err != nil || client == nil {
		http.Error(w, "YouTrack is not configured. Please configure YouTrack in Settings.", http.StatusBadRequest)
		return
	}

	ctx := r.Context()

	// Get or create default project
	defaultProjectID, err := h.getOrCreateDefaultProject(ctx, userID)
	if err != nil {
		http.Error(w, "Failed to get/create default project: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Fetch states and save as sections
	states, err := client.GetStates(ctx)
	if err != nil {
		log.Printf("Warning: Failed to fetch YouTrack states: %v", err)
	} else {
		var sectionsToSave []models.AsanaSection
		for i, state := range states {
			sectionsToSave = append(sectionsToSave, models.AsanaSection{
				ProjectID:       defaultProjectID,
				AsanaSectionGID: state.Name, // Use state name as ID
				Name:            state.Name,
				Position:        i,
			})
		}
		if err := h.sectionRepo.SaveSections(ctx, defaultProjectID, sectionsToSave); err != nil {
			log.Printf("Warning: Failed to save sections: %v", err)
		} else {
			log.Printf("Synced %d states from YouTrack", len(sectionsToSave))
		}
	}

	// Get issues from YouTrack
	issues, err := client.GetIssues(ctx)
	if err != nil {
		http.Error(w, "Failed to fetch YouTrack issues: "+err.Error(), http.StatusInternalServerError)
		return
	}

	var tasksCreated, tasksUpdated, tasksSynced int
	var errors []string

	for _, issue := range issues {
		// Check if task exists by YouTrack ID
		existingTask, err := h.taskRepo.GetByYouTrackID(ctx, issue.ID)
		if err != nil && !strings.Contains(err.Error(), "no rows") {
			errors = append(errors, "Error checking issue "+issue.ID+": "+err.Error())
			continue
		}

		status := h.mapYouTrackStatusToLocal(youtrack.GetStatus(issue))
		priority := h.mapYouTrackPriorityToLocal(youtrack.GetPriority(issue))
		stateName := youtrack.GetStatus(issue)

		if existingTask != nil {
			// Update existing
			existingTask.Title = issue.Summary
			existingTask.Description = issue.Description
			existingTask.Status = status
			existingTask.Priority = priority
			existingTask.SectionName = &stateName
			if err := h.taskRepo.Update(ctx, existingTask); err != nil {
				errors = append(errors, "Error updating task: "+err.Error())
				continue
			}
			tasksUpdated++
		} else {
			// Create new task
			createdTime := time.Unix(issue.Created/1000, 0)
			newTask := &models.Task{
				Title:        issue.Summary,
				Description:  issue.Description,
				Status:       status,
				Priority:     priority,
				ProjectID:    defaultProjectID,
				YouTrackID:   &issue.ID,
				SectionName:  &stateName,
				CreatedBy:    userID,
				CreatedAt:    createdTime,
			}

			// Set assignee if available
			if assignee := youtrack.GetAssignee(issue); assignee != nil {
				newTask.Assignee = &models.Assignee{
					ID:   assignee.ID,
					Name: assignee.FullName,
				}
			}

			if err := h.taskRepo.Create(ctx, newTask); err != nil {
				errors = append(errors, "Error creating task: "+err.Error())
				continue
			}
			tasksCreated++
		}
		tasksSynced++
	}

	log.Printf("Imported %d issues from YouTrack (created: %d, updated: %d)", tasksSynced, tasksCreated, tasksUpdated)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Import completed",
		"data": map[string]interface{}{
			"tasks_synced":  tasksSynced,
			"tasks_created": tasksCreated,
			"tasks_updated": tasksUpdated,
			"errors":        errors,
		},
	})
}

// SyncTaskToYouTrack syncs a local task to YouTrack
func (h *YouTrackHandler) SyncTaskToYouTrack(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	vars := mux.Vars(r)
	taskID := vars["id"]

	client, err := h.getYouTrackClient(r.Context())
	if err != nil || client == nil {
		http.Error(w, "YouTrack is not configured", http.StatusBadRequest)
		return
	}

	// Get local task
	task, err := h.taskRepo.GetByID(r.Context(), taskID)
	if err != nil {
		http.Error(w, "Task not found: "+err.Error(), http.StatusNotFound)
		return
	}

	if task.YouTrackID == nil || *task.YouTrackID == "" {
		http.Error(w, "Task is not linked to YouTrack", http.StatusBadRequest)
		return
	}

	// Map local status to YouTrack state
	state := h.mapLocalStatusToYouTrack(task.Status)

	updateReq := youtrack.UpdateIssueRequest{
		Summary:     task.Title,
		Description: task.Description,
		CustomFields: []youtrack.CustomField{
			{
				Name:  "State",
				Value: map[string]string{"name": state},
			},
		},
	}

	_, err = client.UpdateIssue(r.Context(), *task.YouTrackID, updateReq)
	if err != nil {
		http.Error(w, "Failed to update YouTrack issue: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Task synced to YouTrack",
	})
}

// GetProjectSectionsFromDB returns sections stored in database for a project
func (h *YouTrackHandler) GetProjectSectionsFromDB(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Get project ID from URL or use default project
	vars := mux.Vars(r)
	projectID := vars["id"]

	// If no project ID specified, get the default/first project
	if projectID == "" {
		projects, err := h.projectRepo.GetByOwnerID(r.Context(), userID)
		if err != nil || len(projects) == 0 {
			// Return empty sections if no project
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": true,
				"data":    []models.SectionResponse{},
			})
			return
		}
		projectID = projects[0].ID
	}

	sections, err := h.sectionRepo.GetProjectSections(r.Context(), projectID)
	if err != nil {
		http.Error(w, "Failed to get sections: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Convert to response format
	var response []models.SectionResponse
	for _, s := range sections {
		response = append(response, s.ToResponse())
	}

	// If no sections stored, return default fallback sections
	if len(response) == 0 {
		response = []models.SectionResponse{
			{GID: "Open", Name: "Open", Position: 0},
			{GID: "In Progress", Name: "In Progress", Position: 1},
			{GID: "Fixed", Name: "Fixed", Position: 2},
			{GID: "Done", Name: "Done", Position: 3},
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    response,
	})
}

// Helper methods

func (h *YouTrackHandler) getOrCreateDefaultProject(ctx context.Context, userID string) (string, error) {
	projects, err := h.projectRepo.GetByOwnerID(ctx, userID)
	if err == nil && len(projects) > 0 {
		return projects[0].ID, nil
	}

	project := &models.Project{
		Name:        "Default Project",
		Description: "Auto-created project for imported tasks",
		OwnerID:     userID,
	}

	if err := h.projectRepo.Create(ctx, project); err != nil {
		return "", err
	}

	return project.ID, nil
}

func (h *YouTrackHandler) mapYouTrackStatusToLocal(status string) models.TaskStatus {
	statusLower := strings.ToLower(status)
	switch {
	case strings.Contains(statusLower, "done") || strings.Contains(statusLower, "fixed") || strings.Contains(statusLower, "complete"):
		return models.TaskStatusDone
	case strings.Contains(statusLower, "progress") || strings.Contains(statusLower, "doing"):
		return models.TaskStatusInProgress
	case strings.Contains(statusLower, "review") || strings.Contains(statusLower, "verify"):
		return models.TaskStatusReview
	case strings.Contains(statusLower, "open") || strings.Contains(statusLower, "submitted"):
		return models.TaskStatusTodo
	default:
		return models.TaskStatusTodo
	}
}

func (h *YouTrackHandler) mapYouTrackPriorityToLocal(priority string) models.TaskPriority {
	priorityLower := strings.ToLower(priority)
	switch {
	case strings.Contains(priorityLower, "critical") || strings.Contains(priorityLower, "show-stopper"):
		return models.TaskPriorityHigh
	case strings.Contains(priorityLower, "major"):
		return models.TaskPriorityHigh
	case strings.Contains(priorityLower, "minor"):
		return models.TaskPriorityLow
	default:
		return models.TaskPriorityMedium
	}
}

func (h *YouTrackHandler) mapLocalStatusToYouTrack(status models.TaskStatus) string {
	switch status {
	case models.TaskStatusDone:
		return "Fixed"
	case models.TaskStatusInProgress:
		return "In Progress"
	case models.TaskStatusReview:
		return "To be discussed"
	default:
		return "Open"
	}
}

// ============================================================
// AI Analysis → YouTrack Matching & Bulk Move
// ============================================================

// MatchAnalysis matches AI analysis results against YouTrack issues using fuzzy matching
func (h *YouTrackHandler) MatchAnalysis(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		PersonBreakdown []struct {
			Name      string   `json:"name"`
			Assigned  []string `json:"assigned"`
			Completed []string `json:"completed"`
			Pending   []string `json:"pending"`
			Blocked   []string `json:"blocked"`
		} `json:"person_breakdown"`
		Analysis []struct {
			TaskTitle      string   `json:"task_title"`
			DetectedStatus string   `json:"detected_status"`
			Confidence     float64  `json:"confidence"`
			Evidence       []string `json:"evidence"`
			Assignee       string   `json:"assignee"`
		} `json:"analysis"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	client, err := h.getYouTrackClient(r.Context())
	if err != nil || client == nil {
		http.Error(w, "YouTrack is not configured", http.StatusBadRequest)
		return
	}

	// Fetch all YouTrack issues
	issues, err := client.GetIssues(r.Context())
	if err != nil {
		http.Error(w, "Failed to fetch YouTrack issues: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Build a list of all tasks from person_breakdown with their status and person
	type taskEntry struct {
		Title  string
		Person string
		Status string // completed, pending, blocked
	}
	var allTasks []taskEntry

	for _, person := range req.PersonBreakdown {
		for _, t := range person.Completed {
			allTasks = append(allTasks, taskEntry{Title: t, Person: person.Name, Status: "completed"})
		}
		for _, t := range person.Pending {
			allTasks = append(allTasks, taskEntry{Title: t, Person: person.Name, Status: "in_progress"})
		}
		for _, t := range person.Blocked {
			allTasks = append(allTasks, taskEntry{Title: t, Person: person.Name, Status: "blocked"})
		}
	}

	// Match each task against YouTrack issues
	type matchResult struct {
		TaskTitle     string                 `json:"task_title"`
		Person        string                 `json:"person"`
		Status        string                 `json:"status"`
		YouTrackIssue map[string]interface{} `json:"youtrack_issue"`
		ProposedState string                 `json:"proposed_state"`
		Confidence    float64                `json:"confidence"`
	}

	var matches []matchResult
	var unmatchedTasks []map[string]string
	matchedIssueIDs := make(map[string]bool)

	for _, task := range allTasks {
		bestMatch := -1
		bestScore := 0.0

		for i, issue := range issues {
			score := fuzzyMatchScore(task.Title, issue.Summary)
			if score > bestScore && score >= 0.4 {
				bestScore = score
				bestMatch = i
			}
		}

		if bestMatch >= 0 {
			issue := issues[bestMatch]
			currentState := youtrack.GetStatus(issue)

			// Determine proposed state based on AI status
			proposedState := ""
			switch task.Status {
			case "completed":
				proposedState = "DEV"
			case "in_progress":
				proposedState = "In Progress"
			case "blocked":
				proposedState = "In Progress" // blocked stays in progress
			}

			matches = append(matches, matchResult{
				TaskTitle: task.Title,
				Person:    task.Person,
				Status:    task.Status,
				YouTrackIssue: map[string]interface{}{
					"id":            issue.ID,
					"summary":       issue.Summary,
					"current_state": currentState,
				},
				ProposedState: proposedState,
				Confidence:    bestScore,
			})
			matchedIssueIDs[issue.ID] = true
		} else {
			unmatchedTasks = append(unmatchedTasks, map[string]string{
				"task_title": task.Title,
				"person":     task.Person,
				"status":     task.Status,
			})
		}
	}

	// Collect unmatched YouTrack issues
	var unmatchedIssues []map[string]interface{}
	for _, issue := range issues {
		if !matchedIssueIDs[issue.ID] {
			unmatchedIssues = append(unmatchedIssues, map[string]interface{}{
				"id":            issue.ID,
				"summary":       issue.Summary,
				"current_state": youtrack.GetStatus(issue),
			})
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":          true,
		"matches":          matches,
		"unmatched_tasks":  unmatchedTasks,
		"unmatched_issues": unmatchedIssues,
	})
}

// BulkUpdateStates updates the state of multiple YouTrack issues at once
func (h *YouTrackHandler) BulkUpdateStates(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		Updates []struct {
			IssueID  string `json:"issue_id"`
			NewState string `json:"new_state"`
		} `json:"updates"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	client, err := h.getYouTrackClient(r.Context())
	if err != nil || client == nil {
		http.Error(w, "YouTrack is not configured", http.StatusBadRequest)
		return
	}

	var succeeded, failed int
	var errors []string

	for _, update := range req.Updates {
		if err := client.UpdateIssueState(r.Context(), update.IssueID, update.NewState); err != nil {
			failed++
			errors = append(errors, update.IssueID+": "+err.Error())
			log.Printf("Failed to update %s to %s: %v", update.IssueID, update.NewState, err)
		} else {
			succeeded++
			log.Printf("Updated %s → %s", update.IssueID, update.NewState)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":   failed == 0,
		"succeeded": succeeded,
		"failed":    failed,
		"errors":    errors,
		"message":   fmt.Sprintf("Updated %d/%d issues", succeeded, len(req.Updates)),
	})
}

// ============================================================
// Fuzzy Matching Helpers
// ============================================================

// fuzzyMatchScore returns a similarity score between 0 and 1 for two strings
func fuzzyMatchScore(a, b string) float64 {
	a = normalizeFuzzy(a)
	b = normalizeFuzzy(b)

	if a == "" || b == "" {
		return 0
	}

	// Exact match
	if a == b {
		return 1.0
	}

	// One contains the other (substring match)
	if strings.Contains(a, b) || strings.Contains(b, a) {
		shorter := len(a)
		longer := len(b)
		if shorter > longer {
			shorter, longer = longer, shorter
		}
		return 0.7 + 0.3*float64(shorter)/float64(longer)
	}

	// Levenshtein distance ratio
	dist := levenshtein(a, b)
	maxLen := len(a)
	if len(b) > maxLen {
		maxLen = len(b)
	}
	if maxLen == 0 {
		return 0
	}
	return 1.0 - float64(dist)/float64(maxLen)
}

// normalizeFuzzy normalizes a string for fuzzy matching
func normalizeFuzzy(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	// Remove common punctuation
	replacer := strings.NewReplacer(
		".", "", ",", "", "!", "", "?", "", ":", "", ";", "",
		"(", "", ")", "", "[", "", "]", "", "'", "", "\"", "",
		"-", " ", "_", " ",
	)
	s = replacer.Replace(s)
	// Collapse multiple spaces
	parts := strings.Fields(s)
	return strings.Join(parts, " ")
}

// levenshtein calculates the Levenshtein distance between two strings
func levenshtein(a, b string) int {
	la := len(a)
	lb := len(b)

	if la == 0 {
		return lb
	}
	if lb == 0 {
		return la
	}

	// Use two rows instead of full matrix for memory efficiency
	prev := make([]int, lb+1)
	curr := make([]int, lb+1)

	for j := 0; j <= lb; j++ {
		prev[j] = j
	}

	for i := 1; i <= la; i++ {
		curr[0] = i
		for j := 1; j <= lb; j++ {
			cost := 1
			if a[i-1] == b[j-1] {
				cost = 0
			}
			curr[j] = min(curr[j-1]+1, min(prev[j]+1, prev[j-1]+cost))
		}
		prev, curr = curr, prev
	}

	return prev[lb]
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// ============================================================
// YouTrack Issues Grouped by Assignee (for Daily Task List)
// ============================================================

var priorityRegex = regexp.MustCompile(`^(P[0-3])\s+(.*)`)

// extractPriorityFromSummary parses "P2 FE UI: Avatar Bug" -> ("P2", "P2 FE UI: Avatar Bug")
// The clean_title keeps the priority prefix since it's part of the Slack message format
func extractPriorityFromSummary(summary string) (string, string) {
	matches := priorityRegex.FindStringSubmatch(summary)
	if len(matches) == 3 {
		return matches[1], summary // Keep full summary as title
	}
	return "", summary
}

// GetIssuesGroupedByAssignee returns active YouTrack issues grouped by assignee
func (h *YouTrackHandler) GetIssuesGroupedByAssignee(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	client, err := h.getYouTrackClient(r.Context())
	if err != nil || client == nil {
		http.Error(w, "YouTrack is not configured", http.StatusBadRequest)
		return
	}

	issues, err := client.GetIssues(r.Context())
	if err != nil {
		http.Error(w, "Failed to get issues: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Group by assignee, filter out Done/Fixed
	type issueItem struct {
		ID          string `json:"id"`
		Summary     string `json:"summary"`
		PriorityTag string `json:"priority_tag"`
		CleanTitle  string `json:"clean_title"`
		Status      string `json:"status"`
		Selected    bool   `json:"selected"`
	}

	type assigneeGroup struct {
		UserName    string      `json:"user_name"`
		SlackHandle string      `json:"slack_handle"`
		Issues      []issueItem `json:"issues"`
	}

	groups := make(map[string]*assigneeGroup)
	var unassignedIssues []issueItem

	for _, issue := range issues {
		status := youtrack.GetStatus(issue)
		statusLower := strings.ToLower(status)

		// Skip done/fixed issues
		if statusLower == "done" || statusLower == "fixed" {
			continue
		}

		priorityTag, cleanTitle := extractPriorityFromSummary(issue.Summary)

		item := issueItem{
			ID:          issue.ID,
			Summary:     issue.Summary,
			PriorityTag: priorityTag,
			CleanTitle:  cleanTitle,
			Status:      status,
			Selected:    true,
		}

		assignee := youtrack.GetAssignee(issue)
		if assignee != nil && assignee.FullName != "" {
			name := assignee.FullName
			if groups[name] == nil {
				groups[name] = &assigneeGroup{
					UserName:    name,
					SlackHandle: "@" + name,
					Issues:      []issueItem{},
				}
			}
			groups[name].Issues = append(groups[name].Issues, item)
		} else {
			unassignedIssues = append(unassignedIssues, item)
		}
	}

	// Convert map to slice
	var assignments []assigneeGroup
	for _, group := range groups {
		assignments = append(assignments, *group)
	}

	// Add unassigned group if any
	if len(unassignedIssues) > 0 {
		assignments = append(assignments, assigneeGroup{
			UserName:    "Unassigned",
			SlackHandle: "@Unassigned",
			Issues:      unassignedIssues,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data": map[string]interface{}{
			"assignments": assignments,
		},
	})
}

// ============================================================
// Workflow State Order & Backward Movement Detection
// ============================================================

// stateOrder maps lowercase state names to their workflow position.
// Based on actual YouTrack project states confirmed via /api/youtrack/states:
// Backlog(0) → In Progress(1) → DEV(2) → Ready for Stage(3) → STAGE(4) → Ready for PROD(5) → PROD(6) → Closed/Done(7)
// Blocked and Findings are treated as lateral states at In Progress level.
var stateOrder = map[string]int{
	"backlog":         0,
	"open":            0,
	"submitted":       0,
	"in progress":     1,
	"blocked":         1,  // lateral — not forward, not backward relative to In Progress
	"findings":        1,  // lateral
	"dev":             2,
	"ready for stage": 3,
	"stage":           4,
	"ready for prod":  5,
	"ready for prd":   5,
	"prod":            6,
	"mobile done":     6,
	"done":            7,
	"fixed":           7,
	"closed":          7,
}

func getStateIndex(state string) int {
	if idx, ok := stateOrder[strings.ToLower(state)]; ok {
		return idx
	}
	return 0
}

func isBackwardMove(currentState, proposedState string) bool {
	return getStateIndex(proposedState) < getStateIndex(currentState)
}

// GetSyncRecommendations compares AI analysis against YouTrack states and returns recommendations
func (h *YouTrackHandler) GetSyncRecommendations(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		PersonBreakdown []struct {
			Name      string   `json:"name"`
			Assigned  []string `json:"assigned"`
			Completed []string `json:"completed"`
			Pending   []string `json:"pending"`
			Blocked   []string `json:"blocked"`
		} `json:"person_breakdown"`
		Analysis []struct {
			TaskTitle      string   `json:"task_title"`
			DetectedStatus string   `json:"detected_status"`
			Confidence     float64  `json:"confidence"`
			Evidence       []string `json:"evidence"`
			Assignee       string   `json:"assignee"`
		} `json:"analysis"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	client, err := h.getYouTrackClient(r.Context())
	if err != nil || client == nil {
		http.Error(w, "YouTrack is not configured", http.StatusBadRequest)
		return
	}

	issues, err := client.GetIssues(r.Context())
	if err != nil {
		http.Error(w, "Failed to fetch YouTrack issues: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Build task list from person_breakdown
	type taskEntry struct {
		Title  string
		Person string
		Status string
	}
	var allTasks []taskEntry

	for _, person := range req.PersonBreakdown {
		for _, t := range person.Completed {
			allTasks = append(allTasks, taskEntry{Title: t, Person: person.Name, Status: "completed"})
		}
		for _, t := range person.Pending {
			allTasks = append(allTasks, taskEntry{Title: t, Person: person.Name, Status: "in_progress"})
		}
		for _, t := range person.Blocked {
			allTasks = append(allTasks, taskEntry{Title: t, Person: person.Name, Status: "blocked"})
		}
	}

	// Match and generate recommendations
	type recommendation struct {
		IssueID       string  `json:"issue_id"`
		Summary       string  `json:"summary"`
		Person        string  `json:"person"`
		CurrentState  string  `json:"current_state"`
		ProposedState string  `json:"proposed_state"`
		Reason        string  `json:"reason"`
		Backward      bool    `json:"backward"`
		Confidence    float64 `json:"confidence"`
	}

	var recommendations []recommendation

	for _, task := range allTasks {
		bestMatch := -1
		bestScore := 0.0

		for i, issue := range issues {
			score := fuzzyMatchScore(task.Title, issue.Summary)
			if score > bestScore && score >= 0.4 {
				bestScore = score
				bestMatch = i
			}
		}

		if bestMatch < 0 {
			continue
		}

		issue := issues[bestMatch]
		currentState := youtrack.GetStatus(issue)

		// Determine proposed state
		var proposedState string
		switch task.Status {
		case "completed":
			proposedState = "DEV"
		case "in_progress":
			proposedState = "In Progress"
		case "blocked":
			proposedState = "In Progress"
		}

		if proposedState == "" {
			continue
		}

		// Skip if already in the proposed state
		if strings.EqualFold(currentState, proposedState) {
			continue
		}

		backward := isBackwardMove(currentState, proposedState)
		reason := fmt.Sprintf("AI analysis detected status '%s' but YouTrack shows '%s'", task.Status, currentState)

		recommendations = append(recommendations, recommendation{
			IssueID:       issue.ID,
			Summary:       issue.Summary,
			Person:        task.Person,
			CurrentState:  currentState,
			ProposedState: proposedState,
			Reason:        reason,
			Backward:      backward,
			Confidence:    bestScore,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":         true,
		"recommendations": recommendations,
	})
}

// ============================================================
// PM Assistant Query (AI Chat with YouTrack Context)
// ============================================================

// defaultPMAssistantPrompt is used when no active pm_assistant bot config exists.
const defaultPMAssistantPrompt = `You are a PM Assistant for a software development team.

## Your Role
Answer questions about YouTrack issues and time tracking data provided below. Be concise and accurate.

## Assignee Task Format
When asked for tasks assigned to a specific person, ALWAYS respond in this exact format:

@{assignee_name}

{Status}:
{issueID} {summary}

Group by status (Backlog, In Progress, Blocked, DEV, Done). One ticket per line. No tables, no pipes, no extra metadata.

Example:
@simranjot

In Progress:
3-671 FE Studio: UI theme text issue
ARD-801 API refactor

Blocked:
3-896 FE UI: Mic remains activated when holding spacebar

## General Format
- Use bullet points for lists
- Use tables only for multi-column comparisons (e.g. showing all assignees side by side)
- Bold (**text**) for important flags (OVERDUE, MOVED BACK)
- Group data by assignee when showing team workload

## Key Rules
- OVERDUE = ticket's time in In Progress exceeds its priority threshold (P0:4h P1:24h P2:48h Other:72h)
- MOVED BACK = ticket transitioned to a less-advanced state (e.g. DEV→In Progress, In Progress→Backlog) — treat as regression
- PINNED = PM has manually flagged this ticket as important — always mention these first
- If the query is ambiguous, make reasonable assumptions and state them

Today's date: {{DATE}}`

// pmStateOrder is used to detect moved-back (regression) transitions.
var pmStateOrder = map[string]int{
	"backlog": 0, "open": 0,
	"in progress": 1,
	"dev": 2,
	"stage": 3, "ready for stage": 3,
	"prod": 4, "ready for prod": 4,
	"done": 5, "closed": 5, "won't fix": 5, "duplicate": 5, "mobile done": 5,
}

func pmIsMovedBack(from, to string) bool {
	toRank, toOk := pmStateOrder[strings.ToLower(to)]
	fromRank, fromOk := pmStateOrder[strings.ToLower(from)]
	if !toOk || !fromOk {
		return false
	}
	return toRank < fromRank
}

func pmOverdueThreshold(priority string) float64 {
	switch strings.ToUpper(priority) {
	case "P0", "CRITICAL":
		return 4
	case "P1":
		return 24
	case "P2":
		return 48
	default:
		return 72
	}
}

// PMAssistantQuery handles natural language queries against YouTrack + time tracking data.
// It loads an active pm_assistant bot config for custom instructions, injects live data,
// and supports multi-turn conversation history.
func (h *YouTrackHandler) PMAssistantQuery(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		Query   string           `json:"query"`
		History []ai.ConvMessage `json:"history"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Query == "" {
		http.Error(w, "Invalid request: query is required", http.StatusBadRequest)
		return
	}

	// ── 1. Load custom instructions from active pm_assistant bot config ──────
	botRepo := database.NewBotConfigRepository()
	bots, _ := botRepo.GetByType(r.Context(), models.BotTypePMAssistant)
	customInstructions := ""
	for _, b := range bots {
		if b.IsActive {
			customInstructions = b.Prompt
			break
		}
	}
	if customInstructions == "" {
		customInstructions = defaultPMAssistantPrompt
	}
	// Substitute {{DATE}} variable
	customInstructions = strings.ReplaceAll(customInstructions, "{{DATE}}", time.Now().Format("2006-01-02"))

	// ── 2. Fetch live YouTrack issues ────────────────────────────────────────
	var issueSection strings.Builder
	issueSection.WriteString("\n\n---\n## Live YouTrack Issues (current state)\n")
	issueSection.WriteString("Format: ID | Priority | Summary | Status | Assignee\n\n")

	ytClient, err := h.getYouTrackClient(r.Context())
	if err == nil && ytClient != nil {
		issues, err := ytClient.GetIssues(r.Context())
		if err == nil {
			for _, issue := range issues {
				status := youtrack.GetStatus(issue)
				assignee := youtrack.GetAssignee(issue)
				assigneeName := "Unassigned"
				if assignee != nil && assignee.FullName != "" {
					assigneeName = assignee.FullName
				}
				priority := ""
				for _, p := range []string{"P0", "P1", "P2", "P3"} {
					if strings.HasPrefix(issue.Summary, p+" ") {
						priority = p
						break
					}
				}
				issueSection.WriteString(fmt.Sprintf("- %s | %s | %s | %s | %s\n",
					issue.ID, priority, issue.Summary, status, assigneeName))
			}
		} else {
			issueSection.WriteString("(Failed to fetch live issues: " + err.Error() + ")\n")
		}
	} else {
		issueSection.WriteString("(YouTrack not configured — no live issue data)\n")
	}

	// ── 3. Fetch time tracking log ───────────────────────────────────────────
	var trackingSection strings.Builder
	trackingSection.WriteString("\n\n---\n## Time Tracking History (In Progress transitions)\n")
	trackingSection.WriteString("Format: IssueID | Summary | Assignee | MovedBy | From→To | Hours | Overdue? | MovedBack? | EnteredAt | Pinned?\n\n")

	reportRepo := database.NewReportRepository()
	pinnedIDs, _ := reportRepo.GetPinnedIssueIDs(r.Context(), userID)
	pinnedSet := make(map[string]bool, len(pinnedIDs))
	for _, id := range pinnedIDs {
		pinnedSet[id] = true
	}

	trackingLogs, trackErr := reportRepo.GetTimeTracking(r.Context(), database.TimeTrackingParams{})
	if trackErr == nil && len(trackingLogs) > 0 {
		for _, row := range trackingLogs {
			hours := 0.0
			if row.DurationInPrevStateHours != nil {
				hours = *row.DurationInPrevStateHours
			}
			threshold := pmOverdueThreshold(row.Priority)
			overdue := hours > threshold && row.DurationInPrevStateHours != nil
			overdueStr := "No"
			if overdue {
				overdueStr = fmt.Sprintf("OVERDUE (>%.0fh threshold)", threshold)
			}
			movedBack := pmIsMovedBack(row.FromState, row.ToState)
			movedBackStr := "No"
			if movedBack {
				movedBackStr = "MOVED BACK"
			}
			pinnedStr := "-"
			if pinnedSet[row.IssueID] {
				pinnedStr = "PINNED"
			}
			enteredAt := row.TransitionedAt.Format("2006-01-02 15:04")

			// Show "LIVE" for currently active In Progress entries
			hoursStr := fmt.Sprintf("%.1fh", hours)
			if strings.EqualFold(row.ToState, "in progress") && row.DurationInPrevStateHours == nil {
				hoursStr = fmt.Sprintf("%.1fh (LIVE)", hours)
			}

			trackingSection.WriteString(fmt.Sprintf("- %s | %s | %s | %s | %s→%s | %s | %s | %s | %s | %s\n",
				row.IssueID, row.IssueSummary, row.Assignee, row.MovedBy,
				row.FromState, row.ToState,
				hoursStr, overdueStr, movedBackStr, enteredAt, pinnedStr))
		}
		trackingSection.WriteString(fmt.Sprintf("\nOverdue thresholds: P0=4h, P1=24h, P2=48h, Other=72h\n"))
	} else if trackErr != nil {
		trackingSection.WriteString("(Failed to load time tracking data: " + trackErr.Error() + ")\n")
	} else {
		trackingSection.WriteString("(No time tracking data yet — run Sync History to import)\n")
	}

	// ── 4. Assemble full system prompt ───────────────────────────────────────
	systemPrompt := customInstructions + issueSection.String() + trackingSection.String()

	// ── 5. Query AI with conversation history ────────────────────────────────
	response, err := ai.QueryWithHistory(r.Context(), systemPrompt, req.History, req.Query)
	if err != nil {
		http.Error(w, "AI query failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data": map[string]interface{}{
			"response": response,
		},
	})
}

// ============================================================
// YouTrack Webhook (Real-time State Updates)
// ============================================================

// HandleWebhook receives and processes YouTrack webhook events
// This endpoint does NOT require authentication — called by YouTrack server
func (h *YouTrackHandler) HandleWebhook(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		log.Printf("[YouTrack Webhook] Failed to read body: %v", err)
		http.Error(w, "Failed to read body", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	// Log full raw payload so we can diagnose the exact structure YouTrack sends
	log.Printf("[YouTrack Webhook] Received payload (%d bytes): %s", len(body), string(body))

	// YouTrack sends an array of events or a single event object
	// Try to parse as a single event first, then as an array
	var events []youtrack.WebhookEvent

	var singleEvent youtrack.WebhookEvent
	if err := json.Unmarshal(body, &singleEvent); err == nil && singleEvent.Issue != nil {
		events = append(events, singleEvent)
	} else {
		// Try as array
		if err := json.Unmarshal(body, &events); err != nil {
			log.Printf("[YouTrack Webhook] Failed to parse payload: %v", err)
			// Still respond 200 so YouTrack doesn't retry
			w.WriteHeader(http.StatusOK)
			return
		}
	}

	// Process events asynchronously so we respond quickly
	go h.processWebhookEvents(events)

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// processWebhookEvents handles YouTrack webhook events in the background
func (h *YouTrackHandler) processWebhookEvents(events []youtrack.WebhookEvent) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	for _, event := range events {
		if event.Issue == nil {
			log.Printf("[YouTrack Webhook] Skipping event with no issue field")
			continue
		}

		// Prefer the human-readable ID (e.g. "ARD-628") over internal ID (e.g. "3-671").
		// YouTrack Cloud sends idReadable in the issue object; top-level issueId is also readable.
		issueID := event.Issue.ID
		if event.Issue.IDReadable != "" {
			issueID = event.Issue.IDReadable
		} else if event.IssueID != "" {
			issueID = event.IssueID
		}
		summary := event.Issue.Summary

		// Extract assignee, priority and the person who made the change
		assignee := ""
		priority := ""
		movedBy := ""
		if event.Issue != nil {
			if u := youtrack.GetAssignee(*event.Issue); u != nil {
				if u.FullName != "" {
					assignee = u.FullName
				} else {
					assignee = u.Login
				}
			}
			priority = youtrack.GetPriority(*event.Issue)
		}
		if updater := event.GetUpdater(); updater != nil {
			if updater.FullName != "" {
				movedBy = updater.FullName
			} else {
				movedBy = updater.Login
			}
		}

		log.Printf("[YouTrack Webhook] Processing event for issue=%q summary=%q movedBy=%q assignee=%q", issueID, summary, movedBy, assignee)

		for _, change := range event.NormalizedChanges() {
			oldValue := youtrack.ExtractFieldChangeValue(change.OldValue)
			newValue := youtrack.ExtractFieldChangeValue(change.NewValue)

			log.Printf("[YouTrack Webhook] Issue %s field change: name=%q old=%q new=%q", issueID, change.Name, oldValue, newValue)

			if oldValue == "" || newValue == "" || oldValue == newValue {
				continue
			}

			// Broadcast SSE event for ALL field changes so frontend can react
			if h.sseHub != nil {
				h.sseHub.Broadcast(SSEEvent{
					Type: "youtrack_update",
					Data: map[string]interface{}{
						"issue_id":  issueID,
						"field":     change.Name,
						"old_value": oldValue,
						"new_value": newValue,
						"summary":   summary,
					},
				})
			}

			// Only process State changes for task sync + time tracking
			// Use case-insensitive match — YouTrack may send "state" or "State"
			if !strings.EqualFold(change.Name, "State") {
				continue
			}

			log.Printf("[YouTrack Webhook] State change confirmed: %s → %s for %s", oldValue, newValue, issueID)

			backward := isBackwardMove(oldValue, newValue)

			// --- Fetch latest comment for backward moves and blocked transitions ---
			// We do this synchronously (before inserting state log) so we can store the comment.
			latestComment := ""
			if backward || strings.EqualFold(newValue, "blocked") {
				if ytClient, err := h.getYouTrackClient(ctx); err == nil && ytClient != nil {
					if comments, err := ytClient.GetIssueComments(ctx, issueID); err == nil && len(comments) > 0 {
						latestComment = comments[len(comments)-1]
					}
				}
			}

			// --- Time Tracking: record state transition (with comment for backward/blocked moves) ---
			if h.reportRepo != nil {
				stateLog := &database.IssueStateLog{
					IssueID:        issueID,
					IssueSummary:   summary,
					Assignee:       assignee,
					MovedBy:        movedBy,
					FromState:      oldValue,
					ToState:        newValue,
					Priority:       priority,
					TransitionedAt: time.Now(),
					Comment:        latestComment,
				}
				if err := h.reportRepo.InsertStateLog(ctx, stateLog); err != nil {
					log.Printf("[YouTrack Webhook] Failed to insert state log for %s: %v", issueID, err)
				} else {
					log.Printf("[YouTrack Webhook] State log recorded: %s → %s for %s (moved by: %s)", oldValue, newValue, issueID, movedBy)
				}
			}

			// --- Moved-by mismatch: notify when someone else moves a ticket ---
			if h.notifHandler != nil && assignee != "" && movedBy != "" && assignee != movedBy {
				notif := &models.Notification{
					Type:    "warning",
					Title:   "Ticket Moved by Non-Assignee: " + issueID,
					Message: fmt.Sprintf("%s (%s) was moved %s → %s by %s, but is assigned to %s", issueID, summary, oldValue, newValue, movedBy, assignee),
				}
				if err := h.notifHandler.CreateAndBroadcast(ctx, notif); err != nil {
					log.Printf("[YouTrack Webhook] Failed to send mismatch notification: %v", err)
				}
			}

			// --- Blocked notification: use already-fetched comment ---
			if strings.EqualFold(newValue, "blocked") && h.notifHandler != nil {
				h.notifyBlocked(ctx, issueID, summary, assignee, latestComment)
			}

			// --- Moved to DEV: "done" notification ---
			if strings.EqualFold(newValue, "dev") && h.notifHandler != nil {
				mover := movedBy
				if mover == "" {
					mover = assignee
				}
				notif := &models.Notification{
					Type:    "success",
					Title:   "Ticket Done: " + issueID,
					Message: fmt.Sprintf("%s (%s) moved to DEV by %s", issueID, summary, mover),
				}
				if err := h.notifHandler.CreateAndBroadcast(ctx, notif); err != nil {
					log.Printf("[YouTrack Webhook] Failed to send done notification: %v", err)
				}
			}

			// --- Backward movement: critical notification with comment check ---
			if backward {
				log.Printf("[YouTrack Webhook] ⚠ BACKWARD MOVE: %s → %s for %s (comment: %q)", oldValue, newValue, issueID, latestComment)
				if h.notifHandler != nil {
					mover := movedBy
					if mover == "" {
						mover = assignee
					}
					var msg string
					if latestComment != "" {
						msg = fmt.Sprintf("%s (%s) moved backward: %s → %s by %s. Reason: %s", issueID, summary, oldValue, newValue, mover, latestComment)
					} else {
						msg = fmt.Sprintf("%s (%s) moved backward: %s → %s by %s. ⚠ NO REASON COMMENT FOUND — developer must explain why.", issueID, summary, oldValue, newValue, mover)
					}
					notif := &models.Notification{
						Type:    "danger",
						Title:   fmt.Sprintf("⚠ Backward Move: %s (%s → %s)", issueID, oldValue, newValue),
						Message: msg,
					}
					_ = h.notifHandler.CreateAndBroadcast(ctx, notif)
				}
			}

			// Update the matching local task if it exists
			task, err := h.taskRepo.GetByYouTrackID(ctx, issueID)
			if err != nil {
				log.Printf("[YouTrack Webhook] No local task for %s: %v", issueID, err)
				continue
			}

			newLocalStatus := h.mapYouTrackStatusToLocal(newValue)
			task.Status = newLocalStatus
			sectionName := newValue
			task.SectionName = &sectionName

			if err := h.taskRepo.Update(ctx, task); err != nil {
				log.Printf("[YouTrack Webhook] Failed to update local task for %s: %v", issueID, err)
			} else {
				log.Printf("[YouTrack Webhook] Updated local task %s → %s", issueID, newLocalStatus)
			}
		}
	}
}

// notifyBlocked fires a notification when a ticket moves to Blocked state.
// latestComment is the already-fetched YouTrack comment (may be empty).
func (h *YouTrackHandler) notifyBlocked(ctx context.Context, issueID, summary, assignee, latestComment string) {
	msg := fmt.Sprintf("%s (%s) is BLOCKED", issueID, summary)
	if latestComment != "" {
		msg += " — Reason: " + latestComment
	} else {
		msg += " — ⚠ No reason comment found. Developer must add a comment explaining the blocker."
	}
	if assignee != "" {
		msg += " | Assignee: " + assignee
	}

	notif := &models.Notification{
		Type:    "danger",
		Title:   "Blocked: " + issueID,
		Message: msg,
	}
	if err := h.notifHandler.CreateAndBroadcast(ctx, notif); err != nil {
		log.Printf("[YouTrack Webhook] Failed to send blocked notification: %v", err)
	}
}

// overdueThresholdHours returns hours before a ticket is considered overdue by priority
func overdueThresholdHours(priority string) float64 {
	switch strings.ToUpper(priority) {
	case "P0", "CRITICAL":
		return 4
	case "P1":
		return 24
	case "P2":
		return 48
	default: // P3, Normal, Other
		return 72
	}
}
