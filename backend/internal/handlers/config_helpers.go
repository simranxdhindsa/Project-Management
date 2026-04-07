package handlers

import (
	"strings"

	"github.com/dhindsa/project-management/internal/models"
	"github.com/dhindsa/project-management/internal/services/youtrack"
)

// extractPriorityFromConfig checks ticket summary against configured priority prefixes.
// Returns the matching tag label, or "Other" if no match.
func extractPriorityFromConfig(summary string, tags []models.PriorityTag) string {
	for _, tag := range tags {
		for _, prefix := range tag.Prefixes {
			if strings.HasPrefix(summary, prefix+" ") || strings.HasPrefix(summary, prefix+"\t") {
				return tag.Label
			}
		}
	}
	return "Other"
}

// overdueThresholdFromConfig returns the SLA threshold in hours for a given priority label.
// Falls back to 72h if not found.
func overdueThresholdFromConfig(priority string, tags []models.PriorityTag) float64 {
	upper := strings.ToUpper(priority)
	for _, tag := range tags {
		if strings.ToUpper(tag.Label) == upper {
			return tag.SLAHours
		}
		// Also check YT mappings (e.g., "CRITICAL" → P0)
		for _, yt := range tag.YTMappings {
			if strings.ToUpper(yt) == upper {
				return tag.SLAHours
			}
		}
	}
	return 72 // default fallback
}

// getStateIndexFromConfig returns the rank of a state in the column hierarchy.
// Checks both state names and aliases (case-insensitive). Returns 0 if not found.
func getStateIndexFromConfig(state string, hierarchy []models.ColumnState) int {
	lower := strings.ToLower(state)
	for _, col := range hierarchy {
		if strings.ToLower(col.State) == lower {
			return col.Rank
		}
		for _, alias := range col.Aliases {
			if strings.ToLower(alias) == lower {
				return col.Rank
			}
		}
	}
	return 0
}

// isBackwardMoveFromConfig checks if transitioning from currentState to proposedState
// is a regression (moving to a lower rank in the hierarchy).
func isBackwardMoveFromConfig(currentState, proposedState string, hierarchy []models.ColumnState) bool {
	return getStateIndexFromConfig(proposedState, hierarchy) < getStateIndexFromConfig(currentState, hierarchy)
}

// isHotfixFromConfig checks whether a state transition counts as a hotfix.
// If rules have explicit from/to states, use those.
// Otherwise, auto-derive: hotfix = from backlog/active role → deployed role.
func isHotfixFromConfig(fromState, toState string, rules models.HotfixRules, hierarchy []models.ColumnState) bool {
	fromLower := strings.ToLower(fromState)
	toLower := strings.ToLower(toState)

	// If explicit states are configured, use them
	if len(rules.FromStates) > 0 && len(rules.ToStates) > 0 {
		fromMatch := false
		for _, s := range rules.FromStates {
			if strings.ToLower(s) == fromLower {
				fromMatch = true
				break
			}
		}
		if !fromMatch {
			return false
		}
		for _, s := range rules.ToStates {
			if strings.ToLower(s) == toLower {
				return true
			}
		}
		return false
	}

	// Auto-derive from roles: backlog/active → deployed
	fromRole := getStateRole(fromLower, hierarchy)
	toRole := getStateRole(toLower, hierarchy)

	isFromEarly := fromRole == "backlog" || fromRole == "active"
	isToDeployed := toRole == "deployed"

	return isFromEarly && isToDeployed
}

// mapYTPriorityFromConfig maps a YouTrack priority field value (e.g., "Critical") to a tag label (e.g., "P0").
func mapYTPriorityFromConfig(ytPriority string, tags []models.PriorityTag) string {
	lower := strings.ToLower(ytPriority)
	for _, tag := range tags {
		for _, yt := range tag.YTMappings {
			if strings.ToLower(yt) == lower {
				return tag.Label
			}
		}
	}
	return ytPriority // return as-is if no mapping found
}

// getStateRole returns the role of a state from the hierarchy (case-insensitive).
func getStateRole(state string, hierarchy []models.ColumnState) string {
	lower := strings.ToLower(state)
	for _, col := range hierarchy {
		if strings.ToLower(col.State) == lower {
			return col.Role
		}
		for _, alias := range col.Aliases {
			if strings.ToLower(alias) == lower {
				return col.Role
			}
		}
	}
	return ""
}

// getStatesByRole returns all state names (including aliases) that have the given role.
func getStatesByRole(role string, hierarchy []models.ColumnState) []string {
	var states []string
	for _, col := range hierarchy {
		if col.Role == role {
			states = append(states, col.State)
			states = append(states, col.Aliases...)
		}
	}
	return states
}

// getDoneStates returns all state names (including aliases) for columns considered "done".
// Includes dev_done, verified, deployed, and closed roles so that tickets reaching
// DEV, Ready for Stage, STAGE, Ready for PROD, PROD, or Done all count as done.
func getDoneStates(cfg *models.WorkflowConfig) []string {
	postDevRoles := map[string]bool{
		"dev_done": true, "verified": true, "deployed": true, "closed": true,
	}
	var states []string
	for _, col := range cfg.ColumnHierarchy {
		if postDevRoles[col.Role] {
			states = append(states, col.State)
			states = append(states, col.Aliases...)
		}
	}
	// Fallback to done_role only if hierarchy is empty
	if len(states) == 0 {
		return getStatesByRole(cfg.ReportConfig.DoneRole, cfg.ColumnHierarchy)
	}
	return states
}

// classifyBackwardMove returns "qa_rejected" when a ticket moves back from a post-dev column
// (rank >= dev_done role rank), or "dev_stalled" when it moves back from an early column.
func classifyBackwardMove(fromState, toState string, hierarchy []models.ColumnState) string {
	// Find the rank of the first dev_done column
	devDoneRank := -1
	for _, col := range hierarchy {
		if col.Role == "dev_done" {
			devDoneRank = col.Rank
			break
		}
	}
	fromRank := getStateIndexFromConfig(fromState, hierarchy)
	if devDoneRank >= 0 && fromRank >= devDoneRank {
		return "qa_rejected"
	}
	return "dev_stalled"
}

// isHotfixIssueByField returns true if the issue's type custom field matches a configured hotfix value.
func isHotfixIssueByField(issue youtrack.Issue, rules models.HotfixRules) bool {
	if rules.TypeFieldName == "" || len(rules.HotfixValues) == 0 {
		return false
	}
	val := youtrack.GetCustomFieldValue(issue, rules.TypeFieldName)
	for _, hv := range rules.HotfixValues {
		if strings.EqualFold(val, hv) {
			return true
		}
	}
	return false
}

// isRegressionIssueByField returns true if the issue's type custom field matches a configured regression value.
func isRegressionIssueByField(issue youtrack.Issue, rules models.HotfixRules) bool {
	if rules.TypeFieldName == "" || len(rules.RegressionValues) == 0 {
		return false
	}
	val := youtrack.GetCustomFieldValue(issue, rules.TypeFieldName)
	for _, rv := range rules.RegressionValues {
		if strings.EqualFold(val, rv) {
			return true
		}
	}
	return false
}

// getHotfixFromStates returns the "from" states for hotfix detection.
// Uses explicit rules if set, otherwise auto-derives from backlog/active roles.
func getHotfixFromStates(cfg *models.WorkflowConfig) []string {
	if len(cfg.HotfixRules.FromStates) > 0 {
		return cfg.HotfixRules.FromStates
	}
	var states []string
	states = append(states, getStatesByRole("backlog", cfg.ColumnHierarchy)...)
	states = append(states, getStatesByRole("active", cfg.ColumnHierarchy)...)
	return states
}

// getHotfixToStates returns the "to" states for hotfix detection.
// Uses explicit rules if set, otherwise auto-derives from deployed role.
func getHotfixToStates(cfg *models.WorkflowConfig) []string {
	if len(cfg.HotfixRules.ToStates) > 0 {
		return cfg.HotfixRules.ToStates
	}
	return getStatesByRole("deployed", cfg.ColumnHierarchy)
}

// buildPriorityOrder returns ordered priority labels from config (for report grouping).
func buildPriorityOrder(tags []models.PriorityTag) []string {
	order := make([]string, len(tags))
	for i, t := range tags {
		order[i] = t.Label
	}
	return order
}
