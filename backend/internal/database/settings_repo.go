package database

import (
	"context"
	"time"

	"github.com/dhindsa/project-management/internal/models"
)

// SettingsRepository handles global settings database operations
type SettingsRepository struct{}

// NewSettingsRepository creates a new SettingsRepository
func NewSettingsRepository() *SettingsRepository {
	return &SettingsRepository{}
}

// Get retrieves a setting by key
func (r *SettingsRepository) Get(ctx context.Context, key string) (*models.GlobalSetting, error) {
	pool := GetPool()
	if pool == nil {
		return nil, nil
	}

	var setting models.GlobalSetting
	err := pool.QueryRow(ctx, `
		SELECT id, key, value, encrypted, description, updated_by, created_at, updated_at
		FROM global_settings WHERE key = $1
	`, key).Scan(&setting.ID, &setting.Key, &setting.Value, &setting.Encrypted,
		&setting.Description, &setting.UpdatedBy, &setting.CreatedAt, &setting.UpdatedAt)

	if err != nil {
		return nil, err
	}
	return &setting, nil
}

// Set creates or updates a setting
func (r *SettingsRepository) Set(ctx context.Context, key, value string, updatedBy string) error {
	pool := GetPool()
	if pool == nil {
		return nil
	}

	_, err := pool.Exec(ctx, `
		INSERT INTO global_settings (key, value, updated_by, updated_at)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (key) DO UPDATE SET
			value = $2,
			updated_by = $3,
			updated_at = $4
	`, key, value, updatedBy, time.Now())

	return err
}

// GetAsanaSettings retrieves all Asana-related settings
func (r *SettingsRepository) GetAsanaSettings(ctx context.Context) (*models.AsanaSettings, error) {
	pool := GetPool()
	if pool == nil {
		return &models.AsanaSettings{Configured: false}, nil
	}

	settings := &models.AsanaSettings{}

	// Get PAT
	pat, err := r.Get(ctx, "asana_pat")
	if err == nil && pat != nil {
		settings.PAT = pat.Value
		settings.Configured = pat.Value != ""
	}

	// Get Project ID
	projectID, err := r.Get(ctx, "asana_project_id")
	if err == nil && projectID != nil {
		settings.ProjectID = projectID.Value
	}

	// Get Workspace ID
	workspaceID, err := r.Get(ctx, "asana_workspace_id")
	if err == nil && workspaceID != nil {
		settings.WorkspaceID = workspaceID.Value
	}

	return settings, nil
}

// UpdateAsanaSettings updates Asana-related settings
func (r *SettingsRepository) UpdateAsanaSettings(ctx context.Context, settings *models.UpdateAsanaSettingsRequest, updatedBy string) error {
	pool := GetPool()
	if pool == nil {
		return nil
	}

	if settings.PAT != "" {
		if err := r.Set(ctx, "asana_pat", settings.PAT, updatedBy); err != nil {
			return err
		}
	}

	if settings.ProjectID != "" {
		if err := r.Set(ctx, "asana_project_id", settings.ProjectID, updatedBy); err != nil {
			return err
		}
	}

	if settings.WorkspaceID != "" {
		if err := r.Set(ctx, "asana_workspace_id", settings.WorkspaceID, updatedBy); err != nil {
			return err
		}
	}

	return nil
}

// GetValue retrieves just the value of a setting
func (r *SettingsRepository) GetValue(ctx context.Context, key string) string {
	setting, err := r.Get(ctx, key)
	if err != nil || setting == nil {
		return ""
	}
	return setting.Value
}
