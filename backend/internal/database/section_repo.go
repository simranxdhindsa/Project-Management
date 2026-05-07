package database

import (
	"context"
	"time"

	"github.com/dhindsa/project-management/internal/models"
)

// SectionRepository handles Asana section database operations
type SectionRepository struct{}

// NewSectionRepository creates a new SectionRepository
func NewSectionRepository() *SectionRepository {
	return &SectionRepository{}
}

// SaveSections bulk upserts sections for a project
func (r *SectionRepository) SaveSections(ctx context.Context, projectID string, sections []models.AsanaSection) error {
	pool := GetPool()
	if pool == nil {
		return nil
	}

	for i, section := range sections {
		_, err := pool.Exec(ctx, `
			INSERT INTO asana_sections (project_id, asana_section_gid, name, position, color, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			ON CONFLICT (project_id, asana_section_gid) DO UPDATE SET
				name = $3,
				position = $4,
				color = $5,
				updated_at = $7
		`, projectID, section.AsanaSectionGID, section.Name, i, section.Color, time.Now(), time.Now())

		if err != nil {
			return err
		}
	}

	return nil
}

// GetProjectSections returns all sections for a project ordered by position
func (r *SectionRepository) GetProjectSections(ctx context.Context, projectID string) ([]models.AsanaSection, error) {
	pool := GetPool()
	if pool == nil {
		return nil, nil
	}

	rows, err := pool.Query(ctx, `
		SELECT id, project_id, asana_section_gid, name, position, color, created_at, updated_at
		FROM asana_sections
		WHERE project_id = $1
		ORDER BY position ASC
	`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sections []models.AsanaSection
	for rows.Next() {
		var section models.AsanaSection
		err := rows.Scan(
			&section.ID,
			&section.ProjectID,
			&section.AsanaSectionGID,
			&section.Name,
			&section.Position,
			&section.Color,
			&section.CreatedAt,
			&section.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		sections = append(sections, section)
	}

	return sections, nil
}

// GetSectionByGID returns a section by its Asana GID
func (r *SectionRepository) GetSectionByGID(ctx context.Context, gid string) (*models.AsanaSection, error) {
	pool := GetPool()
	if pool == nil {
		return nil, nil
	}

	var section models.AsanaSection
	err := pool.QueryRow(ctx, `
		SELECT id, project_id, asana_section_gid, name, position, color, created_at, updated_at
		FROM asana_sections
		WHERE asana_section_gid = $1
	`, gid).Scan(
		&section.ID,
		&section.ProjectID,
		&section.AsanaSectionGID,
		&section.Name,
		&section.Position,
		&section.Color,
		&section.CreatedAt,
		&section.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	return &section, nil
}

// DeleteProjectSections removes all sections for a project
func (r *SectionRepository) DeleteProjectSections(ctx context.Context, projectID string) error {
	pool := GetPool()
	if pool == nil {
		return nil
	}

	_, err := pool.Exec(ctx, `DELETE FROM asana_sections WHERE project_id = $1`, projectID)
	return err
}

// GetSectionsByAsanaProjectID returns sections by the Asana project ID stored in global settings
// This is useful when we don't have a local project ID but have the Asana project GID
func (r *SectionRepository) GetSectionsByAsanaProjectGID(ctx context.Context, asanaProjectGID string) ([]models.AsanaSection, error) {
	pool := GetPool()
	if pool == nil {
		return nil, nil
	}

	// First find the project by its asana_project_id
	var projectID string
	err := pool.QueryRow(ctx, `
		SELECT id FROM projects WHERE asana_project_id = $1 LIMIT 1
	`, asanaProjectGID).Scan(&projectID)
	if err != nil {
		return nil, err
	}

	return r.GetProjectSections(ctx, projectID)
}
