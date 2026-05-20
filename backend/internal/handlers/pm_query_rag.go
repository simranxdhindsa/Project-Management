package handlers

// pm_query_rag.go — zero-cost retrieval for the PM assistant.
//
// Instead of dumping the entire sprint into every prompt (21K+ tokens),
// we classify the user's query and retrieve only the relevant slice:
//
//   greeting / general summary → sprint KPI stats only (~150 tokens)
//   "what is ARD-1160"         → just that one issue
//   "what is Alice doing"      → Alice's issues only
//   "who is blocked"           → only blocked-state issues
//   unrecognized               → BM25 keyword scoring, top 20 issues
//
// This keeps every prompt under ~3,000 tokens, compatible with any free model.

import (
	"fmt"
	"log"
	"math"
	"regexp"
	"sort"
	"strings"

	"github.com/dhindsa/project-management/internal/database"
	"github.com/dhindsa/project-management/internal/services/youtrack"
)

// ─── Intent types ────────────────────────────────────────────────────────────

type pmQueryIntentType string

const (
	intentGreeting        pmQueryIntentType = "greeting"
	intentSprintOverview  pmQueryIntentType = "sprint_overview" // detailed sprint summary — returns active+blocked issues
	intentIssueID         pmQueryIntentType = "issue_id"
	intentAssignee        pmQueryIntentType = "assignee"
	intentStatusFilter    pmQueryIntentType = "status_filter"
	intentTypeFilter      pmQueryIntentType = "type_filter"
	intentPriorityFilter  pmQueryIntentType = "priority_filter"
	intentGeneral         pmQueryIntentType = "general"
)

type pmQueryIntent struct {
	kind           pmQueryIntentType
	issueID        string // for intentIssueID
	assigneeName   string // for intentAssignee
	statusFilter   string // for intentStatusFilter: "blocked"|"delayed"|"done"|"in_progress"
	typeFilter     string // for intentTypeFilter: "Feature"|"Bug"|"Task"|"Hotfix"|"Regression"
	priorityFilter string // for intentPriorityFilter: "P0"|"P1"|"P2"|"Critical"
}

var (
	issueIDRe = regexp.MustCompile(`(?i)\b[A-Z]{2,10}-\d+\b`)

	greetingPhrases = []string{"hi", "hello", "hey", "howdy", "sup", "morning", "afternoon"}
	summaryPhrases  = []string{"summary", "overview", "status", "how are we", "how is the sprint", "sprint health"}
	// detailPhrases trigger a full active-issues dump rather than stats-only
	detailPhrases = []string{"breakdown", "detailed", "full", "everyone", "all assignees", "overloaded", "velocity", "workload all", "complete picture", "full breakdown"}
	blockedKW       = []string{"block", "blocked", "blocker", "stuck", "waiting", "wait"}
	delayedKW       = []string{"delay", "delayed", "overdue", "behind", "late", "slow", "risk"}
	doneKW          = []string{"done", "finished", "completed", "closed", "deployed", "verified", "shipped"}
	inProgKW        = []string{"in progress", "working on", "active", "current", "in-progress"}

	// typeKWOrder maps query keywords → canonical YouTrack Type value.
	// Ordered: multi-word phrases first, then longer single words, to avoid partial matches.
	typeKWOrder = []struct{ kw, canonical string }{
		{"hot fix", "Hotfix"},
		{"hotfixes", "Hotfix"},
		{"hotfix", "Hotfix"},
		{"regressions", "Regression"},
		{"regression", "Regression"},
		{"features", "Feature"},
		{"feature", "Feature"},
		{"defects", "Bug"},
		{"defect", "Bug"},
		{"bugs", "Bug"},
		{"bug", "Bug"},
		{"tasks", "Task"},
		{"task", "Task"},
		{"chore", "Task"},
	}

	// priorityKWOrder maps query keywords → canonical priority value.
	priorityKWOrder = []struct{ kw, canonical string }{
		{"critical", "Critical"},
		{"p0", "P0"},
		{"p1", "P1"},
		{"p2", "P2"},
		{"p3", "P3"},
		{"low priority", "P3"},
		{"high priority", "P1"},
	}

	stopwords = map[string]bool{
		"the": true, "a": true, "an": true, "is": true, "in": true,
		"of": true, "to": true, "and": true, "for": true, "on": true,
		"what": true, "who": true, "are": true, "show": true, "me": true,
		"all": true, "any": true, "do": true, "with": true, "has": true,
	}
)

// classifyPMQueryIntent inspects the raw query string and returns a structured intent.
// All entity matching (assignee names, issue IDs) is done against live sprint data.
func classifyPMQueryIntent(query string, issues []youtrack.Issue) pmQueryIntent {
	q := strings.ToLower(strings.TrimSpace(query))
	words := strings.Fields(q)

	// Short greeting check (≤6 words that start with a greeting word)
	if len(words) <= 6 {
		for _, g := range greetingPhrases {
			if strings.HasPrefix(q, g) {
				return pmQueryIntent{kind: intentGreeting}
			}
		}
	}

	// Summary / overview check — if also asking for detail, return real issues
	for _, p := range summaryPhrases {
		if strings.Contains(q, p) {
			for _, d := range detailPhrases {
				if strings.Contains(q, d) {
					return pmQueryIntent{kind: intentSprintOverview}
				}
			}
			return pmQueryIntent{kind: intentGreeting} // stats only
		}
	}
	// Standalone detail/workload requests without a summary keyword
	for _, d := range detailPhrases {
		if strings.Contains(q, d) {
			return pmQueryIntent{kind: intentSprintOverview}
		}
	}

	// Specific issue ID (e.g. ARD-1160)
	if m := issueIDRe.FindString(query); m != "" {
		return pmQueryIntent{kind: intentIssueID, issueID: strings.ToUpper(m)}
	}

	// Assignee name — match against actual people in this sprint
	assigneeIndex := buildAssigneeIndex(issues)
	for lc, full := range assigneeIndex {
		if strings.Contains(q, lc) {
			return pmQueryIntent{kind: intentAssignee, assigneeName: full}
		}
	}

	// Type filter — ordered slice ensures multi-word phrases checked first
	for _, entry := range typeKWOrder {
		if strings.Contains(q, entry.kw) {
			return pmQueryIntent{kind: intentTypeFilter, typeFilter: entry.canonical}
		}
	}

	// Priority filter
	for _, entry := range priorityKWOrder {
		if strings.Contains(q, entry.kw) {
			return pmQueryIntent{kind: intentPriorityFilter, priorityFilter: entry.canonical}
		}
	}

	// Status keywords
	for _, kw := range blockedKW {
		if strings.Contains(q, kw) {
			return pmQueryIntent{kind: intentStatusFilter, statusFilter: "blocked"}
		}
	}
	for _, kw := range delayedKW {
		if strings.Contains(q, kw) {
			return pmQueryIntent{kind: intentStatusFilter, statusFilter: "delayed"}
		}
	}
	for _, kw := range doneKW {
		if strings.Contains(q, kw) {
			return pmQueryIntent{kind: intentStatusFilter, statusFilter: "done"}
		}
	}
	for _, kw := range inProgKW {
		if strings.Contains(q, kw) {
			return pmQueryIntent{kind: intentStatusFilter, statusFilter: "in_progress"}
		}
	}

	// Dynamic state-name detection: match against actual state names present in the sprint
	// (e.g. "DEV", "Ready for Stage", "Stage", "Ready for Prod")
	if matched := findStateNameInQuery(q, issues); matched != "" {
		return pmQueryIntent{kind: intentStatusFilter, statusFilter: "state:" + matched}
	}

	return pmQueryIntent{kind: intentGeneral}
}

// findStateNameInQuery checks whether the query contains any actual state name from the sprint.
// Returns the canonical state name (original case) if found, else "".
func findStateNameInQuery(q string, issues []youtrack.Issue) string {
	seen := map[string]string{} // lowercase → original
	for _, iss := range issues {
		s := youtrack.GetStatus(iss)
		if s != "" {
			seen[strings.ToLower(s)] = s
		}
	}
	// Check multi-word states first, then single-word
	for lc, orig := range seen {
		if strings.Contains(strings.ToLower(q), lc) {
			return orig
		}
	}
	return ""
}

// countStatusKeywords counts how many distinct status categories are mentioned in the query.
// Used to detect analysis queries ("done vs blocked") vs filter queries ("features on stage").
func countStatusKeywords(q string) int {
	q = strings.ToLower(q)
	count := 0
	for _, kw := range blockedKW {
		if strings.Contains(q, kw) {
			count++
			break
		}
	}
	for _, kw := range doneKW {
		if strings.Contains(q, kw) {
			count++
			break
		}
	}
	for _, kw := range inProgKW {
		if strings.Contains(q, kw) {
			count++
			break
		}
	}
	return count
}

// detectStatusKeyword returns a status filter string if the query contains status keywords,
// without creating an intent (used for compound filtering).
func detectStatusKeyword(q string) string {
	q = strings.ToLower(q)
	for _, kw := range blockedKW {
		if strings.Contains(q, kw) {
			return "blocked"
		}
	}
	for _, kw := range doneKW {
		if strings.Contains(q, kw) {
			return "done"
		}
	}
	for _, kw := range inProgKW {
		if strings.Contains(q, kw) {
			return "in_progress"
		}
	}
	return ""
}

// buildAssigneeIndex returns a map of lowercase-name/firstname → full name for all assignees in the sprint.
func buildAssigneeIndex(issues []youtrack.Issue) map[string]string {
	idx := map[string]string{}
	for _, issue := range issues {
		a := youtrack.GetAssignee(issue)
		if a == nil || a.FullName == "" {
			continue
		}
		full := a.FullName
		idx[strings.ToLower(full)] = full
		if parts := strings.Fields(full); len(parts) > 0 {
			idx[strings.ToLower(parts[0])] = full // first name only
		}
	}
	return idx
}

// ─── Retrieval ────────────────────────────────────────────────────────────────

const (
	maxContextIssues     = 20 // BM25 general ranking cap
	maxBulkFilterIssues  = 30 // cap for type/priority/status/assignee filters
)

// retrieveRelevantIssues returns the issues relevant to the query using the classified intent.
// Returns nil for intentGreeting (caller should emit stats-only context).
func retrieveRelevantIssues(intent pmQueryIntent, query string, issues []youtrack.Issue) []youtrack.Issue {
	switch intent.kind {
	case intentGreeting:
		return nil

	case intentSprintOverview:
		// Return active/blocked/in-progress issues (skip pure backlog) up to 40
		var result []youtrack.Issue
		for _, iss := range issues {
			s := strings.ToLower(youtrack.GetStatus(iss))
			if strings.Contains(s, "progress") || strings.Contains(s, "block") ||
				strings.Contains(s, "wait") || strings.Contains(s, "dev") ||
				strings.Contains(s, "stage") || strings.Contains(s, "done") ||
				strings.Contains(s, "verif") || strings.Contains(s, "deploy") {
				result = append(result, iss)
				if len(result) >= 40 {
					break
				}
			}
		}
		return result

	case intentIssueID:
		for _, iss := range issues {
			if strings.EqualFold(iss.ID, intent.issueID) {
				return []youtrack.Issue{iss}
			}
		}
		return nil

	case intentAssignee:
		var result []youtrack.Issue
		for _, iss := range issues {
			a := youtrack.GetAssignee(iss)
			if a != nil && strings.EqualFold(a.FullName, intent.assigneeName) {
				result = append(result, iss)
				if len(result) >= maxBulkFilterIssues {
					break
				}
			}
		}
		return result

	case intentStatusFilter:
		all := filterByStatus(issues, intent.statusFilter)
		if len(all) > maxBulkFilterIssues {
			return all[:maxBulkFilterIssues]
		}
		return all

	case intentTypeFilter:
		all := filterByType(issues, intent.typeFilter)
		if len(all) > maxBulkFilterIssues {
			return all[:maxBulkFilterIssues]
		}
		return all

	case intentPriorityFilter:
		all := filterByPriority(issues, intent.priorityFilter)
		if len(all) > maxBulkFilterIssues {
			return all[:maxBulkFilterIssues]
		}
		return all

	default: // intentGeneral — BM25 ranking
		return rankByBM25(query, issues, maxContextIssues)
	}
}

func filterByStatus(issues []youtrack.Issue, filter string) []youtrack.Issue {
	// "state:XYZ" = exact dynamic state name match (from findStateNameInQuery)
	if strings.HasPrefix(filter, "state:") {
		stateName := strings.ToLower(strings.TrimPrefix(filter, "state:"))
		var result []youtrack.Issue
		for _, iss := range issues {
			if strings.ToLower(youtrack.GetStatus(iss)) == stateName {
				result = append(result, iss)
			}
		}
		return result
	}

	var result []youtrack.Issue
	for _, iss := range issues {
		status := strings.ToLower(youtrack.GetStatus(iss))
		match := false
		switch filter {
		case "blocked":
			match = strings.Contains(status, "block") || strings.Contains(status, "wait")
		case "delayed":
			match = strings.Contains(status, "progress") // in-progress = at risk of delay
		case "done":
			match = strings.Contains(status, "done") || strings.Contains(status, "clos") ||
				strings.Contains(status, "deploy") || strings.Contains(status, "verif") || strings.Contains(status, "prod")
		case "in_progress":
			match = strings.Contains(status, "progress") || strings.Contains(status, "working")
		}
		if match {
			result = append(result, iss)
		}
	}
	return result
}

func filterByPriority(issues []youtrack.Issue, priorityFilter string) []youtrack.Issue {
	var result []youtrack.Issue
	for _, iss := range issues {
		p := youtrack.GetPriority(iss)
		if strings.EqualFold(p, priorityFilter) {
			result = append(result, iss)
		}
	}
	return result
}

func filterByType(issues []youtrack.Issue, typeFilter string) []youtrack.Issue {
	var result []youtrack.Issue
	for _, iss := range issues {
		issType := youtrack.GetCustomFieldValue(iss, "Type")
		if strings.EqualFold(issType, typeFilter) {
			result = append(result, iss)
		}
	}
	return result
}

// ─── BM25 ─────────────────────────────────────────────────────────────────────

const bm25K1 = 1.5
const bm25B = 0.75
const avgDocLen = 12.0 // average tokens per issue document

func tokenize(s string) []string {
	s = strings.ToLower(s)
	raw := strings.FieldsFunc(s, func(r rune) bool {
		return !((r >= 'a' && r <= 'z') || (r >= '0' && r <= '9'))
	})
	out := raw[:0]
	for _, t := range raw {
		if len(t) > 1 && !stopwords[t] {
			out = append(out, t)
		}
	}
	return out
}

func issueToDoc(iss youtrack.Issue) string {
	assignee := ""
	if a := youtrack.GetAssignee(iss); a != nil {
		assignee = a.FullName
	}
	issType := youtrack.GetCustomFieldValue(iss, "Type")
	subsystem := youtrack.GetSubsystem(iss)
	return iss.ID + " " + iss.Summary + " " + youtrack.GetStatus(iss) + " " + assignee + " " + issType + " " + subsystem
}

func bm25Score(queryTokens, docTokens []string) float64 {
	freq := make(map[string]int, len(docTokens))
	for _, t := range docTokens {
		freq[t]++
	}
	docLen := float64(len(docTokens))
	score := 0.0
	for _, qt := range queryTokens {
		tf := float64(freq[qt])
		if tf == 0 {
			continue
		}
		idf := math.Log(2.0) // simplified IDF (no corpus-level stats needed at this scale)
		num := tf * (bm25K1 + 1)
		den := tf + bm25K1*(1-bm25B+bm25B*docLen/avgDocLen)
		score += idf * num / den
	}
	return score
}

func rankByBM25(query string, issues []youtrack.Issue, topN int) []youtrack.Issue {
	queryTokens := tokenize(query)
	type scored struct {
		iss   youtrack.Issue
		score float64
	}
	ranked := make([]scored, 0, len(issues))
	for _, iss := range issues {
		s := bm25Score(queryTokens, tokenize(issueToDoc(iss)))
		ranked = append(ranked, scored{iss, s})
	}
	sort.Slice(ranked, func(i, j int) bool { return ranked[i].score > ranked[j].score })

	result := make([]youtrack.Issue, 0, topN)
	for _, r := range ranked {
		if len(result) >= topN {
			break
		}
		result = append(result, r.iss)
	}
	return result
}

// ─── Context builder ─────────────────────────────────────────────────────────

// SprintKPIs carries the high-level numbers for greeting/summary queries.
type SprintKPIs struct {
	SprintName string
	SprintEnds string
	Total      int
	Done       int
	InProgress int
	Blocked    int
	Overdue    int
	Bounced    int
	TypeCounts map[string]int // e.g. "Feature"→15, "Bug"→8, "Task"→12
}

// BuildPMQueryContext is the entry point: classifies the query, retrieves relevant
// issues, and returns a compact context string ready to prepend to the system prompt.
// trackingByID maps issueID → its tracking log rows for that sprint.
func BuildPMQueryContext(
	query string,
	issues []youtrack.Issue,
	trackingLogs []database.IssueStateLog,
	blockerReasons map[string]string, // issueID → reason
	kpis SprintKPIs,
) (string, pmQueryIntent) {
	intent := classifyPMQueryIntent(query, issues)
	relevant := retrieveRelevantIssues(intent, query, issues)
	log.Printf("[RAG-DEBUG] intent=%s relevant_before_compound=%d total_issues=%d typeFilter=%q",
		intent.kind, len(relevant), len(issues), intent.typeFilter)

	// Compound filter: apply status filter only when query asks for ONE specific status
	// (e.g. "features on stage", "done bugs by harpinder") but NOT when asking for
	// a breakdown across multiple statuses (e.g. "done vs in progress vs blocked").
	if relevant != nil {
		switch intent.kind {
		case intentTypeFilter, intentPriorityFilter, intentAssignee:
			if statusKW := detectStatusKeyword(query); statusKW != "" && countStatusKeywords(query) == 1 {
				relevant = filterByStatus(relevant, statusKW)
			} else if statusKW == "" {
				if matched := findStateNameInQuery(strings.ToLower(query), issues); matched != "" {
					relevant = filterByStatus(relevant, "state:"+matched)
				}
			}
		}
	}

	// Build tracking index: issueID → rows
	trackIdx := map[string][]database.IssueStateLog{}
	for _, row := range trackingLogs {
		trackIdx[row.IssueID] = append(trackIdx[row.IssueID], row)
	}

	// Pre-compute per-issue derived stats from tracking logs
	bounceCounts := map[string]int{}
	overdueFlags := map[string]bool{}
	for _, row := range trackingLogs {
		if pmIsMovedBack(row.FromState, row.ToState) {
			bounceCounts[row.IssueID]++
		}
		if row.DurationInPrevStateHours != nil && *row.DurationInPrevStateHours > pmOverdueThreshold(row.Priority) {
			overdueFlags[row.IssueID] = true
		}
	}

	var sb strings.Builder

	if intent.kind == intentGreeting || relevant == nil {
		// Stats-only context — very small
		sb.WriteString(buildKPIContext(kpis))
		return sb.String(), intent
	}

	// Header describing what was retrieved — include total count from KPIs for type queries
	switch intent.kind {
	case intentTypeFilter:
		total := kpis.TypeCounts[intent.typeFilter]
		if total == 0 {
			total = len(relevant)
		}
		if len(relevant) < total {
			sb.WriteString(fmt.Sprintf("## %s tickets in sprint: %d total (showing first %d — use Sprint Summary Ticket Types for the exact count)\n", intent.typeFilter, total, len(relevant)))
		} else {
			sb.WriteString(fmt.Sprintf("## All %s tickets in sprint (%d total — complete list)\n", intent.typeFilter, total))
		}
	case intentPriorityFilter:
		sb.WriteString(fmt.Sprintf("## %s tickets in sprint (%d shown)\n", intent.priorityFilter, len(relevant)))
	case intentAssignee:
		sb.WriteString(fmt.Sprintf("## All tickets for %s in sprint (%d shown)\n", intent.assigneeName, len(relevant)))
	case intentStatusFilter:
		sb.WriteString(fmt.Sprintf("## Tickets matching status filter (%d retrieved)\n", len(relevant)))
	default:
		sb.WriteString(fmt.Sprintf("## Relevant Sprint Issues (%d retrieved for this query)\n", len(relevant)))
	}
	sb.WriteString("Format: ID | Priority | Type | Summary | Status | Assignee | Subsystem | Bounces | Flags\n")
	sb.WriteString("IMPORTANT: Only reference people and tickets listed below. Do not mention anyone not in this data.\n\n")

	for _, iss := range relevant {
		status := youtrack.GetStatus(iss)
		priority := youtrack.GetPriority(iss)
		if priority == "" {
			priority = "?"
		}
		assignee := "Unassigned"
		if a := youtrack.GetAssignee(iss); a != nil && a.FullName != "" {
			assignee = a.FullName
		}
		issueType := youtrack.GetCustomFieldValue(iss, "Type")
		if issueType == "" {
			issueType = "?"
		}
		subsystem := youtrack.GetSubsystem(iss)
		if subsystem == "" {
			subsystem = "-"
		}
		bounces := bounceCounts[iss.ID]

		flags := ""
		if overdueFlags[iss.ID] {
			flags += " OVERDUE"
		}
		if strings.EqualFold(issueType, "Hotfix") {
			flags += " HOTFIX"
		} else if strings.EqualFold(issueType, "Regression") {
			flags += " REGRESSION"
		}
		if _, blocked := blockerReasons[iss.ID]; blocked {
			flags += " BLOCKED"
		}

		sb.WriteString(fmt.Sprintf("- %s | %s | %s | %s | %s | %s | %s | bounces:%d%s\n",
			iss.ID, priority, issueType, iss.Summary, status, assignee, subsystem, bounces, flags))

		// Include tracking transitions only for intents where history matters:
		// issue-specific, assignee workload, sprint overview, and general BM25.
		// Skip for bulk type/priority/status filters to stay within token limits.
		showTransitions := intent.kind == intentIssueID ||
			intent.kind == intentAssignee ||
			intent.kind == intentSprintOverview ||
			intent.kind == intentGeneral
		if showTransitions {
			rows := trackIdx[iss.ID]
			maxRows := 3
			if intent.kind == intentIssueID {
				maxRows = 10 // full history for single ticket queries
			}
			if len(rows) > maxRows {
				rows = rows[len(rows)-maxRows:]
			}
			for _, row := range rows {
				hours := 0.0
				if row.DurationInPrevStateHours != nil {
					hours = *row.DurationInPrevStateHours
				}
				sb.WriteString(fmt.Sprintf("  → %s→%s (%.1fh, by %s)\n", row.FromState, row.ToState, hours, row.MovedBy))
			}
		}

		// Blocker reason — emit reason if available, or note it's missing for blocked tickets
		if reason, ok := blockerReasons[iss.ID]; ok {
			sb.WriteString(fmt.Sprintf("  BLOCKER: %s\n", reason))
		} else {
			st := strings.ToLower(youtrack.GetStatus(iss))
			if strings.Contains(st, "block") || strings.Contains(st, "wait") {
				sb.WriteString("  BLOCKER: No reason recorded in the system\n")
			}
		}
	}

	// Always append sprint KPIs for context
	sb.WriteString("\n")
	sb.WriteString(buildKPIContext(kpis))

	return sb.String(), intent
}

func buildKPIContext(kpis SprintKPIs) string {
	ends := ""
	if kpis.SprintEnds != "" {
		ends = " | Ends: " + kpis.SprintEnds
	}
	base := fmt.Sprintf(
		"## Sprint Summary: %s%s\nTotal: %d | Done: %d | InProgress: %d | Blocked: %d | Overdue: %d | Bounced: %d\n",
		kpis.SprintName, ends, kpis.Total, kpis.Done, kpis.InProgress, kpis.Blocked, kpis.Overdue, kpis.Bounced,
	)
	if len(kpis.TypeCounts) > 0 {
		types := make([]string, 0, len(kpis.TypeCounts))
		for t := range kpis.TypeCounts {
			types = append(types, t)
		}
		sort.Strings(types)
		parts := make([]string, 0, len(types))
		for _, t := range types {
			parts = append(parts, fmt.Sprintf("%s: %d", t, kpis.TypeCounts[t]))
		}
		base += "Ticket Types: " + strings.Join(parts, " | ") + "\n"
	}
	return base
}
