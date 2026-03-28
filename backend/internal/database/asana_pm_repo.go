package database

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// AsanaTaskLog records a section transition for an Asana task (mirrors IssueStateLog)
type AsanaTaskLog struct {
	ID                         string
	TaskGID                    string
	TaskName                   string
	ProjectGID                 string
	Assignee                   string
	FromSection                string
	ToSection                  string
	Priority                   string
	TransitionedAt             time.Time
	DurationInPrevSectionHours *float64
	IsRegression               bool
	DueDate                    *time.Time // task due date from Asana (for overdue detection)
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
			(task_gid, task_name, project_gid, assignee, from_section, to_section, priority, transitioned_at, duration_in_prev_section_hours, is_regression, due_date)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
	`, log.TaskGID, log.TaskName, log.ProjectGID, log.Assignee, log.FromSection, log.ToSection,
		log.Priority, log.TransitionedAt, durationHours, log.IsRegression, log.DueDate)
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
		       COALESCE(priority,''), transitioned_at, duration_in_prev_section_hours, COALESCE(is_regression, false)
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
			&l.FromSection, &l.ToSection, &l.Priority, &l.TransitionedAt, &l.DurationInPrevSectionHours, &l.IsRegression); err == nil {
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
		       COALESCE(priority,''), transitioned_at, duration_in_prev_section_hours, COALESCE(is_regression, false)
		FROM asana_task_log WHERE task_gid = $1 ORDER BY transitioned_at DESC LIMIT 1
	`, taskGID).Scan(&l.ID, &l.TaskGID, &l.TaskName, &l.ProjectGID, &l.Assignee,
		&l.FromSection, &l.ToSection, &l.Priority, &l.TransitionedAt, &l.DurationInPrevSectionHours, &l.IsRegression)
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

// ─── Time Tracking ────────────────────────────────────────────────────────────

// GetAsanaTimeTracking returns asana_task_log rows matching the given filters,
// mapped to IssueStateLog so the frontend Tracking tab receives the same shape.
func (r *AsanaPMRepository) GetAsanaTimeTracking(ctx context.Context, params TimeTrackingParams) ([]IssueStateLog, error) {
	pool := GetPool()
	if pool == nil {
		return nil, nil
	}

	conditions := []string{}
	args := []interface{}{}
	argIdx := 1

	if params.WeekStart != nil && params.WeekEnd != nil {
		weekCond := fmt.Sprintf(`(
			(transitioned_at >= $%d AND transitioned_at <= $%d)
			OR duration_in_prev_section_hours IS NULL
		)`, argIdx, argIdx+1)
		args = append(args, *params.WeekStart, *params.WeekEnd)
		argIdx += 2

		if len(params.PinnedIssues) > 0 {
			placeholders := ""
			for i, id := range params.PinnedIssues {
				if i > 0 {
					placeholders += ","
				}
				placeholders += fmt.Sprintf("$%d", argIdx)
				args = append(args, id)
				argIdx++
			}
			weekCond = fmt.Sprintf(`(
				(transitioned_at >= $1 AND transitioned_at <= $2)
				OR duration_in_prev_section_hours IS NULL
				OR task_gid IN (%s)
			)`, placeholders)
		}
		conditions = append(conditions, weekCond)
	}

	if len(params.Assignees) > 0 {
		placeholders := ""
		for i, a := range params.Assignees {
			if i > 0 {
				placeholders += ","
			}
			placeholders += fmt.Sprintf("$%d", argIdx)
			args = append(args, a)
			argIdx++
		}
		conditions = append(conditions, fmt.Sprintf("LOWER(COALESCE(assignee,'')) IN (%s)", placeholders))
	}

	if len(params.Priorities) > 0 {
		placeholders := ""
		for i, p := range params.Priorities {
			if i > 0 {
				placeholders += ","
			}
			placeholders += fmt.Sprintf("$%d", argIdx)
			args = append(args, strings.ToUpper(p))
			argIdx++
		}
		conditions = append(conditions, fmt.Sprintf("UPPER(COALESCE(priority,'')) IN (%s)", placeholders))
	}

	whereClause := ""
	for i, c := range conditions {
		if i == 0 {
			whereClause = "WHERE " + c
		} else {
			whereClause += " AND " + c
		}
	}

	query := fmt.Sprintf(`
		SELECT
			id,
			task_gid,
			task_name,
			COALESCE(assignee,'') AS assignee,
			'' AS moved_by,
			COALESCE(from_section,'') AS from_section,
			to_section,
			COALESCE(priority,'') AS priority,
			transitioned_at,
			CASE
				WHEN duration_in_prev_section_hours IS NULL
					THEN EXTRACT(EPOCH FROM (NOW() - transitioned_at)) / 3600.0
				ELSE duration_in_prev_section_hours
			END AS duration_hours,
			'' AS comment,
			due_date
		FROM asana_task_log
		%s
		ORDER BY
			CASE WHEN duration_in_prev_section_hours IS NULL THEN 0 ELSE 1 END ASC,
			transitioned_at DESC
		LIMIT 500
	`, whereClause)

	rows, err := pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var logs []IssueStateLog
	for rows.Next() {
		var l IssueStateLog
		var durHrs *float64
		if err := rows.Scan(
			&l.ID, &l.IssueID, &l.IssueSummary,
			&l.Assignee, &l.MovedBy,
			&l.FromState, &l.ToState,
			&l.Priority, &l.TransitionedAt, &durHrs, &l.Comment,
			&l.DueDate,
		); err != nil {
			continue
		}
		l.DurationInPrevStateHours = durHrs
		logs = append(logs, l)
	}
	return logs, nil
}

// ─── Assignee Stats ───────────────────────────────────────────────────────────

// GetAsanaAssigneeStats returns per-assignee done count and average duration from asana_task_log
func (r *AsanaPMRepository) GetAsanaAssigneeStats(ctx context.Context) ([]AssigneeStat, error) {
	pool := GetPool()
	if pool == nil {
		return nil, nil
	}

	rows, err := pool.Query(ctx, `
		SELECT
			COALESCE(assignee,'Unassigned') AS assignee,
			COUNT(*) AS done,
			AVG(duration_in_prev_section_hours) AS avg_hours
		FROM asana_task_log
		WHERE (
			LOWER(to_section) LIKE '%done%' OR
			LOWER(to_section) LIKE '%complet%' OR
			LOWER(to_section) LIKE '%deploy%' OR
			LOWER(to_section) LIKE '%prod%' OR
			LOWER(to_section) LIKE '%fixed%' OR
			LOWER(to_section) LIKE '%closed%'
		)
		GROUP BY COALESCE(assignee,'Unassigned')
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
			continue
		}
		stats = append(stats, s)
	}
	return stats, nil
}

// ─── Done Tasks (for report generation) ──────────────────────────────────────

// GetAsanaDoneTasksForDate returns tasks that moved to a done-like section on a given date
func (r *AsanaPMRepository) GetAsanaDoneTasksForDate(ctx context.Context, projectGID, date string) ([]AsanaTaskLog, error) {
	pool := GetPool()
	if pool == nil {
		return nil, nil
	}

	rows, err := pool.Query(ctx, `
		SELECT id, task_gid, task_name, project_gid, COALESCE(assignee,''), COALESCE(from_section,''), to_section,
		       COALESCE(priority,''), transitioned_at, duration_in_prev_section_hours
		FROM asana_task_log
		WHERE ($1 = '' OR project_gid = $1)
		  AND DATE(transitioned_at) = $2::date
		  AND (
			LOWER(to_section) LIKE '%done%' OR
			LOWER(to_section) LIKE '%complet%' OR
			LOWER(to_section) LIKE '%deploy%' OR
			LOWER(to_section) LIKE '%prod%' OR
			LOWER(to_section) LIKE '%fixed%' OR
			LOWER(to_section) LIKE '%closed%'
		  )
		ORDER BY transitioned_at ASC
	`, projectGID, date)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanAsanaTaskLogs(rows)
}

// GetAsanaDoneTasksForWeek returns tasks that moved to a done-like section during a week
func (r *AsanaPMRepository) GetAsanaDoneTasksForWeek(ctx context.Context, projectGID, weekStart, weekEnd string) ([]AsanaTaskLog, error) {
	pool := GetPool()
	if pool == nil {
		return nil, nil
	}

	rows, err := pool.Query(ctx, `
		SELECT id, task_gid, task_name, project_gid, COALESCE(assignee,''), COALESCE(from_section,''), to_section,
		       COALESCE(priority,''), transitioned_at, duration_in_prev_section_hours
		FROM asana_task_log
		WHERE ($1 = '' OR project_gid = $1)
		  AND transitioned_at >= $2::timestamp
		  AND transitioned_at <= $3::timestamp
		  AND (
			LOWER(to_section) LIKE '%done%' OR
			LOWER(to_section) LIKE '%complet%' OR
			LOWER(to_section) LIKE '%deploy%' OR
			LOWER(to_section) LIKE '%prod%' OR
			LOWER(to_section) LIKE '%fixed%' OR
			LOWER(to_section) LIKE '%closed%'
		  )
		ORDER BY COALESCE(assignee,''), transitioned_at ASC
	`, projectGID, weekStart+" 00:00:00", weekEnd+" 23:59:59")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanAsanaTaskLogs(rows)
}

func scanAsanaTaskLogs(rows pgx.Rows) ([]AsanaTaskLog, error) {
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

// ─── Issue Timelines ──────────────────────────────────────────────────────────

// asanaSectionRank returns a rank for move-back detection (higher = more advanced)
func asanaSectionRank(section string) int {
	s := strings.ToLower(section)
	switch {
	case strings.Contains(s, "done") || strings.Contains(s, "complet") ||
		strings.Contains(s, "deploy") || strings.Contains(s, "prod") || strings.Contains(s, "fixed"):
		return 5
	case strings.Contains(s, "stage") || strings.Contains(s, "review") || strings.Contains(s, "qa"):
		return 4
	case strings.Contains(s, "progress") || strings.Contains(s, "dev") || strings.Contains(s, "sprint"):
		return 3
	case strings.Contains(s, "block") || strings.Contains(s, "wait") || strings.Contains(s, "hold"):
		return 2
	case strings.Contains(s, "backlog") || strings.Contains(s, "todo") || strings.Contains(s, "upcoming"):
		return 1
	default:
		return 2
	}
}

// GetAsanaIssueTimelines builds per-task timelines from asana_task_log,
// returning IssueTimeline structs so the frontend Tracking tab can reuse the same component.
func (r *AsanaPMRepository) GetAsanaIssueTimelines(ctx context.Context, pinnedIDs []string) ([]IssueTimeline, error) {
	pool := GetPool()
	if pool == nil {
		return nil, nil
	}

	rows, err := pool.Query(ctx, `
		SELECT task_gid, task_name, COALESCE(assignee,''), COALESCE(from_section,''), to_section,
		       COALESCE(priority,''), transitioned_at, duration_in_prev_section_hours, due_date
		FROM asana_task_log
		ORDER BY task_gid, transitioned_at ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type rawRow struct {
		taskGID     string
		taskName    string
		assignee    string
		fromSection string
		toSection   string
		priority    string
		at          time.Time
		durHrs      *float64
		dueDate     *time.Time
	}

	byTask := map[string][]rawRow{}
	taskOrder := []string{}

	for rows.Next() {
		var rr rawRow
		if err := rows.Scan(&rr.taskGID, &rr.taskName, &rr.assignee, &rr.fromSection, &rr.toSection,
			&rr.priority, &rr.at, &rr.durHrs, &rr.dueDate); err != nil {
			continue
		}
		if _, ok := byTask[rr.taskGID]; !ok {
			taskOrder = append(taskOrder, rr.taskGID)
		}
		byTask[rr.taskGID] = append(byTask[rr.taskGID], rr)
	}

	pinnedSet := make(map[string]bool, len(pinnedIDs))
	for _, id := range pinnedIDs {
		pinnedSet[id] = true
	}

	now := time.Now()
	var timelines []IssueTimeline

	for _, taskGID := range taskOrder {
		rrows := byTask[taskGID]
		if len(rrows) == 0 {
			continue
		}

		first := rrows[0]
		summary := first.taskName
		assignee := first.assignee
		priority := first.priority

		var stints []IssueStint
		var totalHours float64
		var movedBackCount int
		var isLive bool
		var liveHours float64
		lastActivityAt := first.at
		firstEnteredAt := first.at

		for i, rr := range rrows {
			if rr.priority != "" {
				priority = rr.priority
			}
			if rr.assignee != "" {
				assignee = rr.assignee
			}
			if rr.at.After(lastActivityAt) {
				lastActivityAt = rr.at
			}

			var exitedAt *time.Time
			var durationHours *float64
			var exitedTo string
			var movedBack bool

			if rr.durHrs != nil {
				// This row exiting the previous section
				durationHours = rr.durHrs
				totalHours += *rr.durHrs
				exitedTo = rr.toSection
				movedBack = asanaSectionRank(rr.toSection) < asanaSectionRank(rr.fromSection)
				if movedBack {
					movedBackCount++
				}
				exitTime := rr.at
				exitedAt = &exitTime
			} else {
				// Still in this section
				lh := now.Sub(rr.at).Hours()
				durationHours = &lh
				totalHours += lh
				liveHours = lh
				isLive = true
			}

			stint := IssueStint{
				StintNumber:   i + 1,
				EnteredAt:     rr.at,
				ExitedAt:      exitedAt,
				ExitedTo:      exitedTo,
				DurationHours: durationHours,
				MovedBack:     movedBack,
			}
			stints = append(stints, stint)
		}

		// Collect the most recent due_date for this task (last non-nil value in log rows)
		var taskDueDate *time.Time
		for _, rr := range rrows {
			if rr.dueDate != nil {
				taskDueDate = rr.dueDate
			}
		}

		// Overdue: use due_date if available, otherwise fall back to threshold hours
		threshold := overdueThresholdForPriority(priority)
		var isOverdue bool
		if taskDueDate != nil {
			isOverdue = taskDueDate.UTC().Before(now.UTC().Truncate(24 * time.Hour))
		} else {
			isOverdue = totalHours > threshold
		}

		timelines = append(timelines, IssueTimeline{
			IssueID:        taskGID,
			IssueSummary:   summary,
			Assignee:       assignee,
			Priority:       priority,
			Pinned:         pinnedSet[taskGID],
			TotalStints:    len(stints),
			TotalHours:     totalHours,
			IsLive:         isLive,
			LiveHours:      liveHours,
			MovedBackCount: movedBackCount,
			IsOverdue:      isOverdue,
			ThresholdHours: threshold,
			DueDate:        taskDueDate,
			FirstEnteredAt: firstEnteredAt,
			LastActivityAt: lastActivityAt,
			Stints:         stints,
		})
	}

	return timelines, nil
}

// BackfillAsanaTaskLog seeds asana_task_log with current section for all live tasks.
// This gives a baseline for time-in-section calculations when webhooks haven't fired yet.
// It inserts with NOW() as transitioned_at and skips tasks already in the log.
func (r *AsanaPMRepository) BackfillAsanaTaskLog(ctx context.Context, entries []AsanaTaskLog) (int, error) {
	pool := GetPool()
	if pool == nil {
		return 0, nil
	}

	inserted := 0
	for _, e := range entries {
		// Skip if task already has a log entry
		var count int
		pool.QueryRow(ctx, `SELECT COUNT(*) FROM asana_task_log WHERE task_gid = $1`, e.TaskGID).Scan(&count)
		if count > 0 {
			continue
		}
		_, err := pool.Exec(ctx, `
			INSERT INTO asana_task_log (task_gid, task_name, project_gid, assignee, from_section, to_section, priority, transitioned_at, duration_in_prev_section_hours)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL)
		`, e.TaskGID, e.TaskName, e.ProjectGID, e.Assignee, e.FromSection, e.ToSection, e.Priority, e.TransitionedAt)
		if err == nil {
			inserted++
		}
	}
	return inserted, nil
}
