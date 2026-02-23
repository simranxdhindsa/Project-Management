package database

import (
	"context"
	"fmt"
	"time"
)

// IssueStateLog represents one state transition for a YouTrack issue
type IssueStateLog struct {
	ID                       string    `json:"id"`
	IssueID                  string    `json:"issue_id"`
	IssueSummary             string    `json:"issue_summary"`
	Assignee                 string    `json:"assignee"`
	MovedBy                  string    `json:"moved_by"`
	FromState                string    `json:"from_state"`
	ToState                  string    `json:"to_state"`
	Priority                 string    `json:"priority"`
	TransitionedAt           time.Time `json:"transitioned_at"`
	DurationInPrevStateHours *float64  `json:"duration_in_prev_state_hours"`
	Comment                  string    `json:"comment"`   // comment added at time of transition (for backward moves)
	// MovedByMismatch is true when moved_by ≠ assignee (both non-empty)
	MovedByMismatch          bool      `json:"moved_by_mismatch"`
}

// PMReport represents a saved daily PM report
type PMReport struct {
	ID           string    `json:"id"`
	Date         string    `json:"date"`
	ReportText   string    `json:"report_text"`
	DoneCount    int       `json:"done_count"`
	OpenCount    int       `json:"open_count"`
	BlockedCount int       `json:"blocked_count"`
	GeneratedAt  time.Time `json:"generated_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// AssigneeStat represents aggregated stats for one assignee
type AssigneeStat struct {
	Assignee   string  `json:"assignee"`
	Open       int     `json:"open"`
	InProgress int     `json:"in_progress"`
	Done       int     `json:"done"`
	Blocked    int     `json:"blocked"`
	AvgHoursInProgress *float64 `json:"avg_hours_in_progress"`
}

// ReportRepository handles reporting database operations
type ReportRepository struct{}

// NewReportRepository creates a new ReportRepository
func NewReportRepository() *ReportRepository {
	return &ReportRepository{}
}

// ResetStateLog deletes ALL rows from issue_state_log.
// Used to clear stale backfill data so tracking can start fresh from live webhooks.
func (r *ReportRepository) ResetStateLog(ctx context.Context) (int64, error) {
	pool := GetPool()
	tag, err := pool.Exec(ctx, `DELETE FROM issue_state_log`)
	if err != nil {
		return 0, fmt.Errorf("failed to reset state log: %w", err)
	}
	return tag.RowsAffected(), nil
}

// IsCurrentlyInProgress returns true if the issue has an active In Progress entry
// (entered In Progress but not yet exited). Used for backfill idempotency.
func (r *ReportRepository) IsCurrentlyInProgress(ctx context.Context, issueID string) (bool, error) {
	pool := GetPool()
	var count int
	err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM issue_state_log
		WHERE issue_id = $1
		  AND LOWER(to_state) = 'in progress'
		  AND issue_id NOT IN (
			SELECT issue_id FROM issue_state_log WHERE LOWER(from_state) = 'in progress'
		  )
	`, issueID).Scan(&count)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// InsertStateLog inserts a new state transition record
func (r *ReportRepository) InsertStateLog(ctx context.Context, log *IssueStateLog) error {
	pool := GetPool()

	// Compute duration from previous state if there's an existing log entry
	var durationHours *float64
	if log.FromState != "" {
		var lastTransitionedAt *time.Time
		err := pool.QueryRow(ctx, `
			SELECT transitioned_at FROM issue_state_log
			WHERE issue_id = $1 AND to_state = $2
			ORDER BY transitioned_at DESC
			LIMIT 1
		`, log.IssueID, log.FromState).Scan(&lastTransitionedAt)
		if err == nil && lastTransitionedAt != nil {
			d := log.TransitionedAt.Sub(*lastTransitionedAt).Hours()
			durationHours = &d
		}
	}

	_, err := pool.Exec(ctx, `
		INSERT INTO issue_state_log (issue_id, issue_summary, assignee, moved_by, from_state, to_state, priority, transitioned_at, duration_in_prev_state_hours, comment)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`, log.IssueID, log.IssueSummary, log.Assignee, log.MovedBy, log.FromState, log.ToState, log.Priority, log.TransitionedAt, durationHours, log.Comment)
	if err != nil {
		return fmt.Errorf("failed to insert state log: %w", err)
	}
	return nil
}

// scanStateLog scans a row into IssueStateLog and computes MovedByMismatch
// Column order must match all SELECT queries: id, issue_id, issue_summary, assignee, moved_by,
// from_state, to_state, priority, transitioned_at, duration_in_prev_state_hours, comment
func scanStateLog(rows interface {
	Scan(dest ...interface{}) error
}) (IssueStateLog, error) {
	var l IssueStateLog
	err := rows.Scan(
		&l.ID, &l.IssueID, &l.IssueSummary,
		&l.Assignee, &l.MovedBy,
		&l.FromState, &l.ToState, &l.Priority,
		&l.TransitionedAt, &l.DurationInPrevStateHours, &l.Comment,
	)
	if err == nil && l.Assignee != "" && l.MovedBy != "" && l.Assignee != l.MovedBy {
		l.MovedByMismatch = true
	}
	return l, err
}

// GetStateLogForIssue returns the full state transition history for one issue
func (r *ReportRepository) GetStateLogForIssue(ctx context.Context, issueID string) ([]IssueStateLog, error) {
	pool := GetPool()

	rows, err := pool.Query(ctx, `
		SELECT id, issue_id, issue_summary,
		       COALESCE(assignee,''), COALESCE(moved_by,''),
		       COALESCE(from_state,''), to_state, COALESCE(priority,''),
		       transitioned_at, duration_in_prev_state_hours, COALESCE(comment,'')
		FROM issue_state_log
		WHERE issue_id = $1
		ORDER BY transitioned_at ASC
	`, issueID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var logs []IssueStateLog
	for rows.Next() {
		l, err := scanStateLog(rows)
		if err != nil {
			return nil, err
		}
		logs = append(logs, l)
	}
	return logs, nil
}

// GetDoneIssues returns issues that moved to DEV on a specific date
func (r *ReportRepository) GetDoneIssues(ctx context.Context, date string) ([]IssueStateLog, error) {
	pool := GetPool()

	rows, err := pool.Query(ctx, `
		SELECT id, issue_id, issue_summary,
		       COALESCE(assignee,''), COALESCE(moved_by,''),
		       COALESCE(from_state,''), to_state, COALESCE(priority,''),
		       transitioned_at, duration_in_prev_state_hours, COALESCE(comment,'')
		FROM issue_state_log
		WHERE LOWER(to_state) = 'dev'
		  AND date(transitioned_at) = $1::date
		ORDER BY transitioned_at DESC
	`, date)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var logs []IssueStateLog
	for rows.Next() {
		l, err := scanStateLog(rows)
		if err != nil {
			return nil, err
		}
		logs = append(logs, l)
	}
	return logs, nil
}

// GetTimeTracking returns one row per ticket showing its most relevant In Progress span:
//   - If the ticket is currently In Progress (no exit yet): shows elapsed time live (NOW - entered).
//   - If the ticket has exited In Progress: shows the MOST RECENT exit transition with stored duration.
//
// Only one row per ticket is returned (the latest relevant transition) to avoid duplicates.
func (r *ReportRepository) GetTimeTracking(ctx context.Context) ([]IssueStateLog, error) {
	pool := GetPool()

	// Use DISTINCT ON (issue_id) with a deliberate ordering to pick the best row per ticket:
	// Priority 1: rows where from_state='in progress' (ticket has already exited) — ordered by transitioned_at DESC (most recent exit)
	// Priority 2: rows where to_state='in progress' (ticket is currently there) — only shown if no exit row exists
	//
	// We achieve this with a subquery that ranks rows per issue_id and picks rank=1.
	rows, err := pool.Query(ctx, `
		WITH ranked AS (
			SELECT
				id, issue_id, issue_summary,
				COALESCE(assignee,'') AS assignee,
				COALESCE(moved_by,'') AS moved_by,
				COALESCE(from_state,'') AS from_state,
				to_state,
				COALESCE(priority,'') AS priority,
				transitioned_at,
				CASE
					WHEN LOWER(to_state) = 'in progress' AND duration_in_prev_state_hours IS NULL
						THEN EXTRACT(EPOCH FROM (NOW() - transitioned_at)) / 3600.0
					ELSE duration_in_prev_state_hours
				END AS duration_in_prev_state_hours,
				COALESCE(comment,'') AS comment,
				-- Rank: exit rows (from_state=in progress) get rank 0 (preferred), entry rows get rank 1
				CASE WHEN LOWER(from_state) = 'in progress' THEN 0 ELSE 1 END AS row_rank,
				ROW_NUMBER() OVER (
					PARTITION BY issue_id
					ORDER BY
						CASE WHEN LOWER(from_state) = 'in progress' THEN 0 ELSE 1 END ASC,
						transitioned_at DESC
				) AS rn
			FROM issue_state_log
			WHERE LOWER(to_state) = 'in progress'
			   OR LOWER(from_state) = 'in progress'
		)
		SELECT id, issue_id, issue_summary, assignee, moved_by,
		       from_state, to_state, priority, transitioned_at, duration_in_prev_state_hours, comment
		FROM ranked
		WHERE rn = 1
		ORDER BY
			row_rank ASC,         -- Currently In Progress first, then completed
			transitioned_at DESC
		LIMIT 200
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var logs []IssueStateLog
	for rows.Next() {
		l, err := scanStateLog(rows)
		if err != nil {
			return nil, err
		}
		logs = append(logs, l)
	}
	return logs, nil
}

// GetInProgressOlderThan returns issues currently In Progress for longer than given hours
func (r *ReportRepository) GetInProgressOlderThan(ctx context.Context, hours float64) ([]IssueStateLog, error) {
	pool := GetPool()

	rows, err := pool.Query(ctx, `
		SELECT DISTINCT ON (issue_id)
		       id, issue_id, issue_summary,
		       COALESCE(assignee,''), COALESCE(moved_by,''),
		       COALESCE(from_state,''), to_state, COALESCE(priority,''),
		       transitioned_at, duration_in_prev_state_hours, COALESCE(comment,'')
		FROM issue_state_log
		WHERE LOWER(to_state) = 'in progress'
		  AND issue_id NOT IN (
			SELECT DISTINCT issue_id FROM issue_state_log
			WHERE LOWER(from_state) = 'in progress'
		  )
		  AND EXTRACT(EPOCH FROM (NOW() - transitioned_at))/3600 > $1
		ORDER BY issue_id, transitioned_at ASC
	`, hours)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var logs []IssueStateLog
	for rows.Next() {
		l, err := scanStateLog(rows)
		if err != nil {
			return nil, err
		}
		logs = append(logs, l)
	}
	return logs, nil
}

// GetAssigneeStats returns per-assignee done count from state log
func (r *ReportRepository) GetAssigneeStats(ctx context.Context) ([]AssigneeStat, error) {
	pool := GetPool()

	rows, err := pool.Query(ctx, `
		SELECT
			assignee,
			COUNT(*) FILTER (WHERE LOWER(to_state) = 'dev') AS done,
			COALESCE(AVG(duration_in_prev_state_hours) FILTER (WHERE LOWER(from_state) = 'in progress'), NULL) AS avg_hours
		FROM issue_state_log
		WHERE assignee != ''
		GROUP BY assignee
		ORDER BY done DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var stats []AssigneeStat
	for rows.Next() {
		var s AssigneeStat
		if err := rows.Scan(&s.Assignee, &s.Done, &s.AvgHoursInProgress); err != nil {
			return nil, err
		}
		stats = append(stats, s)
	}
	return stats, nil
}

// SavePMReport upserts a PM report by date
func (r *ReportRepository) SavePMReport(ctx context.Context, date, reportText string, doneCount, openCount, blockedCount int) (*PMReport, error) {
	pool := GetPool()

	now := time.Now()
	var report PMReport

	err := pool.QueryRow(ctx, `
		INSERT INTO pm_reports (date, report_text, done_count, open_count, blocked_count, generated_at, updated_at)
		VALUES ($1::date, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (date) DO UPDATE SET
			report_text = EXCLUDED.report_text,
			done_count = EXCLUDED.done_count,
			open_count = EXCLUDED.open_count,
			blocked_count = EXCLUDED.blocked_count,
			updated_at = EXCLUDED.updated_at
		RETURNING id, date::text, report_text, done_count, open_count, blocked_count, generated_at, updated_at
	`, date, reportText, doneCount, openCount, blockedCount, now, now).Scan(
		&report.ID, &report.Date, &report.ReportText,
		&report.DoneCount, &report.OpenCount, &report.BlockedCount,
		&report.GeneratedAt, &report.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to save PM report: %w", err)
	}
	return &report, nil
}

// GetPMReport fetches a saved report for a specific date
func (r *ReportRepository) GetPMReport(ctx context.Context, date string) (*PMReport, error) {
	pool := GetPool()

	var report PMReport
	err := pool.QueryRow(ctx, `
		SELECT id, date::text, report_text, done_count, open_count, blocked_count, generated_at, updated_at
		FROM pm_reports
		WHERE date = $1::date
	`, date).Scan(
		&report.ID, &report.Date, &report.ReportText,
		&report.DoneCount, &report.OpenCount, &report.BlockedCount,
		&report.GeneratedAt, &report.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &report, nil
}

// ListPMReports returns the most recent saved reports
func (r *ReportRepository) ListPMReports(ctx context.Context) ([]PMReport, error) {
	pool := GetPool()

	rows, err := pool.Query(ctx, `
		SELECT id, date::text, report_text, done_count, open_count, blocked_count, generated_at, updated_at
		FROM pm_reports
		ORDER BY date DESC
		LIMIT 30
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var reports []PMReport
	for rows.Next() {
		var report PMReport
		if err := rows.Scan(
			&report.ID, &report.Date, &report.ReportText,
			&report.DoneCount, &report.OpenCount, &report.BlockedCount,
			&report.GeneratedAt, &report.UpdatedAt,
		); err != nil {
			return nil, err
		}
		reports = append(reports, report)
	}
	return reports, nil
}
