package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"github.com/dhindsa/project-management/internal/database"
	"github.com/dhindsa/project-management/internal/middleware"
	"github.com/dhindsa/project-management/internal/models"
	"github.com/gorilla/mux"
)

// DailyTaskHandler handles daily task list API requests
type DailyTaskHandler struct {
	dailyRepo *database.DailyTaskRepository
	taskRepo  *database.TaskRepository
}

// NewDailyTaskHandler creates a new DailyTaskHandler
func NewDailyTaskHandler() *DailyTaskHandler {
	return &DailyTaskHandler{
		dailyRepo: database.NewDailyTaskRepository(),
		taskRepo:  database.NewTaskRepository(),
	}
}

// GetDailyTaskList returns the daily task list for a specific date
func (h *DailyTaskHandler) GetDailyTaskList(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	vars := mux.Vars(r)
	date := vars["date"]
	projectID := r.URL.Query().Get("project_id")
	if projectID == "" {
		projectID = "default"
	}

	list, err := h.dailyRepo.GetByDate(r.Context(), date, projectID)
	if err != nil {
		// No list found for this date
		sendJSON(w, http.StatusOK, Response{
			Success: true,
			Data:    nil,
			Message: "No task list found for this date",
		})
		return
	}

	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Data:    list,
	})
}

// GenerateDailyTaskList generates a new daily task list from pending tasks
func (h *DailyTaskHandler) GenerateDailyTaskList(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	vars := mux.Vars(r)
	date := vars["date"]

	var req struct {
		ProjectID string `json:"project_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		req.ProjectID = "default"
	}
	if req.ProjectID == "" {
		req.ProjectID = "default"
	}

	// Delete existing list for this date if any
	_ = h.dailyRepo.DeleteByDate(r.Context(), date, req.ProjectID)

	// Create new list
	list := &models.DailyTaskList{
		Date:      date,
		ProjectID: req.ProjectID,
	}
	if err := h.dailyRepo.Create(r.Context(), list); err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{
			Success: false,
			Message: "Failed to create daily task list: " + err.Error(),
		})
		return
	}

	// Get pending tasks grouped by assignee
	tasksByAssignee, err := h.dailyRepo.GetPendingTasksByAssignee(r.Context(), req.ProjectID)
	if err != nil {
		// Even on error, return the empty list
		sendJSON(w, http.StatusOK, Response{
			Success: true,
			Data:    list,
			Message: "Created empty list (could not fetch pending tasks)",
		})
		return
	}

	// Get slack handles for mapping
	slackHandles, _ := h.dailyRepo.GetUserSlackHandles(r.Context())

	// Sort assignee names for consistent ordering
	names := make([]string, 0, len(tasksByAssignee))
	for name := range tasksByAssignee {
		names = append(names, name)
	}
	sort.Strings(names)

	// Create assignments for each assignee
	for i, name := range names {
		tasks := tasksByAssignee[name]

		slackHandle := "@" + name
		if handle, ok := slackHandles[name]; ok && handle != "" {
			slackHandle = handle
		}

		var userID *string
		if len(tasks) > 0 && tasks[0].AssigneeID != nil {
			userID = tasks[0].AssigneeID
		}

		assignment := &models.UserTaskAssignment{
			DailyListID: list.ID,
			UserID:      userID,
			UserName:    name,
			SlackHandle: slackHandle,
			Position:    i,
		}

		if err := h.dailyRepo.CreateAssignment(r.Context(), assignment); err != nil {
			continue
		}

		// Create task items for this assignment
		for j, task := range tasks {
			priority := string(task.Priority)
			if priority == "" {
				priority = "medium"
			}

			// Tasks that were already in progress are carried over
			carriedOver := task.Status == models.TaskStatusInProgress

			item := &models.DailyTaskItem{
				AssignmentID: assignment.ID,
				TaskID:       &task.ID,
				Title:        task.Title,
				Priority:     priority,
				Position:     j,
				CarriedOver:  carriedOver,
			}
			h.dailyRepo.CreateTaskItem(r.Context(), item)
		}
	}

	// Re-fetch the full list with all relationships
	fullList, err := h.dailyRepo.GetByDate(r.Context(), date, req.ProjectID)
	if err != nil {
		sendJSON(w, http.StatusOK, Response{
			Success: true,
			Data:    list,
		})
		return
	}

	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Data:    fullList,
		Message: fmt.Sprintf("Generated task list with %d assignees", len(names)),
	})
}

// GetFormattedTaskList returns Slack-formatted text for copy/paste
func (h *DailyTaskHandler) GetFormattedTaskList(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	vars := mux.Vars(r)
	date := vars["date"]
	projectID := r.URL.Query().Get("project_id")
	if projectID == "" {
		projectID = "default"
	}

	list, err := h.dailyRepo.GetByDate(r.Context(), date, projectID)
	if err != nil {
		sendJSON(w, http.StatusNotFound, Response{
			Success: false,
			Message: "No task list found for this date",
		})
		return
	}

	// Build Slack-formatted text
	formatted := formatForSlack(list)

	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Data: map[string]string{
			"formatted_text": formatted,
			"date":           date,
		},
	})
}

// ReorderTasks reorders task items within a user's assignment
func (h *DailyTaskHandler) ReorderTasks(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	var req models.ReorderTasksRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendJSON(w, http.StatusBadRequest, Response{Success: false, Message: "Invalid request body"})
		return
	}

	if req.AssignmentID == "" || len(req.TaskItemIDs) == 0 {
		sendJSON(w, http.StatusBadRequest, Response{
			Success: false,
			Message: "assignment_id and task_item_ids are required",
		})
		return
	}

	if err := h.dailyRepo.ReorderTaskItems(r.Context(), req.AssignmentID, req.TaskItemIDs); err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{
			Success: false,
			Message: "Failed to reorder tasks",
		})
		return
	}

	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Message: "Tasks reordered successfully",
	})
}

// AddTaskItem adds a task item to an assignment
func (h *DailyTaskHandler) AddTaskItem(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	var req models.AddTaskItemRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendJSON(w, http.StatusBadRequest, Response{Success: false, Message: "Invalid request body"})
		return
	}

	if req.AssignmentID == "" || req.Title == "" {
		sendJSON(w, http.StatusBadRequest, Response{
			Success: false,
			Message: "assignment_id and title are required",
		})
		return
	}

	if req.Priority == "" {
		req.Priority = "medium"
	}

	item := &models.DailyTaskItem{
		AssignmentID: req.AssignmentID,
		TaskID:       req.TaskID,
		Title:        req.Title,
		Priority:     req.Priority,
		Position:     999, // Will be appended at the end
		CarriedOver:  false,
	}

	if err := h.dailyRepo.CreateTaskItem(r.Context(), item); err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{
			Success: false,
			Message: "Failed to add task item",
		})
		return
	}

	sendJSON(w, http.StatusCreated, Response{
		Success: true,
		Data:    item,
		Message: "Task item added",
	})
}

// DeleteTaskItem removes a task item
func (h *DailyTaskHandler) DeleteTaskItem(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	vars := mux.Vars(r)
	itemID := vars["itemId"]

	if err := h.dailyRepo.DeleteTaskItem(r.Context(), itemID); err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{
			Success: false,
			Message: "Failed to delete task item",
		})
		return
	}

	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Message: "Task item deleted",
	})
}

// AddAssignment adds a new user assignment section to the daily list
func (h *DailyTaskHandler) AddAssignment(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	vars := mux.Vars(r)
	date := vars["date"]
	projectID := r.URL.Query().Get("project_id")
	if projectID == "" {
		projectID = "default"
	}

	var req models.AddAssignmentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendJSON(w, http.StatusBadRequest, Response{Success: false, Message: "Invalid request body"})
		return
	}

	if req.UserName == "" || req.SlackHandle == "" {
		sendJSON(w, http.StatusBadRequest, Response{
			Success: false,
			Message: "user_name and slack_handle are required",
		})
		return
	}

	// Get existing list
	list, err := h.dailyRepo.GetByDate(r.Context(), date, projectID)
	if err != nil {
		sendJSON(w, http.StatusNotFound, Response{
			Success: false,
			Message: "No task list found for this date. Generate one first.",
		})
		return
	}

	assignment := &models.UserTaskAssignment{
		DailyListID: list.ID,
		UserName:    req.UserName,
		SlackHandle: req.SlackHandle,
		Position:    len(list.Assignments),
	}

	if err := h.dailyRepo.CreateAssignment(r.Context(), assignment); err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{
			Success: false,
			Message: "Failed to add assignment",
		})
		return
	}

	assignment.Tasks = []models.DailyTaskItem{}

	sendJSON(w, http.StatusCreated, Response{
		Success: true,
		Data:    assignment,
		Message: "Assignment added for " + req.UserName,
	})
}

// DeleteAssignment removes a user assignment section
func (h *DailyTaskHandler) DeleteAssignment(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	vars := mux.Vars(r)
	assignmentID := vars["assignmentId"]

	if err := h.dailyRepo.DeleteAssignment(r.Context(), assignmentID); err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{
			Success: false,
			Message: "Failed to delete assignment",
		})
		return
	}

	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Message: "Assignment deleted",
	})
}

// formatForSlack generates Slack-formatted text from a daily task list
func formatForSlack(list *models.DailyTaskList) string {
	var sb strings.Builder

	sb.WriteString("`todays task list`\n")

	for _, assignment := range list.Assignments {
		sb.WriteString("\n")
		sb.WriteString(fmt.Sprintf("`%s`\n", assignment.SlackHandle))

		for _, task := range assignment.Tasks {
			priorityTag := ""
			if task.Priority == "high" {
				priorityTag = " (High)"
			}
			sb.WriteString(fmt.Sprintf("• %s%s\n", task.Title, priorityTag))
		}
	}

	return sb.String()
}
