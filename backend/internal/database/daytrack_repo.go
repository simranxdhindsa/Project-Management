package database

import (
	"context"
	"time"
)

// ── Models ────────────────────────────────────────────────────────────────────

type DayTrackEntry struct {
	ID            string     `json:"id"`
	UserID        string     `json:"user_id"`
	EntryDate     string     `json:"entry_date"` // YYYY-MM-DD
	Name          string     `json:"name"`
	Category      string     `json:"category"`
	StartTime     string     `json:"start_time"`
	EndTime       string     `json:"end_time"`
	DurationMins  *int       `json:"duration_mins"`
	Notes         string     `json:"notes"`
	Status        string     `json:"status"`
	ParentEntryID *string    `json:"parent_entry_id"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

type DayTrackPlanned struct {
	ID            string    `json:"id"`
	UserID        string    `json:"user_id"`
	EntryDate     string    `json:"entry_date"`
	Name          string    `json:"name"`
	Category      string    `json:"category"`
	ScheduledTime string    `json:"scheduled_time"`
	StartTime     string    `json:"start_time"`
	EndTime       string    `json:"end_time"`
	WhenType      string    `json:"when_type"` // today | tomorrow
	Notes         string    `json:"notes"`
	Status        string    `json:"status"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type DayTrackRepository struct{}

func NewDayTrackRepository() *DayTrackRepository { return &DayTrackRepository{} }

// ── Entries ───────────────────────────────────────────────────────────────────

func (r *DayTrackRepository) GetEntries(ctx context.Context, userID, date string) ([]DayTrackEntry, error) {
	pool := GetPool()
	rows, err := pool.Query(ctx,
		`SELECT id, user_id, entry_date::text, name, category, COALESCE(start_time,''), COALESCE(end_time,''),
		        duration_mins, COALESCE(notes,''), status, parent_entry_id, created_at, updated_at
		 FROM daytrack_entries WHERE user_id=$1 AND entry_date=$2::date ORDER BY created_at DESC`,
		userID, date)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var entries []DayTrackEntry
	for rows.Next() {
		var e DayTrackEntry
		if err := rows.Scan(&e.ID, &e.UserID, &e.EntryDate, &e.Name, &e.Category,
			&e.StartTime, &e.EndTime, &e.DurationMins, &e.Notes, &e.Status, &e.ParentEntryID, &e.CreatedAt, &e.UpdatedAt); err != nil {
			return nil, err
		}
		entries = append(entries, e)
	}
	if entries == nil {
		entries = []DayTrackEntry{}
	}
	return entries, nil
}

func (r *DayTrackRepository) CreateEntry(ctx context.Context, userID, date, name, category, startTime, endTime string, durationMins *int, notes, status string, parentEntryID *string) (*DayTrackEntry, error) {
	pool := GetPool()
	var e DayTrackEntry
	err := pool.QueryRow(ctx,
		`INSERT INTO daytrack_entries (user_id, entry_date, name, category, start_time, end_time, duration_mins, notes, status, parent_entry_id)
		 VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10)
		 RETURNING id, user_id, entry_date::text, name, category, COALESCE(start_time,''), COALESCE(end_time,''),
		           duration_mins, COALESCE(notes,''), status, parent_entry_id, created_at, updated_at`,
		userID, date, name, category, nullStr(startTime), nullStr(endTime), durationMins, notes, status, parentEntryID,
	).Scan(&e.ID, &e.UserID, &e.EntryDate, &e.Name, &e.Category,
		&e.StartTime, &e.EndTime, &e.DurationMins, &e.Notes, &e.Status, &e.ParentEntryID, &e.CreatedAt, &e.UpdatedAt)
	return &e, err
}

func (r *DayTrackRepository) UpdateEntry(ctx context.Context, id, userID, name, category, startTime, endTime string, durationMins *int, notes, status string) (*DayTrackEntry, error) {
	pool := GetPool()
	var e DayTrackEntry
	err := pool.QueryRow(ctx,
		`UPDATE daytrack_entries SET name=$3, category=$4, start_time=$5, end_time=$6, duration_mins=$7, notes=$8, status=$9, updated_at=NOW()
		 WHERE id=$1 AND user_id=$2
		 RETURNING id, user_id, entry_date::text, name, category, COALESCE(start_time,''), COALESCE(end_time,''),
		           duration_mins, COALESCE(notes,''), status, parent_entry_id, created_at, updated_at`,
		id, userID, name, category, nullStr(startTime), nullStr(endTime), durationMins, notes, status,
	).Scan(&e.ID, &e.UserID, &e.EntryDate, &e.Name, &e.Category,
		&e.StartTime, &e.EndTime, &e.DurationMins, &e.Notes, &e.Status, &e.ParentEntryID, &e.CreatedAt, &e.UpdatedAt)
	return &e, err
}

func (r *DayTrackRepository) DeleteEntry(ctx context.Context, id, userID string) error {
	pool := GetPool()
	_, err := pool.Exec(ctx, `DELETE FROM daytrack_entries WHERE id=$1 AND user_id=$2`, id, userID)
	return err
}

func (r *DayTrackRepository) GetEntryByID(ctx context.Context, id, userID string) (*DayTrackEntry, error) {
	pool := GetPool()
	var e DayTrackEntry
	err := pool.QueryRow(ctx,
		`SELECT id, user_id, entry_date::text, name, category, COALESCE(start_time,''), COALESCE(end_time,''),
		        duration_mins, COALESCE(notes,''), status, parent_entry_id, created_at, updated_at
		 FROM daytrack_entries WHERE id=$1 AND user_id=$2`,
		id, userID,
	).Scan(&e.ID, &e.UserID, &e.EntryDate, &e.Name, &e.Category,
		&e.StartTime, &e.EndTime, &e.DurationMins, &e.Notes, &e.Status, &e.ParentEntryID, &e.CreatedAt, &e.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &e, nil
}

// ── Planned ───────────────────────────────────────────────────────────────────

func (r *DayTrackRepository) GetPlanned(ctx context.Context, userID, date string) ([]DayTrackPlanned, error) {
	pool := GetPool()
	rows, err := pool.Query(ctx,
		`SELECT id, user_id, entry_date::text, name, category, COALESCE(scheduled_time,''),
		        COALESCE(start_time,''), COALESCE(end_time,''),
		        when_type, COALESCE(notes,''), status, created_at, updated_at
		 FROM daytrack_planned WHERE user_id=$1 AND entry_date=$2::date ORDER BY created_at DESC`,
		userID, date)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []DayTrackPlanned
	for rows.Next() {
		var p DayTrackPlanned
		if err := rows.Scan(&p.ID, &p.UserID, &p.EntryDate, &p.Name, &p.Category,
			&p.ScheduledTime, &p.StartTime, &p.EndTime, &p.WhenType, &p.Notes, &p.Status, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, p)
	}
	if items == nil {
		items = []DayTrackPlanned{}
	}
	return items, nil
}

func (r *DayTrackRepository) CreatePlanned(ctx context.Context, userID, date, name, category, scheduledTime, startTime, endTime, whenType, notes, status string) (*DayTrackPlanned, error) {
	pool := GetPool()
	var p DayTrackPlanned
	err := pool.QueryRow(ctx,
		`INSERT INTO daytrack_planned (user_id, entry_date, name, category, scheduled_time, start_time, end_time, when_type, notes, status)
		 VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10)
		 RETURNING id, user_id, entry_date::text, name, category, COALESCE(scheduled_time,''),
		           COALESCE(start_time,''), COALESCE(end_time,''), when_type, COALESCE(notes,''), status, created_at, updated_at`,
		userID, date, name, category, nullStr(scheduledTime), nullStr(startTime), nullStr(endTime), whenType, notes, status,
	).Scan(&p.ID, &p.UserID, &p.EntryDate, &p.Name, &p.Category,
		&p.ScheduledTime, &p.StartTime, &p.EndTime, &p.WhenType, &p.Notes, &p.Status, &p.CreatedAt, &p.UpdatedAt)
	return &p, err
}

func (r *DayTrackRepository) UpdatePlanned(ctx context.Context, id, userID, name, category, scheduledTime, startTime, endTime, whenType, notes, status string) (*DayTrackPlanned, error) {
	pool := GetPool()
	var p DayTrackPlanned
	err := pool.QueryRow(ctx,
		`UPDATE daytrack_planned SET name=$3, category=$4, scheduled_time=$5, start_time=$6, end_time=$7, when_type=$8, notes=$9, status=$10, updated_at=NOW()
		 WHERE id=$1 AND user_id=$2
		 RETURNING id, user_id, entry_date::text, name, category, COALESCE(scheduled_time,''),
		           COALESCE(start_time,''), COALESCE(end_time,''), when_type, COALESCE(notes,''), status, created_at, updated_at`,
		id, userID, name, category, nullStr(scheduledTime), nullStr(startTime), nullStr(endTime), whenType, notes, status,
	).Scan(&p.ID, &p.UserID, &p.EntryDate, &p.Name, &p.Category,
		&p.ScheduledTime, &p.StartTime, &p.EndTime, &p.WhenType, &p.Notes, &p.Status, &p.CreatedAt, &p.UpdatedAt)
	return &p, err
}

func (r *DayTrackRepository) DeletePlanned(ctx context.Context, id, userID string) error {
	pool := GetPool()
	_, err := pool.Exec(ctx, `DELETE FROM daytrack_planned WHERE id=$1 AND user_id=$2`, id, userID)
	return err
}

// ── Range export ─────────────────────────────────────────────────────────────

func (r *DayTrackRepository) GetEntriesRange(ctx context.Context, userID, startDate, endDate string) ([]DayTrackEntry, error) {
	pool := GetPool()
	rows, err := pool.Query(ctx,
		`SELECT id, user_id, entry_date::text, name, category, COALESCE(start_time,''), COALESCE(end_time,''),
		        duration_mins, COALESCE(notes,''), status, parent_entry_id, created_at, updated_at
		 FROM daytrack_entries
		 WHERE user_id=$1 AND entry_date BETWEEN $2::date AND $3::date
		 ORDER BY entry_date ASC, created_at ASC`,
		userID, startDate, endDate)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var entries []DayTrackEntry
	for rows.Next() {
		var e DayTrackEntry
		if err := rows.Scan(&e.ID, &e.UserID, &e.EntryDate, &e.Name, &e.Category,
			&e.StartTime, &e.EndTime, &e.DurationMins, &e.Notes, &e.Status, &e.ParentEntryID, &e.CreatedAt, &e.UpdatedAt); err != nil {
			return nil, err
		}
		entries = append(entries, e)
	}
	if entries == nil {
		entries = []DayTrackEntry{}
	}
	return entries, nil
}

// ── Categories ────────────────────────────────────────────────────────────────

func (r *DayTrackRepository) GetCategories(ctx context.Context, userID string) ([]string, error) {
	pool := GetPool()
	rows, err := pool.Query(ctx,
		`SELECT name FROM daytrack_categories WHERE user_id=$1 ORDER BY position, name`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var cats []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		cats = append(cats, name)
	}
	return cats, nil
}

func (r *DayTrackRepository) AddCategory(ctx context.Context, userID, name string) error {
	pool := GetPool()
	_, err := pool.Exec(ctx,
		`INSERT INTO daytrack_categories (user_id, name, position)
		 VALUES ($1, $2, (SELECT COALESCE(MAX(position),0)+1 FROM daytrack_categories WHERE user_id=$1))
		 ON CONFLICT DO NOTHING`,
		userID, name)
	return err
}

func (r *DayTrackRepository) DeleteCategory(ctx context.Context, userID, name string) error {
	pool := GetPool()
	_, err := pool.Exec(ctx, `DELETE FROM daytrack_categories WHERE user_id=$1 AND name=$2`, userID, name)
	return err
}

// nullStr returns nil if s is empty, else &s — for nullable TEXT columns
func nullStr(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}
