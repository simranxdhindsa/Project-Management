package models

import "time"

// ReminderType represents the type of reminder
type ReminderType string

const (
	ReminderTaskFollowup ReminderType = "task_followup"
	ReminderCustom       ReminderType = "custom"
	ReminderDailyDigest  ReminderType = "daily_digest"
	ReminderBlockedIssue ReminderType = "blocked_issue"
	ReminderUpdateCheck  ReminderType = "update_check"
)

// ReminderRecurring represents the recurring type
type ReminderRecurring string

const (
	RecurringNone   ReminderRecurring = "none"
	RecurringDaily  ReminderRecurring = "daily"
	RecurringWeekly ReminderRecurring = "weekly"
)

// ReminderStatus represents the status of a reminder
type ReminderStatus string

const (
	ReminderPending   ReminderStatus = "pending"
	ReminderSent      ReminderStatus = "sent"
	ReminderDismissed ReminderStatus = "dismissed"
)

// Reminder represents a scheduled reminder
type Reminder struct {
	ID             string            `json:"id" db:"id"`
	UserID         string            `json:"user_id" db:"user_id"`
	Type           ReminderType      `json:"type" db:"type"`
	Title          string            `json:"title" db:"title"`
	Message        *string           `json:"message,omitempty" db:"message"`
	TargetDate     string            `json:"target_date" db:"target_date"`
	TargetTime     *string           `json:"target_time,omitempty" db:"target_time"`
	RelatedTaskID  *string           `json:"related_task_id,omitempty" db:"related_task_id"`
	RelatedIssueID *string           `json:"related_issue_id,omitempty" db:"related_issue_id"`
	Recurring      ReminderRecurring `json:"recurring" db:"recurring"`
	Status         ReminderStatus    `json:"status" db:"status"`
	CreatedAt      time.Time         `json:"created_at" db:"created_at"`
}

// CreateReminderRequest represents the request to create a reminder
type CreateReminderRequest struct {
	Type           ReminderType      `json:"type"`
	Title          string            `json:"title" validate:"required"`
	Message        *string           `json:"message,omitempty"`
	TargetDate     string            `json:"target_date" validate:"required"`
	TargetTime     *string           `json:"target_time,omitempty"`
	RelatedTaskID  *string           `json:"related_task_id,omitempty"`
	RelatedIssueID *string           `json:"related_issue_id,omitempty"`
	Recurring      ReminderRecurring `json:"recurring"`
}
