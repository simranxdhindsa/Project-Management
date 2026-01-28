package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/dhindsa/project-management/internal/database"
	"github.com/dhindsa/project-management/internal/middleware"
	"github.com/dhindsa/project-management/internal/models"
	"github.com/gorilla/mux"
)

// TaskHandler handles task API requests
type TaskHandler struct {
	taskRepo    *database.TaskRepository
	projectRepo *database.ProjectRepository
}

// NewTaskHandler creates a new TaskHandler
func NewTaskHandler() *TaskHandler {
	return &TaskHandler{
		taskRepo:    database.NewTaskRepository(),
		projectRepo: database.NewProjectRepository(),
	}
}

// GetTasks returns all tasks for the user with optional filters
func (h *TaskHandler) GetTasks(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		sendJSON(w, http.StatusUnauthorized, Response{
			Success: false,
			Message: "Unauthorized",
		})
		return
	}

	// Check if database is connected
	if database.GetPool() == nil {
		sendJSON(w, http.StatusOK, Response{
			Success: true,
			Message: "Database not connected - returning sample data",
			Data:    []interface{}{},
		})
		return
	}

	// Parse query filters
	status := r.URL.Query().Get("status")
	date := r.URL.Query().Get("date")
	projectID := r.URL.Query().Get("project_id")

	filter := &models.TaskFilter{}
	if status != "" {
		s := models.TaskStatus(status)
		filter.Status = &s
	}
	if date != "" {
		filter.Date = &date
	}
	if projectID != "" {
		filter.ProjectID = &projectID
	}

	tasks, err := h.taskRepo.List(r.Context(), filter)
	if err != nil {
		// If database fails, return empty array instead of error
		sendJSON(w, http.StatusOK, Response{
			Success: true,
			Data:    []interface{}{},
		})
		return
	}

	// Convert to API response format
	response := make([]map[string]interface{}, len(tasks))
	for i, task := range tasks {
		response[i] = map[string]interface{}{
			"id":          task.ID,
			"title":       task.Title,
			"description": task.Description,
			"status":      task.Status,
			"priority":    task.Priority,
			"project_id":  task.ProjectID,
			"assignee_id": task.AssigneeID,
			"asana_id":    task.AsanaID,
			"asana_url":   task.AsanaURL,
			"due_date":    task.DueDate,
			"created_at":  task.CreatedAt,
			"updated_at":  task.UpdatedAt,
		}
		if task.AssigneeName != nil {
			response[i]["assignee"] = map[string]interface{}{
				"id":      task.AssigneeID,
				"name":    task.AssigneeName,
				"email":   task.AssigneeEmail,
				"picture": task.AssigneePicture,
			}
		}
	}

	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Data:    response,
	})
}

// GetTask returns a single task by ID
func (h *TaskHandler) GetTask(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	taskID := vars["id"]

	task, err := h.taskRepo.GetByIDWithAssignee(r.Context(), taskID)
	if err != nil {
		sendJSON(w, http.StatusNotFound, Response{
			Success: false,
			Message: "Task not found",
		})
		return
	}

	response := map[string]interface{}{
		"id":          task.ID,
		"title":       task.Title,
		"description": task.Description,
		"status":      task.Status,
		"priority":    task.Priority,
		"project_id":  task.ProjectID,
		"assignee_id": task.AssigneeID,
		"asana_id":    task.AsanaID,
		"asana_url":   task.AsanaURL,
		"due_date":    task.DueDate,
		"created_at":  task.CreatedAt,
		"updated_at":  task.UpdatedAt,
	}
	if task.AssigneeName != nil {
		response["assignee"] = map[string]interface{}{
			"id":      task.AssigneeID,
			"name":    task.AssigneeName,
			"email":   task.AssigneeEmail,
			"picture": task.AssigneePicture,
		}
	}

	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Data:    response,
	})
}

// CreateTask creates a new task
func (h *TaskHandler) CreateTask(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		sendJSON(w, http.StatusUnauthorized, Response{
			Success: false,
			Message: "Unauthorized",
		})
		return
	}

	var req struct {
		Title       string              `json:"title"`
		Description string              `json:"description"`
		Status      models.TaskStatus   `json:"status"`
		Priority    models.TaskPriority `json:"priority"`
		ProjectID   string              `json:"project_id"`
		AssigneeID  *string             `json:"assignee_id"`
		DueDate     *time.Time          `json:"due_date"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendJSON(w, http.StatusBadRequest, Response{
			Success: false,
			Message: "Invalid request body",
		})
		return
	}

	if req.Title == "" {
		sendJSON(w, http.StatusBadRequest, Response{
			Success: false,
			Message: "Title is required",
		})
		return
	}

	// Set defaults
	if req.Status == "" {
		req.Status = models.TaskStatusTodo
	}
	if req.Priority == "" {
		req.Priority = models.TaskPriorityMedium
	}

	task := &models.Task{
		Title:       req.Title,
		Description: req.Description,
		Status:      req.Status,
		Priority:    req.Priority,
		ProjectID:   req.ProjectID,
		AssigneeID:  req.AssigneeID,
		DueDate:     req.DueDate,
		CreatedBy:   user.ID,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	if err := h.taskRepo.Create(r.Context(), task); err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{
			Success: false,
			Message: "Failed to create task: " + err.Error(),
		})
		return
	}

	sendJSON(w, http.StatusCreated, Response{
		Success: true,
		Message: "Task created successfully",
		Data:    task,
	})
}

// UpdateTask updates a task
func (h *TaskHandler) UpdateTask(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	taskID := vars["id"]

	task, err := h.taskRepo.GetByID(r.Context(), taskID)
	if err != nil {
		sendJSON(w, http.StatusNotFound, Response{
			Success: false,
			Message: "Task not found",
		})
		return
	}

	var req struct {
		Title       *string              `json:"title"`
		Description *string              `json:"description"`
		Status      *models.TaskStatus   `json:"status"`
		Priority    *models.TaskPriority `json:"priority"`
		AssigneeID  *string              `json:"assignee_id"`
		DueDate     *time.Time           `json:"due_date"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendJSON(w, http.StatusBadRequest, Response{
			Success: false,
			Message: "Invalid request body",
		})
		return
	}

	// Update only provided fields
	if req.Title != nil {
		task.Title = *req.Title
	}
	if req.Description != nil {
		task.Description = *req.Description
	}
	if req.Status != nil {
		task.Status = *req.Status
	}
	if req.Priority != nil {
		task.Priority = *req.Priority
	}
	if req.AssigneeID != nil {
		task.AssigneeID = req.AssigneeID
	}
	if req.DueDate != nil {
		task.DueDate = req.DueDate
	}

	if err := h.taskRepo.Update(r.Context(), task); err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{
			Success: false,
			Message: "Failed to update task",
		})
		return
	}

	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Message: "Task updated successfully",
		Data:    task,
	})
}

// UpdateTaskStatus updates only the task status (for Kanban drag & drop)
func (h *TaskHandler) UpdateTaskStatus(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		sendJSON(w, http.StatusUnauthorized, Response{
			Success: false,
			Message: "Unauthorized",
		})
		return
	}

	vars := mux.Vars(r)
	taskID := vars["id"]

	var req struct {
		Status models.TaskStatus `json:"status"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendJSON(w, http.StatusBadRequest, Response{
			Success: false,
			Message: "Invalid request body",
		})
		return
	}

	if err := h.taskRepo.UpdateStatus(r.Context(), taskID, req.Status, user.ID); err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{
			Success: false,
			Message: "Failed to update task status",
		})
		return
	}

	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Message: "Task status updated to " + string(req.Status),
	})
}

// DeleteTask deletes a task
func (h *TaskHandler) DeleteTask(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	taskID := vars["id"]

	if err := h.taskRepo.Delete(r.Context(), taskID); err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{
			Success: false,
			Message: "Failed to delete task",
		})
		return
	}

	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Message: "Task deleted successfully",
	})
}

// GetYesterdayPending returns tasks that were not completed yesterday
func (h *TaskHandler) GetYesterdayPending(w http.ResponseWriter, r *http.Request) {
	projectID := r.URL.Query().Get("project_id")

	tasks, err := h.taskRepo.GetYesterdayPending(r.Context(), projectID)
	if err != nil {
		// Return empty array on error
		sendJSON(w, http.StatusOK, Response{
			Success: true,
			Data:    []interface{}{},
		})
		return
	}

	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Message: "Yesterday's pending tasks",
		Data:    tasks,
	})
}

// GetTasksByDate returns tasks for a specific date
func (h *TaskHandler) GetTasksByDate(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	date := vars["date"]

	filter := &models.TaskFilter{
		Date: &date,
	}

	tasks, err := h.taskRepo.List(r.Context(), filter)
	if err != nil {
		sendJSON(w, http.StatusOK, Response{
			Success: true,
			Data:    []interface{}{},
		})
		return
	}

	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Data:    tasks,
	})
}

// GetTaskStats returns task statistics for dashboard
func (h *TaskHandler) GetTaskStats(w http.ResponseWriter, r *http.Request) {
	projectID := r.URL.Query().Get("project_id")

	counts, err := h.taskRepo.GetTaskCountByStatus(r.Context(), projectID)
	if err != nil {
		// Return default stats on error
		counts = map[string]int{
			"todo":        0,
			"in_progress": 0,
			"review":      0,
			"done":        0,
		}
	}

	total := 0
	for _, count := range counts {
		total += count
	}

	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Data: map[string]interface{}{
			"total":       total,
			"todo":        counts["todo"],
			"in_progress": counts["in_progress"],
			"review":      counts["review"],
			"done":        counts["done"],
		},
	})
}

// BulkUpdateStatus updates status for multiple tasks
func (h *TaskHandler) BulkUpdateStatus(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		sendJSON(w, http.StatusUnauthorized, Response{
			Success: false,
			Message: "Unauthorized",
		})
		return
	}

	var req struct {
		TaskIDs []string          `json:"task_ids"`
		Status  models.TaskStatus `json:"status"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendJSON(w, http.StatusBadRequest, Response{
			Success: false,
			Message: "Invalid request body",
		})
		return
	}

	if err := h.taskRepo.BulkUpdateStatus(r.Context(), req.TaskIDs, req.Status, user.ID); err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{
			Success: false,
			Message: "Failed to update tasks",
		})
		return
	}

	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Message: "Tasks updated successfully",
	})
}
