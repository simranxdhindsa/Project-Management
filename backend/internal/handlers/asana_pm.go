package handlers

// AsanaPMHandler mirrors all YouTrack PM endpoints but fetches data from Asana.
// All response shapes are identical to the YouTrack handler so the frontend can
// switch sources transparently.
//
// Routes (all protected by AuthMiddleware):
//   GET  /api/asana/pm/status
//   GET  /api/asana/pm/projects
//   GET  /api/asana/pm/boards
//   GET  /api/asana/pm/boards/{board_id}/columns
//   GET  /api/asana/pm/states
//   GET  /api/asana/pm/priorities
//   GET  /api/asana/pm/users
//   GET  /api/asana/pm/issues
//   POST /api/asana/pm/issues
//   GET  /api/asana/pm/issues/grouped-by-assignee
//   GET  /api/asana/pm/issues/{gid}
//   PUT  /api/asana/pm/issues/{gid}
//   PATCH /api/asana/pm/issues/{gid}
//   DELETE /api/asana/pm/issues/{gid}
//   PATCH /api/asana/pm/issues/{gid}/state
//   POST /api/asana/pm/match-analysis
//   POST /api/asana/pm/pm-query
//   GET  /api/asana/pm/daily-brief
//   GET  /api/asana/pm/eod-summary
//   GET  /api/asana/pm/developer-load
//   GET  /api/asana/pm/blocker-reasons
//   POST /api/asana/pm/save-plan
//   GET  /api/asana/pm/carryover
//   GET  /api/asana/pm/sections
//   POST /api/asana/pm/import

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/dhindsa/project-management/internal/database"
	"github.com/dhindsa/project-management/internal/middleware"
	"github.com/dhindsa/project-management/internal/models"
	"github.com/dhindsa/project-management/internal/services/ai"
	"github.com/dhindsa/project-management/internal/services/asana"
	"github.com/gorilla/mux"
)

// AsanaPMHandler handles all Asana PM-mode endpoints
type AsanaPMHandler struct {
	integrationRepo *database.IntegrationRepository
	settingsRepo    *database.SettingsRepository
	sectionRepo     *database.SectionRepository
	projectRepo     *database.ProjectRepository
	taskRepo        *database.TaskRepository
	asanaPMRepo     *database.AsanaPMRepository
	configRepo      *database.WorkflowConfigRepository
}

// NewAsanaPMHandler creates a new AsanaPMHandler
func NewAsanaPMHandler() *AsanaPMHandler {
	return &AsanaPMHandler{
		integrationRepo: database.NewIntegrationRepository(),
		settingsRepo:    database.NewSettingsRepository(),
		sectionRepo:     database.NewSectionRepository(),
		projectRepo:     database.NewProjectRepository(),
		taskRepo:        database.NewTaskRepository(),
		asanaPMRepo:     database.NewAsanaPMRepository(),
		configRepo:      database.NewWorkflowConfigRepository(),
	}
}

// ─── helpers ─────────────────────────────────────────────────────────────────

// getAsanaClient resolves credentials: per-user asana_integrations → global_settings → env
func (h *AsanaPMHandler) getAsanaClient(ctx context.Context, userID string) (*asana.Client, string, string, error) {
	var pat, projectGID, workspaceGID string

	// 1. Per-user integration
	if userID != "" {
		if integ, err := h.integrationRepo.GetAsanaIntegration(ctx, userID); err == nil && integ != nil && integ.Connected {
			pat = integ.AccessToken
			workspaceGID = integ.WorkspaceID
		}
	}

	// 2. Global settings DB
	settings, _ := h.settingsRepo.GetAsanaSettings(ctx)
	if settings != nil && settings.Configured {
		if pat == "" {
			pat = settings.PAT
		}
		if settings.ProjectID != "" {
			projectGID = settings.ProjectID
		}
		if workspaceGID == "" {
			workspaceGID = settings.WorkspaceID
		}
	}

	// 3. Environment variables
	if pat == "" {
		pat = os.Getenv("ASANA_PAT")
	}
	if projectGID == "" {
		projectGID = os.Getenv("ASANA_PROJECT_ID")
	}
	if workspaceGID == "" {
		workspaceGID = os.Getenv("ASANA_WORKSPACE_ID")
	}

	if pat == "" {
		return nil, "", "", fmt.Errorf("Asana is not configured. Please connect Asana in Settings.")
	}

	return asana.NewClient(pat), projectGID, workspaceGID, nil
}

// sectionStatus classifies an Asana section name as a status string
// Returns one of: "In Progress", "Blocked", "Done", "Backlog"
func sectionStatus(name string) string {
	n := strings.ToLower(name)
	switch {
	case strings.Contains(n, "done") || strings.Contains(n, "complet") ||
		strings.Contains(n, "deploy") || strings.Contains(n, "prod") ||
		strings.Contains(n, "stage") || strings.Contains(n, "dev") ||
		strings.Contains(n, "fixed") || strings.Contains(n, "closed"):
		return "Done"
	case strings.Contains(n, "block") || strings.Contains(n, "wait") ||
		strings.Contains(n, "hold"):
		return "Blocked"
	case strings.Contains(n, "backlog") || strings.Contains(n, "todo") ||
		strings.Contains(n, "to do") || strings.Contains(n, "upcoming"):
		return "Backlog"
	default:
		return "In Progress"
	}
}

// isDoneSection returns true if the section name looks like a "done" forward state
func isDoneSection(name string) bool {
	n := strings.ToLower(name)
	return strings.Contains(n, "done") || strings.Contains(n, "complet") ||
		strings.Contains(n, "deploy") || strings.Contains(n, "prod") ||
		strings.Contains(n, "stage") || strings.Contains(n, "fixed") ||
		strings.Contains(n, "closed")
}

// isBlockedSection returns true if the section name implies blocked
func isBlockedSection(name string) bool {
	n := strings.ToLower(name)
	return strings.Contains(n, "block") || strings.Contains(n, "wait") || strings.Contains(n, "hold")
}

// taskToIssueRow converts an Asana task to the issueRow shape used in daily ops responses
func taskToIssueRow(task asana.Task) issueRow {
	status := "Backlog"
	for _, m := range task.Memberships {
		if m.Section != nil {
			status = sectionStatus(m.Section.Name)
			break
		}
	}
	if task.Completed {
		status = "Done"
	}
	assigneeName := ""
	if task.Assignee != nil {
		assigneeName = task.Assignee.Name
	}
	priority := extractAsanaPriority(task)
	return issueRow{
		ID:       task.GID,
		Summary:  task.Name,
		Status:   status,
		Priority: priority,
		Assignee: assigneeName,
	}
}

// extractAsanaPriority tries to get priority from Asana custom fields
func extractAsanaPriority(task asana.Task) string {
	// AsanaTask from client.go doesn't have CustomFields in the basic struct,
	// but GetProjectTasksPaginated fetches them. We check the raw JSON by
	// trying to match known priority field names.
	// Since the Task struct doesn't have CustomFields, return "Normal" for now.
	// The richer BoardSyncv2 pattern can be added when custom field mapping is configured.
	return "Normal"
}

// taskSectionName returns the first section name for a task
func taskSectionName(task asana.Task) string {
	for _, m := range task.Memberships {
		if m.Section != nil {
			return m.Section.Name
		}
	}
	return ""
}

// ─── Status / Config ──────────────────────────────────────────────────────────

// GetStatus returns Asana PM connection status (mirrors YouTrack GetStatus)
func (h *AsanaPMHandler) GetStatus(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	client, projectGID, workspaceGID, err := h.getAsanaClient(r.Context(), userID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"connected":  false,
			"configured": false,
			"error":      err.Error(),
		})
		return
	}

	// Test connection
	_, testErr := client.GetMe(r.Context())
	connected := testErr == nil
	errMsg := ""
	if testErr != nil {
		errMsg = testErr.Error()
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"connected":     connected,
		"configured":    true,
		"error":         errMsg,
		"project_id":    projectGID,
		"workspace_id":  workspaceGID,
		"source":        "asana",
	})
}

// ─── Projects / Boards / States / Users ──────────────────────────────────────

// GetProjects returns Asana projects (mirrors YouTrack GetProjects)
func (h *AsanaPMHandler) GetProjects(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	client, _, workspaceGID, err := h.getAsanaClient(r.Context(), userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if workspaceGID == "" {
		// Try fetching workspaces
		ws, wsErr := client.GetWorkspaces(r.Context())
		if wsErr != nil || len(ws) == 0 {
			http.Error(w, "No Asana workspace found", http.StatusBadRequest)
			return
		}
		workspaceGID = ws[0].GID
	}

	projects, err := client.GetProjects(r.Context(), workspaceGID)
	if err != nil {
		http.Error(w, "Failed to get projects: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Shape: [{id, name, short_name}] — matches YouTrack project shape
	var result []map[string]interface{}
	for _, p := range projects {
		result = append(result, map[string]interface{}{
			"id":         p.GID,
			"name":       p.Name,
			"short_name": p.Name,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "data": result})
}

// GetBoards returns Asana projects as boards (mirrors YouTrack GetBoards)
func (h *AsanaPMHandler) GetBoards(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	client, _, workspaceGID, err := h.getAsanaClient(r.Context(), userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if workspaceGID == "" {
		ws, wsErr := client.GetWorkspaces(r.Context())
		if wsErr != nil || len(ws) == 0 {
			http.Error(w, "No Asana workspace found", http.StatusBadRequest)
			return
		}
		workspaceGID = ws[0].GID
	}

	projects, err := client.GetProjects(r.Context(), workspaceGID)
	if err != nil {
		http.Error(w, "Failed to get boards: "+err.Error(), http.StatusInternalServerError)
		return
	}

	var result []map[string]interface{}
	for _, p := range projects {
		result = append(result, map[string]interface{}{
			"id":   p.GID,
			"name": p.Name,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "data": result})
}

// GetBoardColumns returns sections of an Asana project as board columns
func (h *AsanaPMHandler) GetBoardColumns(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	vars := mux.Vars(r)
	boardID := vars["board_id"]

	client, projectGID, _, err := h.getAsanaClient(r.Context(), userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if boardID == "" {
		boardID = projectGID
	}
	if boardID == "" {
		http.Error(w, "board_id is required", http.StatusBadRequest)
		return
	}

	sections, err := client.GetSections(r.Context(), boardID)
	if err != nil {
		http.Error(w, "Failed to get columns: "+err.Error(), http.StatusInternalServerError)
		return
	}

	var result []map[string]interface{}
	for _, s := range sections {
		result = append(result, map[string]interface{}{
			"name":         s.Name,
			"field_values": []string{s.Name},
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "data": result})
}

// GetStates returns Asana project sections as states (mirrors YouTrack GetStates)
func (h *AsanaPMHandler) GetStates(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	client, projectGID, _, err := h.getAsanaClient(r.Context(), userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if projectGID == "" {
		http.Error(w, "Asana project not configured", http.StatusBadRequest)
		return
	}

	sections, err := client.GetSections(r.Context(), projectGID)
	if err != nil {
		http.Error(w, "Failed to get states: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Shape matches YouTrack state: {name string}
	var result []map[string]string
	for _, s := range sections {
		result = append(result, map[string]string{"name": s.Name})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "data": result})
}

// GetPriorities returns available priority values (from Asana custom field or hardcoded)
func (h *AsanaPMHandler) GetPriorities(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	// Default priority list — matches common Asana priority custom field values
	priorities := []string{"P0", "P1", "P2", "P3", "Critical", "High", "Medium", "Low", "Normal"}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "data": priorities})
}

// GetUsers returns Asana workspace members (mirrors YouTrack GetUsers)
func (h *AsanaPMHandler) GetUsers(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	client, _, workspaceGID, err := h.getAsanaClient(r.Context(), userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if workspaceGID == "" {
		ws, wsErr := client.GetWorkspaces(r.Context())
		if wsErr != nil || len(ws) == 0 {
			http.Error(w, "No Asana workspace found", http.StatusBadRequest)
			return
		}
		workspaceGID = ws[0].GID
	}

	users, err := client.GetWorkspaceUsers(r.Context(), workspaceGID)
	if err != nil {
		http.Error(w, "Failed to get users: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Shape matches YouTrack user: {id, login, full_name, email}
	var result []map[string]interface{}
	for _, u := range users {
		result = append(result, map[string]interface{}{
			"id":        u.GID,
			"login":     u.GID,
			"full_name": u.Name,
			"email":     u.Email,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "data": result})
}

// ─── Issues CRUD ─────────────────────────────────────────────────────────────

// GetIssues returns all Asana tasks as issues (mirrors YouTrack GetIssues)
func (h *AsanaPMHandler) GetIssues(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	client, projectGID, _, err := h.getAsanaClient(r.Context(), userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if projectGID == "" {
		http.Error(w, "Asana project not configured", http.StatusBadRequest)
		return
	}

	tasks, err := client.GetProjectTasksPaginated(r.Context(), projectGID)
	if err != nil {
		http.Error(w, "Failed to get issues: "+err.Error(), http.StatusInternalServerError)
		return
	}

	response := tasksToIssueList(tasks)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "data": response})
}

// GetIssue returns a single Asana task (mirrors YouTrack GetIssue)
func (h *AsanaPMHandler) GetIssue(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	vars := mux.Vars(r)
	taskGID := vars["issue_id"]

	client, _, _, err := h.getAsanaClient(r.Context(), userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	task, err := client.GetTask(r.Context(), taskGID)
	if err != nil {
		http.Error(w, "Failed to get issue: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    taskToIssueMap(*task),
	})
}

// CreateIssue creates a new Asana task (mirrors YouTrack CreateIssue)
func (h *AsanaPMHandler) CreateIssue(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		Summary     string `json:"summary"`
		Description string `json:"description"`
		State       string `json:"state,omitempty"`   // section name
		Priority    string `json:"priority,omitempty"`
		Assignee    string `json:"assignee_login,omitempty"` // Asana user GID
		DueDate     *int64 `json:"due_date,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	client, projectGID, _, err := h.getAsanaClient(r.Context(), userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if projectGID == "" {
		http.Error(w, "Asana project not configured", http.StatusBadRequest)
		return
	}

	createReq := asana.CreateTaskRequest{
		Name:     req.Summary,
		Notes:    req.Description,
		Projects: []string{projectGID},
		Assignee: req.Assignee,
	}
	if req.DueDate != nil {
		t := time.Unix(*req.DueDate/1000, 0)
		createReq.DueOn = t.Format("2006-01-02")
	}

	task, err := client.CreateTask(r.Context(), createReq)
	if err != nil {
		http.Error(w, "Failed to create issue: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Move to section if state provided
	if req.State != "" {
		sections, _ := client.GetSections(r.Context(), projectGID)
		for _, s := range sections {
			if strings.EqualFold(s.Name, req.State) {
				_ = client.AddTaskToSection(r.Context(), s.GID, task.GID)
				break
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "data": taskToIssueMap(*task)})
}

// UpdateIssue updates an Asana task (mirrors YouTrack UpdateIssue)
func (h *AsanaPMHandler) UpdateIssue(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	vars := mux.Vars(r)
	taskGID := vars["issue_id"]

	var req struct {
		Summary     string `json:"summary,omitempty"`
		Description string `json:"description,omitempty"`
		State       string `json:"state,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	client, projectGID, _, err := h.getAsanaClient(r.Context(), userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	updateReq := asana.UpdateTaskRequest{}
	if req.Summary != "" {
		updateReq.Name = &req.Summary
	}
	if req.Description != "" {
		updateReq.Notes = &req.Description
	}

	task, err := client.UpdateTask(r.Context(), taskGID, updateReq)
	if err != nil {
		http.Error(w, "Failed to update issue: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Move to section if state provided
	if req.State != "" && projectGID != "" {
		sections, _ := client.GetSections(r.Context(), projectGID)
		for _, s := range sections {
			if strings.EqualFold(s.Name, req.State) {
				_ = client.AddTaskToSection(r.Context(), s.GID, taskGID)
				break
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "data": taskToIssueMap(*task)})
}

// UpdateIssueState moves an Asana task to a different section (mirrors YouTrack UpdateIssueState)
func (h *AsanaPMHandler) UpdateIssueState(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	vars := mux.Vars(r)
	taskGID := vars["issue_id"]

	var req struct {
		State string `json:"state"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.State == "" {
		http.Error(w, "state is required", http.StatusBadRequest)
		return
	}

	client, projectGID, _, err := h.getAsanaClient(r.Context(), userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if projectGID == "" {
		http.Error(w, "Asana project not configured", http.StatusBadRequest)
		return
	}

	sections, err := client.GetSections(r.Context(), projectGID)
	if err != nil {
		http.Error(w, "Failed to get sections: "+err.Error(), http.StatusInternalServerError)
		return
	}

	for _, s := range sections {
		if strings.EqualFold(s.Name, req.State) {
			if err := client.AddTaskToSection(r.Context(), s.GID, taskGID); err != nil {
				http.Error(w, "Failed to move task: "+err.Error(), http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "message": "State updated"})
			return
		}
	}

	http.Error(w, "Section '"+req.State+"' not found in Asana project", http.StatusNotFound)
}

// DeleteIssue deletes an Asana task (mirrors YouTrack DeleteIssue)
func (h *AsanaPMHandler) DeleteIssue(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	vars := mux.Vars(r)
	taskGID := vars["issue_id"]

	client, _, _, err := h.getAsanaClient(r.Context(), userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if err := client.DeleteTask(r.Context(), taskGID); err != nil {
		http.Error(w, "Failed to delete issue: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "message": "Issue deleted"})
}

// ─── Grouped by Assignee ─────────────────────────────────────────────────────

// GetIssuesGroupedByAssignee groups active tasks by assignee (mirrors YouTrack)
func (h *AsanaPMHandler) GetIssuesGroupedByAssignee(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	client, projectGID, _, err := h.getAsanaClient(r.Context(), userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if projectGID == "" {
		http.Error(w, "Asana project not configured", http.StatusBadRequest)
		return
	}

	tasks, err := client.GetProjectTasksPaginated(r.Context(), projectGID)
	if err != nil {
		http.Error(w, "Failed to get issues: "+err.Error(), http.StatusInternalServerError)
		return
	}

	type issueItem struct {
		ID          string `json:"id"`
		Summary     string `json:"summary"`
		PriorityTag string `json:"priority_tag"`
		CleanTitle  string `json:"clean_title"`
		Status      string `json:"status"`
		Selected    bool   `json:"selected"`
	}
	type assigneeGroup struct {
		UserName    string      `json:"user_name"`
		SlackHandle string      `json:"slack_handle"`
		Issues      []issueItem `json:"issues"`
	}

	groups := make(map[string]*assigneeGroup)
	var unassignedIssues []issueItem

	for _, task := range tasks {
		if task.Completed {
			continue
		}
		status := taskSectionName(task)
		if isDoneSection(status) {
			continue
		}
		statusMapped := sectionStatus(status)
		if statusMapped == "Done" {
			continue
		}

		priorityTag, cleanTitle := extractPriorityFromSummary(task.Name)
		item := issueItem{
			ID:          task.GID,
			Summary:     task.Name,
			PriorityTag: priorityTag,
			CleanTitle:  cleanTitle,
			Status:      statusMapped,
			Selected:    true,
		}

		if task.Assignee != nil && task.Assignee.Name != "" {
			name := task.Assignee.Name
			if groups[name] == nil {
				groups[name] = &assigneeGroup{
					UserName:    name,
					SlackHandle: "@" + name,
					Issues:      []issueItem{},
				}
			}
			groups[name].Issues = append(groups[name].Issues, item)
		} else {
			unassignedIssues = append(unassignedIssues, item)
		}
	}

	var assignments []assigneeGroup
	for _, g := range groups {
		assignments = append(assignments, *g)
	}
	if len(unassignedIssues) > 0 {
		assignments = append(assignments, assigneeGroup{
			UserName:    "Unassigned",
			SlackHandle: "@Unassigned",
			Issues:      unassignedIssues,
		})
	}
	if assignments == nil {
		assignments = []assigneeGroup{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    map[string]interface{}{"assignments": assignments},
	})
}

// ─── Match Analysis ──────────────────────────────────────────────────────────

// MatchAnalysis fuzzy-matches AI analysis tasks against Asana tasks (mirrors YouTrack MatchAnalysis)
func (h *AsanaPMHandler) MatchAnalysis(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		PersonBreakdown []struct {
			Name      string   `json:"name"`
			Assigned  []string `json:"assigned"`
			Completed []string `json:"completed"`
			Pending   []string `json:"pending"`
			Blocked   []string `json:"blocked"`
		} `json:"person_breakdown"`
		Analysis []struct {
			TaskTitle      string   `json:"task_title"`
			DetectedStatus string   `json:"detected_status"`
			Confidence     float64  `json:"confidence"`
			Evidence       []string `json:"evidence"`
			Assignee       string   `json:"assignee"`
		} `json:"analysis"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	client, projectGID, _, err := h.getAsanaClient(r.Context(), userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	tasks, err := client.GetProjectTasksPaginated(r.Context(), projectGID)
	if err != nil {
		http.Error(w, "Failed to get issues: "+err.Error(), http.StatusInternalServerError)
		return
	}

	type matchResult struct {
		TaskTitle      string  `json:"task_title"`
		Person         string  `json:"person"`
		Status         string  `json:"status"`
		AsanaTask      map[string]interface{} `json:"youtrack_issue"` // keeps same key name for frontend compat
		ProposedState  string  `json:"proposed_state"`
		Confidence     float64 `json:"confidence"`
	}
	type unmatchedTask struct {
		TaskTitle string `json:"task_title"`
		Person    string `json:"person"`
		Status    string `json:"status"`
	}

	var matches []matchResult
	var unmatchedTasks []unmatchedTask
	matchedTaskGIDs := make(map[string]bool)

	for _, item := range req.Analysis {
		bestMatch := -1
		bestScore := 0.0
		for i, task := range tasks {
			score := fuzzyMatchScore(item.TaskTitle, task.Name)
			if score > bestScore && score >= 0.4 {
				bestScore = score
				bestMatch = i
			}
		}
		if bestMatch < 0 {
			unmatchedTasks = append(unmatchedTasks, unmatchedTask{
				TaskTitle: item.TaskTitle, Person: item.Assignee, Status: item.DetectedStatus,
			})
			continue
		}
		t := tasks[bestMatch]
		matchedTaskGIDs[t.GID] = true
		currentState := taskSectionName(t)

		var proposedState string
		switch item.DetectedStatus {
		case "completed":
			proposedState = "Done"
		case "in_progress", "blocked":
			proposedState = "In Progress"
		}

		matches = append(matches, matchResult{
			TaskTitle: item.TaskTitle,
			Person:    item.Assignee,
			Status:    item.DetectedStatus,
			AsanaTask: map[string]interface{}{
				"id":            t.GID,
				"summary":       t.Name,
				"current_state": currentState,
			},
			ProposedState: proposedState,
			Confidence:    bestScore,
		})
	}

	var unmatchedIssues []map[string]interface{}
	for _, t := range tasks {
		if !matchedTaskGIDs[t.GID] && !t.Completed {
			unmatchedIssues = append(unmatchedIssues, map[string]interface{}{
				"id":            t.GID,
				"summary":       t.Name,
				"current_state": taskSectionName(t),
			})
		}
	}

	if matches == nil {
		matches = []matchResult{}
	}
	if unmatchedTasks == nil {
		unmatchedTasks = []unmatchedTask{}
	}
	if unmatchedIssues == nil {
		unmatchedIssues = []map[string]interface{}{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":          true,
		"matches":          matches,
		"unmatched_tasks":  unmatchedTasks,
		"unmatched_issues": unmatchedIssues,
	})
}

// ─── PM Assistant ────────────────────────────────────────────────────────────

const defaultAsanaPMAssistantPrompt = `You are a PM Assistant for a software development team using Asana.

## Your Role
Answer questions about Asana tasks and section transition data provided below. Be concise and accurate.

## Assignee Task Format
When asked for tasks assigned to a specific person, ALWAYS respond in this exact format:

@{assignee_name}

{Status}:
{taskGID} {task_name}

Group by status (Backlog, In Progress, Blocked, Done). One task per line.

## General Format
- Use bullet points for lists
- Bold (**text**) for important flags (OVERDUE, MOVED BACK)
- Group data by assignee when showing team workload

## Key Rules
- OVERDUE = task has been in the same section longer than its priority threshold
- MOVED BACK = task moved to a less-advanced section (regression)
- If the query is ambiguous, make reasonable assumptions and state them

Today's date: {{DATE}}`

// PMAssistantQuery handles natural language queries with live Asana context (mirrors YouTrack PMAssistantQuery)
func (h *AsanaPMHandler) PMAssistantQuery(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		Query   string           `json:"query"`
		History []ai.ConvMessage `json:"history"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Query == "" {
		http.Error(w, "query is required", http.StatusBadRequest)
		return
	}

	// 1. Load custom bot instructions
	botRepo := database.NewBotConfigRepository()
	bots, _ := botRepo.GetByType(r.Context(), models.BotTypePMAssistant)
	customInstructions := ""
	for _, b := range bots {
		if b.IsActive {
			customInstructions = b.Prompt
			break
		}
	}
	if customInstructions == "" {
		customInstructions = defaultAsanaPMAssistantPrompt
	}
	customInstructions = strings.ReplaceAll(customInstructions, "{{DATE}}", time.Now().Format("2006-01-02"))

	// 2. Fetch live Asana tasks
	var issueSection strings.Builder
	issueSection.WriteString("\n\n---\n## Live Asana Tasks (current state)\n")
	issueSection.WriteString("Format: GID | Priority | Name | Section | Assignee\n\n")

	client, projectGID, _, clientErr := h.getAsanaClient(r.Context(), userID)
	if clientErr == nil && projectGID != "" {
		tasks, taskErr := client.GetProjectTasksPaginated(r.Context(), projectGID)
		if taskErr == nil {
			for _, t := range tasks {
				if t.Completed {
					continue
				}
				assigneeName := ""
				if t.Assignee != nil {
					assigneeName = t.Assignee.Name
				}
				section := taskSectionName(t)
				priority := extractAsanaPriority(t)
				issueSection.WriteString(fmt.Sprintf("%s | %s | %s | %s | %s\n",
					t.GID, priority, t.Name, section, assigneeName))
			}
		}
	}

	// 3. Fetch recent section transitions from asana_task_log
	var historySection strings.Builder
	historySection.WriteString("\n\n---\n## Asana Section Transition History (last 7 days)\n")
	historySection.WriteString("Format: TaskGID | TaskName | Assignee | From → To | Date\n\n")

	if projectGID != "" {
		since := time.Now().AddDate(0, 0, -7)
		logs, _ := h.asanaPMRepo.GetTransitionsSince(r.Context(), projectGID, since)
		for _, l := range logs {
			historySection.WriteString(fmt.Sprintf("%s | %s | %s | %s → %s | %s\n",
				l.TaskGID, l.TaskName, l.Assignee, l.FromSection, l.ToSection,
				l.TransitionedAt.Format("2006-01-02 15:04")))
		}
	}

	systemPrompt := customInstructions + issueSection.String() + historySection.String()

	response, err := ai.QueryWithHistory(r.Context(), systemPrompt, req.History, req.Query)
	if err != nil {
		http.Error(w, "AI service error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    map[string]string{"response": response},
	})
}

// ─── Daily Ops ───────────────────────────────────────────────────────────────

// GetDailyBrief returns a grouped morning brief from Asana (mirrors YouTrack GetDailyBrief)
func (h *AsanaPMHandler) GetDailyBrief(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	client, projectGID, _, err := h.getAsanaClient(r.Context(), userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if projectGID == "" {
		http.Error(w, "Asana project not configured", http.StatusBadRequest)
		return
	}

	tasks, err := client.GetProjectTasksPaginated(r.Context(), projectGID)
	if err != nil {
		http.Error(w, "Failed to get issues: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Get done yesterday from asana_task_log
	yesterday := time.Now().AddDate(0, 0, -1).Format("2006-01-02")
	since := time.Now().AddDate(0, 0, -1)
	logs, _ := h.asanaPMRepo.GetTransitionsSince(r.Context(), projectGID, since)

	var doneYesterday []issueRow
	for _, l := range logs {
		if l.TransitionedAt.Format("2006-01-02") == yesterday && isDoneSection(l.ToSection) {
			doneYesterday = append(doneYesterday, issueRow{
				ID:       l.TaskGID,
				Summary:  l.TaskName,
				Status:   l.ToSection,
				Priority: l.Priority,
				Assignee: l.Assignee,
			})
		}
	}

	var p0, p1, p2, p3, blockedOurs, blockedTheirs, openItems, unassigned []issueRow

	for _, task := range tasks {
		if task.Completed {
			continue
		}
		row := taskToIssueRow(task)
		statusMapped := row.Status

		if statusMapped == "Done" {
			continue
		}

		if statusMapped == "Blocked" {
			if row.Assignee == "" {
				blockedTheirs = append(blockedTheirs, row)
			} else {
				blockedOurs = append(blockedOurs, row)
			}
			continue
		}

		if row.Assignee == "" && statusMapped != "Backlog" {
			unassigned = append(unassigned, row)
		}

		p := strings.ToUpper(row.Priority)
		switch {
		case p == "P0" || p == "CRITICAL":
			p0 = append(p0, row)
		case p == "P1":
			p1 = append(p1, row)
		case p == "P2":
			p2 = append(p2, row)
		default:
			p3 = append(p3, row)
		}
	}

	for _, task := range tasks {
		if task.Completed {
			continue
		}
		row := taskToIssueRow(task)
		if row.Status == "In Progress" && row.Assignee == "" {
			openItems = append(openItems, row)
		}
	}

	nullSafe := func(s []issueRow) []issueRow {
		if s == nil {
			return []issueRow{}
		}
		return s
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data": map[string]interface{}{
			"done_yesterday":  nullSafe(doneYesterday),
			"p0":              nullSafe(p0),
			"p1":              nullSafe(p1),
			"p2":              nullSafe(p2),
			"p3":              nullSafe(p3),
			"blocked_ours":    nullSafe(blockedOurs),
			"blocked_theirs":  nullSafe(blockedTheirs),
			"open_items":      nullSafe(openItems),
			"unassigned":      nullSafe(unassigned),
			"generated_at":    time.Now().Format(time.RFC3339),
		},
	})
}

// GetEODSummary returns today's progress from Asana (mirrors YouTrack GetEODSummary)
func (h *AsanaPMHandler) GetEODSummary(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	client, projectGID, _, err := h.getAsanaClient(r.Context(), userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if projectGID == "" {
		http.Error(w, "Asana project not configured", http.StatusBadRequest)
		return
	}

	today := time.Now().Format("2006-01-02")
	todayStart := time.Now().Truncate(24 * time.Hour)
	logs, _ := h.asanaPMRepo.GetTransitionsSince(r.Context(), projectGID, todayStart)

	var completedToday, newBlockers []issueRow
	movedToday := make(map[string]bool)

	for _, l := range logs {
		if l.TransitionedAt.Format("2006-01-02") != today {
			continue
		}
		movedToday[l.TaskGID] = true
		if isDoneSection(l.ToSection) {
			completedToday = append(completedToday, issueRow{
				ID: l.TaskGID, Summary: l.TaskName, Status: l.ToSection,
				Priority: l.Priority, Assignee: l.Assignee,
			})
		}
		if isBlockedSection(l.ToSection) {
			newBlockers = append(newBlockers, issueRow{
				ID: l.TaskGID, Summary: l.TaskName, Status: l.ToSection,
				Priority: l.Priority, Assignee: l.Assignee,
			})
		}
	}

	tasks, err := client.GetProjectTasksPaginated(r.Context(), projectGID)
	if err != nil {
		http.Error(w, "Failed to get issues: "+err.Error(), http.StatusInternalServerError)
		return
	}

	var stillInProgress, noMovement []issueRow
	for _, task := range tasks {
		if task.Completed {
			continue
		}
		row := taskToIssueRow(task)
		if row.Status != "In Progress" {
			continue
		}
		if movedToday[task.GID] {
			stillInProgress = append(stillInProgress, row)
		} else {
			noMovement = append(noMovement, row)
		}
	}

	nullSafe := func(s []issueRow) []issueRow {
		if s == nil {
			return []issueRow{}
		}
		return s
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data": map[string]interface{}{
			"completed_today":   nullSafe(completedToday),
			"still_in_progress": nullSafe(stillInProgress),
			"no_movement":       nullSafe(noMovement),
			"new_blockers":      nullSafe(newBlockers),
			"date":              today,
		},
	})
}

// GetDeveloperLoad returns per-assignee workload from Asana (mirrors YouTrack GetDeveloperLoad)
func (h *AsanaPMHandler) GetDeveloperLoad(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	client, projectGID, _, err := h.getAsanaClient(r.Context(), userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if projectGID == "" {
		http.Error(w, "Asana project not configured", http.StatusBadRequest)
		return
	}

	tasks, err := client.GetProjectTasksPaginated(r.Context(), projectGID)
	if err != nil {
		http.Error(w, "Failed to get issues: "+err.Error(), http.StatusInternalServerError)
		return
	}

	type devLoad struct {
		Assignee       string     `json:"assignee"`
		ActiveIssues   []issueRow `json:"active_issues"`
		BlockedIssues  []issueRow `json:"blocked_issues"`
		DoneToday      int        `json:"done_today"`
		AvgHoursPerP1  float64    `json:"avg_hours_per_p1"`
		AvgHoursPerP2  float64    `json:"avg_hours_per_p2"`
		LastActivityAt *string    `json:"last_activity_at"`
		MissingUpdate  bool       `json:"missing_update"`
		Overloaded     bool       `json:"overloaded"`
	}

	loadsMap := make(map[string]*devLoad)

	for _, task := range tasks {
		if task.Completed {
			continue
		}
		row := taskToIssueRow(task)
		if row.Status == "Done" || row.Assignee == "" {
			continue
		}
		if loadsMap[row.Assignee] == nil {
			loadsMap[row.Assignee] = &devLoad{
				Assignee:      row.Assignee,
				ActiveIssues:  []issueRow{},
				BlockedIssues: []issueRow{},
			}
		}
		dl := loadsMap[row.Assignee]
		if row.Status == "Blocked" {
			dl.BlockedIssues = append(dl.BlockedIssues, row)
		} else {
			dl.ActiveIssues = append(dl.ActiveIssues, row)
		}
	}

	// Compute done_today and last_activity_at from asana_task_log
	today := time.Now().Format("2006-01-02")
	todayStart := time.Now().Truncate(24 * time.Hour)
	logs, _ := h.asanaPMRepo.GetTransitionsSince(r.Context(), projectGID, todayStart)

	for _, l := range logs {
		if l.TransitionedAt.Format("2006-01-02") != today || l.Assignee == "" {
			continue
		}
		if loadsMap[l.Assignee] == nil {
			loadsMap[l.Assignee] = &devLoad{
				Assignee:      l.Assignee,
				ActiveIssues:  []issueRow{},
				BlockedIssues: []issueRow{},
			}
		}
		dl := loadsMap[l.Assignee]
		if isDoneSection(l.ToSection) {
			dl.DoneToday++
		}
		lastAt := l.TransitionedAt.Format(time.RFC3339)
		dl.LastActivityAt = &lastAt
	}

	var result []devLoad
	for _, dl := range loadsMap {
		dl.Overloaded = len(dl.ActiveIssues) > 3
		dl.MissingUpdate = dl.LastActivityAt == nil
		result = append(result, *dl)
	}
	if result == nil {
		result = []devLoad{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "data": result})
}

// GetBlockerReasons returns AI-extracted blocker reasons for Asana tasks (mirrors YouTrack)
func (h *AsanaPMHandler) GetBlockerReasons(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	idsParam := r.URL.Query().Get("ids")
	if idsParam == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "data": map[string]string{}})
		return
	}
	ids := strings.Split(idsParam, ",")

	client, _, _, err := h.getAsanaClient(r.Context(), userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	reasons := make(map[string]string)

	for _, rawID := range ids {
		taskGID := strings.TrimSpace(rawID)
		if taskGID == "" {
			continue
		}

		// Fetch stories (comments) for this task
		stories, storiesErr := client.GetTaskStories(r.Context(), taskGID)
		currentCount := len(stories)

		// Check cache
		cachedReason, cachedCount, cachedSection, found := h.asanaPMRepo.GetAsanaBlockerCache(r.Context(), taskGID)
		if found && currentCount == cachedCount && isBlockedSection(cachedSection) {
			reasons[taskGID] = cachedReason
			continue
		}

		// Analyse
		var reason string
		if storiesErr != nil || len(stories) == 0 {
			reason = "No comments — reason unknown"
		} else {
			// Collect comment text from stories
			var comments []string
			for _, s := range stories {
				if s.Type == "comment" && s.Text != "" {
					comments = append(comments, s.Text)
				}
			}
			if len(comments) == 0 {
				reason = "No comments — reason unknown"
			} else {
				reason = analyseBlockerComments(r.Context(), taskGID, comments)
			}
		}

		_ = h.asanaPMRepo.SaveAsanaBlockerCache(r.Context(), taskGID, reason, "Blocked", currentCount)
		reasons[taskGID] = reason
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "data": reasons})
}

// ─── Carryover (reuse same daily_ops_carryover table as YouTrack) ─────────────

// SaveCarryoverPlan saves EOD action items (mirrors YouTrack SaveCarryoverPlan)
func (h *AsanaPMHandler) SaveCarryoverPlan(w http.ResponseWriter, r *http.Request) {
	// Delegate to YouTrack handler logic — same table, same format
	ytHandler := NewYouTrackHandler()
	ytHandler.SaveCarryoverPlan(w, r)
}

// GetCarryover retrieves saved carryover items (mirrors YouTrack GetCarryover)
func (h *AsanaPMHandler) GetCarryover(w http.ResponseWriter, r *http.Request) {
	ytHandler := NewYouTrackHandler()
	ytHandler.GetCarryover(w, r)
}

// ─── Import ──────────────────────────────────────────────────────────────────

// ImportFromAsana imports Asana tasks into local DB (reuses existing asana.go ImportFromEnv)
func (h *AsanaPMHandler) ImportFromAsana(w http.ResponseWriter, r *http.Request) {
	asanaHandler := NewAsanaHandler()
	asanaHandler.ImportFromEnv(w, r)
}

// GetProjectSectionsFromDB returns cached Asana sections (reuses existing asana.go handler)
func (h *AsanaPMHandler) GetProjectSectionsFromDB(w http.ResponseWriter, r *http.Request) {
	asanaHandler := NewAsanaHandler()
	asanaHandler.GetProjectSectionsFromDB(w, r)
}

// ─── Data Source preference endpoints ────────────────────────────────────────

// GetDataSource returns the active data source for the current user
func (h *AsanaPMHandler) GetDataSource(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	source, _ := h.settingsRepo.GetUserDataSource(r.Context(), userID)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "data": map[string]string{"source": source}})
}

// SetDataSource saves the active data source for the current user
func (h *AsanaPMHandler) SetDataSource(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	var req struct {
		Source string `json:"source"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if err := h.settingsRepo.SetUserDataSource(r.Context(), userID, req.Source); err != nil {
		http.Error(w, "Failed to save data source: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "data": map[string]string{"source": req.Source}})
}

// ─── internal helpers ────────────────────────────────────────────────────────

// tasksToIssueList converts a slice of Asana tasks to the YouTrack issue list shape
func tasksToIssueList(tasks []asana.Task) []map[string]interface{} {
	var result []map[string]interface{}
	for _, task := range tasks {
		result = append(result, taskToIssueMap(task))
	}
	if result == nil {
		result = []map[string]interface{}{}
	}
	return result
}

// taskToIssueMap converts a single Asana task to the YouTrack issue map shape
func taskToIssueMap(task asana.Task) map[string]interface{} {
	section := taskSectionName(task)
	status := sectionStatus(section)
	if task.Completed {
		status = "Done"
	}

	var assignee interface{}
	if task.Assignee != nil {
		assignee = map[string]interface{}{
			"id":        task.Assignee.GID,
			"login":     task.Assignee.GID,
			"fullName":  task.Assignee.Name,
			"full_name": task.Assignee.Name,
			"email":     task.Assignee.Email,
		}
	}

	createdMs := task.CreatedAt.UnixMilli()
	updatedMs := task.ModifiedAt.UnixMilli()

	return map[string]interface{}{
		"id":          task.GID,
		"summary":     task.Name,
		"description": task.Notes,
		"status":      status,
		"subsystem":   "",
		"priority":    extractAsanaPriority(task),
		"assignee":    assignee,
		"created":     createdMs,
		"updated":     updatedMs,
		"attachments": []interface{}{},
		"section":     section,
		"permalink":   task.PermalinkURL,
	}
}

// analyseAsanaBlockerComments is an alias for analyseBlockerComments (defined in youtrack.go)
// We call it directly since it's in the same package.
// Redeclaring here would cause a duplicate; use the function from youtrack.go.
var _ = analyseAsanaBlockerStories // suppress unused warning

func analyseAsanaBlockerStories(ctx context.Context, taskGID string, comments []string) string {
	apiKey := os.Getenv("GROQ_API_KEY")
	if apiKey == "" {
		apiKey = os.Getenv("OPENAI_API_KEY")
	}
	if apiKey == "" {
		return "AI not configured"
	}

	apiURL := "https://api.groq.com/openai/v1/chat/completions"
	model := "llama-3.3-70b-versatile"
	if os.Getenv("GROQ_API_KEY") == "" {
		apiURL = "https://api.openai.com/v1/chat/completions"
		model = "gpt-4o-mini"
	}

	commentText := strings.Join(comments, "\n---\n")
	if len(commentText) > 4000 {
		commentText = commentText[:4000] + "…"
	}

	prompt := fmt.Sprintf(
		"The following comments are from a blocked Asana task (%s).\nIn ONE short sentence, what is blocking this task? Be specific.\n\nComments:\n%s",
		taskGID, commentText,
	)

	reqBody := map[string]interface{}{
		"model":  model,
		"stream": false,
		"messages": []map[string]string{
			{"role": "user", "content": prompt},
		},
	}
	bodyBytes, _ := json.Marshal(reqBody)

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, apiURL, bytes.NewBuffer(bodyBytes))
	if err != nil {
		return "AI request error"
	}
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	httpReq.Header.Set("Content-Type", "application/json")

	httpClient := &http.Client{Timeout: 30 * time.Second}
	resp, err := httpClient.Do(httpReq)
	if err != nil {
		return "AI unavailable"
	}
	defer resp.Body.Close()
	respBytes, _ := io.ReadAll(resp.Body)

	var aiResp struct {
		Choices []struct {
			Message struct{ Content string `json:"content"` } `json:"message"`
		} `json:"choices"`
	}
	if json.Unmarshal(respBytes, &aiResp) != nil || len(aiResp.Choices) == 0 {
		return "Could not analyse"
	}
	return strings.TrimSpace(aiResp.Choices[0].Message.Content)
}

// Ensure log and _ imports are used
var _ = log.Printf
