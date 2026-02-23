package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/dhindsa/project-management/internal/database"
	"github.com/dhindsa/project-management/internal/middleware"
	"github.com/dhindsa/project-management/internal/models"
	"github.com/gorilla/mux"
)

// ReminderHandler handles reminder API endpoints
type ReminderHandler struct {
	repo *database.ReminderRepository
}

// NewReminderHandler creates a new ReminderHandler
func NewReminderHandler() *ReminderHandler {
	return &ReminderHandler{
		repo: database.NewReminderRepository(),
	}
}

// GetReminders returns reminders for the authenticated user
func (h *ReminderHandler) GetReminders(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]interface{}{"success": false, "message": "Unauthorized"})
		return
	}

	reminders, err := h.repo.GetByUserID(r.Context(), userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{"success": false, "message": "Failed to fetch reminders: " + err.Error()})
		return
	}

	if reminders == nil {
		reminders = []*models.Reminder{}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "data": reminders})
}

// CreateReminder creates a new reminder
func (h *ReminderHandler) CreateReminder(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]interface{}{"success": false, "message": "Unauthorized"})
		return
	}

	var req models.CreateReminderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": "Invalid request body"})
		return
	}

	if req.Title == "" || req.TargetDate == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "message": "Title and target_date are required"})
		return
	}

	if req.Type == "" {
		req.Type = models.ReminderCustom
	}
	if req.Recurring == "" {
		req.Recurring = models.RecurringNone
	}

	reminder := &models.Reminder{
		UserID:         userID,
		Type:           req.Type,
		Title:          req.Title,
		Message:        req.Message,
		TargetDate:     req.TargetDate,
		TargetTime:     req.TargetTime,
		RelatedTaskID:  req.RelatedTaskID,
		RelatedIssueID: req.RelatedIssueID,
		Recurring:      req.Recurring,
	}

	if err := h.repo.Create(r.Context(), reminder); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{"success": false, "message": "Failed to create reminder: " + err.Error()})
		return
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{"success": true, "data": reminder})
}

// DismissReminder marks a reminder as dismissed
func (h *ReminderHandler) DismissReminder(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]interface{}{"success": false, "message": "Unauthorized"})
		return
	}

	vars := mux.Vars(r)
	if err := h.repo.Dismiss(r.Context(), vars["id"], userID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{"success": false, "message": "Failed to dismiss reminder: " + err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "message": "Reminder dismissed"})
}

// DeleteReminder deletes a reminder
func (h *ReminderHandler) DeleteReminder(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]interface{}{"success": false, "message": "Unauthorized"})
		return
	}

	vars := mux.Vars(r)
	if err := h.repo.Delete(r.Context(), vars["id"], userID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{"success": false, "message": "Failed to delete reminder: " + err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "message": "Reminder deleted"})
}
