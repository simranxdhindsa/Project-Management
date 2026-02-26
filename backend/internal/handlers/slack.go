package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/dhindsa/project-management/internal/database"
	"github.com/dhindsa/project-management/internal/middleware"
	"github.com/dhindsa/project-management/internal/models"
	slacksvc "github.com/dhindsa/project-management/internal/services/slack"
	"github.com/gorilla/mux"
)

// SlackHandler handles Slack integration API requests
type SlackHandler struct {
	service      *slacksvc.Service
	slackRepo    *database.SlackRepository
	reminderRepo *database.ReminderRepository
	notifHandler *NotificationHandler
}

// NewSlackHandler creates a new Slack handler
func NewSlackHandler(notifHandler *NotificationHandler) *SlackHandler {
	return &SlackHandler{
		service:      slacksvc.NewService(),
		slackRepo:    database.NewSlackRepository(),
		reminderRepo: database.NewReminderRepository(),
		notifHandler: notifHandler,
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

// SetMonitorChannel sets the channel to monitor for @mentions
func (h *SlackHandler) SetMonitorChannel(w http.ResponseWriter, r *http.Request) {
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

	if err := h.service.SetMonitorChannel(r.Context(), userID, req.ChannelID, req.ChannelName); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Monitor channel set successfully",
	})
}

// Scan triggers a mention + thread scan and creates notifications for new mentions
func (h *SlackHandler) Scan(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	newMentions, err := h.service.ScanMentions(r.Context(), user.ID, user.Email)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	newThreads, err := h.service.ScanUserThreads(r.Context(), user.ID, user.Email)
	if err != nil {
		// Non-fatal: proceed without threads
		newThreads = nil
	}

	// Fire SSE notification for each new @mention
	for _, mention := range newMentions {
		notif := &models.Notification{
			UserID:  user.ID,
			Type:    "slack_mention",
			Title:   "New @mention in Slack",
			Message: "From " + mention.SenderName + ": " + truncate(mention.MessageText, 100),
		}
		_ = h.notifHandler.CreateAndBroadcast(r.Context(), notif)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":      true,
		"new_mentions": len(newMentions),
		"new_threads":  len(newThreads),
	})
}

// GetMentions returns unreplied @mentions for the logged-in user
func (h *SlackHandler) GetMentions(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	mentions, err := h.slackRepo.GetAllMentions(r.Context(), userID, 50)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	unrepliedCount, _ := h.slackRepo.CountUnrepliedMentions(r.Context(), userID)

	if mentions == nil {
		mentions = []models.SlackMention{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":         true,
		"mentions":        mentions,
		"count":           len(mentions),
		"unreplied_count": unrepliedCount,
	})
}

// DismissMention marks a mention as handled/replied
func (h *SlackHandler) DismissMention(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	vars := mux.Vars(r)
	messageTS := vars["messageTS"]
	if messageTS == "" {
		http.Error(w, "messageTS is required", http.StatusBadRequest)
		return
	}

	if err := h.slackRepo.MarkMentionReplied(r.Context(), userID, messageTS); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Mention marked as handled",
	})
}

// GetUnansweredThreads returns threads the user started with no or few replies
func (h *SlackHandler) GetUnansweredThreads(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	threads, err := h.slackRepo.GetAllUserThreads(r.Context(), userID, 50)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if threads == nil {
		threads = []models.SlackUserThread{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"threads": threads,
		"count":   len(threads),
	})
}

// PostDigest posts today's digest to the configured primary channel
func (h *SlackHandler) PostDigest(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		Issues []slacksvc.DigestIssue `json:"issues"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	threadTS, err := h.service.PostDailyDigest(r.Context(), userID, req.Issues)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":   true,
		"thread_ts": threadTS,
		"message":   "Digest posted successfully",
	})
}

// CreateFollowupReminder creates a Slack follow-up reminder tied to a thread
func (h *SlackHandler) CreateFollowupReminder(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		ThreadTS    string `json:"thread_ts"`
		ChannelID   string `json:"channel_id"`
		MessageText string `json:"message_text"`
		FollowUpDate string `json:"follow_up_date"`
		Note        string `json:"note"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.FollowUpDate == "" {
		// Default to tomorrow
		req.FollowUpDate = time.Now().AddDate(0, 0, 1).Format("2006-01-02")
	}

	title := "Follow up on Slack thread"
	if req.MessageText != "" {
		title = "Follow up: " + truncate(req.MessageText, 80)
	}

	var msg *string
	if req.Note != "" {
		msg = &req.Note
	}

	reminder := &models.Reminder{
		UserID:         userID,
		Type:           models.ReminderSlackFollowup,
		Title:          title,
		Message:        msg,
		TargetDate:     req.FollowUpDate,
		RelatedIssueID: &req.ThreadTS,
		Recurring:      models.RecurringNone,
	}

	if err := h.reminderRepo.Create(r.Context(), reminder); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Fire notification
	notif := &models.Notification{
		UserID:  userID,
		Type:    "reminder_created",
		Title:   "Slack Follow-up Reminder Set",
		Message: title + " — due " + req.FollowUpDate,
	}
	_ = h.notifHandler.CreateAndBroadcast(context.Background(), notif)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"reminder": reminder,
	})
}

// SnoozeMention snoozes a mention for 2h or until tomorrow
func (h *SlackHandler) SnoozeMention(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	vars := mux.Vars(r)
	messageTS := vars["messageTS"]
	if messageTS == "" {
		http.Error(w, "messageTS is required", http.StatusBadRequest)
		return
	}

	var req struct {
		Until string `json:"until"` // "2h" or "tomorrow" or RFC3339
	}
	json.NewDecoder(r.Body).Decode(&req)

	var until time.Time
	switch req.Until {
	case "tomorrow":
		t := time.Now().AddDate(0, 0, 1)
		until = time.Date(t.Year(), t.Month(), t.Day(), 9, 0, 0, 0, t.Location())
	default: // "2h" or anything else
		until = time.Now().Add(2 * time.Hour)
	}

	if err := h.slackRepo.SnoozeMention(r.Context(), userID, messageTS, until); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":     true,
		"snoozed_until": until.Format(time.RFC3339),
	})
}

// SnoozeThread snoozes a thread for 2h or until tomorrow
func (h *SlackHandler) SnoozeThread(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	vars := mux.Vars(r)
	threadTS := vars["threadTS"]
	if threadTS == "" {
		http.Error(w, "threadTS is required", http.StatusBadRequest)
		return
	}

	var req struct {
		Until string `json:"until"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	var until time.Time
	switch req.Until {
	case "tomorrow":
		t := time.Now().AddDate(0, 0, 1)
		until = time.Date(t.Year(), t.Month(), t.Day(), 9, 0, 0, 0, t.Location())
	default:
		until = time.Now().Add(2 * time.Hour)
	}

	if err := h.slackRepo.SnoozeThread(r.Context(), userID, threadTS, until); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":       true,
		"snoozed_until": until.Format(time.RFC3339),
	})
}

// PostMorningReport posts the PM's formatted morning report to one or more Slack channels.
// POST /api/slack/post-morning-report
func (h *SlackHandler) PostMorningReport(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		ReportText string   `json:"report_text"`
		ChannelIDs []string `json:"channel_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if req.ReportText == "" {
		http.Error(w, "report_text is required", http.StatusBadRequest)
		return
	}
	if len(req.ChannelIDs) == 0 {
		http.Error(w, "at least one channel_id is required", http.StatusBadRequest)
		return
	}

	var posted []string
	var errs []string
	for _, channelID := range req.ChannelIDs {
		if err := h.service.PostMessage(r.Context(), userID, channelID, req.ReportText); err != nil {
			errs = append(errs, channelID+": "+err.Error())
		} else {
			posted = append(posted, channelID)
		}
	}

	if len(posted) == 0 {
		http.Error(w, "Failed to post to any channel: "+strings.Join(errs, "; "), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":         true,
		"posted_channels": posted,
		"errors":          errs,
	})
}

// truncate trims a string to maxLen and appends "…" if cut
func truncate(s string, maxLen int) string {
	runes := []rune(s)
	if len(runes) <= maxLen {
		return s
	}
	return string(runes[:maxLen]) + "…"
}
