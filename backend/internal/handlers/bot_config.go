package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/dhindsa/project-management/internal/database"
	"github.com/dhindsa/project-management/internal/middleware"
	"github.com/dhindsa/project-management/internal/models"
	"github.com/gorilla/mux"
)

// BotConfigHandler handles bot configuration API requests
type BotConfigHandler struct {
	botRepo *database.BotConfigRepository
}

// NewBotConfigHandler creates a new BotConfigHandler
func NewBotConfigHandler() *BotConfigHandler {
	return &BotConfigHandler{
		botRepo: database.NewBotConfigRepository(),
	}
}

// ListBots returns all bot configurations, merging DB bots with any templates not yet saved.
func (h *BotConfigHandler) ListBots(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	if database.GetPool() == nil {
		sendJSON(w, http.StatusOK, Response{
			Success: true,
			Data:    getDefaultTemplates(),
		})
		return
	}

	configs, err := h.botRepo.List(r.Context())
	if err != nil {
		sendJSON(w, http.StatusOK, Response{
			Success: true,
			Data:    getDefaultTemplates(),
		})
		return
	}

	if len(configs) == 0 {
		sendJSON(w, http.StatusOK, Response{
			Success: true,
			Data:    getDefaultTemplates(),
		})
		return
	}

	// Build set of bot_types already in DB
	dbTypes := map[string]bool{}
	for _, c := range configs {
		dbTypes[string(c.BotType)] = true
	}

	// Build response: real DB bots first, then any templates whose type isn't in DB yet
	var result []interface{}
	for _, c := range configs {
		result = append(result, c)
	}
	for _, tmpl := range getDefaultTemplates() {
		bt, _ := tmpl["bot_type"].(string)
		if !dbTypes[bt] {
			result = append(result, tmpl)
		}
	}

	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Data:    result,
	})
}

// GetBot returns a single bot configuration
func (h *BotConfigHandler) GetBot(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	vars := mux.Vars(r)
	botID := vars["id"]

	config, err := h.botRepo.GetByID(r.Context(), botID)
	if err != nil {
		sendJSON(w, http.StatusNotFound, Response{Success: false, Message: "Bot not found"})
		return
	}

	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Data:    config,
	})
}

// CreateBot creates a new bot configuration
func (h *BotConfigHandler) CreateBot(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	var req models.CreateBotConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendJSON(w, http.StatusBadRequest, Response{Success: false, Message: "Invalid request body"})
		return
	}

	if req.Name == "" {
		sendJSON(w, http.StatusBadRequest, Response{Success: false, Message: "Name is required"})
		return
	}

	if req.BotType == "" {
		req.BotType = models.BotTypeCustom
	}
	if req.Variables == "" {
		req.Variables = "[]"
	}

	config := &models.BotConfig{
		Name:        req.Name,
		Description: req.Description,
		BotType:     req.BotType,
		Prompt:      req.Prompt,
		Variables:   req.Variables,
		IsActive:    true,
		CreatedBy:   user.ID,
	}

	if err := h.botRepo.Create(r.Context(), config); err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{
			Success: false,
			Message: "Failed to create bot: " + err.Error(),
		})
		return
	}

	sendJSON(w, http.StatusCreated, Response{
		Success: true,
		Data:    config,
		Message: "Bot created successfully",
	})
}

// UpdateBot updates a bot configuration
func (h *BotConfigHandler) UpdateBot(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	vars := mux.Vars(r)
	botID := vars["id"]

	config, err := h.botRepo.GetByID(r.Context(), botID)
	if err != nil {
		sendJSON(w, http.StatusNotFound, Response{Success: false, Message: "Bot not found"})
		return
	}

	var req models.UpdateBotConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendJSON(w, http.StatusBadRequest, Response{Success: false, Message: "Invalid request body"})
		return
	}

	if req.Name != nil {
		config.Name = *req.Name
	}
	if req.Description != nil {
		config.Description = *req.Description
	}
	if req.Prompt != nil {
		config.Prompt = *req.Prompt
	}
	if req.Variables != nil {
		config.Variables = *req.Variables
	}
	if req.IsActive != nil {
		config.IsActive = *req.IsActive
	}

	if err := h.botRepo.Update(r.Context(), config); err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{
			Success: false,
			Message: "Failed to update bot",
		})
		return
	}

	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Data:    config,
		Message: "Bot updated successfully",
	})
}

// DeleteBot deletes a bot configuration
func (h *BotConfigHandler) DeleteBot(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	vars := mux.Vars(r)
	botID := vars["id"]

	if err := h.botRepo.Delete(r.Context(), botID); err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{
			Success: false,
			Message: "Failed to delete bot",
		})
		return
	}

	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Message: "Bot deleted successfully",
	})
}

// GetTemplates returns available bot templates
func (h *BotConfigHandler) GetTemplates(w http.ResponseWriter, r *http.Request) {
	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Data:    getDefaultTemplates(),
	})
}

// getDefaultTemplates returns the built-in bot templates
func getDefaultTemplates() []map[string]interface{} {
	return []map[string]interface{}{
		{
			"id":          "template-slack-analysis",
			"name":        "Slack Task Analysis",
			"description": "Analyzes Slack messages to determine task completion status",
			"bot_type":    "slack_analysis",
			"is_active":   true,
			"prompt": `Analyze the following Slack messages from channel {{$CHANNEL$}} for date {{$DATE$}}.

Morning task assignments:
{{$MORNING_MESSAGES$}}

Evening status updates:
{{$EVENING_MESSAGES$}}

For each team member, determine:
1. Which tasks were assigned in the morning
2. Which tasks were reported as completed in the evening
3. Which tasks are still pending
4. Any new tasks that were added during the day

Return a JSON response with team_members array containing name, assigned_tasks, completed_tasks, pending_tasks, new_tasks, and notes.`,
			"variables": `[{"name":"CHANNEL","label":"Slack Channel","type":"text","default":"#ardoise-platform","required":true},{"name":"DATE","label":"Date","type":"date","default":"today","required":true},{"name":"MORNING_MESSAGES","label":"Morning Messages","type":"text","default":"","required":false,"description":"Auto-filled from Slack"},{"name":"EVENING_MESSAGES","label":"Evening Messages","type":"text","default":"","required":false,"description":"Auto-filled from Slack"}]`,
		},
		{
			"id":          "template-daily-report",
			"name":        "Daily Report Generator",
			"description": "Generates formatted daily task reports for Slack",
			"bot_type":    "daily_report",
			"is_active":   true,
			"prompt": "Generate a daily task report for {{$DATE$}} for team {{$TEAM_NAME$}}.\n\nCurrent tasks by team member:\n{{$TASK_DATA$}}\n\nFormat as a Slack message with backtick headers and bullet points.",
			"variables": `[{"name":"DATE","label":"Date","type":"date","default":"today","required":true},{"name":"TEAM_NAME","label":"Team Name","type":"text","default":"Ardoise Platform","required":true},{"name":"TASK_DATA","label":"Task Data","type":"text","default":"","required":false,"description":"Auto-filled from task database"}]`,
		},
		{
			"id":          "template-custom",
			"name":        "Custom Bot",
			"description": "Create your own bot with custom prompts and variables",
			"bot_type":    "custom",
			"is_active":   true,
			"prompt":      "Your custom prompt here. Use {{$VARIABLE_NAME$}} for variables.",
			"variables":   `[]`,
		},
		{
			"id":          "template-pm-assistant",
			"name":        "PM Assistant",
			"description": "Custom instructions for the PM Assistant chat. Live YouTrack + time tracking data is injected automatically.",
			"bot_type":    "pm_assistant",
			"is_active":   true,
			"prompt": `You are a PM Assistant for a software development team.

## Your Role
Answer questions about YouTrack issues and time tracking data provided below. Be concise and accurate.

## Assignee Task Format
When asked for tasks assigned to a specific person, ALWAYS respond in this exact format:

@{assignee_name}

{Status}:
{issueID} {summary}

Group by status (Backlog, In Progress, Blocked, DEV, Done). One ticket per line. No tables, no pipes, no extra metadata.

Example:
@simranjot

In Progress:
3-671 FE Studio: UI theme text issue
ARD-801 API refactor

Blocked:
3-896 FE UI: Mic remains activated when holding spacebar

## General Format
- Use bullet points for lists
- Use tables only for multi-column comparisons
- Bold (**text**) for important flags (OVERDUE, MOVED BACK)
- Group data by assignee when showing team workload

## Key Rules
- OVERDUE = ticket's time in In Progress exceeds its priority threshold (P0:4h P1:24h P2:48h Other:72h)
- MOVED BACK = ticket transitioned to a less-advanced state (e.g. DEV→In Progress, In Progress→Backlog) — treat as regression
- PINNED = PM has manually flagged as important — always mention first
- If a query is ambiguous, make reasonable assumptions and state them

Today's date: {{DATE}}`,
			"variables": `[{"name":"DATE","label":"Today's Date","type":"date","default":"today","required":false,"description":"Auto-substituted with today's date"}]`,
		},
	}
}
