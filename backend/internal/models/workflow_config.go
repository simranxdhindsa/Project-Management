package models

// PriorityTag defines a user-customizable priority classification
type PriorityTag struct {
	Label        string   `json:"label"`         // "P0", "B1", "A0"
	Color        string   `json:"color"`         // "#ef4444"
	DisplayOrder int      `json:"display_order"` // sort position
	SLAHours     float64  `json:"sla_hours"`     // overdue threshold in hours
	Prefixes     []string `json:"prefixes"`      // ticket summary prefixes: ["P0","B0"]
	YTMappings   []string `json:"yt_mappings"`   // YouTrack priority field values: ["Critical"]
}

// ColumnState defines a workflow column with its semantic role
type ColumnState struct {
	State     string   `json:"state"`      // "DEV", "STAGE", etc.
	Rank      int      `json:"rank"`       // workflow position (0-based)
	Aliases   []string `json:"aliases"`    // alternate names: ["Fixed","Closed"]
	Role      string   `json:"role"`       // semantic role: backlog, active, dev_done, verified, deployed, closed
	IsLateral bool     `json:"is_lateral"` // lateral state (Blocked, Findings) — not part of main flow
}

// Column roles (user-assignable):
//   "backlog"    — unstarted work (e.g. Backlog, Open)
//   "active"     — in-progress work (e.g. In Progress)
//   "blocked"    — items someone is stuck on (e.g. Blocked) — shown in "Blocked" report section
//   "findings"   — items to pick up in next sprint (e.g. Findings)
//   "dev_done"   — dev-complete / code merged (e.g. DEV) — tickets here count as "done" in daily reports
//   "verified"   — verified on prior env, ready for next (e.g. Ready for Stage, Ready for PROD)
//   "deployed"   — deployed to an environment (e.g. STAGE, PROD) — direct jumps here from backlog/active = hotfix
//   "closed"     — terminal state (e.g. Done, Closed, Won't Fix)

// HotfixRules defines how hotfix detection works
type HotfixRules struct {
	// When FromStates/ToStates are empty, hotfix detection is auto-derived from column roles:
	// ticket jumps from backlog/active role → deployed role (skipping dev_done/verified)
	FromStates []string `json:"from_states"`
	ToStates   []string `json:"to_states"`
}

// ReportConfig defines which data goes into generated reports
type ReportConfig struct {
	DoneRole        string   `json:"done_role"`        // column role that counts as "done" (default: "dev_done")
	BlockedStates   []string `json:"blocked_states"`   // ["Blocked"]
	OpenStates      []string `json:"open_states"`      // columns to pull open issues from
	PriorityFilters []string `json:"priority_filters"` // which priority tags to include
	Sections        []string `json:"sections"`          // report sections: ["done","hotfixes","open","blocked","overdue"]
}

// WorkflowConfig is the top-level configuration object
type WorkflowConfig struct {
	ID              string        `json:"id"`
	UserID          *string       `json:"user_id"`
	PriorityTags    []PriorityTag `json:"priority_tags"`
	ColumnHierarchy []ColumnState `json:"column_hierarchy"`
	HotfixRules     HotfixRules   `json:"hotfix_rules"`
	ReportConfig    ReportConfig  `json:"report_config"`
}
