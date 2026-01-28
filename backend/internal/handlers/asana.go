package handlers

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/dhindsa/project-management/internal/database"
	"github.com/dhindsa/project-management/internal/middleware"
	"github.com/dhindsa/project-management/internal/models"
	"github.com/dhindsa/project-management/internal/services/asana"
	"github.com/gorilla/mux"
)

// AsanaHandler handles Asana integration API requests
type AsanaHandler struct {
	integrationRepo *database.IntegrationRepository
	taskRepo        *database.TaskRepository
	projectRepo     *database.ProjectRepository
	syncService     *asana.SyncService
	webhookService  *asana.WebhookService
}

// NewAsanaHandler creates a new Asana handler
func NewAsanaHandler() *AsanaHandler {
	return &AsanaHandler{
		integrationRepo: database.NewIntegrationRepository(),
		taskRepo:        database.NewTaskRepository(),
		projectRepo:     database.NewProjectRepository(),
		syncService:     asana.NewSyncService(),
		webhookService:  asana.NewWebhookService(),
	}
}

// ConnectAsana handles connecting an Asana account
func (h *AsanaHandler) ConnectAsana(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req models.ConnectAsanaRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Verify the access token by making a test request
	client := asana.NewClient(req.AccessToken)
	user, err := client.GetMe(r.Context())
	if err != nil {
		http.Error(w, "Invalid Asana access token: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Get workspaces to find the workspace ID
	workspaces, err := client.GetWorkspaces(r.Context())
	if err != nil {
		http.Error(w, "Failed to get workspaces: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if len(workspaces) == 0 {
		http.Error(w, "No workspaces found in Asana account", http.StatusBadRequest)
		return
	}

	// Use the first workspace or the specified one
	workspaceID := workspaces[0].GID
	workspaceName := workspaces[0].Name
	if req.WorkspaceID != "" {
		for _, ws := range workspaces {
			if ws.GID == req.WorkspaceID {
				workspaceID = ws.GID
				workspaceName = ws.Name
				break
			}
		}
	}

	// Save the integration
	integration := &models.AsanaIntegration{
		UserID:        userID,
		AccessToken:   req.AccessToken,
		WorkspaceID:   workspaceID,
		WorkspaceName: workspaceName,
		Connected:     true,
	}

	if err := h.integrationRepo.SaveAsanaIntegration(r.Context(), integration); err != nil {
		http.Error(w, "Failed to save integration: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Asana connected successfully",
		"user":    user.Name,
		"workspace": map[string]string{
			"id":   workspaceID,
			"name": workspaceName,
		},
	})
}

// DisconnectAsana handles disconnecting an Asana account
func (h *AsanaHandler) DisconnectAsana(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	if err := h.integrationRepo.DisconnectAsana(r.Context(), userID); err != nil {
		http.Error(w, "Failed to disconnect: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Asana disconnected successfully",
	})
}

// GetAsanaStatus returns the current Asana connection status
func (h *AsanaHandler) GetAsanaStatus(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	integration, err := h.integrationRepo.GetAsanaIntegration(r.Context(), userID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"connected": false,
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"connected":      integration.Connected,
		"workspace_id":   integration.WorkspaceID,
		"workspace_name": integration.WorkspaceName,
		"last_sync_at":   integration.LastSyncAt,
	})
}

// GetAsanaWorkspaces returns available Asana workspaces
func (h *AsanaHandler) GetAsanaWorkspaces(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	integration, err := h.integrationRepo.GetAsanaIntegration(r.Context(), userID)
	if err != nil || !integration.Connected {
		http.Error(w, "Asana not connected", http.StatusBadRequest)
		return
	}

	client := asana.NewClient(integration.AccessToken)
	workspaces, err := client.GetWorkspaces(r.Context())
	if err != nil {
		http.Error(w, "Failed to get workspaces: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(workspaces)
}

// GetAsanaProjects returns available Asana projects
func (h *AsanaHandler) GetAsanaProjects(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	projects, err := h.syncService.GetAsanaProjects(r.Context(), userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(projects)
}

// GetAsanaSections returns sections for an Asana project
func (h *AsanaHandler) GetAsanaSections(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	vars := mux.Vars(r)
	asanaProjectID := vars["asana_project_id"]

	sections, err := h.syncService.GetAsanaSections(r.Context(), userID, asanaProjectID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sections)
}

// LinkProject links a local project to an Asana project
func (h *AsanaHandler) LinkProject(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	vars := mux.Vars(r)
	projectID := vars["id"]

	var req struct {
		AsanaProjectID string `json:"asana_project_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if err := h.syncService.LinkProject(r.Context(), userID, projectID, req.AsanaProjectID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Project linked to Asana successfully",
	})
}

// SyncProject triggers a sync for a project
func (h *AsanaHandler) SyncProject(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	vars := mux.Vars(r)
	projectID := vars["id"]

	result, err := h.syncService.SyncProject(r.Context(), userID, projectID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// SyncTaskStatus handles real-time task status sync to Asana
func (h *AsanaHandler) SyncTaskStatus(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	vars := mux.Vars(r)
	taskID := vars["id"]

	var req struct {
		Status models.TaskStatus `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if err := h.syncService.SyncTaskStatus(r.Context(), userID, taskID, req.Status); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

// SetupWebhook creates a webhook for a project
func (h *AsanaHandler) SetupWebhook(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	vars := mux.Vars(r)
	projectID := vars["id"]

	var req struct {
		CallbackURL string `json:"callback_url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	webhookID, err := h.webhookService.SetupWebhook(r.Context(), userID, projectID, req.CallbackURL)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":    true,
		"webhook_id": webhookID,
	})
}

// HandleWebhook receives and processes Asana webhook events
// This endpoint does not require authentication as it's called by Asana
func (h *AsanaHandler) HandleWebhook(w http.ResponseWriter, r *http.Request) {
	// Asana sends a handshake request with X-Hook-Secret header
	// We need to respond with the same header to confirm
	hookSecret := r.Header.Get("X-Hook-Secret")
	if hookSecret != "" {
		w.Header().Set("X-Hook-Secret", hookSecret)
		w.WriteHeader(http.StatusOK)
		return
	}

	// Read the request body
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read body", http.StatusBadRequest)
		return
	}

	// Parse the webhook payload
	var payload asana.WebhookPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	// Process events asynchronously
	go func() {
		if err := h.webhookService.HandleWebhook(r.Context(), payload.Events); err != nil {
			// Log error but don't fail the webhook
			println("Webhook processing error:", err.Error())
		}
	}()

	// Always respond with 200 OK quickly to Asana
	w.WriteHeader(http.StatusOK)
}

// ImportFromEnv imports tasks from Asana using PAT from environment variable
// This is a simplified endpoint for quick testing without OAuth setup
func (h *AsanaHandler) ImportFromEnv(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Get PAT and project ID from environment
	asanaPAT := os.Getenv("ASANA_PAT")
	asanaProjectID := os.Getenv("ASANA_PROJECT_ID")

	if asanaPAT == "" || asanaProjectID == "" {
		http.Error(w, "ASANA_PAT and ASANA_PROJECT_ID environment variables are required", http.StatusBadRequest)
		return
	}

	client := asana.NewClient(asanaPAT)
	ctx := r.Context()

	// Get tasks from Asana
	asanaTasks, err := client.GetProjectTasks(ctx, asanaProjectID)
	if err != nil {
		http.Error(w, "Failed to fetch Asana tasks: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Get or create default project
	defaultProjectID, err := h.getOrCreateDefaultProject(ctx, userID)
	if err != nil {
		http.Error(w, "Failed to get/create default project: "+err.Error(), http.StatusInternalServerError)
		return
	}

	result := &asana.SyncResult{}

	for _, asanaTask := range asanaTasks {
		// Check if task exists
		existingTask, err := h.taskRepo.GetByAsanaID(ctx, asanaTask.GID)
		if err != nil && !strings.Contains(err.Error(), "no rows") {
			result.Errors = append(result.Errors, "Error checking task "+asanaTask.GID+": "+err.Error())
			continue
		}

		status := h.mapAsanaStatusToLocal(asanaTask)

		if existingTask != nil {
			// Update existing
			existingTask.Title = asanaTask.Name
			existingTask.Description = asanaTask.Notes
			existingTask.Status = status
			if asanaTask.DueOn != nil {
				dueDate, _ := time.Parse("2006-01-02", *asanaTask.DueOn)
				existingTask.DueDate = &dueDate
			}
			if err := h.taskRepo.Update(ctx, existingTask); err != nil {
				result.Errors = append(result.Errors, "Error updating task: "+err.Error())
				continue
			}
			result.TasksUpdated++
		} else {
			// Create new task
			newTask := &models.Task{
				Title:       asanaTask.Name,
				Description: asanaTask.Notes,
				Status:      status,
				Priority:    models.TaskPriorityMedium,
				ProjectID:   defaultProjectID,
				AsanaID:     &asanaTask.GID,
				AsanaURL:    &asanaTask.PermalinkURL,
				CreatedBy:   userID,
			}
			if asanaTask.DueOn != nil {
				dueDate, _ := time.Parse("2006-01-02", *asanaTask.DueOn)
				newTask.DueDate = &dueDate
			}

			if err := h.taskRepo.Create(ctx, newTask); err != nil {
				result.Errors = append(result.Errors, "Error creating task: "+err.Error())
				continue
			}
			result.TasksCreated++
		}
		result.TasksSynced++
	}

	log.Printf("Imported %d tasks from Asana (created: %d, updated: %d)", result.TasksSynced, result.TasksCreated, result.TasksUpdated)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Import completed",
		"data":    result,
	})
}

// PushToAsana pushes a single task update to Asana
func (h *AsanaHandler) PushToAsana(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	vars := mux.Vars(r)
	taskID := vars["id"]

	// Get PAT from environment
	asanaPAT := os.Getenv("ASANA_PAT")
	if asanaPAT == "" {
		http.Error(w, "ASANA_PAT environment variable is required", http.StatusBadRequest)
		return
	}

	// Get local task
	task, err := h.taskRepo.GetByID(r.Context(), taskID)
	if err != nil {
		http.Error(w, "Task not found: "+err.Error(), http.StatusNotFound)
		return
	}

	if task.AsanaID == nil || *task.AsanaID == "" {
		http.Error(w, "Task is not linked to Asana", http.StatusBadRequest)
		return
	}

	client := asana.NewClient(asanaPAT)

	// Update task in Asana
	completed := task.Status == models.TaskStatusDone
	updateReq := asana.UpdateTaskRequest{
		Name:      &task.Title,
		Notes:     &task.Description,
		Completed: &completed,
	}
	if task.DueDate != nil {
		dueStr := task.DueDate.Format("2006-01-02")
		updateReq.DueOn = &dueStr
	}

	_, err = client.UpdateTask(r.Context(), *task.AsanaID, updateReq)
	if err != nil {
		http.Error(w, "Failed to update Asana task: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Task synced to Asana",
	})
}

// getOrCreateDefaultProject gets or creates a default project for the user
func (h *AsanaHandler) getOrCreateDefaultProject(ctx context.Context, userID string) (string, error) {
	// Try to get existing projects for user
	projects, err := h.projectRepo.GetByOwnerID(ctx, userID)
	if err == nil && len(projects) > 0 {
		return projects[0].ID, nil
	}

	// Create default project
	asanaProjectID := os.Getenv("ASANA_PROJECT_ID")
	project := &models.Project{
		Name:           "Default Project",
		Description:    "Auto-created project for imported tasks",
		OwnerID:        userID,
		AsanaProjectID: &asanaProjectID,
	}

	if err := h.projectRepo.Create(ctx, project); err != nil {
		return "", err
	}

	return project.ID, nil
}

// mapAsanaStatusToLocal maps Asana task state to local status
func (h *AsanaHandler) mapAsanaStatusToLocal(task asana.Task) models.TaskStatus {
	if task.Completed {
		return models.TaskStatusDone
	}

	// Check section for more granular status
	for _, membership := range task.Memberships {
		if membership.Section != nil {
			sectionName := strings.ToLower(membership.Section.Name)
			switch {
			case strings.Contains(sectionName, "done") || strings.Contains(sectionName, "complete"):
				return models.TaskStatusDone
			case strings.Contains(sectionName, "progress") || strings.Contains(sectionName, "doing"):
				return models.TaskStatusInProgress
			case strings.Contains(sectionName, "review"):
				return models.TaskStatusReview
			case strings.Contains(sectionName, "todo") || strings.Contains(sectionName, "backlog"):
				return models.TaskStatusTodo
			}
		}
	}

	return models.TaskStatusTodo
}
