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
	intentGreeting     pmQueryIntentType = "greeting"
	intentIssueID      pmQueryIntentType = "issue_id"
	intentAssignee     pmQueryIntentType = "assignee"
	intentStatusFilter pmQueryIntentType = "status_filter"
	intentGeneral      pmQueryIntentType = "general"
)

type pmQueryIntent struct {
	kind         pmQueryIntentType
	issueID      string // for intentIssueID
	assigneeName string // for intentAssignee
	statusFilter string // for intentStatusFilter: "blocked"|"delayed"|"done"|"in_progress"
}

var (
	issueIDRe = regexp.MustCompile(`(?i)\b[A-Z]{2,10}-\d+\b`)

	greetingPhrases = []string{"hi", "hello", "hey", "howdy", "sup", "morning", "afternoon"}
	summaryPhrases  = []string{"summary", "overview", "status", "how are we", "how is the sprint", "sprint health"}
	blockedKW       = []string{"block", "blocked", "blocker", "stuck", "waiting", "wait"}
	delayedKW       = []string{"delay", "delayed", "overdue", "behind", "late", "slow", "risk"}
	doneKW          = []string{"done", "finished", "completed", "closed", "deployed", "verified", "shipped"}
	inProgKW        = []string{"in progress", "working on", "active", "current", "in-progress"}
	stopwords       = map[string]bool{
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

	// Summary / overview check
	for _, p := range summaryPhrases {
		if strings.Contains(q, p) {
			return pmQueryIntent{kind: intentGreeting} // same handler: stats only
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

	return pmQueryIntent{kind: intentGeneral}
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

const maxContextIssues = 20

// retrieveRelevantIssues returns the issues relevant to the query using the classified intent.
// Returns nil for intentGreeting (caller should emit stats-only context).
func retrieveRelevantIssues(intent pmQueryIntent, query string, issues []youtrack.Issue) []youtrack.Issue {
	switch intent.kind {
	case intentGreeting:
		return nil

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
			}
		}
		return result

	case intentStatusFilter:
		return filterByStatus(issues, intent.statusFilter)

	default: // intentGeneral — BM25 ranking
		return rankByBM25(query, issues, maxContextIssues)
	}
}

func filterByStatus(issues []youtrack.Issue, filter string) []youtrack.Issue {
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
	return iss.ID + " " + iss.Summary + " " + youtrack.GetStatus(iss) + " " + assignee
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

	// Header describing what was retrieved
	sb.WriteString(fmt.Sprintf("## Relevant Sprint Issues (%d retrieved for this query)\n", len(relevant)))
	sb.WriteString("Format: ID | Priority | Summary | Status | Assignee | Bounces | Flags\n\n")

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
		bounces := bounceCounts[iss.ID]

		flags := ""
		if overdueFlags[iss.ID] {
			flags += " OVERDUE"
		}
		issueType := youtrack.GetCustomFieldValue(iss, "Type")
		if strings.EqualFold(issueType, "Hotfix") {
			flags += " HOTFIX"
		} else if strings.EqualFold(issueType, "Regression") {
			flags += " REGRESSION"
		}
		if _, blocked := blockerReasons[iss.ID]; blocked {
			flags += " BLOCKED"
		}

		sb.WriteString(fmt.Sprintf("- %s | %s | %s | %s | %s | bounces:%d%s\n",
			iss.ID, priority, iss.Summary, status, assignee, bounces, flags))

		// Inline tracking transitions for this issue (most recent 3)
		rows := trackIdx[iss.ID]
		if len(rows) > 3 {
			rows = rows[len(rows)-3:]
		}
		for _, row := range rows {
			hours := 0.0
			if row.DurationInPrevStateHours != nil {
				hours = *row.DurationInPrevStateHours
			}
			sb.WriteString(fmt.Sprintf("  → %s→%s (%.1fh, by %s)\n", row.FromState, row.ToState, hours, row.MovedBy))
		}

		// Blocker reason if present
		if reason, ok := blockerReasons[iss.ID]; ok {
			sb.WriteString(fmt.Sprintf("  BLOCKER: %s\n", reason))
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
	return fmt.Sprintf(
		"## Sprint Summary: %s%s\nTotal: %d | Done: %d | InProgress: %d | Blocked: %d | Overdue: %d | Bounced: %d\n",
		kpis.SprintName, ends, kpis.Total, kpis.Done, kpis.InProgress, kpis.Blocked, kpis.Overdue, kpis.Bounced,
	)
}
