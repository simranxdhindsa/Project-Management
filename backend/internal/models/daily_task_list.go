package models

import "time"

// DailyAnalysis represents a stored AI analysis for a specific date
type DailyAnalysis struct {
	ID              string                 `json:"id" db:"id"`
	Date            string                 `json:"date" db:"date"` // YYYY-MM-DD format
	MorningMessage  string                 `json:"morning_message" db:"morning_message"`
	EveningMessage  string                 `json:"evening_message" db:"evening_message"`
	AnalysisResult  map[string]interface{} `json:"analysis_result" db:"analysis_result"` // Full AI response as JSON
	CreatedAt       time.Time              `json:"created_at" db:"created_at"`
	UpdatedAt       time.Time              `json:"updated_at" db:"updated_at"`
}

// DailyTask represents an individual task from the analysis
type DailyTask struct {
	ID               string    `json:"id" db:"id"`
	AnalysisID       string    `json:"analysis_id" db:"analysis_id"`
	Date             string    `json:"date" db:"date"`
	Assignee         string    `json:"assignee" db:"assignee"`
	TaskTitle        string    `json:"task_title" db:"task_title"`
	Status           string    `json:"status" db:"status"` // done, pending, in_progress, blocked, not_mentioned, skipped
	OriginalTitle    *string   `json:"original_title,omitempty" db:"original_title"`
	Confidence       float64   `json:"confidence" db:"confidence"`
	Evidence         *string   `json:"evidence,omitempty" db:"evidence"`
	CarriedFromDate  *string   `json:"carried_from_date,omitempty" db:"carried_from_date"`
	CreatedAt        time.Time `json:"created_at" db:"created_at"`
}

// NextDayTask represents an editable task for tomorrow's list
type NextDayTask struct {
	ID               string    `json:"id" db:"id"`
	TargetDate       string    `json:"target_date" db:"target_date"` // YYYY-MM-DD format
	Assignee         string    `json:"assignee" db:"assignee"`
	TaskTitle        string    `json:"task_title" db:"task_title"`
	Priority         string    `json:"priority" db:"priority"` // high, medium, low
	Position         int       `json:"position" db:"position"`
	IsCarriedForward bool      `json:"is_carried_forward" db:"is_carried_forward"`
	SourceDate       *string   `json:"source_date,omitempty" db:"source_date"`
	SourceTaskID     *string   `json:"source_task_id,omitempty" db:"source_task_id"`
	Notes            *string   `json:"notes,omitempty" db:"notes"`
	CreatedBy        *string   `json:"created_by,omitempty" db:"created_by"`
	CreatedAt        time.Time `json:"created_at" db:"created_at"`
	UpdatedAt        time.Time `json:"updated_at" db:"updated_at"`
}

// UserTaskAssignment groups tasks by assignee for display
type UserTaskAssignment struct {
	UserName    string        `json:"user_name"`
	SlackHandle string        `json:"slack_handle"`
	Tasks       []NextDayTask `json:"tasks"`
}

// DailyTaskList represents the complete task list for a date
type DailyTaskList struct {
	Date        string               `json:"date"`
	Assignments []UserTaskAssignment `json:"assignments"`
}

// DailyTaskSummary provides a summary of tasks for a specific date
type DailyTaskSummary struct {
	Date          string `json:"date"`
	TotalTasks    int    `json:"total_tasks"`
	DoneTasks     int    `json:"done_tasks"`
	PendingTasks  int    `json:"pending_tasks"`
	BlockedTasks  int    `json:"blocked_tasks"`
	SkippedTasks  int    `json:"skipped_tasks"`
}

// TasksByAssignee groups daily tasks by assignee
type TasksByAssignee struct {
	Assignee  string      `json:"assignee"`
	Tasks     []DailyTask `json:"tasks"`
	Completed []string    `json:"completed"`
	Pending   []string    `json:"pending"`
	Blocked   []string    `json:"blocked"`
	Skipped   []string    `json:"skipped"`
}

// SaveAnalysisRequest is the request body for saving analysis
type SaveAnalysisRequest struct {
	Date           string                 `json:"date"`
	MorningMessage string                 `json:"morning_message"`
	EveningMessage string                 `json:"evening_message"`
	AnalysisResult map[string]interface{} `json:"analysis_result"`
}

// GenerateNextDayRequest is the request body for generating next day tasks
type GenerateNextDayRequest struct {
	SourceDate string `json:"source_date"` // Date to carry forward from
	TargetDate string `json:"target_date"` // Date to generate for (usually source_date + 1)
}

// ReorderTasksRequest is the request body for reordering tasks
type ReorderTasksRequest struct {
	TargetDate string   `json:"target_date"`
	Assignee   string   `json:"assignee"`
	TaskIDs    []string `json:"task_ids"` // Ordered list of task IDs
}

// UpdateNextDayTaskRequest is the request body for updating a single task
type UpdateNextDayTaskRequest struct {
	TaskTitle *string `json:"task_title,omitempty"`
	Priority  *string `json:"priority,omitempty"`
	Notes     *string `json:"notes,omitempty"`
	Position  *int    `json:"position,omitempty"`
}

// CreateNextDayTaskRequest is the request body for creating a new task
type CreateNextDayTaskRequest struct {
	TargetDate string  `json:"target_date"`
	Assignee   string  `json:"assignee"`
	TaskTitle  string  `json:"task_title"`
	Priority   *string `json:"priority,omitempty"`
	Notes      *string `json:"notes,omitempty"`
}
