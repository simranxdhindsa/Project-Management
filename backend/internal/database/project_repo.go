package database

import (
	"context"
	"time"

	"github.com/dhindsa/project-management/internal/models"
)

// ProjectRepository handles project database operations
type ProjectRepository struct{}

// NewProjectRepository creates a new ProjectRepository
func NewProjectRepository() *ProjectRepository {
	return &ProjectRepository{}
}

// Create inserts a new project
func (r *ProjectRepository) Create(ctx context.Context, project *models.Project) error {
	pool := GetPool()

	project.CreatedAt = time.Now()
	project.UpdatedAt = time.Now()

	return pool.QueryRow(ctx, `
		INSERT INTO projects (name, description, owner_id, asana_project_id, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id
	`, project.Name, project.Description, project.OwnerID, project.AsanaProjectID,
		project.CreatedAt, project.UpdatedAt).Scan(&project.ID)
}

// GetByID retrieves a project by ID
func (r *ProjectRepository) GetByID(ctx context.Context, id string) (*models.Project, error) {
	pool := GetPool()

	var project models.Project
	err := pool.QueryRow(ctx, `
		SELECT id, name, description, owner_id, asana_project_id, created_at, updated_at
		FROM projects WHERE id = $1
	`, id).Scan(&project.ID, &project.Name, &project.Description, &project.OwnerID,
		&project.AsanaProjectID, &project.CreatedAt, &project.UpdatedAt)

	if err != nil {
		return nil, err
	}
	return &project, nil
}

// GetByOwnerID retrieves all projects owned by a user
func (r *ProjectRepository) GetByOwnerID(ctx context.Context, ownerID string) ([]*models.Project, error) {
	pool := GetPool()

	rows, err := pool.Query(ctx, `
		SELECT id, name, description, owner_id, asana_project_id, created_at, updated_at
		FROM projects WHERE owner_id = $1
		ORDER BY created_at DESC
	`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var projects []*models.Project
	for rows.Next() {
		var project models.Project
		err := rows.Scan(&project.ID, &project.Name, &project.Description, &project.OwnerID,
			&project.AsanaProjectID, &project.CreatedAt, &project.UpdatedAt)
		if err != nil {
			return nil, err
		}
		projects = append(projects, &project)
	}

	return projects, nil
}

// GetUserProjects retrieves all projects a user has access to (owned or member of)
func (r *ProjectRepository) GetUserProjects(ctx context.Context, userID string) ([]*models.Project, error) {
	pool := GetPool()

	rows, err := pool.Query(ctx, `
		SELECT DISTINCT p.id, p.name, p.description, p.owner_id, p.asana_project_id, p.created_at, p.updated_at
		FROM projects p
		LEFT JOIN project_members pm ON p.id = pm.project_id
		WHERE p.owner_id = $1 OR pm.user_id = $1
		ORDER BY p.created_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var projects []*models.Project
	for rows.Next() {
		var project models.Project
		err := rows.Scan(&project.ID, &project.Name, &project.Description, &project.OwnerID,
			&project.AsanaProjectID, &project.CreatedAt, &project.UpdatedAt)
		if err != nil {
			return nil, err
		}
		projects = append(projects, &project)
	}

	return projects, nil
}

// Update updates a project
func (r *ProjectRepository) Update(ctx context.Context, project *models.Project) error {
	pool := GetPool()

	project.UpdatedAt = time.Now()
	_, err := pool.Exec(ctx, `
		UPDATE projects SET name = $2, description = $3, asana_project_id = $4, updated_at = $5
		WHERE id = $1
	`, project.ID, project.Name, project.Description, project.AsanaProjectID, project.UpdatedAt)

	return err
}

// Delete removes a project
func (r *ProjectRepository) Delete(ctx context.Context, id string) error {
	pool := GetPool()

	_, err := pool.Exec(ctx, `DELETE FROM projects WHERE id = $1`, id)
	return err
}

// GetByAsanaProjectID retrieves a project by its Asana project ID
func (r *ProjectRepository) GetByAsanaProjectID(ctx context.Context, asanaProjectID string) (*models.Project, error) {
	pool := GetPool()

	var project models.Project
	err := pool.QueryRow(ctx, `
		SELECT id, name, description, owner_id, asana_project_id, created_at, updated_at
		FROM projects WHERE asana_project_id = $1
	`, asanaProjectID).Scan(&project.ID, &project.Name, &project.Description, &project.OwnerID,
		&project.AsanaProjectID, &project.CreatedAt, &project.UpdatedAt)

	if err != nil {
		return nil, err
	}
	return &project, nil
}

// AddMember adds a user to a project
func (r *ProjectRepository) AddMember(ctx context.Context, projectID, userID string, role models.Role) error {
	pool := GetPool()

	_, err := pool.Exec(ctx, `
		INSERT INTO project_members (project_id, user_id, role, joined_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (project_id, user_id) DO UPDATE SET role = $3
	`, projectID, userID, role)

	return err
}

// RemoveMember removes a user from a project
func (r *ProjectRepository) RemoveMember(ctx context.Context, projectID, userID string) error {
	pool := GetPool()

	_, err := pool.Exec(ctx, `
		DELETE FROM project_members WHERE project_id = $1 AND user_id = $2
	`, projectID, userID)

	return err
}

// GetMembers retrieves all members of a project
func (r *ProjectRepository) GetMembers(ctx context.Context, projectID string) ([]*models.ProjectMember, error) {
	pool := GetPool()

	rows, err := pool.Query(ctx, `
		SELECT pm.project_id, pm.user_id, pm.role, pm.joined_at,
		       u.name, u.email, u.picture
		FROM project_members pm
		JOIN users u ON pm.user_id = u.id
		WHERE pm.project_id = $1
		ORDER BY pm.joined_at ASC
	`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var members []*models.ProjectMember
	for rows.Next() {
		var member models.ProjectMember
		err := rows.Scan(&member.ProjectID, &member.UserID, &member.Role, &member.JoinedAt,
			&member.UserName, &member.UserEmail, &member.UserPicture)
		if err != nil {
			return nil, err
		}
		members = append(members, &member)
	}

	return members, nil
}

// GetMemberRole retrieves a user's role in a project
func (r *ProjectRepository) GetMemberRole(ctx context.Context, projectID, userID string) (models.Role, error) {
	pool := GetPool()

	// Check if user is owner first
	var ownerID string
	err := pool.QueryRow(ctx, `SELECT owner_id FROM projects WHERE id = $1`, projectID).Scan(&ownerID)
	if err != nil {
		return "", err
	}

	if ownerID == userID {
		return models.RoleAdmin, nil
	}

	// Check project_members table
	var role models.Role
	err = pool.QueryRow(ctx, `
		SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2
	`, projectID, userID).Scan(&role)

	return role, err
}

// CreateColumn creates a new column in a project
func (r *ProjectRepository) CreateColumn(ctx context.Context, column *models.Column) error {
	pool := GetPool()

	return pool.QueryRow(ctx, `
		INSERT INTO columns (project_id, name, position)
		VALUES ($1, $2, $3)
		RETURNING id
	`, column.ProjectID, column.Name, column.Position).Scan(&column.ID)
}

// GetColumns retrieves all columns for a project
func (r *ProjectRepository) GetColumns(ctx context.Context, projectID string) ([]*models.Column, error) {
	pool := GetPool()

	rows, err := pool.Query(ctx, `
		SELECT id, project_id, name, position
		FROM columns WHERE project_id = $1
		ORDER BY position ASC
	`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var columns []*models.Column
	for rows.Next() {
		var column models.Column
		err := rows.Scan(&column.ID, &column.ProjectID, &column.Name, &column.Position)
		if err != nil {
			return nil, err
		}
		columns = append(columns, &column)
	}

	return columns, nil
}

// UpdateColumnPosition updates a column's position
func (r *ProjectRepository) UpdateColumnPosition(ctx context.Context, columnID string, position int) error {
	pool := GetPool()

	_, err := pool.Exec(ctx, `
		UPDATE columns SET position = $2 WHERE id = $1
	`, columnID, position)

	return err
}

// DeleteColumn removes a column
func (r *ProjectRepository) DeleteColumn(ctx context.Context, columnID string) error {
	pool := GetPool()

	_, err := pool.Exec(ctx, `DELETE FROM columns WHERE id = $1`, columnID)
	return err
}

// GetAllProjects retrieves all projects (admin only)
func (r *ProjectRepository) GetAllProjects(ctx context.Context) ([]*models.Project, error) {
	pool := GetPool()

	rows, err := pool.Query(ctx, `
		SELECT id, name, description, owner_id, asana_project_id, created_at, updated_at
		FROM projects
		ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var projects []*models.Project
	for rows.Next() {
		var project models.Project
		err := rows.Scan(&project.ID, &project.Name, &project.Description, &project.OwnerID,
			&project.AsanaProjectID, &project.CreatedAt, &project.UpdatedAt)
		if err != nil {
			return nil, err
		}
		projects = append(projects, &project)
	}

	return projects, nil
}
