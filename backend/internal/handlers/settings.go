package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/dhindsa/project-management/internal/database"
	"github.com/dhindsa/project-management/internal/middleware"
	"github.com/dhindsa/project-management/internal/models"
	"github.com/dhindsa/project-management/internal/services/asana"
)

// SettingsHandler handles settings API requests
type SettingsHandler struct {
	settingsRepo *database.SettingsRepository
}

// NewSettingsHandler creates a new settings handler
func NewSettingsHandler() *SettingsHandler {
	return &SettingsHandler{
		settingsRepo: database.NewSettingsRepository(),
	}
}

// GetAsanaSettings returns Asana configuration (admin only)
func (h *SettingsHandler) GetAsanaSettings(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	settings, err := h.settingsRepo.GetAsanaSettings(r.Context())
	if err != nil {
		http.Error(w, "Failed to get settings: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Mask the PAT for security (show only last 4 chars)
	if settings.PAT != "" && len(settings.PAT) > 4 {
		settings.PAT = "****" + settings.PAT[len(settings.PAT)-4:]
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    settings,
	})
}

// UpdateAsanaSettings updates Asana configuration (admin only)
func (h *SettingsHandler) UpdateAsanaSettings(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req models.UpdateAsanaSettingsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	var asanaUserName string

	// Validate the PAT if provided
	if req.PAT != "" {
		client := asana.NewClient(req.PAT)
		user, err := client.GetMe(r.Context())
		if err != nil {
			http.Error(w, "Invalid Asana PAT: "+err.Error(), http.StatusBadRequest)
			return
		}
		asanaUserName = user.Name

		// Auto-fetch workspaces
		workspaces, err := client.GetWorkspaces(r.Context())
		if err == nil && len(workspaces) > 0 && req.WorkspaceID == "" {
			req.WorkspaceID = workspaces[0].GID
		}
	}

	if err := h.settingsRepo.UpdateAsanaSettings(r.Context(), &req, userID); err != nil {
		http.Error(w, "Failed to update settings: "+err.Error(), http.StatusInternalServerError)
		return
	}

	response := map[string]interface{}{
		"success": true,
		"message": "Asana settings updated successfully",
	}

	if asanaUserName != "" {
		response["asana_user"] = asanaUserName
		response["workspace_id"] = req.WorkspaceID
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// TestAsanaConnection tests the Asana connection
func (h *SettingsHandler) TestAsanaConnection(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	settings, err := h.settingsRepo.GetAsanaSettings(r.Context())
	if err != nil || !settings.Configured {
		http.Error(w, "Asana is not configured", http.StatusBadRequest)
		return
	}

	client := asana.NewClient(settings.PAT)
	user, err := client.GetMe(r.Context())
	if err != nil {
		http.Error(w, "Asana connection failed: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Get projects if we have a workspace
	var projects []asana.Project
	if settings.WorkspaceID != "" {
		projects, _ = client.GetProjects(r.Context(), settings.WorkspaceID)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":    true,
		"connected":  true,
		"user":       user.Name,
		"projects":   projects,
	})
}

// GetAsanaConfigStatus returns whether Asana is configured (accessible to all authenticated users)
func (h *SettingsHandler) GetAsanaConfigStatus(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	settings, err := h.settingsRepo.GetAsanaSettings(r.Context())
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"data": map[string]interface{}{
				"configured": false,
			},
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data": map[string]interface{}{
			"configured":   settings.Configured,
			"has_project":  settings.ProjectID != "",
		},
	})
}

// GetAsanaProjects returns available Asana projects for selection
func (h *SettingsHandler) GetAsanaProjects(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	settings, err := h.settingsRepo.GetAsanaSettings(r.Context())
	if err != nil || !settings.Configured {
		http.Error(w, "Asana is not configured", http.StatusBadRequest)
		return
	}

	client := asana.NewClient(settings.PAT)

	// Get workspace ID
	workspaceID := settings.WorkspaceID
	if workspaceID == "" {
		workspaces, err := client.GetWorkspaces(r.Context())
		if err != nil || len(workspaces) == 0 {
			http.Error(w, "No workspaces found", http.StatusBadRequest)
			return
		}
		workspaceID = workspaces[0].GID
	}

	projects, err := client.GetProjects(r.Context(), workspaceID)
	if err != nil {
		http.Error(w, "Failed to fetch projects: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    projects,
	})
}
