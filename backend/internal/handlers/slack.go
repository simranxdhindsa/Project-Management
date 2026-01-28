package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/dhindsa/project-management/internal/middleware"
	"github.com/dhindsa/project-management/internal/services/slack"
)

// SlackHandler handles Slack integration API requests
type SlackHandler struct {
	service *slack.Service
}

// NewSlackHandler creates a new Slack handler
func NewSlackHandler() *SlackHandler {
	return &SlackHandler{
		service: slack.NewService(),
	}
}

// Connect handles connecting a Slack bot
func (h *SlackHandler) Connect(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		BotToken  string `json:"bot_token"`
		ChannelID string `json:"channel_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.BotToken == "" {
		http.Error(w, "Bot token is required", http.StatusBadRequest)
		return
	}

	integration, err := h.service.Connect(r.Context(), userID, req.BotToken, req.ChannelID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":      true,
		"message":      "Slack connected successfully",
		"team_id":      integration.TeamID,
		"team_name":    integration.TeamName,
		"channel_id":   integration.ChannelID,
		"channel_name": integration.ChannelName,
	})
}

// Disconnect handles disconnecting Slack
func (h *SlackHandler) Disconnect(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	if err := h.service.Disconnect(r.Context(), userID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Slack disconnected successfully",
	})
}

// GetStatus returns the current Slack connection status
func (h *SlackHandler) GetStatus(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	integration, err := h.service.GetStatus(r.Context(), userID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"connected": false,
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"connected":    integration.Connected,
		"team_id":      integration.TeamID,
		"team_name":    integration.TeamName,
		"channel_id":   integration.ChannelID,
		"channel_name": integration.ChannelName,
	})
}

// GetChannels returns available Slack channels
func (h *SlackHandler) GetChannels(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	channels, err := h.service.GetChannels(r.Context(), userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(channels)
}

// SetChannel sets the channel to monitor
func (h *SlackHandler) SetChannel(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		ChannelID   string `json:"channel_id"`
		ChannelName string `json:"channel_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if err := h.service.SetChannel(r.Context(), userID, req.ChannelID, req.ChannelName); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Channel set successfully",
	})
}

// GetMessages retrieves messages from the configured channel
func (h *SlackHandler) GetMessages(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Parse date range from query params
	fromStr := r.URL.Query().Get("from")
	toStr := r.URL.Query().Get("to")

	var from, to time.Time
	if fromStr != "" {
		from, _ = time.Parse("2006-01-02", fromStr)
	} else {
		// Default to yesterday
		from = time.Now().AddDate(0, 0, -1)
		from = time.Date(from.Year(), from.Month(), from.Day(), 0, 0, 0, 0, from.Location())
	}

	if toStr != "" {
		to, _ = time.Parse("2006-01-02", toStr)
	} else {
		to = time.Now()
	}

	messages, err := h.service.GetMessages(r.Context(), userID, from, to)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"messages": messages,
		"count":    len(messages),
	})
}

// GetYesterdayMessages retrieves messages from yesterday
func (h *SlackHandler) GetYesterdayMessages(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	messages, err := h.service.GetYesterdayMessages(r.Context(), userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"messages": messages,
		"count":    len(messages),
	})
}
