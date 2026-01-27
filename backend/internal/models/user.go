package models

import "time"

// Role represents user permission levels
type Role string

const (
	RoleAdmin          Role = "admin"
	RoleProjectManager Role = "project_manager"
	RoleMember         Role = "member"
	RoleViewer         Role = "viewer"
)

// User represents a user in the system
type User struct {
	ID        string    `json:"id"`
	Email     string    `json:"email"`
	Name      string    `json:"name"`
	Picture   string    `json:"picture,omitempty"`
	Role      Role      `json:"role"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// GoogleUserInfo represents the user info returned from Google OAuth
type GoogleUserInfo struct {
	ID            string `json:"id"`
	Email         string `json:"email"`
	VerifiedEmail bool   `json:"verified_email"`
	Name          string `json:"name"`
	GivenName     string `json:"given_name"`
	FamilyName    string `json:"family_name"`
	Picture       string `json:"picture"`
}

// AuthResponse is returned after successful authentication
type AuthResponse struct {
	User  *User  `json:"user"`
	Token string `json:"token"`
}

// TokenClaims represents JWT claims
type TokenClaims struct {
	UserID string `json:"user_id"`
	Email  string `json:"email"`
	Role   Role   `json:"role"`
}
