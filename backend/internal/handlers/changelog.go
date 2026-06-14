package handlers

import (
	"bufio"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/dhindsa/project-management/internal/database"
	"github.com/dhindsa/project-management/internal/middleware"
)

// ChangelogEntry represents one dated release block in CHANGELOG.md
type ChangelogEntry struct {
	Date         string   `json:"date"`
	Features     []string `json:"features"`
	Enhancements []string `json:"enhancements"`
	Bugs         []string `json:"bugs"`
	Refactors    []string `json:"refactors"`
}

// ChangelogStatus is the response for GET /api/changelog/status
type ChangelogStatus struct {
	HasNew     bool             `json:"has_new"`
	LatestDate string           `json:"latest_date"`
	Entries    []ChangelogEntry `json:"entries"`
}

// ChangelogHandler handles changelog endpoints
type ChangelogHandler struct {
	changelogPath string
}

func NewChangelogHandler() *ChangelogHandler {
	// Resolve CHANGELOG.md relative to the binary's working directory
	path := filepath.Join(".", "..", "CHANGELOG.md")
	if _, err := os.Stat(path); os.IsNotExist(err) {
		// Fallback: same directory as binary
		path = filepath.Join(".", "CHANGELOG.md")
	}
	return &ChangelogHandler{changelogPath: path}
}

// GetStatus returns parsed changelog entries and whether the user has unseen entries.
func (h *ChangelogHandler) GetStatus(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	entries, err := h.parseChangelog()
	if err != nil {
		http.Error(w, "failed to read changelog", http.StatusInternalServerError)
		return
	}

	var seenAt *time.Time
	row := database.GetPool().QueryRow(r.Context(),
		`SELECT changelog_seen_at FROM users WHERE id = $1`, userID)
	var t time.Time
	if err := row.Scan(&t); err == nil {
		seenAt = &t
	}

	hasNew := false
	latestDate := ""
	if len(entries) > 0 {
		latestDate = entries[0].Date
		parsed, err := time.Parse("2006-01-02", latestDate)
		if err == nil {
			if seenAt == nil || parsed.After(*seenAt) {
				hasNew = true
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(ChangelogStatus{
		HasNew:     hasNew,
		LatestDate: latestDate,
		Entries:    entries,
	})
}

// MarkSeen records that the current user has seen the changelog now.
func (h *ChangelogHandler) MarkSeen(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	_, err := database.GetPool().Exec(r.Context(),
		`UPDATE users SET changelog_seen_at = NOW() WHERE id = $1`, userID)
	if err != nil {
		http.Error(w, "failed to update seen state", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

var dateHeader = regexp.MustCompile(`^## (\d{4}-\d{2}-\d{2})`)

// parseChangelog reads and parses CHANGELOG.md into structured entries.
func (h *ChangelogHandler) parseChangelog() ([]ChangelogEntry, error) {
	f, err := os.Open(h.changelogPath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var entries []ChangelogEntry
	var current *ChangelogEntry
	var section string // "features" | "enhancements" | "bugs" | "refactors"

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()

		if m := dateHeader.FindStringSubmatch(line); m != nil {
			if current != nil {
				entries = append(entries, *current)
			}
			current = &ChangelogEntry{Date: m[1]}
			section = ""
			continue
		}

		if current == nil {
			continue
		}

		lower := strings.ToLower(line)
		switch {
		case strings.HasPrefix(lower, "### feature"):
			section = "features"
		case strings.HasPrefix(lower, "### enhancement"):
			section = "enhancements"
		case strings.HasPrefix(lower, "### bug"):
			section = "bugs"
		case strings.HasPrefix(lower, "### refactor"):
			section = "refactors"
		case strings.HasPrefix(line, "- "):
			item := strings.TrimPrefix(line, "- ")
			switch section {
			case "features":
				current.Features = append(current.Features, item)
			case "enhancements":
				current.Enhancements = append(current.Enhancements, item)
			case "bugs":
				current.Bugs = append(current.Bugs, item)
			case "refactors":
				current.Refactors = append(current.Refactors, item)
			}
		}
	}

	if current != nil {
		entries = append(entries, *current)
	}

	return entries, scanner.Err()
}
