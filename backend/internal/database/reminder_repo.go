package database

import (
	"context"
	"time"

	"github.com/dhindsa/project-management/internal/models"
)

// ReminderRepository handles reminder database operations
type ReminderRepository struct{}

// NewReminderRepository creates a new ReminderRepository
func NewReminderRepository() *ReminderRepository {
	return &ReminderRepository{}
}

// Create inserts a new reminder
func (r *ReminderRepository) Create(ctx context.Context, reminder *models.Reminder) error {
	pool := GetPool()

	return pool.QueryRow(ctx, `
		INSERT INTO reminders (user_id, type, title, message, target_date, target_time, related_task_id, related_issue_id, recurring, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
		RETURNING id, created_at
	`, reminder.UserID, reminder.Type, reminder.Title, reminder.Message,
		reminder.TargetDate, reminder.TargetTime, reminder.RelatedTaskID,
		reminder.RelatedIssueID, reminder.Recurring).Scan(&reminder.ID, &reminder.CreatedAt)
}

// GetByUserID retrieves reminders for a user
func (r *ReminderRepository) GetByUserID(ctx context.Context, userID string) ([]*models.Reminder, error) {
	pool := GetPool()

	rows, err := pool.Query(ctx, `
		SELECT id, user_id, type, title, message, target_date, target_time,
		       related_task_id, related_issue_id, recurring, status, created_at
		FROM reminders
		WHERE user_id = $1 AND status != 'dismissed'
		ORDER BY target_date ASC, target_time ASC NULLS LAST
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var reminders []*models.Reminder
	for rows.Next() {
		var rem models.Reminder
		var targetDate time.Time
		err := rows.Scan(&rem.ID, &rem.UserID, &rem.Type, &rem.Title, &rem.Message,
			&targetDate, &rem.TargetTime, &rem.RelatedTaskID, &rem.RelatedIssueID,
			&rem.Recurring, &rem.Status, &rem.CreatedAt)
		if err != nil {
			return nil, err
		}
		rem.TargetDate = targetDate.Format("2006-01-02")
		reminders = append(reminders, &rem)
	}

	return reminders, nil
}

// GetDueReminders retrieves reminders that are due (pending and past their target time)
func (r *ReminderRepository) GetDueReminders(ctx context.Context) ([]*models.Reminder, error) {
	pool := GetPool()

	now := time.Now()
	currentDate := now.Format("2006-01-02")
	currentTime := now.Format("15:04")

	rows, err := pool.Query(ctx, `
		SELECT id, user_id, type, title, message, target_date, target_time,
		       related_task_id, related_issue_id, recurring, status, created_at
		FROM reminders
		WHERE status = 'pending'
		  AND (
		    target_date < $1
		    OR (target_date = $1 AND (target_time IS NULL OR target_time <= $2::time))
		  )
		ORDER BY target_date ASC, target_time ASC NULLS LAST
	`, currentDate, currentTime)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var reminders []*models.Reminder
	for rows.Next() {
		var rem models.Reminder
		var targetDate time.Time
		err := rows.Scan(&rem.ID, &rem.UserID, &rem.Type, &rem.Title, &rem.Message,
			&targetDate, &rem.TargetTime, &rem.RelatedTaskID, &rem.RelatedIssueID,
			&rem.Recurring, &rem.Status, &rem.CreatedAt)
		if err != nil {
			return nil, err
		}
		rem.TargetDate = targetDate.Format("2006-01-02")
		reminders = append(reminders, &rem)
	}

	return reminders, nil
}

// MarkAsSent marks a reminder as sent
func (r *ReminderRepository) MarkAsSent(ctx context.Context, reminderID string) error {
	pool := GetPool()
	_, err := pool.Exec(ctx, `UPDATE reminders SET status = 'sent' WHERE id = $1`, reminderID)
	return err
}

// Dismiss marks a reminder as dismissed
func (r *ReminderRepository) Dismiss(ctx context.Context, reminderID, userID string) error {
	pool := GetPool()
	_, err := pool.Exec(ctx, `UPDATE reminders SET status = 'dismissed' WHERE id = $1 AND user_id = $2`, reminderID, userID)
	return err
}

// Delete removes a reminder
func (r *ReminderRepository) Delete(ctx context.Context, reminderID, userID string) error {
	pool := GetPool()
	_, err := pool.Exec(ctx, `DELETE FROM reminders WHERE id = $1 AND user_id = $2`, reminderID, userID)
	return err
}

// RescheduleRecurring creates the next occurrence for a recurring reminder
func (r *ReminderRepository) RescheduleRecurring(ctx context.Context, reminder *models.Reminder) error {
	if reminder.Recurring == models.RecurringNone {
		return nil
	}

	targetDate, err := time.Parse("2006-01-02", reminder.TargetDate)
	if err != nil {
		return err
	}

	var nextDate time.Time
	switch reminder.Recurring {
	case models.RecurringDaily:
		nextDate = targetDate.AddDate(0, 0, 1)
	case models.RecurringWeekly:
		nextDate = targetDate.AddDate(0, 0, 7)
	default:
		return nil
	}

	newReminder := &models.Reminder{
		UserID:         reminder.UserID,
		Type:           reminder.Type,
		Title:          reminder.Title,
		Message:        reminder.Message,
		TargetDate:     nextDate.Format("2006-01-02"),
		TargetTime:     reminder.TargetTime,
		RelatedTaskID:  reminder.RelatedTaskID,
		RelatedIssueID: reminder.RelatedIssueID,
		Recurring:      reminder.Recurring,
	}

	return r.Create(ctx, newReminder)
}
