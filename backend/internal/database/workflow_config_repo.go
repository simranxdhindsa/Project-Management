package database

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/dhindsa/project-management/internal/models"
)

// WorkflowConfigRepository handles workflow configuration CRUD with caching
type WorkflowConfigRepository struct{}

// NewWorkflowConfigRepository creates a new WorkflowConfigRepository
func NewWorkflowConfigRepository() *WorkflowConfigRepository {
	return &WorkflowConfigRepository{}
}

// cachedConfig wraps a config with expiry for in-memory caching
type cachedConfig struct {
	config    *models.WorkflowConfig
	expiresAt time.Time
}

var (
	configCache sync.Map
	cacheTTL    = 5 * time.Minute
)

// clearCache removes a specific user's cached config
func clearCache(userID string) {
	configCache.Delete(userID)
}

// GetEffective returns the user's config if it exists, otherwise the system default.
func (r *WorkflowConfigRepository) GetEffective(ctx context.Context, userID string) (*models.WorkflowConfig, error) {
	// Check cache first
	if cached, ok := configCache.Load(userID); ok {
		cc := cached.(*cachedConfig)
		if time.Now().Before(cc.expiresAt) {
			return cc.config, nil
		}
		configCache.Delete(userID)
	}

	pool := GetPool()

	// Try user-specific config first
	var cfg models.WorkflowConfig
	var priorityTagsJSON, columnHierarchyJSON, hotfixRulesJSON, reportConfigJSON []byte

	err := pool.QueryRow(ctx, `
		SELECT id, user_id, priority_tags, column_hierarchy, hotfix_rules, report_config
		FROM workflow_config
		WHERE user_id = $1
	`, userID).Scan(&cfg.ID, &cfg.UserID, &priorityTagsJSON, &columnHierarchyJSON, &hotfixRulesJSON, &reportConfigJSON)

	if err != nil {
		// Fall back to system default (user_id IS NULL)
		err = pool.QueryRow(ctx, `
			SELECT id, user_id, priority_tags, column_hierarchy, hotfix_rules, report_config
			FROM workflow_config
			WHERE user_id IS NULL
		`).Scan(&cfg.ID, &cfg.UserID, &priorityTagsJSON, &columnHierarchyJSON, &hotfixRulesJSON, &reportConfigJSON)
		if err != nil {
			return nil, err
		}
	}

	// Unmarshal JSONB fields
	if err := json.Unmarshal(priorityTagsJSON, &cfg.PriorityTags); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(columnHierarchyJSON, &cfg.ColumnHierarchy); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(hotfixRulesJSON, &cfg.HotfixRules); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(reportConfigJSON, &cfg.ReportConfig); err != nil {
		return nil, err
	}

	// Cache the result
	configCache.Store(userID, &cachedConfig{
		config:    &cfg,
		expiresAt: time.Now().Add(cacheTTL),
	})

	return &cfg, nil
}

// GetSystemDefault returns the global default config (user_id IS NULL)
func (r *WorkflowConfigRepository) GetSystemDefault(ctx context.Context) (*models.WorkflowConfig, error) {
	pool := GetPool()

	var cfg models.WorkflowConfig
	var priorityTagsJSON, columnHierarchyJSON, hotfixRulesJSON, reportConfigJSON []byte

	err := pool.QueryRow(ctx, `
		SELECT id, user_id, priority_tags, column_hierarchy, hotfix_rules, report_config
		FROM workflow_config
		WHERE user_id IS NULL
	`).Scan(&cfg.ID, &cfg.UserID, &priorityTagsJSON, &columnHierarchyJSON, &hotfixRulesJSON, &reportConfigJSON)
	if err != nil {
		return nil, err
	}

	if err := json.Unmarshal(priorityTagsJSON, &cfg.PriorityTags); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(columnHierarchyJSON, &cfg.ColumnHierarchy); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(hotfixRulesJSON, &cfg.HotfixRules); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(reportConfigJSON, &cfg.ReportConfig); err != nil {
		return nil, err
	}

	return &cfg, nil
}

// Upsert inserts or updates a user's workflow config
func (r *WorkflowConfigRepository) Upsert(ctx context.Context, userID string, cfg *models.WorkflowConfig) error {
	pool := GetPool()

	priorityTagsJSON, err := json.Marshal(cfg.PriorityTags)
	if err != nil {
		return err
	}
	columnHierarchyJSON, err := json.Marshal(cfg.ColumnHierarchy)
	if err != nil {
		return err
	}
	hotfixRulesJSON, err := json.Marshal(cfg.HotfixRules)
	if err != nil {
		return err
	}
	reportConfigJSON, err := json.Marshal(cfg.ReportConfig)
	if err != nil {
		return err
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO workflow_config (id, user_id, priority_tags, column_hierarchy, hotfix_rules, report_config, updated_at)
		VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, NOW())
		ON CONFLICT (user_id) DO UPDATE SET
			priority_tags = $2,
			column_hierarchy = $3,
			hotfix_rules = $4,
			report_config = $5,
			updated_at = NOW()
	`, userID, priorityTagsJSON, columnHierarchyJSON, hotfixRulesJSON, reportConfigJSON)

	if err == nil {
		clearCache(userID)
	}
	return err
}

// UpsertPriorityTags updates only the priority_tags field
func (r *WorkflowConfigRepository) UpsertPriorityTags(ctx context.Context, userID string, tags []models.PriorityTag) error {
	cfg, err := r.GetEffective(ctx, userID)
	if err != nil {
		return err
	}
	cfg.PriorityTags = tags
	return r.Upsert(ctx, userID, cfg)
}

// UpsertColumnHierarchy updates only the column_hierarchy field
func (r *WorkflowConfigRepository) UpsertColumnHierarchy(ctx context.Context, userID string, columns []models.ColumnState) error {
	cfg, err := r.GetEffective(ctx, userID)
	if err != nil {
		return err
	}
	cfg.ColumnHierarchy = columns
	return r.Upsert(ctx, userID, cfg)
}

// UpsertHotfixRules updates only the hotfix_rules field
func (r *WorkflowConfigRepository) UpsertHotfixRules(ctx context.Context, userID string, rules models.HotfixRules) error {
	cfg, err := r.GetEffective(ctx, userID)
	if err != nil {
		return err
	}
	cfg.HotfixRules = rules
	return r.Upsert(ctx, userID, cfg)
}

// UpsertReportConfig updates only the report_config field
func (r *WorkflowConfigRepository) UpsertReportConfig(ctx context.Context, userID string, rc models.ReportConfig) error {
	cfg, err := r.GetEffective(ctx, userID)
	if err != nil {
		return err
	}
	cfg.ReportConfig = rc
	return r.Upsert(ctx, userID, cfg)
}

// ResetToDefault deletes the user's config row so they fall back to the global default
func (r *WorkflowConfigRepository) ResetToDefault(ctx context.Context, userID string) error {
	pool := GetPool()
	_, err := pool.Exec(ctx, `DELETE FROM workflow_config WHERE user_id = $1`, userID)
	if err == nil {
		clearCache(userID)
	}
	return err
}
