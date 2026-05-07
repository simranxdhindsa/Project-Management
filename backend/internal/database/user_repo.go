package database

import (
	"context"
	"time"

	"github.com/dhindsa/project-management/internal/models"
)

// UserRepository handles user database operations
type UserRepository struct{}

// NewUserRepository creates a new UserRepository
func NewUserRepository() *UserRepository {
	return &UserRepository{}
}

// Create inserts a new user into the database
func (r *UserRepository) Create(ctx context.Context, user *models.User) error {
	pool := GetPool()

	_, err := pool.Exec(ctx, `
		INSERT INTO users (id, email, name, picture, role, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, user.ID, user.Email, user.Name, user.Picture, user.Role, user.CreatedAt, user.UpdatedAt)

	return err
}

// GetByID retrieves a user by ID
func (r *UserRepository) GetByID(ctx context.Context, id string) (*models.User, error) {
	pool := GetPool()

	var user models.User
	err := pool.QueryRow(ctx, `
		SELECT id, email, name, picture, role, created_at, updated_at
		FROM users WHERE id = $1
	`, id).Scan(&user.ID, &user.Email, &user.Name, &user.Picture, &user.Role, &user.CreatedAt, &user.UpdatedAt)

	if err != nil {
		return nil, err
	}
	return &user, nil
}

// GetByEmail retrieves a user by email
func (r *UserRepository) GetByEmail(ctx context.Context, email string) (*models.User, error) {
	pool := GetPool()

	var user models.User
	err := pool.QueryRow(ctx, `
		SELECT id, email, name, picture, role, created_at, updated_at
		FROM users WHERE email = $1
	`, email).Scan(&user.ID, &user.Email, &user.Name, &user.Picture, &user.Role, &user.CreatedAt, &user.UpdatedAt)

	if err != nil {
		return nil, err
	}
	return &user, nil
}

// Update updates a user's information
func (r *UserRepository) Update(ctx context.Context, user *models.User) error {
	pool := GetPool()

	user.UpdatedAt = time.Now()
	_, err := pool.Exec(ctx, `
		UPDATE users SET name = $2, picture = $3, role = $4, updated_at = $5
		WHERE id = $1
	`, user.ID, user.Name, user.Picture, user.Role, user.UpdatedAt)

	return err
}

// UpdateRole updates a user's role
func (r *UserRepository) UpdateRole(ctx context.Context, userID string, role models.Role) error {
	pool := GetPool()

	_, err := pool.Exec(ctx, `
		UPDATE users SET role = $2, updated_at = NOW()
		WHERE id = $1
	`, userID, role)

	return err
}

// Delete removes a user from the database
func (r *UserRepository) Delete(ctx context.Context, id string) error {
	pool := GetPool()

	_, err := pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, id)
	return err
}

// List retrieves all users
func (r *UserRepository) List(ctx context.Context) ([]*models.User, error) {
	pool := GetPool()

	rows, err := pool.Query(ctx, `
		SELECT id, email, name, picture, role, created_at, updated_at
		FROM users ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []*models.User
	for rows.Next() {
		var user models.User
		err := rows.Scan(&user.ID, &user.Email, &user.Name, &user.Picture, &user.Role, &user.CreatedAt, &user.UpdatedAt)
		if err != nil {
			return nil, err
		}
		users = append(users, &user)
	}

	return users, nil
}

// Count returns the total number of users
func (r *UserRepository) Count(ctx context.Context) (int, error) {
	pool := GetPool()

	var count int
	err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM users`).Scan(&count)
	return count, err
}

// Exists checks if a user exists by email
func (r *UserRepository) Exists(ctx context.Context, email string) (bool, error) {
	pool := GetPool()

	var exists bool
	err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE email = $1)`, email).Scan(&exists)
	return exists, err
}
