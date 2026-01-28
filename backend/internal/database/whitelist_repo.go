package database

import (
	"context"
	"strings"
	"time"

	"github.com/dhindsa/project-management/internal/models"
	"github.com/google/uuid"
)

// WhitelistRepository handles allowed emails and domains database operations
type WhitelistRepository struct{}

// NewWhitelistRepository creates a new WhitelistRepository
func NewWhitelistRepository() *WhitelistRepository {
	return &WhitelistRepository{}
}

// --- Allowed Emails ---

// AddAllowedEmail adds an email to the whitelist
func (r *WhitelistRepository) AddAllowedEmail(ctx context.Context, email string, role models.Role, addedBy string) (*models.AllowedEmail, error) {
	pool := GetPool()

	allowedEmail := &models.AllowedEmail{
		ID:        uuid.New().String(),
		Email:     strings.ToLower(email),
		Role:      role,
		AddedBy:   addedBy,
		CreatedAt: time.Now(),
	}

	_, err := pool.Exec(ctx, `
		INSERT INTO allowed_emails (id, email, role, added_by, created_at)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (email) DO UPDATE SET role = $3
	`, allowedEmail.ID, allowedEmail.Email, allowedEmail.Role, allowedEmail.AddedBy, allowedEmail.CreatedAt)

	if err != nil {
		return nil, err
	}

	return allowedEmail, nil
}

// GetAllowedEmails returns all allowed emails
func (r *WhitelistRepository) GetAllowedEmails(ctx context.Context) ([]*models.AllowedEmail, error) {
	pool := GetPool()

	rows, err := pool.Query(ctx, `
		SELECT id, email, role, added_by, created_at
		FROM allowed_emails
		ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var emails []*models.AllowedEmail
	for rows.Next() {
		var email models.AllowedEmail
		err := rows.Scan(&email.ID, &email.Email, &email.Role, &email.AddedBy, &email.CreatedAt)
		if err != nil {
			return nil, err
		}
		emails = append(emails, &email)
	}

	return emails, nil
}

// IsEmailAllowed checks if an email is allowed to access the system
func (r *WhitelistRepository) IsEmailAllowed(ctx context.Context, email string) (bool, models.Role) {
	email = strings.ToLower(email)

	// Check if it's the default admin
	if email == strings.ToLower(models.DefaultAdminEmail) {
		return true, models.RoleAdmin
	}

	pool := GetPool()

	// Check exact email match
	var role models.Role
	err := pool.QueryRow(ctx, `
		SELECT role FROM allowed_emails WHERE email = $1
	`, email).Scan(&role)
	if err == nil {
		return true, role
	}

	// Check domain match
	parts := strings.Split(email, "@")
	if len(parts) == 2 {
		domain := parts[1]
		err = pool.QueryRow(ctx, `
			SELECT role FROM allowed_domains WHERE domain = $1
		`, domain).Scan(&role)
		if err == nil {
			return true, role
		}
	}

	return false, ""
}

// RemoveAllowedEmail removes an email from the whitelist
func (r *WhitelistRepository) RemoveAllowedEmail(ctx context.Context, emailID string) error {
	pool := GetPool()

	_, err := pool.Exec(ctx, `DELETE FROM allowed_emails WHERE id = $1`, emailID)
	return err
}

// UpdateAllowedEmailRole updates the role for an allowed email
func (r *WhitelistRepository) UpdateAllowedEmailRole(ctx context.Context, emailID string, role models.Role) error {
	pool := GetPool()

	_, err := pool.Exec(ctx, `
		UPDATE allowed_emails SET role = $2 WHERE id = $1
	`, emailID, role)

	return err
}

// --- Allowed Domains ---

// AddAllowedDomain adds a domain to the whitelist
func (r *WhitelistRepository) AddAllowedDomain(ctx context.Context, domain string, role models.Role, addedBy string) (*models.AllowedDomain, error) {
	pool := GetPool()

	allowedDomain := &models.AllowedDomain{
		ID:        uuid.New().String(),
		Domain:    strings.ToLower(domain),
		Role:      role,
		AddedBy:   addedBy,
		CreatedAt: time.Now(),
	}

	_, err := pool.Exec(ctx, `
		INSERT INTO allowed_domains (id, domain, role, added_by, created_at)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (domain) DO UPDATE SET role = $3
	`, allowedDomain.ID, allowedDomain.Domain, allowedDomain.Role, allowedDomain.AddedBy, allowedDomain.CreatedAt)

	if err != nil {
		return nil, err
	}

	return allowedDomain, nil
}

// GetAllowedDomains returns all allowed domains
func (r *WhitelistRepository) GetAllowedDomains(ctx context.Context) ([]*models.AllowedDomain, error) {
	pool := GetPool()

	rows, err := pool.Query(ctx, `
		SELECT id, domain, role, added_by, created_at
		FROM allowed_domains
		ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var domains []*models.AllowedDomain
	for rows.Next() {
		var domain models.AllowedDomain
		err := rows.Scan(&domain.ID, &domain.Domain, &domain.Role, &domain.AddedBy, &domain.CreatedAt)
		if err != nil {
			return nil, err
		}
		domains = append(domains, &domain)
	}

	return domains, nil
}

// RemoveAllowedDomain removes a domain from the whitelist
func (r *WhitelistRepository) RemoveAllowedDomain(ctx context.Context, domainID string) error {
	pool := GetPool()

	_, err := pool.Exec(ctx, `DELETE FROM allowed_domains WHERE id = $1`, domainID)
	return err
}
