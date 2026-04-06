package database

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

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

// GetYouTrackSettings retrieves all YouTrack-related settings
func (r *SettingsRepository) GetYouTrackSettings(ctx context.Context) (*models.YouTrackSettings, error) {
	pool := GetPool()
	if pool == nil {
		return &models.YouTrackSettings{Configured: false}, nil
	}

	settings := &models.YouTrackSettings{}

	// Get Base URL
	baseURL, err := r.Get(ctx, "youtrack_base_url")
	if err == nil && baseURL != nil {
		settings.BaseURL = baseURL.Value
	}

	// Get Token
	token, err := r.Get(ctx, "youtrack_token")
	if err == nil && token != nil {
		settings.Token = token.Value
		settings.Configured = token.Value != "" && settings.BaseURL != ""
	}

	// Get Project ID
	projectID, err := r.Get(ctx, "youtrack_project_id")
	if err == nil && projectID != nil {
		settings.ProjectID = projectID.Value
	}

	// Get Board ID
	boardID, err := r.Get(ctx, "youtrack_board_id")
	if err == nil && boardID != nil {
		settings.BoardID = boardID.Value
	}

	return settings, nil
}

// UpdateYouTrackSettings updates YouTrack-related settings
func (r *SettingsRepository) UpdateYouTrackSettings(ctx context.Context, settings *models.UpdateYouTrackSettingsRequest, updatedBy string) error {
	pool := GetPool()
	if pool == nil {
		return nil
	}

	if settings.BaseURL != "" {
		if err := r.Set(ctx, "youtrack_base_url", settings.BaseURL, updatedBy); err != nil {
			return err
		}
	}

	if settings.Token != "" {
		if err := r.Set(ctx, "youtrack_token", settings.Token, updatedBy); err != nil {
			return err
		}
	}

	if settings.ProjectID != "" {
		if err := r.Set(ctx, "youtrack_project_id", settings.ProjectID, updatedBy); err != nil {
			return err
		}
	}

	if settings.BoardID != "" {
		if err := r.Set(ctx, "youtrack_board_id", settings.BoardID, updatedBy); err != nil {
			return err
		}
	}

	return nil
}

// ── Per-user YouTrack integration ──────────────────────────────────────────

// GetYouTrackIntegration retrieves a user's YouTrack integration from DB
func (r *SettingsRepository) GetYouTrackIntegration(ctx context.Context, userID string) (*models.YouTrackIntegration, error) {
	pool := GetPool()
	if pool == nil {
		return nil, nil
	}

	var i models.YouTrackIntegration
	err := pool.QueryRow(ctx, `
		SELECT id, user_id, base_url, token, project_id, COALESCE(board_id, ''), connected, created_at, updated_at
		FROM youtrack_integrations WHERE user_id = $1
	`, userID).Scan(&i.ID, &i.UserID, &i.BaseURL, &i.Token, &i.ProjectID, &i.BoardID, &i.Connected, &i.CreatedAt, &i.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &i, nil
}

// SaveYouTrackIntegration upserts a user's YouTrack integration
func (r *SettingsRepository) SaveYouTrackIntegration(ctx context.Context, userID string, req *models.SaveYouTrackIntegrationRequest) error {
	pool := GetPool()
	if pool == nil {
		return nil
	}

	_, err := pool.Exec(ctx, `
		INSERT INTO youtrack_integrations (user_id, base_url, token, project_id, board_id, connected, updated_at)
		VALUES ($1, $2, $3, $4, NULLIF($5, ''), TRUE, NOW())
		ON CONFLICT (user_id) DO UPDATE SET
			base_url   = $2,
			token      = $3,
			project_id = $4,
			board_id   = NULLIF($5, ''),
			connected  = TRUE,
			updated_at = NOW()
	`, userID, req.BaseURL, req.Token, req.ProjectID, req.BoardID)
	return err
}

// ── Per-user active data source ────────────────────────────────────────────

// GetUserDataSource returns 'youtrack' or 'asana' for the given user (default: 'youtrack')
func (r *SettingsRepository) GetUserDataSource(ctx context.Context, userID string) (string, error) {
	pool := GetPool()
	if pool == nil {
		return "youtrack", nil
	}
	var source string
	err := pool.QueryRow(ctx, `SELECT source FROM user_data_source WHERE user_id = $1`, userID).Scan(&source)
	if err != nil {
		return "youtrack", nil // default
	}
	return source, nil
}

// GetAdminDataSource returns the active data source for the default admin user.
// Used as a fallback for member-role users.
func (r *SettingsRepository) GetAdminDataSource(ctx context.Context) string {
	pool := GetPool()
	if pool == nil {
		return "youtrack"
	}
	var adminUserID string
	if err := pool.QueryRow(ctx, `SELECT id FROM users WHERE email = $1`, models.DefaultAdminEmail).Scan(&adminUserID); err != nil {
		return "youtrack"
	}
	source, _ := r.GetUserDataSource(ctx, adminUserID)
	if source == "" {
		return "youtrack"
	}
	return source
}

// SetUserDataSource upserts the user's active data source preference
func (r *SettingsRepository) SetUserDataSource(ctx context.Context, userID, source string) error {
	pool := GetPool()
	if pool == nil {
		return nil
	}
	if source != "youtrack" && source != "asana" {
		source = "youtrack"
	}
	_, err := pool.Exec(ctx, `
		INSERT INTO user_data_source (user_id, source, updated_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (user_id) DO UPDATE SET source = $2, updated_at = NOW()
	`, userID, source)
	return err
}

// GetAdminYouTrackIntegration returns the YouTrack integration belonging to the default admin user.
// Used as a fallback so that member-role users can read YouTrack data via the admin's credentials.
func (r *SettingsRepository) GetAdminYouTrackIntegration(ctx context.Context) (*models.YouTrackIntegration, error) {
	pool := GetPool()
	if pool == nil {
		return nil, nil
	}
	var adminUserID string
	err := pool.QueryRow(ctx, `SELECT id FROM users WHERE email = $1`, models.DefaultAdminEmail).Scan(&adminUserID)
	if err != nil {
		return nil, nil
	}
	return r.GetYouTrackIntegration(ctx, adminUserID)
}

// DisconnectYouTrackIntegration marks the integration as disconnected
func (r *SettingsRepository) DisconnectYouTrackIntegration(ctx context.Context, userID string) error {
	pool := GetPool()
	if pool == nil {
		return nil
	}
	_, err := pool.Exec(ctx, `
		UPDATE youtrack_integrations SET connected = FALSE, updated_at = NOW() WHERE user_id = $1
	`, userID)
	return err
}
