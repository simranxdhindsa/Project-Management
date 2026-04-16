package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/dhindsa/project-management/internal/database"
	"github.com/dhindsa/project-management/internal/middleware"
	"github.com/gorilla/mux"
)

type DayTrackHandler struct {
	repo *database.DayTrackRepository
}

func NewDayTrackHandler() *DayTrackHandler {
	return &DayTrackHandler{repo: database.NewDayTrackRepository()}
}

func dtJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

// ── Entries ───────────────────────────────────────────────────────────────────

func (h *DayTrackHandler) GetEntries(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	date := r.URL.Query().Get("date")
	if date == "" {
		http.Error(w, "date required", http.StatusBadRequest)
		return
	}
	entries, err := h.repo.GetEntries(r.Context(), userID, date)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	dtJSON(w, entries)
}

func (h *DayTrackHandler) CreateEntry(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	var body struct {
		Date         string `json:"entry_date"`
		Name         string `json:"name"`
		Category     string `json:"category"`
		StartTime    string `json:"start_time"`
		EndTime      string `json:"end_time"`
		DurationMins *int   `json:"duration_mins"`
		Notes        string `json:"notes"`
		Status       string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if body.Name == "" || body.Date == "" {
		http.Error(w, "name and entry_date required", http.StatusBadRequest)
		return
	}
	if body.Category == "" {
		body.Category = "General"
	}
	if body.Status == "" {
		body.Status = "done"
	}
	entry, err := h.repo.CreateEntry(r.Context(), userID, body.Date, body.Name, body.Category, body.StartTime, body.EndTime, body.DurationMins, body.Notes, body.Status)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(entry)
}

func (h *DayTrackHandler) UpdateEntry(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	id := mux.Vars(r)["id"]
	var body struct {
		Name         string `json:"name"`
		Category     string `json:"category"`
		StartTime    string `json:"start_time"`
		EndTime      string `json:"end_time"`
		DurationMins *int   `json:"duration_mins"`
		Notes        string `json:"notes"`
		Status       string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	entry, err := h.repo.UpdateEntry(r.Context(), id, userID, body.Name, body.Category, body.StartTime, body.EndTime, body.DurationMins, body.Notes, body.Status)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	dtJSON(w, entry)
}

func (h *DayTrackHandler) DeleteEntry(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	id := mux.Vars(r)["id"]
	if err := h.repo.DeleteEntry(r.Context(), id, userID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── Planned ───────────────────────────────────────────────────────────────────

func (h *DayTrackHandler) GetPlanned(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	date := r.URL.Query().Get("date")
	if date == "" {
		http.Error(w, "date required", http.StatusBadRequest)
		return
	}
	items, err := h.repo.GetPlanned(r.Context(), userID, date)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	dtJSON(w, items)
}

func (h *DayTrackHandler) CreatePlanned(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	var body struct {
		Date          string `json:"entry_date"`
		Name          string `json:"name"`
		Category      string `json:"category"`
		ScheduledTime string `json:"scheduled_time"`
		WhenType      string `json:"when_type"`
		Notes         string `json:"notes"`
		Status        string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if body.Name == "" || body.Date == "" {
		http.Error(w, "name and entry_date required", http.StatusBadRequest)
		return
	}
	if body.Category == "" {
		body.Category = "General"
	}
	if body.WhenType == "" {
		body.WhenType = "today"
	}
	if body.Status == "" {
		body.Status = "planned"
	}
	item, err := h.repo.CreatePlanned(r.Context(), userID, body.Date, body.Name, body.Category, body.ScheduledTime, body.WhenType, body.Notes, body.Status)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(item)
}

func (h *DayTrackHandler) UpdatePlanned(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	id := mux.Vars(r)["id"]
	var body struct {
		Name          string `json:"name"`
		Category      string `json:"category"`
		ScheduledTime string `json:"scheduled_time"`
		WhenType      string `json:"when_type"`
		Notes         string `json:"notes"`
		Status        string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	item, err := h.repo.UpdatePlanned(r.Context(), id, userID, body.Name, body.Category, body.ScheduledTime, body.WhenType, body.Notes, body.Status)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	dtJSON(w, item)
}

func (h *DayTrackHandler) DeletePlanned(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	id := mux.Vars(r)["id"]
	if err := h.repo.DeletePlanned(r.Context(), id, userID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── Categories ────────────────────────────────────────────────────────────────

func (h *DayTrackHandler) GetCategories(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	cats, err := h.repo.GetCategories(r.Context(), userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if cats == nil {
		cats = []string{}
	}
	dtJSON(w, cats)
}

func (h *DayTrackHandler) AddCategory(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		http.Error(w, "name required", http.StatusBadRequest)
		return
	}
	if err := h.repo.AddCategory(r.Context(), userID, name); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"name": name})
}

func (h *DayTrackHandler) DeleteCategory(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	name := mux.Vars(r)["name"]
	if err := h.repo.DeleteCategory(r.Context(), userID, name); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
