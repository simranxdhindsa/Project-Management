package handlers

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/dhindsa/project-management/internal/database"
	"github.com/dhindsa/project-management/internal/middleware"
	"github.com/dhindsa/project-management/internal/models"
	"github.com/dhindsa/project-management/internal/services/asana"
	"github.com/gorilla/mux"
)

// AsanaHandler handles Asana integration API requests
type AsanaHandler struct {
	integrationRepo *database.IntegrationRepository
	syncService     *asana.SyncService
	webhookService  *asana.WebhookService
}

// NewAsanaHandler creates a new Asana handler
func NewAsanaHandler() *AsanaHandler {
	return &AsanaHandler{
		integrationRepo: database.NewIntegrationRepository(),
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
