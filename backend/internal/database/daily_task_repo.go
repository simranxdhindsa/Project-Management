package database

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/dhindsa/project-management/internal/models"
)

// DailyTaskRepository handles daily task management database operations
type DailyTaskRepository struct{}

// NewDailyTaskRepository creates a new DailyTaskRepository
func NewDailyTaskRepository() *DailyTaskRepository {
	return &DailyTaskRepository{}
}

// ===== DAILY ANALYSES =====

// SaveAnalysis saves or updates an AI analysis for a specific date
func (r *DailyTaskRepository) SaveAnalysis(ctx context.Context, req *models.SaveAnalysisRequest) (*models.DailyAnalysis, error) {
	pool := GetPool()

	// Convert analysis result to JSONB
	analysisJSON, err := json.Marshal(req.AnalysisResult)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal analysis result: %w", err)
	}

	var analysis models.DailyAnalysis
	now := time.Now()

	// Upsert: Insert or update if date already exists
	err = pool.QueryRow(ctx, `
		INSERT INTO daily_analyses (date, morning_message, evening_message, analysis_result, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (date)
		DO UPDATE SET
			morning_message = EXCLUDED.morning_message,
			evening_message = EXCLUDED.evening_message,
			analysis_result = EXCLUDED.analysis_result,
			updated_at = EXCLUDED.updated_at
		RETURNING id, date::text, morning_message, evening_message, analysis_result, created_at, updated_at
	`, req.Date, req.MorningMessage, req.EveningMessage, analysisJSON, now, now).Scan(
		&analysis.ID, &analysis.Date, &analysis.MorningMessage, &analysis.EveningMessage,
		&analysisJSON, &analysis.CreatedAt, &analysis.UpdatedAt,
	)

	if err != nil {
		return nil, fmt.Errorf("failed to save analysis: %w", err)
	}

	// Unmarshal analysis result
	if err := json.Unmarshal(analysisJSON, &analysis.AnalysisResult); err != nil {
		return nil, fmt.Errorf("failed to unmarshal analysis result: %w", err)
	}

	return &analysis, nil
}

// GetAnalysisByDate retrieves an analysis for a specific date
func (r *DailyTaskRepository) GetAnalysisByDate(ctx context.Context, date string) (*models.DailyAnalysis, error) {
	pool := GetPool()

	var analysis models.DailyAnalysis
	var analysisJSON []byte

	err := pool.QueryRow(ctx, `
		SELECT id, date::text, morning_message, evening_message, analysis_result, created_at, updated_at
		FROM daily_analyses
		WHERE date = $1
	`, date).Scan(
		&analysis.ID, &analysis.Date, &analysis.MorningMessage, &analysis.EveningMessage,
		&analysisJSON, &analysis.CreatedAt, &analysis.UpdatedAt,
	)

	if err != nil {
		return nil, err
	}

	// Unmarshal analysis result
	if err := json.Unmarshal(analysisJSON, &analysis.AnalysisResult); err != nil {
		return nil, fmt.Errorf("failed to unmarshal analysis result: %w", err)
	}

	return &analysis, nil
}

// ===== DAILY TASKS =====

// SaveDailyTasks saves individual task records from analysis
func (r *DailyTaskRepository) SaveDailyTasks(ctx context.Context, analysisID, date string, tasks []models.DailyTask) error {
	pool := GetPool()

	// Delete existing tasks for this analysis
	_, err := pool.Exec(ctx, `DELETE FROM daily_tasks WHERE analysis_id = $1`, analysisID)
	if err != nil {
		return fmt.Errorf("failed to delete existing tasks: %w", err)
	}

	// Insert new tasks
	for _, task := range tasks {
		_, err := pool.Exec(ctx, `
			INSERT INTO daily_tasks (analysis_id, date, assignee, task_title, status, original_title, confidence, evidence, carried_from_date)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		`, analysisID, date, task.Assignee, task.TaskTitle, task.Status, task.OriginalTitle, task.Confidence, task.Evidence, task.CarriedFromDate)
		if err != nil {
			return fmt.Errorf("failed to insert task: %w", err)
		}
	}

	return nil
}

// GetTasksByDate retrieves all tasks for a specific date
func (r *DailyTaskRepository) GetTasksByDate(ctx context.Context, date string) ([]models.DailyTask, error) {
	pool := GetPool()

	rows, err := pool.Query(ctx, `
		SELECT id, analysis_id, date::text, assignee, task_title, status, original_title, confidence, evidence, carried_from_date::text, created_at
		FROM daily_tasks
		WHERE date = $1
		ORDER BY assignee ASC, created_at ASC
	`, date)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tasks []models.DailyTask
	for rows.Next() {
		var task models.DailyTask
		err := rows.Scan(&task.ID, &task.AnalysisID, &task.Date, &task.Assignee, &task.TaskTitle,
			&task.Status, &task.OriginalTitle, &task.Confidence, &task.Evidence, &task.CarriedFromDate, &task.CreatedAt)
		if err != nil {
			return nil, err
		}
		tasks = append(tasks, task)
	}

	return tasks, nil
}

// GetTasksByAssignee retrieves tasks grouped by assignee for a specific date
func (r *DailyTaskRepository) GetTasksByAssignee(ctx context.Context, date string) ([]models.TasksByAssignee, error) {
	pool := GetPool()

	rows, err := pool.Query(ctx, `
		SELECT assignee, task_title, status
		FROM daily_tasks
		WHERE date = $1
		ORDER BY assignee ASC
	`, date)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	// Group by assignee
	assigneeMap := make(map[string]*models.TasksByAssignee)
	for rows.Next() {
		var assignee, taskTitle, status string
		if err := rows.Scan(&assignee, &taskTitle, &status); err != nil {
			return nil, err
		}

		if assigneeMap[assignee] == nil {
			assigneeMap[assignee] = &models.TasksByAssignee{
				Assignee:  assignee,
				Completed: []string{},
				Pending:   []string{},
				Blocked:   []string{},
				Skipped:   []string{},
			}
		}

		switch status {
		case "done":
			assigneeMap[assignee].Completed = append(assigneeMap[assignee].Completed, taskTitle)
		case "pending", "in_progress":
			assigneeMap[assignee].Pending = append(assigneeMap[assignee].Pending, taskTitle)
		case "blocked":
			assigneeMap[assignee].Blocked = append(assigneeMap[assignee].Blocked, taskTitle)
		case "not_mentioned", "skipped":
			assigneeMap[assignee].Skipped = append(assigneeMap[assignee].Skipped, taskTitle)
		}
	}

	// Convert map to slice
	var result []models.TasksByAssignee
	for _, v := range assigneeMap {
		result = append(result, *v)
	}

	return result, nil
}

// ===== NEXT DAY TASKS =====

// GetNextDayTasks retrieves all tasks for a specific target date
func (r *DailyTaskRepository) GetNextDayTasks(ctx context.Context, targetDate string) ([]models.NextDayTask, error) {
	pool := GetPool()

	rows, err := pool.Query(ctx, `
		SELECT id, target_date, assignee, task_title, priority, position, is_carried_forward, source_date, source_task_id, notes, created_by, created_at, updated_at
		FROM next_day_tasks
		WHERE target_date = $1
		ORDER BY assignee ASC, position ASC
	`, targetDate)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tasks []models.NextDayTask
	for rows.Next() {
		var task models.NextDayTask
		err := rows.Scan(&task.ID, &task.TargetDate, &task.Assignee, &task.TaskTitle, &task.Priority,
			&task.Position, &task.IsCarriedForward, &task.SourceDate, &task.SourceTaskID, &task.Notes,
			&task.CreatedBy, &task.CreatedAt, &task.UpdatedAt)
		if err != nil {
			return nil, err
		}
		tasks = append(tasks, task)
	}

	return tasks, nil
}

// CreateNextDayTask creates a new task for tomorrow
func (r *DailyTaskRepository) CreateNextDayTask(ctx context.Context, req *models.CreateNextDayTaskRequest, createdBy string) (*models.NextDayTask, error) {
	pool := GetPool()

	priority := "medium"
	if req.Priority != nil {
		priority = *req.Priority
	}

	// Get max position for this assignee
	var maxPosition int
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(MAX(position), -1) FROM next_day_tasks WHERE target_date = $1 AND assignee = $2
	`, req.TargetDate, req.Assignee).Scan(&maxPosition)
	if err != nil {
		return nil, fmt.Errorf("failed to get max position: %w", err)
	}

	var task models.NextDayTask
	now := time.Now()

	err = pool.QueryRow(ctx, `
		INSERT INTO next_day_tasks (target_date, assignee, task_title, priority, position, notes, created_by, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id, target_date, assignee, task_title, priority, position, is_carried_forward, source_date, source_task_id, notes, created_by, created_at, updated_at
	`, req.TargetDate, req.Assignee, req.TaskTitle, priority, maxPosition+1, req.Notes, createdBy, now, now).Scan(
		&task.ID, &task.TargetDate, &task.Assignee, &task.TaskTitle, &task.Priority,
		&task.Position, &task.IsCarriedForward, &task.SourceDate, &task.SourceTaskID, &task.Notes,
		&task.CreatedBy, &task.CreatedAt, &task.UpdatedAt,
	)

	if err != nil {
		return nil, fmt.Errorf("failed to create task: %w", err)
	}

	return &task, nil
}

// UpdateNextDayTask updates an existing next day task
func (r *DailyTaskRepository) UpdateNextDayTask(ctx context.Context, taskID string, req *models.UpdateNextDayTaskRequest) error {
	pool := GetPool()

	// Build dynamic update query
	query := `UPDATE next_day_tasks SET updated_at = NOW()`
	args := []interface{}{}
	argCount := 1

	if req.TaskTitle != nil {
		query += fmt.Sprintf(`, task_title = $%d`, argCount)
		args = append(args, *req.TaskTitle)
		argCount++
	}

	if req.Priority != nil {
		query += fmt.Sprintf(`, priority = $%d`, argCount)
		args = append(args, *req.Priority)
		argCount++
	}

	if req.Notes != nil {
		query += fmt.Sprintf(`, notes = $%d`, argCount)
		args = append(args, *req.Notes)
		argCount++
	}

	if req.Position != nil {
		query += fmt.Sprintf(`, position = $%d`, argCount)
		args = append(args, *req.Position)
		argCount++
	}

	query += fmt.Sprintf(` WHERE id = $%d`, argCount)
	args = append(args, taskID)

	_, err := pool.Exec(ctx, query, args...)
	return err
}

// DeleteNextDayTask deletes a next day task
func (r *DailyTaskRepository) DeleteNextDayTask(ctx context.Context, taskID string) error {
	pool := GetPool()

	_, err := pool.Exec(ctx, `DELETE FROM next_day_tasks WHERE id = $1`, taskID)
	return err
}

// ReorderNextDayTasks updates the position of tasks for a specific assignee
func (r *DailyTaskRepository) ReorderNextDayTasks(ctx context.Context, targetDate, assignee string, taskIDs []string) error {
	pool := GetPool()

	for i, taskID := range taskIDs {
		_, err := pool.Exec(ctx, `
			UPDATE next_day_tasks SET position = $1, updated_at = NOW()
			WHERE id = $2 AND target_date = $3 AND assignee = $4
		`, i, taskID, targetDate, assignee)
		if err != nil {
			return fmt.Errorf("failed to update position for task %s: %w", taskID, err)
		}
	}

	return nil
}

// GenerateNextDayTasksFromPending creates next day tasks from pending/skipped tasks
func (r *DailyTaskRepository) GenerateNextDayTasksFromPending(ctx context.Context, sourceDate, targetDate string) error {
	pool := GetPool()

	// Get pending and skipped tasks from source date
	rows, err := pool.Query(ctx, `
		SELECT assignee, task_title
		FROM daily_tasks
		WHERE date = $1 AND status IN ('pending', 'in_progress', 'skipped', 'not_mentioned')
		ORDER BY assignee ASC
	`, sourceDate)
	if err != nil {
		return fmt.Errorf("failed to query pending tasks: %w", err)
	}
	defer rows.Close()

	// Delete existing tasks for target date (if regenerating)
	_, err = pool.Exec(ctx, `DELETE FROM next_day_tasks WHERE target_date = $1`, targetDate)
	if err != nil {
		return fmt.Errorf("failed to delete existing tasks: %w", err)
	}

	// Insert carried forward tasks
	position := make(map[string]int) // Track position per assignee
	for rows.Next() {
		var assignee, taskTitle string
		if err := rows.Scan(&assignee, &taskTitle); err != nil {
			return fmt.Errorf("failed to scan task: %w", err)
		}

		_, err := pool.Exec(ctx, `
			INSERT INTO next_day_tasks (target_date, assignee, task_title, priority, position, is_carried_forward, source_date, created_at, updated_at)
			VALUES ($1, $2, $3, 'medium', $4, true, $5, NOW(), NOW())
		`, targetDate, assignee, taskTitle, position[assignee], sourceDate)
		if err != nil {
			return fmt.Errorf("failed to insert carried forward task: %w", err)
		}

		position[assignee]++
	}

	return nil
}

// GetNextDayTasksGroupedByAssignee retrieves tasks grouped by assignee
func (r *DailyTaskRepository) GetNextDayTasksGroupedByAssignee(ctx context.Context, targetDate string) (*models.DailyTaskList, error) {
	tasks, err := r.GetNextDayTasks(ctx, targetDate)
	if err != nil {
		return nil, err
	}

	// Group by assignee
	assigneeMap := make(map[string][]models.NextDayTask)
	for _, task := range tasks {
		assigneeMap[task.Assignee] = append(assigneeMap[task.Assignee], task)
	}

	// Convert to UserTaskAssignment
	var assignments []models.UserTaskAssignment
	for assignee, tasks := range assigneeMap {
		assignments = append(assignments, models.UserTaskAssignment{
			UserName:    assignee,
			SlackHandle: "@" + assignee,
			Tasks:       tasks,
		})
	}

	return &models.DailyTaskList{
		Date:        targetDate,
		Assignments: assignments,
	}, nil
}

// FormatSlackMessage generates a Slack-formatted message from next day tasks
func (r *DailyTaskRepository) FormatSlackMessage(ctx context.Context, targetDate string) (string, error) {
	taskList, err := r.GetNextDayTasksGroupedByAssignee(ctx, targetDate)
	if err != nil {
		return "", err
	}

	message := "`todays task list`\n\n"

	for _, assignment := range taskList.Assignments {
		message += fmt.Sprintf("`%s`\n", assignment.SlackHandle)
		for _, task := range assignment.Tasks {
			priority := ""
			if task.Priority == "high" {
				priority = " (High)"
			}
			message += fmt.Sprintf("• %s%s\n", task.TaskTitle, priority)
		}
		message += "\n"
	}

	return message, nil
}
