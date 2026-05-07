package handlers

import (
	"context"
	"net/http"
	"strconv"

	"github.com/dhindsa/project-management/internal/database"
	"github.com/dhindsa/project-management/internal/middleware"
	"github.com/dhindsa/project-management/internal/models"
)

// ActivityHandler handles activity log API endpoints
type ActivityHandler struct {
	repo *database.ActivityRepository
}

func NewActivityHandler() *ActivityHandler {
	return &ActivityHandler{
		repo: database.NewActivityRepository(),
	}
}

// LogActivity is a helper called by other handlers to record activity
func (h *ActivityHandler) LogActivity(userID, actorName string, atype models.ActivityType, title, description, entityType, entityID string, metadata interface{}) {
	a := &models.ActivityLog{
		UserID:      userID,
		ActorName:   actorName,
		Type:        atype,
		Title:       title,
		Description: description,
		EntityType:  entityType,
		EntityID:    entityID,
		Metadata:    metadata,
	}
	// Best-effort: ignore errors so activity logging never breaks core ops
	_ = h.repo.Create(context.Background(), a)
}

// GetActivity returns paginated activity log for the authenticated user
func (h *ActivityHandler) GetActivity(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]interface{}{
			"success": false,
			"message": "Unauthorized",
		})
		return
	}

	limit := 50
	offset := 0

	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 {
			limit = parsed
		}
	}
	if o := r.URL.Query().Get("offset"); o != "" {
		if parsed, err := strconv.Atoi(o); err == nil && parsed >= 0 {
			offset = parsed
		}
	}

	logs, err := h.repo.GetByUserID(r.Context(), userID, limit, offset)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"message": "Failed to fetch activity: " + err.Error(),
		})
		return
	}

	if logs == nil {
		logs = []*models.ActivityLog{}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"data":    logs,
	})
}
