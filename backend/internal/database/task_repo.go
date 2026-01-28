package database

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/dhindsa/project-management/internal/models"
)

// TaskRepository handles task database operations
type TaskRepository struct{}

// NewTaskRepository creates a new TaskRepository
func NewTaskRepository() *TaskRepository {
	return &TaskRepository{}
}

// Create inserts a new task into the database
func (r *TaskRepository) Create(ctx context.Context, task *models.Task) error {
	pool := GetPool()

	task.CreatedAt = time.Now()
	task.UpdatedAt = time.Now()

	err := pool.QueryRow(ctx, `
		INSERT INTO tasks (title, description, status, priority, project_id, assignee_id, asana_id, asana_url, due_date, created_at, updated_at, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		RETURNING id
	`, task.Title, task.Description, task.Status, task.Priority, task.ProjectID,
		task.AssigneeID, task.AsanaID, task.AsanaURL, task.DueDate,
		task.CreatedAt, task.UpdatedAt, task.CreatedBy).Scan(&task.ID)

	if err != nil {
		return err
	}

	// Record initial status in history
	return r.recordHistory(ctx, task.ID, task.Status, task.CreatedBy)
}

// GetByID retrieves a task by ID
func (r *TaskRepository) GetByID(ctx context.Context, id string) (*models.Task, error) {
	pool := GetPool()

	var task models.Task
	err := pool.QueryRow(ctx, `
		SELECT id, title, description, status, priority, project_id, assignee_id,
		       asana_id, asana_url, due_date, created_at, updated_at, created_by
		FROM tasks WHERE id = $1
	`, id).Scan(&task.ID, &task.Title, &task.Description, &task.Status, &task.Priority,
		&task.ProjectID, &task.AssigneeID, &task.AsanaID, &task.AsanaURL,
		&task.DueDate, &task.CreatedAt, &task.UpdatedAt, &task.CreatedBy)

	if err != nil {
		return nil, err
	}
	return &task, nil
}

// GetByIDWithAssignee retrieves a task with assignee details
func (r *TaskRepository) GetByIDWithAssignee(ctx context.Context, id string) (*models.TaskWithAssignee, error) {
	pool := GetPool()

	var task models.TaskWithAssignee
	err := pool.QueryRow(ctx, `
		SELECT t.id, t.title, t.description, t.status, t.priority, t.project_id,
		       t.assignee_id, t.asana_id, t.asana_url, t.due_date, t.created_at,
		       t.updated_at, t.created_by, u.name, u.email, u.picture
		FROM tasks t
		LEFT JOIN users u ON t.assignee_id = u.id
		WHERE t.id = $1
	`, id).Scan(&task.ID, &task.Title, &task.Description, &task.Status, &task.Priority,
		&task.ProjectID, &task.AssigneeID, &task.AsanaID, &task.AsanaURL,
		&task.DueDate, &task.CreatedAt, &task.UpdatedAt, &task.CreatedBy,
		&task.AssigneeName, &task.AssigneeEmail, &task.AssigneePicture)

	if err != nil {
		return nil, err
	}
	return &task, nil
}

// Update updates a task
func (r *TaskRepository) Update(ctx context.Context, task *models.Task) error {
	pool := GetPool()

	task.UpdatedAt = time.Now()
	_, err := pool.Exec(ctx, `
		UPDATE tasks SET title = $2, description = $3, status = $4, priority = $5,
		       assignee_id = $6, due_date = $7, updated_at = $8
		WHERE id = $1
	`, task.ID, task.Title, task.Description, task.Status, task.Priority,
		task.AssigneeID, task.DueDate, task.UpdatedAt)

	return err
}

// UpdateStatus updates only the task status
func (r *TaskRepository) UpdateStatus(ctx context.Context, taskID string, status models.TaskStatus, changedBy string) error {
	pool := GetPool()

	_, err := pool.Exec(ctx, `
		UPDATE tasks SET status = $2, updated_at = NOW()
		WHERE id = $1
	`, taskID, status)

	if err != nil {
		return err
	}

	// Record status change in history
	return r.recordHistory(ctx, taskID, status, changedBy)
}

// recordHistory records a status change in task_history
func (r *TaskRepository) recordHistory(ctx context.Context, taskID string, status models.TaskStatus, changedBy string) error {
	pool := GetPool()

	_, err := pool.Exec(ctx, `
		INSERT INTO task_history (task_id, status, changed_at, changed_by)
		VALUES ($1, $2, NOW(), $3)
	`, taskID, status, changedBy)

	return err
}

// Delete removes a task
func (r *TaskRepository) Delete(ctx context.Context, id string) error {
	pool := GetPool()

	_, err := pool.Exec(ctx, `DELETE FROM tasks WHERE id = $1`, id)
	return err
}

// List retrieves tasks with optional filters
func (r *TaskRepository) List(ctx context.Context, filter *models.TaskFilter) ([]*models.TaskWithAssignee, error) {
	pool := GetPool()

	query := `
		SELECT t.id, t.title, t.description, t.status, t.priority, t.project_id,
		       t.assignee_id, t.asana_id, t.asana_url, t.due_date, t.created_at,
		       t.updated_at, t.created_by, u.name, u.email, u.picture
		FROM tasks t
		LEFT JOIN users u ON t.assignee_id = u.id
		WHERE 1=1
	`

	var args []interface{}
	argNum := 1

	if filter != nil {
		if filter.ProjectID != nil {
			query += fmt.Sprintf(" AND t.project_id = $%d", argNum)
			args = append(args, *filter.ProjectID)
			argNum++
		}
		if filter.Status != nil {
			query += fmt.Sprintf(" AND t.status = $%d", argNum)
			args = append(args, *filter.Status)
			argNum++
		}
		if filter.Priority != nil {
			query += fmt.Sprintf(" AND t.priority = $%d", argNum)
			args = append(args, *filter.Priority)
			argNum++
		}
		if filter.AssigneeID != nil {
			query += fmt.Sprintf(" AND t.assignee_id = $%d", argNum)
			args = append(args, *filter.AssigneeID)
			argNum++
		}
		if filter.Date != nil {
			query += fmt.Sprintf(" AND DATE(t.created_at) = $%d", argNum)
			args = append(args, *filter.Date)
			argNum++
		}
	}

	query += " ORDER BY t.created_at DESC"

	rows, err := pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tasks []*models.TaskWithAssignee
	for rows.Next() {
		var task models.TaskWithAssignee
		err := rows.Scan(&task.ID, &task.Title, &task.Description, &task.Status, &task.Priority,
			&task.ProjectID, &task.AssigneeID, &task.AsanaID, &task.AsanaURL,
			&task.DueDate, &task.CreatedAt, &task.UpdatedAt, &task.CreatedBy,
			&task.AssigneeName, &task.AssigneeEmail, &task.AssigneePicture)
		if err != nil {
			return nil, err
		}
		tasks = append(tasks, &task)
	}

	return tasks, nil
}

// GetYesterdayPending retrieves tasks that were not completed yesterday
func (r *TaskRepository) GetYesterdayPending(ctx context.Context, projectID string) ([]*models.TaskWithAssignee, error) {
	pool := GetPool()

	// Get tasks that were in todo or in_progress status at end of yesterday
	query := `
		WITH yesterday_tasks AS (
			SELECT DISTINCT ON (th.task_id) th.task_id, th.status
			FROM task_history th
			WHERE DATE(th.changed_at) = DATE(NOW() - INTERVAL '1 day')
			ORDER BY th.task_id, th.changed_at DESC
		)
		SELECT t.id, t.title, t.description, t.status, t.priority, t.project_id,
		       t.assignee_id, t.asana_id, t.asana_url, t.due_date, t.created_at,
		       t.updated_at, t.created_by, u.name, u.email, u.picture
		FROM tasks t
		LEFT JOIN users u ON t.assignee_id = u.id
		INNER JOIN yesterday_tasks yt ON t.id = yt.task_id
		WHERE yt.status IN ('todo', 'in_progress')
		AND t.project_id = $1
		ORDER BY t.priority DESC, t.created_at ASC
	`

	rows, err := pool.Query(ctx, query, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tasks []*models.TaskWithAssignee
	for rows.Next() {
		var task models.TaskWithAssignee
		err := rows.Scan(&task.ID, &task.Title, &task.Description, &task.Status, &task.Priority,
			&task.ProjectID, &task.AssigneeID, &task.AsanaID, &task.AsanaURL,
			&task.DueDate, &task.CreatedAt, &task.UpdatedAt, &task.CreatedBy,
			&task.AssigneeName, &task.AssigneeEmail, &task.AssigneePicture)
		if err != nil {
			return nil, err
		}
		tasks = append(tasks, &task)
	}

	return tasks, nil
}

// GetByAsanaID retrieves a task by its Asana ID
func (r *TaskRepository) GetByAsanaID(ctx context.Context, asanaID string) (*models.Task, error) {
	pool := GetPool()

	var task models.Task
	err := pool.QueryRow(ctx, `
		SELECT id, title, description, status, priority, project_id, assignee_id,
		       asana_id, asana_url, due_date, created_at, updated_at, created_by
		FROM tasks WHERE asana_id = $1
	`, asanaID).Scan(&task.ID, &task.Title, &task.Description, &task.Status, &task.Priority,
		&task.ProjectID, &task.AssigneeID, &task.AsanaID, &task.AsanaURL,
		&task.DueDate, &task.CreatedAt, &task.UpdatedAt, &task.CreatedBy)

	if err != nil {
		return nil, err
	}
	return &task, nil
}

// UpdateAsanaID links a task to an Asana task
func (r *TaskRepository) UpdateAsanaID(ctx context.Context, taskID, asanaID, asanaURL string) error {
	pool := GetPool()

	_, err := pool.Exec(ctx, `
		UPDATE tasks SET asana_id = $2, asana_url = $3, updated_at = NOW()
		WHERE id = $1
	`, taskID, asanaID, asanaURL)

	return err
}

// GetTaskCountByStatus returns task counts grouped by status for a project
func (r *TaskRepository) GetTaskCountByStatus(ctx context.Context, projectID string) (map[string]int, error) {
	pool := GetPool()

	rows, err := pool.Query(ctx, `
		SELECT status, COUNT(*) as count
		FROM tasks
		WHERE project_id = $1
		GROUP BY status
	`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	counts := make(map[string]int)
	for rows.Next() {
		var status string
		var count int
		if err := rows.Scan(&status, &count); err != nil {
			return nil, err
		}
		counts[status] = count
	}

	return counts, nil
}

// GetTasksByDateRange retrieves tasks created within a date range
func (r *TaskRepository) GetTasksByDateRange(ctx context.Context, projectID, fromDate, toDate string) ([]*models.Task, error) {
	pool := GetPool()

	rows, err := pool.Query(ctx, `
		SELECT id, title, description, status, priority, project_id, assignee_id,
		       asana_id, asana_url, due_date, created_at, updated_at, created_by
		FROM tasks
		WHERE project_id = $1 AND DATE(created_at) BETWEEN $2 AND $3
		ORDER BY created_at DESC
	`, projectID, fromDate, toDate)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tasks []*models.Task
	for rows.Next() {
		var task models.Task
		err := rows.Scan(&task.ID, &task.Title, &task.Description, &task.Status, &task.Priority,
			&task.ProjectID, &task.AssigneeID, &task.AsanaID, &task.AsanaURL,
			&task.DueDate, &task.CreatedAt, &task.UpdatedAt, &task.CreatedBy)
		if err != nil {
			return nil, err
		}
		tasks = append(tasks, &task)
	}

	return tasks, nil
}

// BulkUpdateStatus updates status for multiple tasks
func (r *TaskRepository) BulkUpdateStatus(ctx context.Context, taskIDs []string, status models.TaskStatus, changedBy string) error {
	pool := GetPool()

	if len(taskIDs) == 0 {
		return nil
	}

	// Build placeholders for IN clause
	placeholders := make([]string, len(taskIDs))
	args := make([]interface{}, len(taskIDs)+1)
	args[0] = status
	for i, id := range taskIDs {
		placeholders[i] = fmt.Sprintf("$%d", i+2)
		args[i+1] = id
	}

	query := fmt.Sprintf(`
		UPDATE tasks SET status = $1, updated_at = NOW()
		WHERE id IN (%s)
	`, strings.Join(placeholders, ","))

	_, err := pool.Exec(ctx, query, args...)
	if err != nil {
		return err
	}

	// Record history for each task
	for _, taskID := range taskIDs {
		if err := r.recordHistory(ctx, taskID, status, changedBy); err != nil {
			return err
		}
	}

	return nil
}
