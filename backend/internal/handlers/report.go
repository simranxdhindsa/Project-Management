package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/dhindsa/project-management/internal/database"
	"github.com/dhindsa/project-management/internal/middleware"
	"github.com/dhindsa/project-management/internal/models"
	"github.com/dhindsa/project-management/internal/services/youtrack"
	"github.com/gorilla/mux"
)

// ReportHandler handles PM reporting endpoints
type ReportHandler struct {
	reportRepo   *database.ReportRepository
	configRepo   *database.WorkflowConfigRepository
	notifHandler *NotificationHandler
}

// NewReportHandler creates a new ReportHandler
func NewReportHandler(notifHandler *NotificationHandler) *ReportHandler {
	return &ReportHandler{
		reportRepo:   database.NewReportRepository(),
		configRepo:   database.NewWorkflowConfigRepository(),
		notifHandler: notifHandler,
	}
}

// getYouTrackClient builds a YouTrack client from env settings
func (h *ReportHandler) getYouTrackClient(ctx context.Context) (*youtrack.Client, error) {
	baseURL := os.Getenv("YOUTRACK_BASE_URL")
	token := os.Getenv("YOUTRACK_TOKEN")
	projectID := os.Getenv("YOUTRACK_PROJECT_ID")
	if baseURL == "" || token == "" || projectID == "" {
		return nil, fmt.Errorf("YouTrack not configured (YOUTRACK_BASE_URL, YOUTRACK_TOKEN, YOUTRACK_PROJECT_ID)")
	}
	return youtrack.NewClient(baseURL, token, projectID), nil
}

// extractPriority extracts priority from a ticket summary using the P0/P1/P2/P3 prefix convention.
// Kept as fallback; prefer extractPriorityFromConfig when config is available.
func extractPriority(summary string) string {
	for _, p := range []string{"P0 ", "P1 ", "P2 ", "P3 "} {
		if strings.HasPrefix(summary, p) {
			return strings.TrimSuffix(p, " ")
		}
	}
	return "Other"
}

// loadWorkflowConfig loads the effective workflow config for a user, with graceful fallback.
func (h *ReportHandler) loadWorkflowConfig(ctx context.Context, userID string) *models.WorkflowConfig {
	if h.configRepo == nil {
		return nil
	}
	cfg, err := h.configRepo.GetEffective(ctx, userID)
	if err != nil {
		return nil
	}
	return cfg
}

// GeneratePMReport generates a Slack-style PM report for a given date and saves it
// GET /api/reports/pm-report/{date}?scope=full|summary
func (h *ReportHandler) GeneratePMReport(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	vars := mux.Vars(r)
	date := vars["date"] // YYYY-MM-DD
	if date == "" {
		date = time.Now().Format("2006-01-02")
	}

	// scope=summary → only done tickets; scope=full (default) → complete report
	scope := r.URL.Query().Get("scope")
	if scope != "summary" {
		scope = "full"
	}

	// Parse date for display
	parsedDate, err := time.Parse("2006-01-02", date)
	if err != nil {
		sendJSON(w, http.StatusBadRequest, Response{Success: false, Message: "Invalid date format (use YYYY-MM-DD)"})
		return
	}

	// Yesterday for "done" tickets
	yesterday := parsedDate.AddDate(0, 0, -1).Format("2006-01-02")

	// Load workflow config for this user (drives done states, hotfix rules, priority tags, open states)
	wfCfg := h.loadWorkflowConfig(r.Context(), user.ID)
	doneStates := []string{"dev"}
	hotfixFromStates := []string{"backlog", "in progress"}
	hotfixToStates := []string{"ready for stage", "stage", "ready for prod", "prod"}
	openStates := []string{"In Progress", "Backlog", "Ready for Stage", "STAGE", "Ready for PROD", "PROD", "Findings", "Mobile DONE"}
	blockedStates := []string{"Blocked"}
	priorityTags := []models.PriorityTag{}
	if wfCfg != nil {
		doneStates = getDoneStates(wfCfg)
		hotfixFromStates = getHotfixFromStates(wfCfg)
		hotfixToStates = getHotfixToStates(wfCfg)
		if len(wfCfg.ReportConfig.OpenStates) > 0 {
			openStates = wfCfg.ReportConfig.OpenStates
		}
		if len(wfCfg.ReportConfig.BlockedStates) > 0 {
			blockedStates = wfCfg.ReportConfig.BlockedStates
		}
		priorityTags = wfCfg.PriorityTags
	}

	// --- 1. Done tickets ---
	doneIssues, err := h.reportRepo.GetDoneIssues(r.Context(), yesterday, doneStates)
	if err != nil {
		doneIssues = nil // non-fatal
	}

	// --- 1b. Hotfix tickets ---
	hotfixIssues, err := h.reportRepo.GetHotfixIssues(r.Context(), yesterday, hotfixFromStates, hotfixToStates)
	if err != nil {
		hotfixIssues = nil // non-fatal
	}

	// --- 2. Open + Blocked tickets from YouTrack live (full scope only) ---
	var openIssues []youtrack.Issue
	var blockedIssues []youtrack.Issue
	var ytErr error

	if scope == "full" {
		var ytClient *youtrack.Client
		ytClient, ytErr = h.getYouTrackClient(r.Context())
		if ytErr == nil {
			open, err := ytClient.GetIssuesByState(r.Context(), openStates)
			if err == nil {
				openIssues = open
			}
			blocked, err := ytClient.GetIssuesByState(r.Context(), blockedStates)
			if err == nil {
				blockedIssues = blocked
			}
		}
	}

	// --- 3. Build Slack-style message ---
	var sb strings.Builder

	// Done section — always included
	doneLabel := parsedDate.AddDate(0, 0, -1).Format("Mon, Jan 2")
	if scope == "summary" {
		sb.WriteString(fmt.Sprintf("*Summary — Tickets Done %s:*\n\n", doneLabel))
	} else {
		sb.WriteString(fmt.Sprintf("*Tickets Done %s:*\n\n", doneLabel))
	}

	if len(doneIssues) == 0 {
		sb.WriteString("_No tickets moved to DEV yesterday_\n")
	} else {
		if scope == "summary" {
			// Group by assignee for summary view
			type assigneeGroup struct {
				name   string
				issues []database.IssueStateLog
			}
			var groups []assigneeGroup
			assigneeIdx := map[string]int{}
			for _, issue := range doneIssues {
				name := issue.Assignee
				if name == "" {
					name = "Unassigned"
				}
				if idx, ok := assigneeIdx[name]; ok {
					groups[idx].issues = append(groups[idx].issues, issue)
				} else {
					assigneeIdx[name] = len(groups)
					groups = append(groups, assigneeGroup{name: name, issues: []database.IssueStateLog{issue}})
				}
			}
			for i, g := range groups {
				if i > 0 {
					sb.WriteString("\n")
				}
				sb.WriteString(fmt.Sprintf("@%s\n", g.name))
				for _, issue := range g.issues {
					sb.WriteString(fmt.Sprintf("• %s %s\n", issue.IssueID, issue.IssueSummary))
				}
			}
		} else {
			for _, issue := range doneIssues {
				sb.WriteString(fmt.Sprintf("• %s %s\n", issue.IssueID, issue.IssueSummary))
			}
		}
	}

	// Hotfix section — always included (shown in both summary and full)
	sb.WriteString("\n\n")
	sb.WriteString("*Hotfixes deployed to STAGE/PROD:*\n\n")
	if len(hotfixIssues) == 0 {
		sb.WriteString("_No hotfixes deployed_\n")
	} else {
		for _, issue := range hotfixIssues {
			destLabels := map[string]string{"ready for stage": "Ready for Stage", "stage": "STAGE", "ready for prod": "Ready for PROD", "prod": "PROD"}
			dest := destLabels[strings.ToLower(issue.ToState)]
			if dest == "" {
				dest = issue.ToState
			}
			line := fmt.Sprintf("• %s %s _(→ %s)_", issue.IssueID, issue.IssueSummary, dest)
			if issue.Assignee != "" {
				line += fmt.Sprintf(" (Assignee: %s)", issue.Assignee)
			}
			sb.WriteString(line + "\n")
		}
	}

	// Full report sections (skipped in summary mode)
	if scope == "full" {
		sb.WriteString("\n\n")

		// Open items grouped by priority
		sb.WriteString("*These are the open items today:*\n")
		sb.WriteString("\n")

		if ytErr != nil {
			sb.WriteString(fmt.Sprintf("_Could not fetch open items: %s_\n", ytErr.Error()))
		} else if len(openIssues) == 0 {
			sb.WriteString("_No open items_\n")
		} else {
			// Group by priority using config tags (falls back to P0-P3/Other if no config)
			priorityOrder := buildPriorityOrder(priorityTags)
			if len(priorityOrder) == 0 {
				priorityOrder = []string{"P0", "P1", "P2", "P3", "Other"}
			}
			priorityGroups := make(map[string][]youtrack.Issue)
			for _, p := range priorityOrder {
				priorityGroups[p] = []youtrack.Issue{}
			}

			for _, issue := range openIssues {
				var p string
				if len(priorityTags) > 0 {
					p = extractPriorityFromConfig(issue.Summary, priorityTags)
				} else {
					p = extractPriority(issue.Summary)
				}
				if _, ok := priorityGroups[p]; !ok {
					priorityGroups["Other"] = append(priorityGroups["Other"], issue)
				} else {
					priorityGroups[p] = append(priorityGroups[p], issue)
				}
			}

			for _, p := range priorityOrder {
				issues := priorityGroups[p]
				if len(issues) == 0 {
					continue
				}
				label := p
				if p == "Other" {
					label = "Other Issues"
				}
				sb.WriteString(fmt.Sprintf("*%s:*\n", label))
				for _, issue := range issues {
					sb.WriteString(fmt.Sprintf("• %s %s\n", issue.ID, issue.Summary))
				}
				sb.WriteString("\n")
			}
		}

		// Blocked section
		sb.WriteString("*Blocked:*\n")
		sb.WriteString("\n")
		if len(blockedIssues) == 0 {
			sb.WriteString("_No blocked tickets_\n")
		} else {
			for _, issue := range blockedIssues {
				assignee := ""
				if u := youtrack.GetAssignee(issue); u != nil {
					assignee = u.FullName
					if assignee == "" {
						assignee = u.Login
					}
				}
				line := fmt.Sprintf("• %s %s", issue.ID, issue.Summary)
				if assignee != "" {
					line += fmt.Sprintf(" (Assignee: %s)", assignee)
				}
				sb.WriteString(line + "\n")
			}
		}
		sb.WriteString("\n\n")

		// --- Delayed / Overdue tickets section ---
		sb.WriteString("*Tickets Getting Delayed:*\n")
		sb.WriteString("\n")
		delayedIssues, delayErr := h.reportRepo.GetDelayedIssues(r.Context())
		if delayErr != nil || len(delayedIssues) == 0 {
			sb.WriteString("_No overdue tickets in progress_\n")
		} else {
			for _, t := range delayedIssues {
				days := int(t.TotalHours) / 24
				hours := int(t.TotalHours) % 24
				durationStr := ""
				if days > 0 {
					durationStr = fmt.Sprintf("%dd %dh", days, hours)
				} else {
					durationStr = fmt.Sprintf("%dh", int(t.TotalHours))
				}
				line := fmt.Sprintf("• %s %s", t.IssueID, t.IssueSummary)
				meta := fmt.Sprintf("In Progress: %s | Threshold: %.0fh", durationStr, t.ThresholdHours)
				if t.Assignee != "" {
					meta = fmt.Sprintf("Assignee: %s | %s", t.Assignee, meta)
				}
				if t.MovedBackCount > 0 {
					meta += fmt.Sprintf(" | Moved Back: %dx", t.MovedBackCount)
				}
				if t.TotalStints > 1 {
					meta += fmt.Sprintf(" | Stints: %d", t.TotalStints)
				}
				sb.WriteString(line + "\n")
				sb.WriteString(fmt.Sprintf("  _%s_\n", meta))
			}
		}
	}

	reportText := sb.String()

	// --- 4. Save report — type encodes both period and scope ---
	reportType := "daily-" + scope // "daily-full" or "daily-summary"
	savedReport, err := h.reportRepo.SavePMReport(
		r.Context(), date, reportType, reportText,
		len(doneIssues), len(openIssues), len(blockedIssues),
	)
	if err != nil {
		// Still return the generated text even if save fails
		sendJSON(w, http.StatusOK, Response{
			Success: true,
			Data: map[string]interface{}{
				"report_text":   reportText,
				"done_count":    len(doneIssues),
				"open_count":    len(openIssues),
				"blocked_count": len(blockedIssues),
				"date":          date,
				"saved":         false,
			},
		})
		return
	}

	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Data: map[string]interface{}{
			"id":            savedReport.ID,
			"report_text":   savedReport.ReportText,
			"done_count":    savedReport.DoneCount,
			"open_count":    savedReport.OpenCount,
			"blocked_count": savedReport.BlockedCount,
			"date":          savedReport.Date,
			"generated_at":  savedReport.GeneratedAt,
			"saved":         true,
		},
	})
}

// GetSavedReport fetches a previously saved PM report
// GET /api/reports/pm-report/{date}/saved
func (h *ReportHandler) GetSavedReport(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	vars := mux.Vars(r)
	date := vars["date"]

	report, err := h.reportRepo.GetPMReport(r.Context(), date)
	if err != nil {
		sendJSON(w, http.StatusNotFound, Response{Success: false, Message: "No saved report for " + date})
		return
	}

	sendJSON(w, http.StatusOK, Response{Success: true, Data: report})
}

// ListReports returns all saved PM reports (history)
// GET /api/reports/pm-reports
func (h *ReportHandler) ListReports(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	reports, err := h.reportRepo.ListPMReports(r.Context())
	if err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{Success: false, Message: "Failed to list reports: " + err.Error()})
		return
	}

	if reports == nil {
		reports = []database.PMReport{}
	}

	sendJSON(w, http.StatusOK, Response{Success: true, Data: reports})
}

// DeletePMReport deletes a saved PM report by ID
// DELETE /api/reports/pm-report/{id}
func (h *ReportHandler) DeletePMReport(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	vars := mux.Vars(r)
	id := vars["id"]
	if id == "" {
		sendJSON(w, http.StatusBadRequest, Response{Success: false, Message: "Missing report ID"})
		return
	}

	if err := h.reportRepo.DeletePMReport(r.Context(), id); err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{Success: false, Message: "Failed to delete report: " + err.Error()})
		return
	}

	sendJSON(w, http.StatusOK, Response{Success: true, Message: "Report deleted"})
}

// GetAssigneeStats returns per-assignee open/done/blocked counts from YouTrack + state log
// GET /api/reports/assignee-stats
func (h *ReportHandler) GetAssigneeStats(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	// DB stats (done counts + avg time from state log)
	dbStats, _ := h.reportRepo.GetAssigneeStats(r.Context())
	dbStatMap := make(map[string]*database.AssigneeStat)
	for i := range dbStats {
		dbStatMap[dbStats[i].Assignee] = &dbStats[i]
	}

	// Live YouTrack stats (open/blocked per assignee)
	type AssigneeReport struct {
		Assignee           string   `json:"assignee"`
		Open               int      `json:"open"`
		InProgress         int      `json:"in_progress"`
		Done               int      `json:"done"`
		Blocked            int      `json:"blocked"`
		AvgHoursInProgress *float64 `json:"avg_hours_in_progress"`
		Issues             []string `json:"issues"`
	}

	reportMap := make(map[string]*AssigneeReport)
	ensureAssignee := func(name string) *AssigneeReport {
		if _, ok := reportMap[name]; !ok {
			reportMap[name] = &AssigneeReport{Assignee: name}
		}
		return reportMap[name]
	}

	ytClient, ytErr := h.getYouTrackClient(r.Context())
	if ytErr == nil {
		// Open issues — use actual project state names (same set as Daily Report)
		openIssues, _ := ytClient.GetIssuesByState(r.Context(), []string{"In Progress", "Backlog", "Ready for Stage", "STAGE", "Ready for PROD", "PROD", "Findings", "Mobile DONE"})
		for _, issue := range openIssues {
			u := youtrack.GetAssignee(issue)
			name := "Unassigned"
			if u != nil {
				name = u.FullName
				if name == "" {
					name = u.Login
				}
			}
			ar := ensureAssignee(name)
			state := strings.ToLower(youtrack.GetStatus(issue))
			if strings.Contains(state, "progress") {
				ar.InProgress++
			} else {
				ar.Open++
			}
			ar.Issues = append(ar.Issues, issue.ID+" "+issue.Summary)
		}

		// Blocked issues
		blockedIssues, _ := ytClient.GetIssuesByState(r.Context(), []string{"Blocked"})
		for _, issue := range blockedIssues {
			u := youtrack.GetAssignee(issue)
			name := "Unassigned"
			if u != nil {
				name = u.FullName
				if name == "" {
					name = u.Login
				}
			}
			ensureAssignee(name).Blocked++
		}
	}

	// Merge DB done stats
	for assignee, dbStat := range dbStatMap {
		ar := ensureAssignee(assignee)
		ar.Done = dbStat.Done
		ar.AvgHoursInProgress = dbStat.AvgHoursInProgress
	}

	// Convert map to sorted slice
	var result []AssigneeReport
	for _, ar := range reportMap {
		result = append(result, *ar)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].Assignee < result[j].Assignee
	})

	sendJSON(w, http.StatusOK, Response{Success: true, Data: result})
}

// GetTimeTracking returns the time tracking table (In Progress durations per ticket)
// GET /api/reports/time-tracking?week=2026-02-16&assignee=alice,bob&priority=P0,P1
func (h *ReportHandler) GetTimeTracking(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	q := r.URL.Query()
	params := database.TimeTrackingParams{}

	// Parse week= (ISO Monday date, e.g. 2026-02-16)
	if weekStr := q.Get("week"); weekStr != "" {
		monday, err := time.Parse("2006-01-02", weekStr)
		if err == nil {
			monday = time.Date(monday.Year(), monday.Month(), monday.Day(), 0, 0, 0, 0, time.UTC)
			sunday := monday.AddDate(0, 0, 6).Add(23*time.Hour + 59*time.Minute + 59*time.Second)
			params.WeekStart = &monday
			params.WeekEnd = &sunday
		}
	}

	// Parse assignee= (comma-separated)
	if a := q.Get("assignee"); a != "" {
		for _, name := range strings.Split(a, ",") {
			if trimmed := strings.TrimSpace(strings.ToLower(name)); trimmed != "" {
				params.Assignees = append(params.Assignees, trimmed)
			}
		}
	}

	// Parse priority= (comma-separated, e.g. P0,P1)
	if p := q.Get("priority"); p != "" {
		for _, pri := range strings.Split(p, ",") {
			if trimmed := strings.TrimSpace(pri); trimmed != "" {
				params.Priorities = append(params.Priorities, trimmed)
			}
		}
	}

	// Always include pinned issues in the query so they show regardless of week
	pinnedIDs, _ := h.reportRepo.GetPinnedIssueIDs(r.Context(), user.ID)
	params.PinnedIssues = pinnedIDs

	logs, err := h.reportRepo.GetTimeTracking(r.Context(), params)
	if err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{Success: false, Message: "Failed to get time tracking: " + err.Error()})
		return
	}

	if logs == nil {
		logs = []database.IssueStateLog{}
	}

	// Load config for threshold lookups
	ttCfg := h.loadWorkflowConfig(r.Context(), user.ID)

	// Enrich with overdue flag and pinned flag
	type TimeTrackingRow struct {
		database.IssueStateLog
		Overdue        bool    `json:"overdue"`
		ThresholdHours float64 `json:"threshold_hours"`
		Pinned         bool    `json:"pinned"`
	}

	pinnedSet := make(map[string]bool, len(pinnedIDs))
	for _, id := range pinnedIDs {
		pinnedSet[id] = true
	}

	var rows []TimeTrackingRow
	for _, l := range logs {
		var threshold float64
		if ttCfg != nil && len(ttCfg.PriorityTags) > 0 {
			threshold = overdueThresholdFromConfig(l.Priority, ttCfg.PriorityTags)
		} else {
			threshold = overdueThresholdHoursForPriority(l.Priority)
		}
		overdue := l.DurationInPrevStateHours != nil && *l.DurationInPrevStateHours > threshold
		rows = append(rows, TimeTrackingRow{
			IssueStateLog:  l,
			Overdue:        overdue,
			ThresholdHours: threshold,
			Pinned:         pinnedSet[l.IssueID],
		})
	}

	sendJSON(w, http.StatusOK, Response{Success: true, Data: rows})
}

// PinIssue pins a ticket so it appears in every week view
// POST /api/reports/pins  body: {"issue_id":"ARD-628"}
func (h *ReportHandler) PinIssue(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}
	var body struct {
		IssueID string `json:"issue_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.IssueID == "" {
		sendJSON(w, http.StatusBadRequest, Response{Success: false, Message: "issue_id required"})
		return
	}
	if err := h.reportRepo.PinIssue(r.Context(), user.ID, body.IssueID); err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{Success: false, Message: "Failed to pin issue: " + err.Error()})
		return
	}
	sendJSON(w, http.StatusOK, Response{Success: true, Message: "Pinned " + body.IssueID})
}

// UnpinIssue removes a pin
// DELETE /api/reports/pins/{issueID}
func (h *ReportHandler) UnpinIssue(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}
	issueID := mux.Vars(r)["issueID"]
	if issueID == "" {
		sendJSON(w, http.StatusBadRequest, Response{Success: false, Message: "issueID required"})
		return
	}
	if err := h.reportRepo.UnpinIssue(r.Context(), user.ID, issueID); err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{Success: false, Message: "Failed to unpin: " + err.Error()})
		return
	}
	sendJSON(w, http.StatusOK, Response{Success: true, Message: "Unpinned " + issueID})
}

// GetPins returns pinned issue IDs for the current user
// GET /api/reports/pins
func (h *ReportHandler) GetPins(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}
	ids, err := h.reportRepo.GetPinnedIssueIDs(r.Context(), user.ID)
	if err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{Success: false, Message: "Failed to get pins: " + err.Error()})
		return
	}
	if ids == nil {
		ids = []string{}
	}
	sendJSON(w, http.StatusOK, Response{Success: true, Data: ids})
}

// GetIssueTimelines returns the per-issue aggregated timeline view.
// GET /api/reports/issue-timelines
func (h *ReportHandler) GetIssueTimelines(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	pinnedIDs, _ := h.reportRepo.GetPinnedIssueIDs(r.Context(), user.ID)
	dismissedSet, _ := h.reportRepo.GetDismissedAlertIDs(r.Context(), user.ID)

	timelines, err := h.reportRepo.GetIssueTimelines(r.Context(), pinnedIDs)
	if err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{Success: false, Message: "Failed to get timelines: " + err.Error()})
		return
	}
	if timelines == nil {
		timelines = []database.IssueTimeline{}
	}

	// Annotate each timeline with whether the user has dismissed its moved-back alert
	type TimelineWithDismiss struct {
		database.IssueTimeline
		AlertDismissed bool `json:"alert_dismissed"`
	}
	result := make([]TimelineWithDismiss, len(timelines))
	for i, t := range timelines {
		result[i] = TimelineWithDismiss{
			IssueTimeline:  t,
			AlertDismissed: dismissedSet[t.IssueID],
		}
	}

	sendJSON(w, http.StatusOK, Response{Success: true, Data: result})
}

// DismissAlert dismisses the moved-back alert for an issue for the current user.
// POST /api/reports/alerts/dismiss  body: {"issue_id":"..."}
func (h *ReportHandler) DismissAlert(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	var body struct {
		IssueID string `json:"issue_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.IssueID == "" {
		sendJSON(w, http.StatusBadRequest, Response{Success: false, Message: "issue_id required"})
		return
	}

	if err := h.reportRepo.DismissAlert(r.Context(), user.ID, body.IssueID); err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{Success: false, Message: "Failed to dismiss: " + err.Error()})
		return
	}
	sendJSON(w, http.StatusOK, Response{Success: true, Message: "Alert dismissed"})
}

// UndismissAlert restores a previously dismissed alert.
// DELETE /api/reports/alerts/dismiss/{issueID}
func (h *ReportHandler) UndismissAlert(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	vars := mux.Vars(r)
	issueID := vars["issueID"]
	if issueID == "" {
		sendJSON(w, http.StatusBadRequest, Response{Success: false, Message: "issueID required"})
		return
	}

	if err := h.reportRepo.UndismissAlert(r.Context(), user.ID, issueID); err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{Success: false, Message: "Failed to undismiss: " + err.Error()})
		return
	}
	sendJSON(w, http.StatusOK, Response{Success: true, Message: "Alert restored"})
}

// overdueThresholdHoursForPriority returns overdue threshold in hours based on priority
func overdueThresholdHoursForPriority(priority string) float64 {
	switch strings.ToUpper(priority) {
	case "P0", "CRITICAL":
		return 4
	case "P1":
		return 24
	case "P2":
		return 48
	default:
		return 72
	}
}

// BackfillStateLog seeds issue_state_log for tickets currently In Progress.
//
// Rationale for only seeding In Progress tickets:
//   - Backfill is meant to establish a baseline for time tracking.
//   - Only In Progress tickets have an ongoing elapsed time that matters.
//   - Seeding DEV/Done/STAGE tickets with today's timestamp would produce false
//     "done yesterday" entries in the Daily Report — we must never do that.
//   - Idempotency: if a row already exists for this issue in 'In Progress' state
//     (from a previous backfill or webhook), we skip it so we don't double-count.
//
// POST /api/reports/backfill
func (h *ReportHandler) BackfillStateLog(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	ytClient, err := h.getYouTrackClient(r.Context())
	if err != nil || ytClient == nil {
		sendJSON(w, http.StatusBadRequest, Response{Success: false, Message: "YouTrack not configured"})
		return
	}

	// Fetch only In Progress tickets — this avoids the accuracy problem of stamping
	// DEV/Done tickets with today's timestamp.
	issues, err := ytClient.GetIssuesByState(r.Context(), []string{"In Progress"})
	if err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{Success: false, Message: "Failed to fetch In Progress issues: " + err.Error()})
		return
	}

	inserted := 0
	skipped := 0
	now := time.Now()

	for _, issue := range issues {
		state := youtrack.GetStatus(issue)
		assignee := ""
		if u := youtrack.GetAssignee(issue); u != nil {
			if u.FullName != "" {
				assignee = u.FullName
			} else {
				assignee = u.Login
			}
		}
		priority := youtrack.GetPriority(issue)

		// Extract priority prefix from summary if the priority field is empty/generic
		if priority == "" || strings.EqualFold(priority, "normal") || strings.EqualFold(priority, "medium") {
			priority = extractPriority(issue.Summary)
		}

		// Idempotency: skip if a currently-active In Progress row already exists
		// (to_state = 'in progress' with no exit row yet).
		// Prevents double-counting elapsed time if backfill is run multiple times.
		alreadyTracked, _ := h.reportRepo.IsCurrentlyInProgress(r.Context(), issue.ID)
		if alreadyTracked {
			skipped++
			continue
		}

		logEntry := &database.IssueStateLog{
			IssueID:        issue.ID,
			IssueSummary:   issue.Summary,
			Assignee:       assignee,
			MovedBy:        assignee, // backfilled entries: assume self-moved (no webhook data)
			FromState:      "Backlog", // assumed prior state for In Progress tickets
			ToState:        state,
			Priority:       priority,
			TransitionedAt: now,
		}

		if err := h.reportRepo.InsertStateLog(r.Context(), logEntry); err != nil {
			skipped++
		} else {
			inserted++
		}
	}

	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Message: fmt.Sprintf("Backfill complete: %d inserted, %d skipped (already tracked)", inserted, skipped),
		Data: map[string]interface{}{
			"inserted": inserted,
			"skipped":  skipped,
			"total":    len(issues),
		},
	})
}

// ImportHistory fetches ALL state-change activities across the entire project in a
// single API call using the project-wide activitiesPage endpoint, then inserts
// each unique transition into issue_state_log. 100% accurate YouTrack timestamps,
// fully idempotent (activity ID used as dedup key in the comment field).
//
// POST /api/reports/import-history
func (h *ReportHandler) ImportHistory(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	ytClient, err := h.getYouTrackClient(r.Context())
	if err != nil || ytClient == nil {
		sendJSON(w, http.StatusBadRequest, Response{Success: false, Message: "YouTrack not configured"})
		return
	}

	// One API call for the entire project — no per-issue loops
	activities, err := ytClient.GetProjectActivities(r.Context(), 2000)
	if err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{Success: false, Message: "Failed to fetch project activities: " + err.Error()})
		return
	}

	// First pass: build assignee map per issue from Assignee activity items.
	// When field.presentation == "Assignee", added[0].name is the current assignee login.
	// We walk chronologically so the last Assignee activity wins (most recent assignment).
	assigneeByIssue := make(map[string]string) // issueID -> assignee name
	for _, act := range activities {
		if !strings.EqualFold(act.Field.Presentation, "Assignee") {
			continue
		}
		if len(act.Added) == 0 {
			continue
		}
		issueID := act.Target.IDReadable
		if issueID == "" {
			issueID = act.Target.ID
		}
		assigneeByIssue[issueID] = act.Added[0].Name
	}

	inserted := 0
	skipped := 0

	// Second pass: insert State transitions with accurate assignee data
	for _, act := range activities {
		if !strings.EqualFold(act.Field.Presentation, "State") {
			continue
		}
		if len(act.Added) == 0 || len(act.Removed) == 0 {
			continue
		}

		fromState := act.Removed[0].Name
		toState := act.Added[0].Name
		if fromState == "" || toState == "" || fromState == toState {
			continue
		}

		issueID := act.Target.IDReadable
		if issueID == "" {
			issueID = act.Target.ID
		}
		issueSummary := act.Target.Summary

		movedBy := ""
		if act.Author != nil {
			if act.Author.FullName != "" {
				movedBy = act.Author.FullName
			} else {
				movedBy = act.Author.Login
			}
		}

		// Use the most recent assignee for this issue from the Assignee activities
		assignee := assigneeByIssue[issueID]
		if assignee == "" {
			assignee = movedBy // fallback: whoever moved it
		}

		priority := extractPriority(issueSummary)
		transitionedAt := time.Unix(act.Timestamp/1000, (act.Timestamp%1000)*int64(time.Millisecond))

		logEntry := &database.IssueStateLog{
			IssueID:        issueID,
			IssueSummary:   issueSummary,
			Assignee:       assignee,
			MovedBy:        movedBy,
			FromState:      fromState,
			ToState:        toState,
			Priority:       priority,
			TransitionedAt: transitionedAt,
			Comment:        "activity:" + act.ID,
		}

		if err := h.reportRepo.InsertStateLogIfNotExists(r.Context(), logEntry, act.ID); err != nil {
			skipped++ // already exists
		} else {
			inserted++
		}
	}

	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Message: fmt.Sprintf("History import complete: %d transitions inserted, %d skipped (already exist)", inserted, skipped),
		Data: map[string]interface{}{
			"inserted":   inserted,
			"skipped":    skipped,
			"activities": len(activities),
		},
	})
}

// ReconcileStateLog checks every ticket that is currently "In Progress" in the state log
// against the live YouTrack state. If a ticket has since moved to a different state but the
// exit webhook was never received (e.g., server was down), this inserts the missing exit row
// so the time tracking table reflects reality.
//
// POST /api/reports/reconcile
func (h *ReportHandler) ReconcileStateLog(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	ytClient, err := h.getYouTrackClient(r.Context())
	if err != nil || ytClient == nil {
		sendJSON(w, http.StatusBadRequest, Response{Success: false, Message: "YouTrack not configured"})
		return
	}

	// Find all tickets that are still recorded as In Progress (no exit row)
	// by querying for InProgressOlderThan 0 hours (returns everything active)
	activeLogs, err := h.reportRepo.GetInProgressOlderThan(r.Context(), 0)
	if err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{Success: false, Message: "Failed to query active tickets: " + err.Error()})
		return
	}

	reconciled := 0
	skipped := 0
	now := time.Now()

	for _, log := range activeLogs {
		// Fetch the current live state from YouTrack
		issue, err := ytClient.GetIssue(r.Context(), log.IssueID)
		if err != nil {
			skipped++
			continue
		}

		liveState := youtrack.GetStatus(*issue)

		// If live state is still In Progress, no reconciliation needed
		if strings.EqualFold(liveState, "in progress") {
			skipped++
			continue
		}

		// The ticket has moved — insert the missing exit row
		exitLog := &database.IssueStateLog{
			IssueID:        log.IssueID,
			IssueSummary:   log.IssueSummary,
			Assignee:       log.Assignee,
			MovedBy:        log.Assignee, // unknown who moved it — attribute to assignee
			FromState:      "In Progress",
			ToState:        liveState,
			Priority:       log.Priority,
			TransitionedAt: now,
			Comment:        "(reconciled — webhook missed)",
		}

		if err := h.reportRepo.InsertStateLog(r.Context(), exitLog); err != nil {
			skipped++
		} else {
			reconciled++
		}
	}

	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Message: fmt.Sprintf("Reconcile complete: %d exit rows inserted, %d skipped", reconciled, skipped),
		Data: map[string]interface{}{
			"reconciled": reconciled,
			"skipped":    skipped,
			"checked":    len(activeLogs),
		},
	})
}

// GenerateWeeklyPMReport generates a weekly Slack-style PM report for a Mon–Sun week.
// GET /api/reports/pm-report/weekly/{weekStart}?scope=full|summary
func (h *ReportHandler) GenerateWeeklyPMReport(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	// scope=summary → only done tickets grouped by assignee; scope=full (default) → complete report
	scope := r.URL.Query().Get("scope")
	if scope != "summary" {
		scope = "full"
	}

	vars := mux.Vars(r)
	weekStartStr := vars["weekStart"] // YYYY-MM-DD

	monday, err := time.Parse("2006-01-02", weekStartStr)
	if err != nil {
		sendJSON(w, http.StatusBadRequest, Response{Success: false, Message: "Invalid weekStart (use YYYY-MM-DD Monday)"})
		return
	}

	// Snap to Monday of that week in case a non-Monday date was passed
	if monday.Weekday() != time.Monday {
		diff := int(monday.Weekday())
		if diff == 0 {
			diff = 7
		}
		monday = monday.AddDate(0, 0, 1-diff)
	}

	sunday := monday.AddDate(0, 0, 6)
	weekStartDate := monday.Format("2006-01-02")
	weekEndDate := sunday.Format("2006-01-02")

	// Load workflow config for this user
	wfCfgW := h.loadWorkflowConfig(r.Context(), user.ID)
	wDoneStates := []string{"dev"}
	wHotfixFrom := []string{"backlog", "in progress"}
	wHotfixTo := []string{"ready for stage", "stage", "ready for prod", "prod"}
	wOpenStates := []string{"In Progress", "Backlog", "Ready for Stage", "STAGE", "Ready for PROD", "PROD", "Findings", "Mobile DONE"}
	wBlockedStates := []string{"Blocked"}
	wPriorityTags := []models.PriorityTag{}
	if wfCfgW != nil {
		wDoneStates = getDoneStates(wfCfgW)
		wHotfixFrom = getHotfixFromStates(wfCfgW)
		wHotfixTo = getHotfixToStates(wfCfgW)
		if len(wfCfgW.ReportConfig.OpenStates) > 0 {
			wOpenStates = wfCfgW.ReportConfig.OpenStates
		}
		if len(wfCfgW.ReportConfig.BlockedStates) > 0 {
			wBlockedStates = wfCfgW.ReportConfig.BlockedStates
		}
		wPriorityTags = wfCfgW.PriorityTags
	}

	// --- 1. Done tickets for the full week ---
	doneIssues, err := h.reportRepo.GetDoneIssuesForWeek(r.Context(), weekStartDate, weekEndDate, wDoneStates)
	if err != nil {
		doneIssues = nil
	}

	// --- 1b. Hotfix tickets for the full week ---
	hotfixIssues, err := h.reportRepo.GetHotfixIssuesForWeek(r.Context(), weekStartDate, weekEndDate, wHotfixFrom, wHotfixTo)
	if err != nil {
		hotfixIssues = nil
	}

	// --- 2. Open + Blocked tickets from YouTrack live (full scope only) ---
	var openIssues []youtrack.Issue
	var blockedIssues []youtrack.Issue
	var ytErr error

	if scope == "full" {
		var ytClient *youtrack.Client
		ytClient, ytErr = h.getYouTrackClient(r.Context())
		if ytErr == nil {
			open, err := ytClient.GetIssuesByState(r.Context(), wOpenStates)
			if err == nil {
				openIssues = open
			}
			blocked, err := ytClient.GetIssuesByState(r.Context(), wBlockedStates)
			if err == nil {
				blockedIssues = blocked
			}
		}
	}

	// --- 3. Build Slack-style weekly message ---
	var sb strings.Builder

	weekLabel := fmt.Sprintf("Mon %s – Sun %s", monday.Format("Jan 2"), sunday.Format("Jan 2"))
	if scope == "summary" {
		sb.WriteString(fmt.Sprintf("*Summary — Tickets Done This Week (%s):*\n\n", weekLabel))
	} else {
		sb.WriteString(fmt.Sprintf("*Tickets Done This Week (%s):*\n\n", weekLabel))
	}

	if len(doneIssues) == 0 {
		sb.WriteString("_No tickets moved to DEV this week_\n")
	} else {
		// Always group by assignee for weekly (summary or full)
		currentAssignee := ""
		for _, issue := range doneIssues {
			name := issue.Assignee
			if name == "" {
				name = "Unassigned"
			}
			if name != currentAssignee {
				if currentAssignee != "" {
					sb.WriteString("\n")
				}
				sb.WriteString(fmt.Sprintf("@%s\n", name))
				currentAssignee = name
			}
			sb.WriteString(fmt.Sprintf("• %s %s\n", issue.IssueID, issue.IssueSummary))
		}
	}

	// Hotfix section — always included (shown in both summary and full)
	sb.WriteString("\n\n")
	sb.WriteString("*Hotfixes deployed to STAGE/PROD:*\n\n")
	if len(hotfixIssues) == 0 {
		sb.WriteString("_No hotfixes deployed this week_\n")
	} else {
		currentHotfixAssignee := ""
		for _, issue := range hotfixIssues {
			name := issue.Assignee
			if name == "" {
				name = "Unassigned"
			}
			if name != currentHotfixAssignee {
				if currentHotfixAssignee != "" {
					sb.WriteString("\n")
				}
				sb.WriteString(fmt.Sprintf("@%s\n", name))
				currentHotfixAssignee = name
			}
			destLabels := map[string]string{"ready for stage": "Ready for Stage", "stage": "STAGE", "ready for prod": "Ready for PROD", "prod": "PROD"}
			dest := destLabels[strings.ToLower(issue.ToState)]
			if dest == "" {
				dest = issue.ToState
			}
			sb.WriteString(fmt.Sprintf("• %s %s _(→ %s)_\n", issue.IssueID, issue.IssueSummary, dest))
		}
	}

	// Full report sections (skipped in summary mode)
	if scope == "full" {
		sb.WriteString("\n\n")

		// Open items grouped by priority — identical to daily report
		sb.WriteString("*These are the open items:*\n\n")
		if ytErr != nil {
			sb.WriteString(fmt.Sprintf("_Could not fetch open items: %s_\n", ytErr.Error()))
		} else if len(openIssues) == 0 {
			sb.WriteString("_No open items_\n")
		} else {
			priorityOrder := buildPriorityOrder(wPriorityTags)
			if len(priorityOrder) == 0 {
				priorityOrder = []string{"P0", "P1", "P2", "P3", "Other"}
			}
			priorityGroups := make(map[string][]youtrack.Issue)
			for _, p := range priorityOrder {
				priorityGroups[p] = []youtrack.Issue{}
			}
			for _, issue := range openIssues {
				var p string
				if len(wPriorityTags) > 0 {
					p = extractPriorityFromConfig(issue.Summary, wPriorityTags)
				} else {
					p = extractPriority(issue.Summary)
				}
				if _, ok := priorityGroups[p]; !ok {
					priorityGroups["Other"] = append(priorityGroups["Other"], issue)
				} else {
					priorityGroups[p] = append(priorityGroups[p], issue)
				}
			}
			for _, p := range priorityOrder {
				issues := priorityGroups[p]
				if len(issues) == 0 {
					continue
				}
				label := p
				if p == "Other" {
					label = "Other Issues"
				}
				sb.WriteString(fmt.Sprintf("*%s:*\n", label))
				for _, issue := range issues {
					sb.WriteString(fmt.Sprintf("• %s %s\n", issue.ID, issue.Summary))
				}
				sb.WriteString("\n")
			}
		}

		// Blocked section — identical to daily report
		sb.WriteString("*Blocked:*\n\n")
		if len(blockedIssues) == 0 {
			sb.WriteString("_No blocked tickets_\n")
		} else {
			for _, issue := range blockedIssues {
				assignee := ""
				if u := youtrack.GetAssignee(issue); u != nil {
					assignee = u.FullName
					if assignee == "" {
						assignee = u.Login
					}
				}
				line := fmt.Sprintf("• %s %s", issue.ID, issue.Summary)
				if assignee != "" {
					line += fmt.Sprintf(" (Assignee: %s)", assignee)
				}
				sb.WriteString(line + "\n")
			}
		}
		sb.WriteString("\n\n")

		// Delayed section — identical to daily report
		sb.WriteString("*Tickets Getting Delayed:*\n\n")
		delayedIssues, delayErr := h.reportRepo.GetDelayedIssues(r.Context())
		if delayErr != nil || len(delayedIssues) == 0 {
			sb.WriteString("_No overdue tickets in progress_\n")
		} else {
			for _, t := range delayedIssues {
				days := int(t.TotalHours) / 24
				hours := int(t.TotalHours) % 24
				durationStr := ""
				if days > 0 {
					durationStr = fmt.Sprintf("%dd %dh", days, hours)
				} else {
					durationStr = fmt.Sprintf("%dh", int(t.TotalHours))
				}
				line := fmt.Sprintf("• %s %s", t.IssueID, t.IssueSummary)
				meta := fmt.Sprintf("In Progress: %s | Threshold: %.0fh", durationStr, t.ThresholdHours)
				if t.Assignee != "" {
					meta = fmt.Sprintf("Assignee: %s | %s", t.Assignee, meta)
				}
				if t.MovedBackCount > 0 {
					meta += fmt.Sprintf(" | Moved Back: %dx", t.MovedBackCount)
				}
				if t.TotalStints > 1 {
					meta += fmt.Sprintf(" | Stints: %d", t.TotalStints)
				}
				sb.WriteString(line + "\n")
				sb.WriteString(fmt.Sprintf("  _%s_\n", meta))
			}
		}
	}

	reportText := sb.String()

	// --- 4. Save — type encodes both period and scope ---
	weeklyReportType := "weekly-" + scope // "weekly-full" or "weekly-summary"
	savedReport, err := h.reportRepo.SavePMReport(
		r.Context(), weekStartDate, weeklyReportType, reportText,
		len(doneIssues), len(openIssues), len(blockedIssues),
	)
	if err != nil {
		sendJSON(w, http.StatusOK, Response{
			Success: true,
			Data: map[string]interface{}{
				"report_text":   reportText,
				"done_count":    len(doneIssues),
				"open_count":    len(openIssues),
				"blocked_count": len(blockedIssues),
				"date":          weekStartDate,
				"report_type":   weeklyReportType,
				"saved":         false,
			},
		})
		return
	}

	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Data: map[string]interface{}{
			"id":            savedReport.ID,
			"report_text":   savedReport.ReportText,
			"report_type":   savedReport.ReportType,
			"done_count":    savedReport.DoneCount,
			"open_count":    savedReport.OpenCount,
			"blocked_count": savedReport.BlockedCount,
			"date":          savedReport.Date,
			"generated_at":  savedReport.GeneratedAt,
			"saved":         true,
		},
	})
}

// ListWeeklyReports returns all saved weekly PM reports
// GET /api/reports/pm-reports/weekly
func (h *ReportHandler) ListWeeklyReports(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	reports, err := h.reportRepo.ListWeeklyPMReports(r.Context())
	if err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{Success: false, Message: "Failed to list weekly reports: " + err.Error()})
		return
	}

	if reports == nil {
		reports = []database.PMReport{}
	}

	sendJSON(w, http.StatusOK, Response{Success: true, Data: reports})
}

// ResetStateLog deletes all rows from issue_state_log so tracking starts fresh.
// After this, only real webhook events will populate the table.
// DELETE /api/reports/reset-state-log
func (h *ReportHandler) ResetStateLog(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r)
	if user == nil {
		sendJSON(w, http.StatusUnauthorized, Response{Success: false, Message: "Unauthorized"})
		return
	}

	deleted, err := h.reportRepo.ResetStateLog(r.Context())
	if err != nil {
		sendJSON(w, http.StatusInternalServerError, Response{Success: false, Message: "Failed to reset: " + err.Error()})
		return
	}

	sendJSON(w, http.StatusOK, Response{
		Success: true,
		Message: fmt.Sprintf("State log cleared: %d rows deleted. Table is now empty — webhooks will populate it as tickets move.", deleted),
		Data:    map[string]interface{}{"deleted": deleted},
	})
}
