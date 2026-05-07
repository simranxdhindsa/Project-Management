package database

import (
	"context"

	"github.com/dhindsa/project-management/internal/models"
)

// NotificationRepository handles notification database operations
type NotificationRepository struct{}

// NewNotificationRepository creates a new NotificationRepository
func NewNotificationRepository() *NotificationRepository {
	return &NotificationRepository{}
}

// Create inserts a new notification
func (r *NotificationRepository) Create(ctx context.Context, notif *models.Notification) error {
	pool := GetPool()

	return pool.QueryRow(ctx, `
		INSERT INTO notifications (user_id, type, title, message, task_id, read)
		VALUES ($1, $2, $3, $4, $5, false)
		RETURNING id, created_at
	`, notif.UserID, notif.Type, notif.Title, notif.Message, notif.TaskID).Scan(&notif.ID, &notif.CreatedAt)
}

// GetByUserID retrieves notifications for a user
func (r *NotificationRepository) GetByUserID(ctx context.Context, userID string, limit int) ([]*models.Notification, error) {
	pool := GetPool()

	if limit <= 0 {
		limit = 50
	}

	rows, err := pool.Query(ctx, `
		SELECT id, user_id, type, title, message, task_id, read, created_at
		FROM notifications
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT $2
	`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var notifications []*models.Notification
	for rows.Next() {
		var notif models.Notification
		err := rows.Scan(&notif.ID, &notif.UserID, &notif.Type, &notif.Title,
			&notif.Message, &notif.TaskID, &notif.Read, &notif.CreatedAt)
		if err != nil {
			return nil, err
		}
		notifications = append(notifications, &notif)
	}

	return notifications, nil
}

// GetUnreadCount returns the count of unread notifications
func (r *NotificationRepository) GetUnreadCount(ctx context.Context, userID string) (int, error) {
	pool := GetPool()

	var count int
	err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM notifications
		WHERE user_id = $1 AND read = false
	`, userID).Scan(&count)

	return count, err
}

// MarkAsRead marks a notification as read
func (r *NotificationRepository) MarkAsRead(ctx context.Context, notifID, userID string) error {
	pool := GetPool()

	_, err := pool.Exec(ctx, `
		UPDATE notifications SET read = true
		WHERE id = $1 AND user_id = $2
	`, notifID, userID)

	return err
}

// MarkAllAsRead marks all notifications as read for a user
func (r *NotificationRepository) MarkAllAsRead(ctx context.Context, userID string) error {
	pool := GetPool()

	_, err := pool.Exec(ctx, `
		UPDATE notifications SET read = true
		WHERE user_id = $1 AND read = false
	`, userID)

	return err
}

// Delete removes a notification
func (r *NotificationRepository) Delete(ctx context.Context, notifID, userID string) error {
	pool := GetPool()

	_, err := pool.Exec(ctx, `
		DELETE FROM notifications
		WHERE id = $1 AND user_id = $2
	`, notifID, userID)

	return err
}

// DeleteAll removes all notifications for a user
func (r *NotificationRepository) DeleteAll(ctx context.Context, userID string) (int64, error) {
	pool := GetPool()

	result, err := pool.Exec(ctx, `
		DELETE FROM notifications WHERE user_id = $1
	`, userID)
	if err != nil {
		return 0, err
	}

	return result.RowsAffected(), nil
}

// DeleteOld removes notifications older than specified days
func (r *NotificationRepository) DeleteOld(ctx context.Context, days int) (int64, error) {
	pool := GetPool()

	result, err := pool.Exec(ctx, `
		DELETE FROM notifications
		WHERE created_at < NOW() - INTERVAL '1 day' * $1
	`, days)
	if err != nil {
		return 0, err
	}

	return result.RowsAffected(), nil
}

// CreateBulk creates multiple notifications at once
func (r *NotificationRepository) CreateBulk(ctx context.Context, notifications []*models.Notification) error {
	pool := GetPool()

	for _, notif := range notifications {
		_, err := pool.Exec(ctx, `
			INSERT INTO notifications (user_id, type, title, message, task_id, read)
			VALUES ($1, $2, $3, $4, $5, false)
		`, notif.UserID, notif.Type, notif.Title, notif.Message, notif.TaskID)
		if err != nil {
			return err
		}
	}

	return nil
}
