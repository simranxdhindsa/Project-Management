package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/dhindsa/project-management/internal/database"
	"github.com/dhindsa/project-management/internal/middleware"
	"github.com/dhindsa/project-management/internal/models"
)

// WorkflowConfigHandler handles workflow configuration endpoints
type WorkflowConfigHandler struct {
	configRepo *database.WorkflowConfigRepository
}

// NewWorkflowConfigHandler creates a new WorkflowConfigHandler
func NewWorkflowConfigHandler() *WorkflowConfigHandler {
	return &WorkflowConfigHandler{
		configRepo: database.NewWorkflowConfigRepository(),
	}
}

// Get returns the effective workflow config for the authenticated user
// GET /api/workflow-config
func (h *WorkflowConfigHandler) Get(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	cfg, err := h.configRepo.GetEffective(r.Context(), userID)
	if err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{Success: false, Message: "Failed to load workflow config"})
		return
	}

	sendJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"data":    cfg,
	})
}

// Update upserts the full workflow config for the authenticated user
// PUT /api/workflow-config
func (h *WorkflowConfigHandler) Update(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	var cfg models.WorkflowConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		sendJSON(w, http.StatusBadRequest, Response{Success: false, Message: "Invalid request body"})
		return
	}

	if err := h.configRepo.Upsert(r.Context(), userID, &cfg); err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{Success: false, Message: "Failed to save workflow config"})
		return
	}

	// Return updated config
	updated, err := h.configRepo.GetEffective(r.Context(), userID)
	if err != nil {
		sendJSON(w, http.StatusOK, Response{Success: true, Message: "Workflow config saved"})
		return
	}

	sendJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"data":    updated,
	})
}

// UpdatePriorities updates only the priority tags
// PUT /api/workflow-config/priorities
func (h *WorkflowConfigHandler) UpdatePriorities(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	var body struct {
		PriorityTags []models.PriorityTag `json:"priority_tags"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		sendJSON(w, http.StatusBadRequest, Response{Success: false, Message: "Invalid request body"})
		return
	}
	tags := body.PriorityTags

	if err := h.configRepo.UpsertPriorityTags(r.Context(), userID, tags); err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{Success: false, Message: "Failed to save priority tags"})
		return
	}

	updated, err := h.configRepo.GetEffective(r.Context(), userID)
	if err != nil {
		sendJSON(w, http.StatusOK, Response{Success: true, Message: "Priority tags saved"})
		return
	}
	sendJSON(w, http.StatusOK, Response{Success: true, Data: updated})
}

// UpdateColumns updates only the column hierarchy
// PUT /api/workflow-config/columns
func (h *WorkflowConfigHandler) UpdateColumns(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	var body struct {
		ColumnHierarchy []models.ColumnState `json:"column_hierarchy"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		sendJSON(w, http.StatusBadRequest, Response{Success: false, Message: "Invalid request body"})
		return
	}
	columns := body.ColumnHierarchy

	if err := h.configRepo.UpsertColumnHierarchy(r.Context(), userID, columns); err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{Success: false, Message: "Failed to save column hierarchy"})
		return
	}

	updated, err := h.configRepo.GetEffective(r.Context(), userID)
	if err != nil {
		sendJSON(w, http.StatusOK, Response{Success: true, Message: "Column hierarchy saved"})
		return
	}
	sendJSON(w, http.StatusOK, Response{Success: true, Data: updated})
}

// UpdateHotfixRules updates only the hotfix rules
// PUT /api/workflow-config/hotfix-rules
func (h *WorkflowConfigHandler) UpdateHotfixRules(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	var rules models.HotfixRules
	if err := json.NewDecoder(r.Body).Decode(&rules); err != nil {
		sendJSON(w, http.StatusBadRequest, Response{Success: false, Message: "Invalid request body"})
		return
	}

	if err := h.configRepo.UpsertHotfixRules(r.Context(), userID, rules); err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{Success: false, Message: "Failed to save hotfix rules"})
		return
	}

	updated, err := h.configRepo.GetEffective(r.Context(), userID)
	if err != nil {
		sendJSON(w, http.StatusOK, Response{Success: true, Message: "Hotfix rules saved"})
		return
	}
	sendJSON(w, http.StatusOK, Response{Success: true, Data: updated})
}

// UpdateReportConfig updates only the report configuration
// PUT /api/workflow-config/report
func (h *WorkflowConfigHandler) UpdateReportConfig(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	var rc models.ReportConfig
	if err := json.NewDecoder(r.Body).Decode(&rc); err != nil {
		sendJSON(w, http.StatusBadRequest, Response{Success: false, Message: "Invalid request body"})
		return
	}

	if err := h.configRepo.UpsertReportConfig(r.Context(), userID, rc); err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{Success: false, Message: "Failed to save report config"})
		return
	}

	updated, err := h.configRepo.GetEffective(r.Context(), userID)
	if err != nil {
		sendJSON(w, http.StatusOK, Response{Success: true, Message: "Report config saved"})
		return
	}
	sendJSON(w, http.StatusOK, Response{Success: true, Data: updated})
}

// Reset deletes the user's config, falling back to the global default
// POST /api/workflow-config/reset
func (h *WorkflowConfigHandler) Reset(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	if err := h.configRepo.ResetToDefault(r.Context(), userID); err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{Success: false, Message: "Failed to reset workflow config"})
		return
	}

	sendJSON(w, http.StatusOK, Response{Success: true, Message: "Workflow config reset to defaults"})
}

// GetDefaults returns the system default config (for UI "reset" preview)
// GET /api/workflow-config/defaults
func (h *WorkflowConfigHandler) GetDefaults(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	cfg, err := h.configRepo.GetSystemDefault(r.Context())
	if err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{Success: false, Message: "Failed to load defaults"})
		return
	}

	sendJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"data":    cfg,
	})
}
