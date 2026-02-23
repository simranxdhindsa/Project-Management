package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/dhindsa/project-management/internal/database"
	"github.com/dhindsa/project-management/internal/middleware"
	"github.com/dhindsa/project-management/internal/models"
	"github.com/gorilla/mux"
)

// NotificationHandler handles notification API endpoints
type NotificationHandler struct {
	repo   *database.NotificationRepository
	sseHub *SSEHub
}

// NewNotificationHandler creates a new NotificationHandler
func NewNotificationHandler(sseHub *SSEHub) *NotificationHandler {
	return &NotificationHandler{
		repo:   database.NewNotificationRepository(),
		sseHub: sseHub,
	}
}

// CreateAndBroadcast creates a notification and broadcasts it via SSE
func (h *NotificationHandler) CreateAndBroadcast(ctx context.Context, notif *models.Notification) error {
	if err := h.repo.Create(ctx, notif); err != nil {
		return err
	}

	h.sseHub.Broadcast(SSEEvent{
		Type: "notification_new",
		Data: notif,
	})

	return nil
}

// GetNotifications returns notifications for the authenticated user
func (h *NotificationHandler) GetNotifications(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]interface{}{
			"success": false,
			"message": "Unauthorized",
		})
		return
	}

	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 {
			limit = parsed
		}
	}

	notifications, err := h.repo.GetByUserID(r.Context(), userID, limit)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"message": "Failed to fetch notifications: " + err.Error(),
		})
		return
	}

	if notifications == nil {
		notifications = []*models.Notification{}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"data":    notifications,
	})
}

// GetUnreadCount returns the unread notification count
func (h *NotificationHandler) GetUnreadCount(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]interface{}{
			"success": false,
			"message": "Unauthorized",
		})
		return
	}

	count, err := h.repo.GetUnreadCount(r.Context(), userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"message": "Failed to get unread count: " + err.Error(),
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"data":    map[string]int{"count": count},
	})
}

// MarkAsRead marks a single notification as read
func (h *NotificationHandler) MarkAsRead(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]interface{}{
			"success": false,
			"message": "Unauthorized",
		})
		return
	}

	vars := mux.Vars(r)
	notifID := vars["id"]

	if err := h.repo.MarkAsRead(r.Context(), notifID, userID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"message": "Failed to mark as read: " + err.Error(),
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Notification marked as read",
	})
}

// MarkAllAsRead marks all notifications as read for the user
func (h *NotificationHandler) MarkAllAsRead(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]interface{}{
			"success": false,
			"message": "Unauthorized",
		})
		return
	}

	if err := h.repo.MarkAllAsRead(r.Context(), userID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"message": "Failed to mark all as read: " + err.Error(),
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "All notifications marked as read",
	})
}

// Delete removes a notification
func (h *NotificationHandler) Delete(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]interface{}{
			"success": false,
			"message": "Unauthorized",
		})
		return
	}

	vars := mux.Vars(r)
	notifID := vars["id"]

	if err := h.repo.Delete(r.Context(), notifID, userID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"message": "Failed to delete notification: " + err.Error(),
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Notification deleted",
	})
}

// writeJSON is a helper for writing JSON responses
func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}
