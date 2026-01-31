package models

import "time"

// TaskStatus represents the status of a task
type TaskStatus string

const (
	TaskStatusTodo       TaskStatus = "todo"
	TaskStatusInProgress TaskStatus = "in_progress"
	TaskStatusReview     TaskStatus = "review"
	TaskStatusDone       TaskStatus = "done"
)

// TaskPriority represents the priority level of a task
type TaskPriority string

const (
	TaskPriorityLow    TaskPriority = "low"
	TaskPriorityMedium TaskPriority = "medium"
	TaskPriorityHigh   TaskPriority = "high"
)

// Task represents a task in the system
type Task struct {
	ID              string       `json:"id" db:"id"`
	Title           string       `json:"title" db:"title"`
	Description     string       `json:"description" db:"description"`
	Status          TaskStatus   `json:"status" db:"status"`
	Priority        TaskPriority `json:"priority" db:"priority"`
	ProjectID       string       `json:"project_id" db:"project_id"`
	AssigneeID      *string      `json:"assignee_id,omitempty" db:"assignee_id"`
	AsanaID         *string      `json:"asana_id,omitempty" db:"asana_id"`
	AsanaURL        *string      `json:"asana_url,omitempty" db:"asana_url"`
	AsanaSectionGID *string      `json:"asana_section_gid,omitempty" db:"asana_section_gid"`
	SectionName     *string      `json:"section_name,omitempty" db:"section_name"`
	DueDate         *time.Time   `json:"due_date,omitempty" db:"due_date"`
	CreatedAt       time.Time    `json:"created_at" db:"created_at"`
	UpdatedAt       time.Time    `json:"updated_at" db:"updated_at"`
	CreatedBy       string       `json:"created_by" db:"created_by"`
}

// TaskWithAssignee includes assignee details
type TaskWithAssignee struct {
	Task
	AssigneeName    *string `json:"assignee_name,omitempty" db:"assignee_name"`
	AssigneeEmail   *string `json:"assignee_email,omitempty" db:"assignee_email"`
	AssigneePicture *string `json:"assignee_picture,omitempty" db:"assignee_picture"`
}

// CreateTaskRequest represents the request to create a task
type CreateTaskRequest struct {
	Title       string       `json:"title" validate:"required,min=1,max=255"`
	Description string       `json:"description"`
	Status      TaskStatus   `json:"status"`
	Priority    TaskPriority `json:"priority"`
	ProjectID   string       `json:"project_id" validate:"required"`
	AssigneeID  *string      `json:"assignee_id"`
	DueDate     *time.Time   `json:"due_date"`
}

// UpdateTaskRequest represents the request to update a task
type UpdateTaskRequest struct {
	Title       *string       `json:"title,omitempty"`
	Description *string       `json:"description,omitempty"`
	Status      *TaskStatus   `json:"status,omitempty"`
	Priority    *TaskPriority `json:"priority,omitempty"`
	AssigneeID  *string       `json:"assignee_id,omitempty"`
	DueDate     *time.Time    `json:"due_date,omitempty"`
}

// UpdateTaskStatusRequest represents the request to update task status
type UpdateTaskStatusRequest struct {
	Status TaskStatus `json:"status" validate:"required"`
}

// UpdateTaskSectionRequest represents the request to move a task to a different section
type UpdateTaskSectionRequest struct {
	SectionGID  string `json:"section_gid" validate:"required"`
	SectionName string `json:"section_name" validate:"required"`
}

// TaskFilter represents filters for querying tasks
type TaskFilter struct {
	ProjectID  *string     `json:"project_id"`
	Status     *TaskStatus `json:"status"`
	Priority   *TaskPriority `json:"priority"`
	AssigneeID *string     `json:"assignee_id"`
	Date       *string     `json:"date"` // YYYY-MM-DD format
	FromDate   *string     `json:"from_date"`
	ToDate     *string     `json:"to_date"`
}

// TaskHistory tracks changes to tasks for carry-over feature
type TaskHistory struct {
	ID        string     `json:"id" db:"id"`
	TaskID    string     `json:"task_id" db:"task_id"`
	Status    TaskStatus `json:"status" db:"status"`
	ChangedAt time.Time  `json:"changed_at" db:"changed_at"`
	ChangedBy string     `json:"changed_by" db:"changed_by"`
}
