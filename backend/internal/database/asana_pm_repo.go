package database

import (
	"context"
	"time"
)

// AsanaTaskLog records a section transition for an Asana task (mirrors IssueStateLog)
type AsanaTaskLog struct {
	ID                          string
	TaskGID                     string
	TaskName                    string
	ProjectGID                  string
	Assignee                    string
	FromSection                 string
	ToSection                   string
	Priority                    string
	TransitionedAt              time.Time
	DurationInPrevSectionHours  *float64
}

// AsanaPMRepository handles asana_task_log and asana_blocker_cache DB operations
type AsanaPMRepository struct{}

// NewAsanaPMRepository creates a new AsanaPMRepository
func NewAsanaPMRepository() *AsanaPMRepository {
	return &AsanaPMRepository{}
}

// LogTaskTransition inserts a new entry into asana_task_log.
// It also computes duration_in_prev_section_hours from the previous log entry for this task.
func (r *AsanaPMRepository) LogTaskTransition(ctx context.Context, log *AsanaTaskLog) error {
	pool := GetPool()
	if pool == nil {
		return nil
	}

	// Compute duration since last transition for this task
	var prevAt *time.Time
	pool.QueryRow(ctx, `
		SELECT transitioned_at FROM asana_task_log
		WHERE task_gid = $1
		ORDER BY transitioned_at DESC LIMIT 1
	`, log.TaskGID).Scan(&prevAt)

	var durationHours *float64
	if prevAt != nil {
		h := log.TransitionedAt.Sub(*prevAt).Hours()
		durationHours = &h
	}

	_, err := pool.Exec(ctx, `
		INSERT INTO asana_task_log
			(task_gid, task_name, project_gid, assignee, from_section, to_section, priority, transitioned_at, duration_in_prev_section_hours)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
	`, log.TaskGID, log.TaskName, log.ProjectGID, log.Assignee, log.FromSection, log.ToSection,
		log.Priority, log.TransitionedAt, durationHours)
	return err
}

// GetTransitionsSince returns all asana_task_log entries for a project since a given time
func (r *AsanaPMRepository) GetTransitionsSince(ctx context.Context, projectGID string, since time.Time) ([]AsanaTaskLog, error) {
	pool := GetPool()
	if pool == nil {
		return nil, nil
	}

	rows, err := pool.Query(ctx, `
		SELECT id, task_gid, task_name, project_gid, COALESCE(assignee,''), COALESCE(from_section,''), to_section,
		       COALESCE(priority,''), transitioned_at, duration_in_prev_section_hours
		FROM asana_task_log
		WHERE project_gid = $1 AND transitioned_at >= $2
		ORDER BY transitioned_at ASC
	`, projectGID, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var logs []AsanaTaskLog
	for rows.Next() {
		var l AsanaTaskLog
		if err := rows.Scan(&l.ID, &l.TaskGID, &l.TaskName, &l.ProjectGID, &l.Assignee,
			&l.FromSection, &l.ToSection, &l.Priority, &l.TransitionedAt, &l.DurationInPrevSectionHours); err == nil {
			logs = append(logs, l)
		}
	}
	return logs, nil
}

// GetLastTransitionForTask returns the most recent asana_task_log entry for a task
func (r *AsanaPMRepository) GetLastTransitionForTask(ctx context.Context, taskGID string) (*AsanaTaskLog, error) {
	pool := GetPool()
	if pool == nil {
		return nil, nil
	}

	var l AsanaTaskLog
	err := pool.QueryRow(ctx, `
		SELECT id, task_gid, task_name, project_gid, COALESCE(assignee,''), COALESCE(from_section,''), to_section,
		       COALESCE(priority,''), transitioned_at, duration_in_prev_section_hours
		FROM asana_task_log WHERE task_gid = $1 ORDER BY transitioned_at DESC LIMIT 1
	`, taskGID).Scan(&l.ID, &l.TaskGID, &l.TaskName, &l.ProjectGID, &l.Assignee,
		&l.FromSection, &l.ToSection, &l.Priority, &l.TransitionedAt, &l.DurationInPrevSectionHours)
	if err != nil {
		return nil, err
	}
	return &l, nil
}

// GetAsanaBlockerCache retrieves a cached blocker reason for an Asana task
func (r *AsanaPMRepository) GetAsanaBlockerCache(ctx context.Context, taskGID string) (reason string, storyCount int, lastSection string, found bool) {
	pool := GetPool()
	if pool == nil {
		return "", 0, "", false
	}
	err := pool.QueryRow(ctx,
		`SELECT reason, story_count, COALESCE(last_section,'') FROM asana_blocker_cache WHERE task_gid = $1`,
		taskGID,
	).Scan(&reason, &storyCount, &lastSection)
	if err != nil {
		return "", 0, "", false
	}
	return reason, storyCount, lastSection, true
}

// SaveAsanaBlockerCache upserts a blocker reason for an Asana task
func (r *AsanaPMRepository) SaveAsanaBlockerCache(ctx context.Context, taskGID, reason, lastSection string, storyCount int) error {
	pool := GetPool()
	if pool == nil {
		return nil
	}
	_, err := pool.Exec(ctx, `
		INSERT INTO asana_blocker_cache (task_gid, reason, story_count, last_section, analyzed_at)
		VALUES ($1,$2,$3,$4,NOW())
		ON CONFLICT (task_gid) DO UPDATE
		  SET reason=$2, story_count=$3, last_section=$4, analyzed_at=NOW()
	`, taskGID, reason, storyCount, lastSection)
	return err
}
