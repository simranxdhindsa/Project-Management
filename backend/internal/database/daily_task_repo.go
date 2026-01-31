package database

import (
	"context"
	"fmt"
	"time"

	"github.com/dhindsa/project-management/internal/models"
)

// DailyTaskRepository handles daily task list database operations
type DailyTaskRepository struct{}

// NewDailyTaskRepository creates a new DailyTaskRepository
func NewDailyTaskRepository() *DailyTaskRepository {
	return &DailyTaskRepository{}
}

// GetByDate retrieves a daily task list for a specific date and project
func (r *DailyTaskRepository) GetByDate(ctx context.Context, date, projectID string) (*models.DailyTaskList, error) {
	pool := GetPool()

	var list models.DailyTaskList
	err := pool.QueryRow(ctx, `
		SELECT id, date, project_id, created_at, updated_at
		FROM daily_task_lists
		WHERE date = $1 AND project_id = $2
	`, date, projectID).Scan(&list.ID, &list.Date, &list.ProjectID, &list.CreatedAt, &list.UpdatedAt)

	if err != nil {
		return nil, err
	}

	// Fetch assignments
	assignments, err := r.getAssignments(ctx, list.ID)
	if err != nil {
		return nil, err
	}
	list.Assignments = assignments

	return &list, nil
}

// Create creates a new daily task list
func (r *DailyTaskRepository) Create(ctx context.Context, list *models.DailyTaskList) error {
	pool := GetPool()

	now := time.Now()
	list.CreatedAt = now
	list.UpdatedAt = now

	err := pool.QueryRow(ctx, `
		INSERT INTO daily_task_lists (date, project_id, created_at, updated_at)
		VALUES ($1, $2, $3, $4)
		RETURNING id
	`, list.Date, list.ProjectID, list.CreatedAt, list.UpdatedAt).Scan(&list.ID)

	return err
}

// DeleteByDate deletes a daily task list for a specific date (cascade deletes assignments and items)
func (r *DailyTaskRepository) DeleteByDate(ctx context.Context, date, projectID string) error {
	pool := GetPool()

	_, err := pool.Exec(ctx, `
		DELETE FROM daily_task_lists WHERE date = $1 AND project_id = $2
	`, date, projectID)

	return err
}

// CreateAssignment adds a user assignment to a daily task list
func (r *DailyTaskRepository) CreateAssignment(ctx context.Context, assignment *models.UserTaskAssignment) error {
	pool := GetPool()

	assignment.CreatedAt = time.Now()

	err := pool.QueryRow(ctx, `
		INSERT INTO daily_task_assignments (daily_list_id, user_id, user_name, slack_handle, position, created_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id
	`, assignment.DailyListID, assignment.UserID, assignment.UserName, assignment.SlackHandle,
		assignment.Position, assignment.CreatedAt).Scan(&assignment.ID)

	return err
}

// CreateTaskItem adds a task item to an assignment
func (r *DailyTaskRepository) CreateTaskItem(ctx context.Context, item *models.DailyTaskItem) error {
	pool := GetPool()

	item.CreatedAt = time.Now()

	err := pool.QueryRow(ctx, `
		INSERT INTO daily_task_items (assignment_id, task_id, title, priority, position, carried_over, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id
	`, item.AssignmentID, item.TaskID, item.Title, item.Priority, item.Position,
		item.CarriedOver, item.CreatedAt).Scan(&item.ID)

	return err
}

// ReorderTaskItems updates positions of task items
func (r *DailyTaskRepository) ReorderTaskItems(ctx context.Context, assignmentID string, itemIDs []string) error {
	pool := GetPool()

	for i, itemID := range itemIDs {
		_, err := pool.Exec(ctx, `
			UPDATE daily_task_items SET position = $1
			WHERE id = $2 AND assignment_id = $3
		`, i, itemID, assignmentID)
		if err != nil {
			return fmt.Errorf("failed to update position for item %s: %w", itemID, err)
		}
	}

	return nil
}

// DeleteTaskItem removes a task item
func (r *DailyTaskRepository) DeleteTaskItem(ctx context.Context, itemID string) error {
	pool := GetPool()

	_, err := pool.Exec(ctx, `DELETE FROM daily_task_items WHERE id = $1`, itemID)
	return err
}

// UpdateTaskItem updates a task item's title/priority
func (r *DailyTaskRepository) UpdateTaskItem(ctx context.Context, itemID, title, priority string) error {
	pool := GetPool()

	_, err := pool.Exec(ctx, `
		UPDATE daily_task_items SET title = $2, priority = $3
		WHERE id = $1
	`, itemID, title, priority)
	return err
}

// DeleteAssignment removes a user assignment and its task items (cascade)
func (r *DailyTaskRepository) DeleteAssignment(ctx context.Context, assignmentID string) error {
	pool := GetPool()

	_, err := pool.Exec(ctx, `DELETE FROM daily_task_assignments WHERE id = $1`, assignmentID)
	return err
}

// UpdateAssignment updates a user assignment's name/handle
func (r *DailyTaskRepository) UpdateAssignment(ctx context.Context, assignmentID string, userName, slackHandle string) error {
	pool := GetPool()

	_, err := pool.Exec(ctx, `
		UPDATE daily_task_assignments SET user_name = $2, slack_handle = $3
		WHERE id = $1
	`, assignmentID, userName, slackHandle)
	return err
}

// UpdateListTimestamp updates the updated_at timestamp for a daily task list
func (r *DailyTaskRepository) UpdateListTimestamp(ctx context.Context, listID string) error {
	pool := GetPool()

	_, err := pool.Exec(ctx, `
		UPDATE daily_task_lists SET updated_at = NOW() WHERE id = $1
	`, listID)
	return err
}

// getAssignments fetches all assignments for a daily task list with their task items
func (r *DailyTaskRepository) getAssignments(ctx context.Context, listID string) ([]models.UserTaskAssignment, error) {
	pool := GetPool()

	rows, err := pool.Query(ctx, `
		SELECT id, daily_list_id, user_id, user_name, slack_handle, position, created_at
		FROM daily_task_assignments
		WHERE daily_list_id = $1
		ORDER BY position ASC
	`, listID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var assignments []models.UserTaskAssignment
	for rows.Next() {
		var a models.UserTaskAssignment
		err := rows.Scan(&a.ID, &a.DailyListID, &a.UserID, &a.UserName, &a.SlackHandle, &a.Position, &a.CreatedAt)
		if err != nil {
			return nil, err
		}
		assignments = append(assignments, a)
	}

	// Fetch task items for each assignment
	for i := range assignments {
		items, err := r.getTaskItems(ctx, assignments[i].ID)
		if err != nil {
			return nil, err
		}
		assignments[i].Tasks = items
	}

	return assignments, nil
}

// getTaskItems fetches all task items for an assignment
func (r *DailyTaskRepository) getTaskItems(ctx context.Context, assignmentID string) ([]models.DailyTaskItem, error) {
	pool := GetPool()

	rows, err := pool.Query(ctx, `
		SELECT id, assignment_id, task_id, title, priority, position, carried_over, created_at
		FROM daily_task_items
		WHERE assignment_id = $1
		ORDER BY position ASC
	`, assignmentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []models.DailyTaskItem
	for rows.Next() {
		var item models.DailyTaskItem
		err := rows.Scan(&item.ID, &item.AssignmentID, &item.TaskID, &item.Title,
			&item.Priority, &item.Position, &item.CarriedOver, &item.CreatedAt)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}

	return items, nil
}

// GetPendingTasksByAssignee gets yesterday's pending tasks grouped by assignee
func (r *DailyTaskRepository) GetPendingTasksByAssignee(ctx context.Context, projectID string) (map[string][]*models.TaskWithAssignee, error) {
	pool := GetPool()

	// Get tasks that are todo or in_progress, grouped by assignee
	rows, err := pool.Query(ctx, `
		SELECT t.id, t.title, t.description, t.status, t.priority, t.project_id,
		       t.assignee_id, t.asana_id, t.asana_url, t.asana_section_gid, t.section_name,
		       t.due_date, t.created_at, t.updated_at, t.created_by,
		       u.name as assignee_name, u.email as assignee_email, u.picture as assignee_picture
		FROM tasks t
		LEFT JOIN users u ON t.assignee_id = u.id
		WHERE t.project_id = $1
		AND t.status IN ('todo', 'in_progress')
		ORDER BY u.name ASC,
		         CASE t.priority
		           WHEN 'high' THEN 1
		           WHEN 'medium' THEN 2
		           WHEN 'low' THEN 3
		         END ASC,
		         t.created_at ASC
	`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string][]*models.TaskWithAssignee)
	for rows.Next() {
		var task models.TaskWithAssignee
		err := rows.Scan(&task.ID, &task.Title, &task.Description, &task.Status, &task.Priority,
			&task.ProjectID, &task.AssigneeID, &task.AsanaID, &task.AsanaURL,
			&task.AsanaSectionGID, &task.SectionName,
			&task.DueDate, &task.CreatedAt, &task.UpdatedAt, &task.CreatedBy,
			&task.AssigneeName, &task.AssigneeEmail, &task.AssigneePicture)
		if err != nil {
			return nil, err
		}

		name := "Unassigned"
		if task.AssigneeName != nil {
			name = *task.AssigneeName
		}
		result[name] = append(result[name], &task)
	}

	return result, nil
}

// GetUserSlackHandles retrieves slack handles for users
func (r *DailyTaskRepository) GetUserSlackHandles(ctx context.Context) (map[string]string, error) {
	pool := GetPool()

	rows, err := pool.Query(ctx, `
		SELECT name, COALESCE(slack_handle, '') FROM users WHERE slack_handle IS NOT NULL AND slack_handle != ''
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	handles := make(map[string]string)
	for rows.Next() {
		var name, handle string
		if err := rows.Scan(&name, &handle); err != nil {
			return nil, err
		}
		handles[name] = handle
	}

	return handles, nil
}
