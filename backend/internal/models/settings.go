package models

import "time"

// GlobalSetting represents a global configuration setting
type GlobalSetting struct {
	ID          string    `json:"id" db:"id"`
	Key         string    `json:"key" db:"key"`
	Value       string    `json:"value,omitempty" db:"value"` // Omit in JSON if encrypted
	Encrypted   bool      `json:"encrypted" db:"encrypted"`
	Description string    `json:"description,omitempty" db:"description"`
	UpdatedBy   *string   `json:"updated_by,omitempty" db:"updated_by"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time `json:"updated_at" db:"updated_at"`
}

// AsanaSettings represents Asana configuration
type AsanaSettings struct {
	PAT         string `json:"pat,omitempty"`  // Only shown if user is admin
	ProjectID   string `json:"project_id"`
	WorkspaceID string `json:"workspace_id"`
	Configured  bool   `json:"configured"` // True if PAT is set
}

// UpdateAsanaSettingsRequest represents request to update Asana settings
type UpdateAsanaSettingsRequest struct {
	PAT         string `json:"pat,omitempty"`
	ProjectID   string `json:"project_id,omitempty"`
	WorkspaceID string `json:"workspace_id,omitempty"`
}

// YouTrackSettings represents YouTrack configuration
type YouTrackSettings struct {
	BaseURL    string `json:"base_url"`
	Token      string `json:"token,omitempty"` // Only shown if user is admin
	ProjectID  string `json:"project_id"`
	BoardID    string `json:"board_id,omitempty"`
	Configured bool   `json:"configured"` // True if credentials are set
}

// UpdateYouTrackSettingsRequest represents request to update YouTrack settings
type UpdateYouTrackSettingsRequest struct {
	BaseURL   string `json:"base_url,omitempty"`
	Token     string `json:"token,omitempty"`
	ProjectID string `json:"project_id,omitempty"`
	BoardID   string `json:"board_id,omitempty"`
}
