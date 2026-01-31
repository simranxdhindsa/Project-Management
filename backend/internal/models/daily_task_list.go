package models

import "time"

// DailyTaskItem represents a single task in a user's daily task list
type DailyTaskItem struct {
	ID          string `json:"id" db:"id"`
	AssignmentID string `json:"assignment_id" db:"assignment_id"`
	TaskID      *string `json:"task_id,omitempty" db:"task_id"`
	Title       string  `json:"title" db:"title"`
	Priority    string  `json:"priority" db:"priority"` // high, medium, low
	Position    int     `json:"position" db:"position"`
	CarriedOver bool    `json:"carried_over" db:"carried_over"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
}

// UserTaskAssignment represents a user's task group in the daily list
type UserTaskAssignment struct {
	ID          string          `json:"id" db:"id"`
	DailyListID string          `json:"daily_list_id" db:"daily_list_id"`
	UserID      *string         `json:"user_id,omitempty" db:"user_id"`
	UserName    string          `json:"user_name" db:"user_name"`
	SlackHandle string          `json:"slack_handle" db:"slack_handle"`
	Position    int             `json:"position" db:"position"`
	Tasks       []DailyTaskItem `json:"tasks"`
	CreatedAt   time.Time       `json:"created_at" db:"created_at"`
}

// DailyTaskList represents the full daily task list for a date
type DailyTaskList struct {
	ID          string               `json:"id" db:"id"`
	Date        string               `json:"date" db:"date"` // YYYY-MM-DD
	ProjectID   string               `json:"project_id" db:"project_id"`
	Assignments []UserTaskAssignment `json:"assignments"`
	CreatedAt   time.Time            `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time            `json:"updated_at" db:"updated_at"`
}

// GenerateDailyTaskListRequest is the request to generate a daily task list
type GenerateDailyTaskListRequest struct {
	Date      string `json:"date"` // YYYY-MM-DD
	ProjectID string `json:"project_id"`
}

// ReorderTasksRequest is the request to reorder tasks within a user's assignment
type ReorderTasksRequest struct {
	AssignmentID string   `json:"assignment_id"`
	TaskItemIDs  []string `json:"task_item_ids"` // ordered list of daily_task_item IDs
}

// AddTaskItemRequest is the request to add a task item to an assignment
type AddTaskItemRequest struct {
	AssignmentID string `json:"assignment_id"`
	Title        string `json:"title"`
	Priority     string `json:"priority"`
	TaskID       *string `json:"task_id,omitempty"` // optional link to tasks table
}

// UpdateAssignmentRequest is for updating a user assignment (name/handle)
type UpdateAssignmentRequest struct {
	UserName    *string `json:"user_name,omitempty"`
	SlackHandle *string `json:"slack_handle,omitempty"`
}

// AddAssignmentRequest is for adding a new user section to the daily list
type AddAssignmentRequest struct {
	UserName    string `json:"user_name"`
	SlackHandle string `json:"slack_handle"`
}
