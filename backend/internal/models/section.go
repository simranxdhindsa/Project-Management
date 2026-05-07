package models

import "time"

// AsanaSection represents a section (column) from an Asana project
type AsanaSection struct {
	ID              string     `json:"id"`
	ProjectID       string     `json:"project_id"`
	AsanaSectionGID string     `json:"asana_section_gid"`
	Name            string     `json:"name"`
	Position        int        `json:"position"`
	Color           *string    `json:"color,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

// SectionResponse is the API response format for sections
type SectionResponse struct {
	GID      string `json:"gid"`
	Name     string `json:"name"`
	Position int    `json:"position"`
	Color    string `json:"color,omitempty"`
}

// ToResponse converts an AsanaSection to the API response format
func (s *AsanaSection) ToResponse() SectionResponse {
	color := ""
	if s.Color != nil {
		color = *s.Color
	}
	return SectionResponse{
		GID:      s.AsanaSectionGID,
		Name:     s.Name,
		Position: s.Position,
		Color:    color,
	}
}
