package models

import "time"

// Project represents a project in the system
type Project struct {
	ID             string    `json:"id" db:"id"`
	Name           string    `json:"name" db:"name"`
	Description    string    `json:"description" db:"description"`
	OwnerID        string    `json:"owner_id" db:"owner_id"`
	AsanaProjectID *string   `json:"asana_project_id,omitempty" db:"asana_project_id"`
	CreatedAt      time.Time `json:"created_at" db:"created_at"`
	UpdatedAt      time.Time `json:"updated_at" db:"updated_at"`
}

// ProjectMember represents a user's membership in a project
type ProjectMember struct {
	ProjectID   string    `json:"project_id" db:"project_id"`
	UserID      string    `json:"user_id" db:"user_id"`
	Role        Role      `json:"role" db:"role"`
	JoinedAt    time.Time `json:"joined_at" db:"joined_at"`
	UserName    *string   `json:"user_name,omitempty" db:"user_name"`
	UserEmail   *string   `json:"user_email,omitempty" db:"user_email"`
	UserPicture *string   `json:"user_picture,omitempty" db:"user_picture"`
}

// ProjectWithMembers includes member count
type ProjectWithMembers struct {
	Project
	MemberCount int `json:"member_count" db:"member_count"`
	TaskCount   int `json:"task_count" db:"task_count"`
}

// CreateProjectRequest represents the request to create a project
type CreateProjectRequest struct {
	Name        string `json:"name" validate:"required,min=1,max=255"`
	Description string `json:"description"`
}

// UpdateProjectRequest represents the request to update a project
type UpdateProjectRequest struct {
	Name        *string `json:"name,omitempty"`
	Description *string `json:"description,omitempty"`
}

// Column represents a kanban column (for custom column ordering)
type Column struct {
	ID        string `json:"id" db:"id"`
	ProjectID string `json:"project_id" db:"project_id"`
	Name      string `json:"name" db:"name"`
	Position  int    `json:"position" db:"position"`
}
