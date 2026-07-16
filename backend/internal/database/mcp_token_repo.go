package database

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"time"
)

type MCPTokenRepository struct{}

func NewMCPTokenRepository() *MCPTokenRepository {
	return &MCPTokenRepository{}
}

type MCPToken struct {
	ID              string
	UserID          string
	CreatedAt       time.Time
	LastUsedAt      *time.Time
	DefaultSendTime string // HH:MM, e.g. "10:00"
}

// GenerateToken creates a new MCP token for the user (replaces any existing one).
// Returns the plain-text token — shown once, never stored.
func (r *MCPTokenRepository) GenerateToken(ctx context.Context, userID string) (string, error) {
	pool := GetPool()
	if pool == nil {
		return "", fmt.Errorf("database not available")
	}

	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("generate token bytes: %w", err)
	}
	plain := base64.URLEncoding.EncodeToString(raw)
	hash := sha256sum(plain)

	_, err := pool.Exec(ctx, `
		INSERT INTO user_mcp_tokens (user_id, token_hash)
		VALUES ($1, $2)
		ON CONFLICT (user_id) DO UPDATE
			SET token_hash   = EXCLUDED.token_hash,
			    created_at   = NOW(),
			    last_used_at = NULL
	`, userID, hash)
	if err != nil {
		return "", err
	}
	return plain, nil
}

// GetUserByToken resolves a plain-text token to a userID and records last_used_at.
// Returns "" if not found.
func (r *MCPTokenRepository) GetUserByToken(ctx context.Context, plain string) (string, error) {
	pool := GetPool()
	if pool == nil {
		return "", nil
	}
	hash := sha256sum(plain)
	var userID string
	err := pool.QueryRow(ctx, `
		UPDATE user_mcp_tokens
		SET last_used_at = NOW()
		WHERE token_hash = $1
		RETURNING user_id
	`, hash).Scan(&userID)
	if err != nil {
		return "", nil // not found
	}
	return userID, nil
}

// RevokeToken deletes the token for a user.
func (r *MCPTokenRepository) RevokeToken(ctx context.Context, userID string) error {
	pool := GetPool()
	if pool == nil {
		return nil
	}
	_, err := pool.Exec(ctx, `DELETE FROM user_mcp_tokens WHERE user_id = $1`, userID)
	return err
}

// GetToken returns metadata (no hash) for the user's token, or nil if none.
func (r *MCPTokenRepository) GetToken(ctx context.Context, userID string) (*MCPToken, error) {
	pool := GetPool()
	if pool == nil {
		return nil, nil
	}
	t := &MCPToken{}
	err := pool.QueryRow(ctx, `
		SELECT id::text, user_id, created_at, last_used_at, default_send_time
		FROM user_mcp_tokens WHERE user_id = $1
	`, userID).Scan(&t.ID, &t.UserID, &t.CreatedAt, &t.LastUsedAt, &t.DefaultSendTime)
	if err != nil {
		return nil, nil // no token
	}
	return t, nil
}

// GetDefaultSendTime returns the user's preferred default send time (HH:MM).
func (r *MCPTokenRepository) GetDefaultSendTime(ctx context.Context, userID string) string {
	pool := GetPool()
	if pool == nil {
		return "10:00"
	}
	var t string
	if err := pool.QueryRow(ctx, `
		SELECT default_send_time FROM user_mcp_tokens WHERE user_id = $1
	`, userID).Scan(&t); err != nil || t == "" {
		return "10:00"
	}
	return t
}

// UpdateDefaultSendTime persists the user's preferred default send time.
func (r *MCPTokenRepository) UpdateDefaultSendTime(ctx context.Context, userID, hhmm string) error {
	pool := GetPool()
	if pool == nil {
		return nil
	}
	_, err := pool.Exec(ctx, `
		UPDATE user_mcp_tokens SET default_send_time = $1 WHERE user_id = $2
	`, hhmm, userID)
	return err
}

func sha256sum(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}
