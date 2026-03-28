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

// sourceParam extracts the ?source= query param, defaulting to "youtrack"
func sourceParam(r *http.Request) string {
	s := r.URL.Query().Get("source")
	if s != "asana" && s != "youtrack" {
		return "youtrack"
	}
	return s
}

// Get returns the effective workflow config for the authenticated user
// GET /api/workflow-config?source=youtrack|asana
func (h *WorkflowConfigHandler) Get(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	source := sourceParam(r)
	cfg, err := h.configRepo.GetEffective(r.Context(), userID, source)
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
// PUT /api/workflow-config?source=youtrack|asana
func (h *WorkflowConfigHandler) Update(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	source := sourceParam(r)

	var cfg models.WorkflowConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		sendJSON(w, http.StatusBadRequest, Response{Success: false, Message: "Invalid request body"})
		return
	}

	if err := h.configRepo.Upsert(r.Context(), userID, source, &cfg); err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{Success: false, Message: "Failed to save workflow config"})
		return
	}

	updated, err := h.configRepo.GetEffective(r.Context(), userID, source)
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
// PUT /api/workflow-config/priorities?source=youtrack|asana
func (h *WorkflowConfigHandler) UpdatePriorities(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	source := sourceParam(r)

	var body struct {
		PriorityTags []models.PriorityTag `json:"priority_tags"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		sendJSON(w, http.StatusBadRequest, Response{Success: false, Message: "Invalid request body"})
		return
	}

	if err := h.configRepo.UpsertPriorityTags(r.Context(), userID, source, body.PriorityTags); err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{Success: false, Message: "Failed to save priority tags"})
		return
	}

	updated, err := h.configRepo.GetEffective(r.Context(), userID, source)
	if err != nil {
		sendJSON(w, http.StatusOK, Response{Success: true, Message: "Priority tags saved"})
		return
	}
	sendJSON(w, http.StatusOK, Response{Success: true, Data: updated})
}

// UpdateColumns updates only the column hierarchy
// PUT /api/workflow-config/columns?source=youtrack|asana
func (h *WorkflowConfigHandler) UpdateColumns(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	source := sourceParam(r)

	var body struct {
		ColumnHierarchy []models.ColumnState `json:"column_hierarchy"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		sendJSON(w, http.StatusBadRequest, Response{Success: false, Message: "Invalid request body"})
		return
	}

	if err := h.configRepo.UpsertColumnHierarchy(r.Context(), userID, source, body.ColumnHierarchy); err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{Success: false, Message: "Failed to save column hierarchy"})
		return
	}

	updated, err := h.configRepo.GetEffective(r.Context(), userID, source)
	if err != nil {
		sendJSON(w, http.StatusOK, Response{Success: true, Message: "Column hierarchy saved"})
		return
	}
	sendJSON(w, http.StatusOK, Response{Success: true, Data: updated})
}

// UpdateHotfixRules updates only the hotfix rules
// PUT /api/workflow-config/hotfix-rules?source=youtrack|asana
func (h *WorkflowConfigHandler) UpdateHotfixRules(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	source := sourceParam(r)

	var rules models.HotfixRules
	if err := json.NewDecoder(r.Body).Decode(&rules); err != nil {
		sendJSON(w, http.StatusBadRequest, Response{Success: false, Message: "Invalid request body"})
		return
	}

	if err := h.configRepo.UpsertHotfixRules(r.Context(), userID, source, rules); err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{Success: false, Message: "Failed to save hotfix rules"})
		return
	}

	updated, err := h.configRepo.GetEffective(r.Context(), userID, source)
	if err != nil {
		sendJSON(w, http.StatusOK, Response{Success: true, Message: "Hotfix rules saved"})
		return
	}
	sendJSON(w, http.StatusOK, Response{Success: true, Data: updated})
}

// UpdateReportConfig updates only the report configuration
// PUT /api/workflow-config/report?source=youtrack|asana
func (h *WorkflowConfigHandler) UpdateReportConfig(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	source := sourceParam(r)

	var rc models.ReportConfig
	if err := json.NewDecoder(r.Body).Decode(&rc); err != nil {
		sendJSON(w, http.StatusBadRequest, Response{Success: false, Message: "Invalid request body"})
		return
	}

	if err := h.configRepo.UpsertReportConfig(r.Context(), userID, source, rc); err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{Success: false, Message: "Failed to save report config"})
		return
	}

	updated, err := h.configRepo.GetEffective(r.Context(), userID, source)
	if err != nil {
		sendJSON(w, http.StatusOK, Response{Success: true, Message: "Report config saved"})
		return
	}
	sendJSON(w, http.StatusOK, Response{Success: true, Data: updated})
}

// Reset deletes the user's config for the given source, falling back to the global default
// POST /api/workflow-config/reset?source=youtrack|asana
func (h *WorkflowConfigHandler) Reset(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	source := sourceParam(r)

	if err := h.configRepo.ResetToDefault(r.Context(), userID, source); err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{Success: false, Message: "Failed to reset workflow config"})
		return
	}

	sendJSON(w, http.StatusOK, Response{Success: true, Message: "Workflow config reset to defaults"})
}

// GetDefaults returns the system default config for a given source (for UI "reset" preview)
// GET /api/workflow-config/defaults?source=youtrack|asana
func (h *WorkflowConfigHandler) GetDefaults(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	source := sourceParam(r)

	cfg, err := h.configRepo.GetSystemDefault(r.Context(), source)
	if err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{Success: false, Message: "Failed to load defaults"})
		return
	}

	sendJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"data":    cfg,
	})
}
