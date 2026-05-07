package models

import "time"

// NotificationType represents the type of notification
type NotificationType string

const (
	NotificationTaskAssigned    NotificationType = "task_assigned"
	NotificationTaskUpdated     NotificationType = "task_updated"
	NotificationTaskCompleted   NotificationType = "task_completed"
	NotificationTaskOverdue     NotificationType = "task_overdue"
	NotificationMentioned       NotificationType = "mentioned"
	NotificationSlackAnalysis   NotificationType = "slack_analysis"
	NotificationDiscrepancy     NotificationType = "discrepancy"
)

// Notification represents a user notification
type Notification struct {
	ID        string           `json:"id" db:"id"`
	UserID    string           `json:"user_id" db:"user_id"`
	Type      NotificationType `json:"type" db:"type"`
	Title     string           `json:"title" db:"title"`
	Message   string           `json:"message" db:"message"`
	TaskID    *string          `json:"task_id,omitempty" db:"task_id"`
	Read      bool             `json:"read" db:"read"`
	CreatedAt time.Time        `json:"created_at" db:"created_at"`
}

// NotificationPreferences represents user notification settings
type NotificationPreferences struct {
	UserID            string `json:"user_id" db:"user_id"`
	TaskAssigned      bool   `json:"task_assigned" db:"task_assigned"`
	TaskUpdated       bool   `json:"task_updated" db:"task_updated"`
	TaskCompleted     bool   `json:"task_completed" db:"task_completed"`
	TaskOverdue       bool   `json:"task_overdue" db:"task_overdue"`
	SlackAnalysis     bool   `json:"slack_analysis" db:"slack_analysis"`
	EmailNotifications bool  `json:"email_notifications" db:"email_notifications"`
}

// CreateNotificationRequest represents the request to create a notification
type CreateNotificationRequest struct {
	UserID  string           `json:"user_id" validate:"required"`
	Type    NotificationType `json:"type" validate:"required"`
	Title   string           `json:"title" validate:"required"`
	Message string           `json:"message" validate:"required"`
	TaskID  *string          `json:"task_id,omitempty"`
}
