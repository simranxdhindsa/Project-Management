package models

import "time"

type ActivityType string

const (
	ActivityTaskCreated    ActivityType = "task_created"
	ActivityTaskUpdated    ActivityType = "task_updated"
	ActivityTaskCompleted  ActivityType = "task_completed"
	ActivityTaskAssigned   ActivityType = "task_assigned"
	ActivityTaskOverdue    ActivityType = "task_overdue"
	ActivityProjectCreated ActivityType = "project_created"
	ActivityProjectUpdated ActivityType = "project_updated"
	ActivitySlackScan      ActivityType = "slack_scan"
	ActivitySlackDigest    ActivityType = "slack_digest"
	ActivityIssueTransition ActivityType = "issue_transition"
	ActivityReminderFired  ActivityType = "reminder_fired"
	ActivityLogin          ActivityType = "login"
	ActivityAIAnalysis     ActivityType = "ai_analysis"
)

type ActivityLog struct {
	ID          string       `json:"id"`
	UserID      string       `json:"user_id"`
	ActorName   string       `json:"actor_name,omitempty"`
	Type        ActivityType `json:"type"`
	Title       string       `json:"title"`
	Description string       `json:"description,omitempty"`
	EntityType  string       `json:"entity_type,omitempty"`
	EntityID    string       `json:"entity_id,omitempty"`
	Metadata    interface{}  `json:"metadata,omitempty"`
	CreatedAt   time.Time    `json:"created_at"`
}
