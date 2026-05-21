package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/dhindsa/project-management/internal/database"
	"github.com/dhindsa/project-management/internal/middleware"
	slacksvc "github.com/dhindsa/project-management/internal/services/slack"
)

// StandupCompilerHandler handles the daily update compiler feature.
type StandupCompilerHandler struct {
	integrationRepo *database.IntegrationRepository
	daytrackRepo    *database.DayTrackRepository
	slackService    *slacksvc.Service
}

func NewStandupCompilerHandler() *StandupCompilerHandler {
	return &StandupCompilerHandler{
		integrationRepo: database.NewIntegrationRepository(),
		daytrackRepo:    database.NewDayTrackRepository(),
		slackService:    slacksvc.NewService(),
	}
}

type StandupChannelRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type standupConfigRow struct {
	SourceChannels  []StandupChannelRef
	DestChannelID   string
	DestChannelName string
	TimeWindowStart string
	TimeWindowEnd   string
}

// PersonUpdate is one developer's compiled update returned as preview.
type PersonUpdate struct {
	SlackUserID string          `json:"slack_user_id"`
	DisplayName string          `json:"display_name"`
	RawText     string          `json:"raw_text"`
	Sections    []UpdateSection `json:"sections"`
	IsOwner     bool            `json:"is_owner"`
}

type UpdateSection struct {
	Label string   `json:"label"`
	Items []string `json:"items"`
}

// GetConfig returns the saved config for the logged-in user.
// GET /api/standup/config
func (h *StandupCompilerHandler) GetConfig(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	cfg, err := loadStandupConfig(r.Context(), userID)
	if err != nil {
		cfg = &standupConfigRow{
			SourceChannels:  []StandupChannelRef{},
			TimeWindowStart: "14:00",
			TimeWindowEnd:   "23:59",
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"config": map[string]interface{}{
			"source_channels":   cfg.SourceChannels,
			"dest_channel_id":   cfg.DestChannelID,
			"dest_channel_name": cfg.DestChannelName,
			"time_window_start": cfg.TimeWindowStart,
			"time_window_end":   cfg.TimeWindowEnd,
		},
	})
}

// SaveConfig upserts the compiler config for the logged-in user.
// PUT /api/standup/config
func (h *StandupCompilerHandler) SaveConfig(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var body struct {
		SourceChannels  []StandupChannelRef `json:"source_channels"`
		DestChannelID   string              `json:"dest_channel_id"`
		DestChannelName string              `json:"dest_channel_name"`
		TimeWindowStart string              `json:"time_window_start"`
		TimeWindowEnd   string              `json:"time_window_end"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	srcJSON, _ := json.Marshal(body.SourceChannels)
	pool := database.GetPool()
	_, err := pool.Exec(r.Context(), `
		INSERT INTO standup_config (user_id, source_channels, dest_channel_id, dest_channel_name, time_window_start, time_window_end)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (user_id) DO UPDATE SET
			source_channels   = EXCLUDED.source_channels,
			dest_channel_id   = EXCLUDED.dest_channel_id,
			dest_channel_name = EXCLUDED.dest_channel_name,
			time_window_start = EXCLUDED.time_window_start,
			time_window_end   = EXCLUDED.time_window_end,
			updated_at        = NOW()`,
		userID, srcJSON, body.DestChannelID, body.DestChannelName, body.TimeWindowStart, body.TimeWindowEnd)
	if err != nil {
		http.Error(w, "failed to save config: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

// Compile fetches Slack messages from all source channels within the time window,
// groups by user, runs Groq to structure each person's update, and replaces the
// logged-in user's section with their DayTrack summary.
// POST /api/standup/compile
func (h *StandupCompilerHandler) Compile(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var reqBody struct {
		Date string `json:"date"` // optional YYYY-MM-DD; defaults to today
	}
	_ = json.NewDecoder(r.Body).Decode(&reqBody)
	today := reqBody.Date
	if today == "" {
		today = time.Now().Format("2006-01-02")
	}

	cfg, err := loadStandupConfig(r.Context(), user.ID)
	if err != nil {
		http.Error(w, "no config saved — please configure the compiler first", http.StatusBadRequest)
		return
	}
	if len(cfg.SourceChannels) == 0 {
		http.Error(w, "no source channels configured", http.StatusBadRequest)
		return
	}

	integration, err := h.integrationRepo.GetSlackIntegration(r.Context(), user.ID)
	if err != nil || !integration.Connected {
		http.Error(w, "Slack not connected", http.StatusBadRequest)
		return
	}
	slackClient := slacksvc.NewClient(integration.BotToken)

	// Fetch from 14:00 today to now — anything before 2 PM is yesterday's carryover.
	// If the user configured an earlier start time (e.g. 13:00) we respect that,
	// otherwise we always floor at 14:00 so yesterday's messages are excluded.
	windowStart := cfg.TimeWindowStart
	if windowStart == "" {
		windowStart = "14:00"
	}
	// Floor at 14:00 even if config is earlier
	if floorHour, _ := time.ParseInLocation("2006-01-02 15:04", today+" 14:00", time.Local); true {
		configured, parseErr := time.ParseInLocation("2006-01-02 15:04", today+" "+windowStart, time.Local)
		if parseErr != nil || configured.Before(floorHour) {
			windowStart = "14:00"
		}
	}
	windowEnd := cfg.TimeWindowEnd
	if windowEnd == "" {
		windowEnd = "23:59"
	}

	oldest, latest, err := standupTimeWindowToUnix(today, windowStart, windowEnd)
	if err != nil {
		http.Error(w, "invalid time window: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Collect messages from all source channels, grouped by Slack user ID
	type channelDebug struct {
		ID       string `json:"id"`
		Name     string `json:"name"`
		Messages int    `json:"messages_found"`
		Error    string `json:"error,omitempty"`
	}
	var channelLog []channelDebug

	userMessages := map[string]string{}
	for _, ch := range cfg.SourceChannels {
		msgs, fetchErr := slackClient.GetChannelHistory(r.Context(), ch.ID, oldest, latest, 500)
		if fetchErr != nil {
			channelLog = append(channelLog, channelDebug{ID: ch.ID, Name: ch.Name, Error: fetchErr.Error()})
			continue
		}
		count := 0
		for _, m := range msgs {
			if m.User == "" || strings.TrimSpace(m.Text) == "" {
				continue
			}
			count++
			if existing := userMessages[m.User]; existing != "" {
				userMessages[m.User] = existing + "\n" + m.Text
			} else {
				userMessages[m.User] = m.Text
			}
		}
		channelLog = append(channelLog, channelDebug{ID: ch.ID, Name: ch.Name, Messages: count})
	}

	// Resolve the logged-in user's own Slack ID (stored alongside the integration)
	ownerSlackID := standupGetOwnerSlackID(r.Context(), user.ID, user.Email, slackClient)

	// Resolve display names for all Slack users
	displayNames := make(map[string]string, len(userMessages))
	for uid := range userMessages {
		u, resolveErr := slackClient.GetUser(r.Context(), uid)
		if resolveErr != nil || u == nil {
			displayNames[uid] = uid
			continue
		}
		name := u.Profile.DisplayName
		if name == "" {
			name = u.RealName
		}
		displayNames[uid] = name
	}

	groqKey := os.Getenv("GROQ_API_KEY")

	// Build worker list — exclude owner (their section comes from DayTrack)
	type personWork struct{ uid, rawText string }
	var workers []personWork
	for uid, text := range userMessages {
		if uid == ownerSlackID {
			continue
		}
		workers = append(workers, personWork{uid, text})
	}

	updates := make([]PersonUpdate, len(workers))
	sem := make(chan struct{}, 3) // respect Groq free-tier limit
	var wg sync.WaitGroup

	for i, pw := range workers {
		wg.Add(1)
		go func(idx int, uid, rawText string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			sections := standupGroqParse(groqKey, rawText)
			updates[idx] = PersonUpdate{
				SlackUserID: uid,
				DisplayName: displayNames[uid],
				RawText:     rawText,
				Sections:    sections,
			}
		}(i, pw.uid, pw.rawText)
	}
	wg.Wait()

	// Owner section from DayTrack
	ownerUpdate := standupBuildOwnerSection(r.Context(), user.ID, user.Name, today, groqKey)
	ownerUpdate.SlackUserID = ownerSlackID
	ownerUpdate.IsOwner = true

	// Strip empty sections across all updates
	stripEmpty := func(p *PersonUpdate) {
		out := p.Sections[:0]
		for _, sec := range p.Sections {
			if len(sec.Items) > 0 {
				out = append(out, sec)
			}
		}
		p.Sections = out
	}
	stripEmpty(&ownerUpdate)
	for i := range updates {
		stripEmpty(&updates[i])
	}

	result := append([]PersonUpdate{ownerUpdate}, updates...)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"updates": result,
		"debug": map[string]interface{}{
			"window_start":  windowStart,
			"window_end":    windowEnd,
			"oldest_unix":   oldest,
			"latest_unix":   latest,
			"channels":      channelLog,
			"owner_slack_id": ownerSlackID,
		},
	})
}

// Post formats the preview as Slack mrkdwn and posts it to the destination channel.
// POST /api/standup/post
func (h *StandupCompilerHandler) Post(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var body struct {
		Updates   []PersonUpdate `json:"updates"`
		ChannelID string         `json:"channel_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.Updates) == 0 || body.ChannelID == "" {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	text := standupFormatMrkdwn(body.Updates)
	if err := h.slackService.PostMessage(r.Context(), user.ID, body.ChannelID, text); err != nil {
		http.Error(w, "failed to post: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

// ── internal helpers ──────────────────────────────────────────────────────────

func loadStandupConfig(ctx context.Context, userID string) (*standupConfigRow, error) {
	pool := database.GetPool()
	row := pool.QueryRow(ctx,
		`SELECT source_channels, dest_channel_id, dest_channel_name, time_window_start, time_window_end
		   FROM standup_config WHERE user_id = $1`, userID)

	var cfg standupConfigRow
	var srcRaw []byte
	if err := row.Scan(&srcRaw, &cfg.DestChannelID, &cfg.DestChannelName, &cfg.TimeWindowStart, &cfg.TimeWindowEnd); err != nil {
		return nil, err
	}
	_ = json.Unmarshal(srcRaw, &cfg.SourceChannels)
	if cfg.SourceChannels == nil {
		cfg.SourceChannels = []StandupChannelRef{}
	}
	return &cfg, nil
}

func standupTimeWindowToUnix(date, startHHMM, endHHMM string) (oldest, latest int64, err error) {
	loc := time.Local
	parse := func(hhmm string) (time.Time, error) {
		return time.ParseInLocation("2006-01-02 15:04", date+" "+hhmm, loc)
	}
	s, parseErr := parse(startHHMM)
	if parseErr != nil {
		return 0, 0, parseErr
	}
	e, parseErr := parse(endHHMM)
	if parseErr != nil {
		return 0, 0, parseErr
	}
	return s.Unix(), e.Unix(), nil
}

// standupGetOwnerSlackID resolves the logged-in user's Slack user ID.
// It first checks the slack_user_id column on slack_integrations, then falls back
// to a users.lookupByEmail call.
func standupGetOwnerSlackID(ctx context.Context, userID, email string, client *slacksvc.Client) string {
	pool := database.GetPool()
	var slackUID string
	_ = pool.QueryRow(ctx,
		`SELECT COALESCE(slack_user_id, '') FROM slack_integrations WHERE user_id = $1 AND connected = true`,
		userID).Scan(&slackUID)
	if slackUID != "" {
		return slackUID
	}
	if u, err := client.GetUserByEmail(ctx, email); err == nil && u != nil {
		return u.ID
	}
	return ""
}

const standupGroqSystem = `You are a structured parser for developer standup updates.
Given a developer's raw Slack message, extract the content into labelled sections.
IMPORTANT: Preserve the exact section label wording from the original message — do NOT rename or normalise them.
For example if the message says "Done - Features / Enhancements", use that exact label, not just "Done".
Common labels you may encounter: "Done", "Done - Features / Enhancements", "Done - Bugs Fixed", "In Progress", "Moved to Dev Today", "QA Findings", "Tickets Created", "Tickets Tested", "Tickets Verified", "Blocked", "Testing", "Research", "Note".
Return ONLY valid JSON with no markdown fences: {"sections": [{"label": "Done - Features / Enhancements", "items": ["ARD-1234 FE: Fix login bug"]}, ...]}.
Preserve ticket IDs exactly (e.g. ARD-1234). Do not invent items. Keep each item to one line. If the message is unclear, return {"sections": []}.`

const standupOwnerGroqSystem = `You are a structured parser for a PM's daily standup update.
Given a list of DayTrack work entries (categories: Testing, PM, Research, Development), group them into labelled sections.
Use labels: "Done Today", "Testing", "PM", "Research", "In Progress", "Tickets Created", "Tickets Tested", "Tickets Verified".
Return ONLY valid JSON with no markdown fences: {"sections": [{"label": "Done Today", "items": ["tested X", ...]}, ...]}.
Keep each item concise. Preserve any ticket IDs (e.g. ARD-1234). Do not invent items. Only include sections that have items.`

func standupGroqParse(groqKey, rawText string) []UpdateSection {
	if groqKey == "" {
		return []UpdateSection{{Label: "Update", Items: []string{rawText}}}
	}

	const maxRetries = 4
	backoff := 2 * time.Second
	userMsg := "Developer update:\n" + rawText

	var result string
	for attempt := 0; attempt < maxRetries; attempt++ {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		var err error
		result, err = callGroqChat(ctx, groqKey, "llama-3.3-70b-versatile", standupGroqSystem, userMsg)
		cancel()
		if err == nil && strings.TrimSpace(result) != "" {
			break
		}
		if err != nil {
			lower := strings.ToLower(err.Error())
			isRate := strings.Contains(lower, "rate limit") || strings.Contains(lower, "rate_limit") ||
				strings.Contains(lower, "429") || strings.Contains(lower, "too many")
			if isRate && attempt < maxRetries-1 {
				time.Sleep(backoff)
				backoff *= 2
				continue
			}
		}
		break
	}

	var parsed struct {
		Sections []UpdateSection `json:"sections"`
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(result)), &parsed); err != nil || len(parsed.Sections) == 0 {
		return []UpdateSection{{Label: "Update", Items: []string{rawText}}}
	}
	return parsed.Sections
}

func standupBuildOwnerSection(ctx context.Context, userID, displayName, date, groqKey string) PersonUpdate {
	repo := database.NewDayTrackRepository()
	entries, err := repo.GetEntries(ctx, userID, date)
	if err != nil || len(entries) == 0 {
		return PersonUpdate{DisplayName: displayName, Sections: []UpdateSection{}}
	}

	skipCat := map[string]bool{
		"sign in": true, "sign off": true, "signing in": true, "signing off": true,
		"time on": true, "time off": true, "time on/off": true,
		"break": true, "breaks": true,
		"meeting": true, "meetings": true,
	}

	var sb strings.Builder
	for _, e := range entries {
		cat := strings.ToLower(e.Category)
		if skipCat[cat] {
			continue
		}
		sb.WriteString(fmt.Sprintf("- [%s] %s", e.Category, e.Name))
		if e.Notes != "" {
			sb.WriteString(" — " + e.Notes)
		}
		sb.WriteString("\n")
	}

	if groqKey != "" && sb.Len() > 0 {
		groqCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		raw, groqErr := callGroqChat(groqCtx, groqKey, "llama-3.3-70b-versatile", standupOwnerGroqSystem, "Work entries:\n"+sb.String())
		cancel()
		if groqErr == nil {
			var parsed struct {
				Sections []UpdateSection `json:"sections"`
			}
			if jerr := json.Unmarshal([]byte(strings.TrimSpace(raw)), &parsed); jerr == nil && len(parsed.Sections) > 0 {
				return PersonUpdate{DisplayName: displayName, Sections: parsed.Sections}
			}
		}
	}

	// Fallback: group by category directly
	sectionMap := map[string][]string{}
	order := []string{}
	catToSection := map[string]string{
		"development": "Done Today",
		"testing":     "Testing",
		"review":      "Done Today",
		"research":    "Research",
		"pm":          "PM",
	}
	for _, e := range entries {
		cat := strings.ToLower(e.Category)
		if skipCat[cat] {
			continue
		}
		sec := catToSection[cat]
		if sec == "" {
			sec = "Done Today"
		}
		if e.Status == "active" || e.Status == "in_progress" {
			sec = "In Progress"
		}
		if _, seen := sectionMap[sec]; !seen {
			order = append(order, sec)
		}
		item := e.Name
		if e.Notes != "" {
			item += " — " + e.Notes
		}
		sectionMap[sec] = append(sectionMap[sec], item)
	}

	var sections []UpdateSection
	for _, label := range order {
		sections = append(sections, UpdateSection{Label: label, Items: sectionMap[label]})
	}
	return PersonUpdate{DisplayName: displayName, Sections: sections}
}

// ── Weekly Report ─────────────────────────────────────────────────────────────

const weeklyGroqSystem = `You are a release notes compiler for a software team.
You will receive a full week of developer Slack standup messages (Monday–Friday).
Your job:
1. Collect ONLY items listed under "Done", "Done:", "DONE", "DONE:" sections.
2. Exclude everything under "In Progress", "In Progress:", "IN PROGRESS" sections.
3. Exclude entries that are purely testing/verification with NO feature value:
   - "verified tickets on stage", "verified tickets on prod", "prod testing", "stage testing"
   - "started working on X", "working on X", "begin X", "began X"
   - "Playwright tests", "scout app is online", "working on onboarding tests"
   - Any line that is only a person's name or @mention
4. Deduplicate: if the same ticket ID (e.g. ARD-1234) appears on multiple days, include it ONCE using the most descriptive line.
5. Keep non-ticket done items if they describe real work (refactors, bugfixes, feature work, infrastructure changes).
6. Do NOT include developer names.
7. Clean up language: fix obvious typos, normalise capitalisation of ticket descriptions.
8. Return ONLY valid JSON (no markdown fences): {"items": ["ARD-1234 FE: description", "Some non-ticket work done", ...]}`

// Weekly handles POST /api/standup/weekly
// Body: { week_start: "2026-05-19" }  (Monday of the target week; omit for current week)
func (h *StandupCompilerHandler) Weekly(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var body struct {
		WeekStart string `json:"week_start"` // YYYY-MM-DD of Monday
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	// Resolve target Monday
	var monday time.Time
	if body.WeekStart != "" {
		t, err := time.ParseInLocation("2006-01-02", body.WeekStart, time.Local)
		if err != nil {
			http.Error(w, "invalid week_start", http.StatusBadRequest)
			return
		}
		monday = t
	} else {
		now := time.Now()
		// Walk back to Monday
		wd := int(now.Weekday())
		if wd == 0 {
			wd = 7
		}
		monday = time.Date(now.Year(), now.Month(), now.Day()-wd+1, 0, 0, 0, 0, time.Local)
	}
	friday := monday.AddDate(0, 0, 4)

	oldest := monday.Unix()
	latest := time.Date(friday.Year(), friday.Month(), friday.Day(), 23, 59, 59, 0, time.Local).Unix()

	cfg, err := loadStandupConfig(r.Context(), user.ID)
	if err != nil || len(cfg.SourceChannels) == 0 {
		http.Error(w, "no source channels configured", http.StatusBadRequest)
		return
	}

	integration, err := h.integrationRepo.GetSlackIntegration(r.Context(), user.ID)
	if err != nil || !integration.Connected {
		http.Error(w, "Slack not connected", http.StatusBadRequest)
		return
	}
	slackClient := slacksvc.NewClient(integration.BotToken)

	// Collect all messages Mon–Fri across all channels
	var allRaw strings.Builder
	type chanDebug struct {
		ID       string `json:"id"`
		Name     string `json:"name"`
		Messages int    `json:"messages_found"`
		Error    string `json:"error,omitempty"`
	}
	var channelLog []chanDebug

	for _, ch := range cfg.SourceChannels {
		msgs, fetchErr := slackClient.GetChannelHistory(r.Context(), ch.ID, oldest, latest, 1000)
		if fetchErr != nil {
			channelLog = append(channelLog, chanDebug{ID: ch.ID, Name: ch.Name, Error: "slack API error: " + fetchErr.Error()})
			continue
		}
		count := 0
		for _, m := range msgs {
			if m.User == "" || strings.TrimSpace(m.Text) == "" {
				continue
			}
			allRaw.WriteString(m.Text + "\n\n")
			count++
		}
		channelLog = append(channelLog, chanDebug{ID: ch.ID, Name: ch.Name, Messages: count})
	}

	groqKey := os.Getenv("GROQ_API_KEY")
	var items []string

	if allRaw.Len() == 0 {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"items":   []string{},
			"week_start": monday.Format("2006-01-02"),
			"week_end":   friday.Format("2006-01-02"),
			"debug":      map[string]interface{}{"channels": channelLog},
		})
		return
	}

	// Groq call — potentially large, so chunk if needed (max ~8k tokens of input)
	rawText := allRaw.String()
	const maxChunk = 12000 // chars
	if len(rawText) > maxChunk {
		// Split into chunks, collect items from each, deduplicate at end
		seen := map[string]bool{}
		for start := 0; start < len(rawText); start += maxChunk {
			end := start + maxChunk
			if end > len(rawText) {
				end = len(rawText)
			}
			chunk := rawText[start:end]
			chunkItems := weeklyGroqCall(groqKey, chunk)
			for _, it := range chunkItems {
				key := strings.ToLower(strings.TrimSpace(it))
				if !seen[key] {
					seen[key] = true
					items = append(items, it)
				}
			}
		}
	} else {
		items = weeklyGroqCall(groqKey, rawText)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":    true,
		"items":      items,
		"week_start": monday.Format("2006-01-02"),
		"week_end":   friday.Format("2006-01-02"),
		"debug":      map[string]interface{}{"channels": channelLog},
	})
}

func weeklyGroqCall(groqKey, rawText string) []string {
	if groqKey == "" {
		return nil
	}
	const maxRetries = 4
	backoff := 2 * time.Second
	var result string
	for attempt := 0; attempt < maxRetries; attempt++ {
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		var err error
		result, err = callGroqChat(ctx, groqKey, "llama-3.3-70b-versatile", weeklyGroqSystem,
			"Week standup messages:\n\n"+rawText)
		cancel()
		if err == nil && strings.TrimSpace(result) != "" {
			break
		}
		if err != nil {
			lower := strings.ToLower(err.Error())
			isRate := strings.Contains(lower, "rate limit") || strings.Contains(lower, "429") || strings.Contains(lower, "too many")
			if isRate && attempt < maxRetries-1 {
				time.Sleep(backoff)
				backoff *= 2
				continue
			}
		}
		break
	}
	var parsed struct {
		Items []string `json:"items"`
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(result)), &parsed); err != nil {
		return nil
	}
	return parsed.Items
}

func standupFormatMrkdwn(updates []PersonUpdate) string {
	var sb strings.Builder
	for i, u := range updates {
		if i > 0 {
			sb.WriteString("\n\n") // blank line between people
		}
		sb.WriteString(fmt.Sprintf("*%s*\n", u.DisplayName))
		for _, sec := range u.Sections {
			if len(sec.Items) == 0 {
				continue
			}
			// Don't double-up the colon if label already ends with one
			label := sec.Label
			if !strings.HasSuffix(label, ":") {
				label += ":"
			}
			sb.WriteString(label + "\n")
			for _, item := range sec.Items {
				sb.WriteString("• " + item + "\n")
			}
		}
	}
	return strings.TrimRight(sb.String(), "\n")
}
