package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/dhindsa/project-management/internal/database"
	"github.com/dhindsa/project-management/internal/middleware"
	slacksvc "github.com/dhindsa/project-management/internal/services/slack"
	updatesvc "github.com/dhindsa/project-management/internal/services/update_reminder"
)

// MCPHandler serves the MCP protocol endpoint used by Claude's custom connector.
// Auth: ?token= query param (plain MCP token, NOT a JWT).
// All JWT-protected token management lives in MCPTokenHandler below.
type MCPHandler struct {
	tokenRepo *database.MCPTokenRepository
	msgRepo   *database.PendingMessagesRepository
	slackSvc  *slacksvc.Service
	updateSvc *updatesvc.Service
}

func NewMCPHandler() *MCPHandler {
	return &MCPHandler{
		tokenRepo: database.NewMCPTokenRepository(),
		msgRepo:   database.NewPendingMessagesRepository(),
		slackSvc:  slacksvc.NewService(),
		updateSvc: updatesvc.NewService(),
	}
}

// ── JSON-RPC 2.0 types ────────────────────────────────────────────────────────

type rpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
	ID      interface{}     `json:"id"`
}

type rpcResponse struct {
	JSONRPC string      `json:"jsonrpc"`
	Result  interface{} `json:"result,omitempty"`
	Error   interface{} `json:"error,omitempty"`
	ID      interface{} `json:"id"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func rpcOK(id, result interface{}) rpcResponse {
	return rpcResponse{JSONRPC: "2.0", Result: result, ID: id}
}

func rpcErr(id interface{}, code int, msg string) rpcResponse {
	return rpcResponse{JSONRPC: "2.0", Error: rpcError{Code: code, Message: msg}, ID: id}
}

// ── Tool definitions ──────────────────────────────────────────────────────────

var mcpTools = []map[string]interface{}{
	{
		"name":        "queue_slack_message",
		"description": "Queue a Slack message to be sent by the Velocity bot at a scheduled time. The user will see it in their Update Reminders tab and can edit, reschedule, or send it immediately.",
		"inputSchema": map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"message":       map[string]string{"type": "string", "description": "The message text to send to Slack"},
				"channel_id":    map[string]string{"type": "string", "description": "Slack channel ID (get from list_slack_channels)"},
				"channel_label": map[string]string{"type": "string", "description": "Human-readable channel name e.g. #daily-updates"},
				"scheduled_at":  map[string]string{"type": "string", "description": "ISO 8601 datetime to send (e.g. 2026-07-16T10:00:00+05:30). Omit to queue for manual review only."},
			},
			"required": []string{"message", "channel_id", "channel_label"},
		},
	},
	{
		"name":        "list_slack_channels",
		"description": "List all Slack channels the Velocity bot has access to. Use this to find the correct channel_id before calling queue_slack_message.",
		"inputSchema": map[string]interface{}{
			"type":       "object",
			"properties": map[string]interface{}{},
		},
	},
	{
		"name":        "send_slack_message_now",
		"description": "Send a Slack message immediately via the Velocity bot, bypassing the queue. Use only when the user explicitly asks to send right now.",
		"inputSchema": map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"message":       map[string]string{"type": "string", "description": "The message text to send"},
				"channel_id":    map[string]string{"type": "string", "description": "Slack channel ID"},
				"channel_label": map[string]string{"type": "string", "description": "Human-readable channel name"},
			},
			"required": []string{"message", "channel_id", "channel_label"},
		},
	},
}

// ── Main entrypoint: POST /api/mcp ───────────────────────────────────────────

func (h *MCPHandler) Handle(w http.ResponseWriter, r *http.Request) {
	// Resolve user from ?token= query param or Authorization: Bearer header
	userID := h.resolveUser(r)
	if userID == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(rpcErr(nil, -32001, "invalid or missing MCP token"))
		return
	}

	var req rpcRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(rpcErr(nil, -32700, "parse error"))
		return
	}

	w.Header().Set("Content-Type", "application/json")

	var resp rpcResponse
	switch req.Method {
	case "initialize":
		resp = rpcOK(req.ID, map[string]interface{}{
			"protocolVersion": "2024-11-05",
			"capabilities":    map[string]interface{}{"tools": map[string]bool{"listChanged": false}},
			"serverInfo":      map[string]string{"name": "velocity", "version": "1.0.0"},
		})

	case "tools/list":
		resp = rpcOK(req.ID, map[string]interface{}{"tools": mcpTools})

	case "tools/call":
		resp = h.callTool(r, req.ID, req.Params, userID)

	default:
		resp = rpcErr(req.ID, -32601, "method not found: "+req.Method)
	}

	json.NewEncoder(w).Encode(resp)
}

// ── Tool dispatch ─────────────────────────────────────────────────────────────

func (h *MCPHandler) callTool(r *http.Request, id interface{}, raw json.RawMessage, userID string) rpcResponse {
	var p struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return rpcErr(id, -32602, "invalid params")
	}

	ctx := r.Context()

	switch p.Name {
	case "list_slack_channels":
		channels, err := h.slackSvc.GetChannels(ctx, userID)
		if err != nil {
			return toolError(id, "Failed to list channels: "+err.Error())
		}
		lines := make([]string, 0, len(channels))
		for _, ch := range channels {
			lines = append(lines, ch.ID+"\t#"+ch.Name)
		}
		text := "Available Slack channels (id \\t name):\n" + strings.Join(lines, "\n")
		return toolOK(id, text)

	case "queue_slack_message":
		var args struct {
			Message      string `json:"message"`
			ChannelID    string `json:"channel_id"`
			ChannelLabel string `json:"channel_label"`
			ScheduledAt  string `json:"scheduled_at"`
		}
		if err := json.Unmarshal(p.Arguments, &args); err != nil {
			return rpcErr(id, -32602, "invalid arguments")
		}
		var scheduledAt *time.Time
		if args.ScheduledAt != "" {
			t, err := time.Parse(time.RFC3339, args.ScheduledAt)
			if err != nil {
				return toolError(id, "invalid scheduled_at format, use ISO 8601 e.g. 2026-07-16T10:00:00+05:30")
			}
			scheduledAt = &t
		} else {
			// No explicit time — apply user's saved default send time
			hhmm := h.tokenRepo.GetDefaultSendTime(ctx, userID)
			if hhmm != "" {
				now := time.Now()
				var hh, mm int
				fmt.Sscanf(hhmm, "%d:%d", &hh, &mm)
				candidate := time.Date(now.Year(), now.Month(), now.Day(), hh, mm, 0, 0, now.Location())
				// If the time has already passed today, schedule for tomorrow
				if candidate.Before(now) {
					candidate = candidate.Add(24 * time.Hour)
				}
				scheduledAt = &candidate
			}
		}
		msg, err := h.msgRepo.Create(ctx, userID, args.Message, args.ChannelID, args.ChannelLabel, "", scheduledAt)
		if err != nil {
			return toolError(id, "Failed to queue message: "+err.Error())
		}
		result := "Message queued (id: " + msg.ID + ")."
		if scheduledAt != nil {
			result += " Scheduled for " + scheduledAt.Format("02 Jan 2006, 15:04 MST") + "."
		} else {
			result += " It will appear in the Update Reminders tab for manual send."
		}
		return toolOK(id, result)

	case "send_slack_message_now":
		var args struct {
			Message      string `json:"message"`
			ChannelID    string `json:"channel_id"`
			ChannelLabel string `json:"channel_label"`
		}
		if err := json.Unmarshal(p.Arguments, &args); err != nil {
			return rpcErr(id, -32602, "invalid arguments")
		}
		slackTS, _, err := h.updateSvc.QuickSend(ctx, userID, args.ChannelID, args.Message, "")
		if err != nil {
			return toolError(id, "Failed to send: "+err.Error())
		}
		return toolOK(id, "Message sent to "+args.ChannelLabel+" (ts: "+slackTS+")")

	default:
		return rpcErr(id, -32601, "unknown tool: "+p.Name)
	}
}

func toolOK(id interface{}, text string) rpcResponse {
	return rpcOK(id, map[string]interface{}{
		"content": []map[string]string{{"type": "text", "text": text}},
		"isError": false,
	})
}

func toolError(id interface{}, text string) rpcResponse {
	return rpcOK(id, map[string]interface{}{
		"content": []map[string]string{{"type": "text", "text": text}},
		"isError": true,
	})
}

func (h *MCPHandler) resolveUser(r *http.Request) string {
	token := r.URL.Query().Get("token")
	if token == "" {
		auth := r.Header.Get("Authorization")
		token = strings.TrimPrefix(auth, "Bearer ")
	}
	if token == "" {
		return ""
	}
	userID, _ := h.tokenRepo.GetUserByToken(r.Context(), token)
	return userID
}

// ── Token management handler (JWT-protected) ──────────────────────────────────

// MCPTokenHandler manages MCP token lifecycle under JWT auth.
type MCPTokenHandler struct {
	tokenRepo *database.MCPTokenRepository
}

func NewMCPTokenHandler() *MCPTokenHandler {
	return &MCPTokenHandler{tokenRepo: database.NewMCPTokenRepository()}
}

// GET /api/mcp/token — returns token metadata (not the plain token)
func (h *MCPTokenHandler) GetToken(w http.ResponseWriter, r *http.Request) {
	u := middleware.GetUserFromContext(r)
	if u == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	t, err := h.tokenRepo.GetToken(r.Context(), u.ID)
	if err != nil || t == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"exists": false})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"exists":            true,
		"created_at":        t.CreatedAt,
		"last_used_at":      t.LastUsedAt,
		"default_send_time": t.DefaultSendTime,
	})
}

// PUT /api/mcp/settings — save user preferences (default_send_time)
func (h *MCPTokenHandler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	u := middleware.GetUserFromContext(r)
	if u == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	var body struct {
		DefaultSendTime string `json:"default_send_time"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.DefaultSendTime == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "default_send_time required (HH:MM)"})
		return
	}
	if err := h.tokenRepo.UpdateDefaultSendTime(r.Context(), u.ID, body.DefaultSendTime); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// POST /api/mcp/token — generate (or regenerate) a token; returns plain token once
func (h *MCPTokenHandler) GenerateToken(w http.ResponseWriter, r *http.Request) {
	u := middleware.GetUserFromContext(r)
	if u == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	plain, err := h.tokenRepo.GenerateToken(r.Context(), u.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"token": plain})
}

// DELETE /api/mcp/token — revoke the token
func (h *MCPTokenHandler) RevokeToken(w http.ResponseWriter, r *http.Request) {
	u := middleware.GetUserFromContext(r)
	if u == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	if err := h.tokenRepo.RevokeToken(r.Context(), u.ID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}
