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

// cacheKey returns a composite cache key for (userID, source)
func cacheKey(userID, source string) string {
	return userID + ":" + source
}

// clearCache removes a specific user+source cached config
func clearCache(userID, source string) {
	configCache.Delete(cacheKey(userID, source))
}

// scanConfig scans the standard workflow_config columns into a WorkflowConfig struct
func scanConfig(cfg *models.WorkflowConfig, priorityTagsJSON, columnHierarchyJSON, hotfixRulesJSON, reportConfigJSON []byte) error {
	if err := json.Unmarshal(priorityTagsJSON, &cfg.PriorityTags); err != nil {
		return err
	}
	if err := json.Unmarshal(columnHierarchyJSON, &cfg.ColumnHierarchy); err != nil {
		return err
	}
	if err := json.Unmarshal(hotfixRulesJSON, &cfg.HotfixRules); err != nil {
		return err
	}
	if err := json.Unmarshal(reportConfigJSON, &cfg.ReportConfig); err != nil {
		return err
	}
	return nil
}

// GetEffective returns the source-specific config for a user, falling back to system defaults.
// Lookup order:
//  1. user-specific + source match
//  2. system default (user_id IS NULL) + source match
//  3. system default (user_id IS NULL) + 'youtrack' (global fallback)
func (r *WorkflowConfigRepository) GetEffective(ctx context.Context, userID, source string) (*models.WorkflowConfig, error) {
	key := cacheKey(userID, source)

	// Check cache first
	if cached, ok := configCache.Load(key); ok {
		cc := cached.(*cachedConfig)
		if time.Now().Before(cc.expiresAt) {
			return cc.config, nil
		}
		configCache.Delete(key)
	}

	pool := GetPool()

	var cfg models.WorkflowConfig
	var priorityTagsJSON, columnHierarchyJSON, hotfixRulesJSON, reportConfigJSON []byte

	// 1. Try user-specific + source
	err := pool.QueryRow(ctx, `
		SELECT id, user_id, COALESCE(pm_source,'youtrack'), priority_tags, column_hierarchy, hotfix_rules, report_config
		FROM workflow_config
		WHERE user_id = $1 AND pm_source = $2
	`, userID, source).Scan(&cfg.ID, &cfg.UserID, &cfg.PMSource, &priorityTagsJSON, &columnHierarchyJSON, &hotfixRulesJSON, &reportConfigJSON)

	if err != nil {
		// 2. Try system default + source
		err = pool.QueryRow(ctx, `
			SELECT id, user_id, COALESCE(pm_source,'youtrack'), priority_tags, column_hierarchy, hotfix_rules, report_config
			FROM workflow_config
			WHERE user_id IS NULL AND pm_source = $1
		`, source).Scan(&cfg.ID, &cfg.UserID, &cfg.PMSource, &priorityTagsJSON, &columnHierarchyJSON, &hotfixRulesJSON, &reportConfigJSON)
	}

	if err != nil {
		// 3. Fall back to system default youtrack (global fallback)
		err = pool.QueryRow(ctx, `
			SELECT id, user_id, COALESCE(pm_source,'youtrack'), priority_tags, column_hierarchy, hotfix_rules, report_config
			FROM workflow_config
			WHERE user_id IS NULL
			ORDER BY pm_source NULLS LAST
			LIMIT 1
		`).Scan(&cfg.ID, &cfg.UserID, &cfg.PMSource, &priorityTagsJSON, &columnHierarchyJSON, &hotfixRulesJSON, &reportConfigJSON)
		if err != nil {
			return nil, err
		}
	}

	if err := scanConfig(&cfg, priorityTagsJSON, columnHierarchyJSON, hotfixRulesJSON, reportConfigJSON); err != nil {
		return nil, err
	}

	// Cache the result
	configCache.Store(key, &cachedConfig{
		config:    &cfg,
		expiresAt: time.Now().Add(cacheTTL),
	})

	return &cfg, nil
}

// GetSystemDefault returns the system default config for a given source (user_id IS NULL)
func (r *WorkflowConfigRepository) GetSystemDefault(ctx context.Context, source string) (*models.WorkflowConfig, error) {
	pool := GetPool()

	var cfg models.WorkflowConfig
	var priorityTagsJSON, columnHierarchyJSON, hotfixRulesJSON, reportConfigJSON []byte

	err := pool.QueryRow(ctx, `
		SELECT id, user_id, COALESCE(pm_source,'youtrack'), priority_tags, column_hierarchy, hotfix_rules, report_config
		FROM workflow_config
		WHERE user_id IS NULL AND pm_source = $1
	`, source).Scan(&cfg.ID, &cfg.UserID, &cfg.PMSource, &priorityTagsJSON, &columnHierarchyJSON, &hotfixRulesJSON, &reportConfigJSON)
	if err != nil {
		// Fall back to any system default
		err = pool.QueryRow(ctx, `
			SELECT id, user_id, COALESCE(pm_source,'youtrack'), priority_tags, column_hierarchy, hotfix_rules, report_config
			FROM workflow_config
			WHERE user_id IS NULL
			ORDER BY pm_source NULLS LAST
			LIMIT 1
		`).Scan(&cfg.ID, &cfg.UserID, &cfg.PMSource, &priorityTagsJSON, &columnHierarchyJSON, &hotfixRulesJSON, &reportConfigJSON)
		if err != nil {
			return nil, err
		}
	}

	if err := scanConfig(&cfg, priorityTagsJSON, columnHierarchyJSON, hotfixRulesJSON, reportConfigJSON); err != nil {
		return nil, err
	}

	return &cfg, nil
}

// Upsert inserts or updates a user's workflow config for a specific source
func (r *WorkflowConfigRepository) Upsert(ctx context.Context, userID, source string, cfg *models.WorkflowConfig) error {
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
		INSERT INTO workflow_config (id, user_id, pm_source, priority_tags, column_hierarchy, hotfix_rules, report_config, updated_at)
		VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, NOW())
		ON CONFLICT (user_id, pm_source) WHERE user_id IS NOT NULL AND pm_source IS NOT NULL DO UPDATE SET
			priority_tags = $3,
			column_hierarchy = $4,
			hotfix_rules = $5,
			report_config = $6,
			updated_at = NOW()
	`, userID, source, priorityTagsJSON, columnHierarchyJSON, hotfixRulesJSON, reportConfigJSON)

	if err == nil {
		clearCache(userID, source)
	}
	return err
}

// UpsertPriorityTags updates only the priority_tags field for a given source
func (r *WorkflowConfigRepository) UpsertPriorityTags(ctx context.Context, userID, source string, tags []models.PriorityTag) error {
	cfg, err := r.GetEffective(ctx, userID, source)
	if err != nil {
		return err
	}
	cfg.PriorityTags = tags
	return r.Upsert(ctx, userID, source, cfg)
}

// UpsertColumnHierarchy updates only the column_hierarchy field for a given source
func (r *WorkflowConfigRepository) UpsertColumnHierarchy(ctx context.Context, userID, source string, columns []models.ColumnState) error {
	cfg, err := r.GetEffective(ctx, userID, source)
	if err != nil {
		return err
	}
	cfg.ColumnHierarchy = columns
	return r.Upsert(ctx, userID, source, cfg)
}

// UpsertHotfixRules updates only the hotfix_rules field for a given source
func (r *WorkflowConfigRepository) UpsertHotfixRules(ctx context.Context, userID, source string, rules models.HotfixRules) error {
	cfg, err := r.GetEffective(ctx, userID, source)
	if err != nil {
		return err
	}
	cfg.HotfixRules = rules
	return r.Upsert(ctx, userID, source, cfg)
}

// UpsertReportConfig updates only the report_config field for a given source
func (r *WorkflowConfigRepository) UpsertReportConfig(ctx context.Context, userID, source string, rc models.ReportConfig) error {
	cfg, err := r.GetEffective(ctx, userID, source)
	if err != nil {
		return err
	}
	cfg.ReportConfig = rc
	return r.Upsert(ctx, userID, source, cfg)
}

// ResetToDefault deletes the user's config for a specific source, falling back to the global default
func (r *WorkflowConfigRepository) ResetToDefault(ctx context.Context, userID, source string) error {
	pool := GetPool()
	_, err := pool.Exec(ctx, `DELETE FROM workflow_config WHERE user_id = $1 AND pm_source = $2`, userID, source)
	if err == nil {
		clearCache(userID, source)
	}
	return err
}
