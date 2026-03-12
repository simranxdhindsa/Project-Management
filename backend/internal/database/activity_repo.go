package database

import (
	"context"
	"encoding/json"

	"github.com/dhindsa/project-management/internal/models"
)

type ActivityRepository struct{}

func NewActivityRepository() *ActivityRepository {
	return &ActivityRepository{}
}

// Create inserts a new activity log entry
func (r *ActivityRepository) Create(ctx context.Context, a *models.ActivityLog) error {
	pool := GetPool()

	var metaJSON []byte
	if a.Metadata != nil {
		var err error
		metaJSON, err = json.Marshal(a.Metadata)
		if err != nil {
			metaJSON = []byte("{}")
		}
	}

	return pool.QueryRow(ctx, `
		INSERT INTO activity_log (user_id, actor_name, type, title, description, entity_type, entity_id, metadata)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, created_at
	`, a.UserID, a.ActorName, a.Type, a.Title, a.Description,
		a.EntityType, a.EntityID, metaJSON).Scan(&a.ID, &a.CreatedAt)
}

// GetByUserID retrieves activity log entries for a user, newest first
func (r *ActivityRepository) GetByUserID(ctx context.Context, userID string, limit, offset int) ([]*models.ActivityLog, error) {
	pool := GetPool()

	if limit <= 0 {
		limit = 50
	}

	rows, err := pool.Query(ctx, `
		SELECT id, user_id, COALESCE(actor_name,''), type, title,
		       COALESCE(description,''), COALESCE(entity_type,''), COALESCE(entity_id,''),
		       metadata, created_at
		FROM activity_log
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3
	`, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var logs []*models.ActivityLog
	for rows.Next() {
		var a models.ActivityLog
		var metaRaw []byte
		err := rows.Scan(&a.ID, &a.UserID, &a.ActorName, &a.Type, &a.Title,
			&a.Description, &a.EntityType, &a.EntityID, &metaRaw, &a.CreatedAt)
		if err != nil {
			return nil, err
		}
		if len(metaRaw) > 0 {
			var meta interface{}
			if err := json.Unmarshal(metaRaw, &meta); err == nil {
				a.Metadata = meta
			}
		}
		logs = append(logs, &a)
	}

	return logs, nil
}

// DeleteOld removes activity entries older than the given number of days (rolling window)
func (r *ActivityRepository) DeleteOld(ctx context.Context, days int) (int64, error) {
	pool := GetPool()

	result, err := pool.Exec(ctx, `
		DELETE FROM activity_log
		WHERE created_at < NOW() - INTERVAL '1 day' * $1
	`, days)
	if err != nil {
		return 0, err
	}

	return result.RowsAffected(), nil
}
