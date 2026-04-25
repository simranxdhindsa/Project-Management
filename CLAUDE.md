# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Backend (run from `backend/`)
```bash
go run .           # Start API server on :8080
go build .         # Compile binary
go test ./...      # Run all tests
```

### Frontend (run from `frontend/`)
```bash
npm run dev        # Start Vite dev server on :5173
npm run build      # Production build
npm run lint       # ESLint
```

The backend loads `backend/.env` automatically on startup via `godotenv`.

## Architecture Overview

This is a React + Go project management tool. Frontend (port 5173) talks to a Go REST API (port 8080) at `http://localhost:8080/api`. All protected routes require `Authorization: Bearer <JWT>`.

### Backend Structure

```
backend/
  main.go                         # Route registration (200+ routes), server init, background jobs
  internal/
    auth/                         # JWT generation/validation, Google OAuth
    middleware/auth.go            # JWT extraction → DB user lookup → context injection
    handlers/                     # One file per feature domain (tasks, asana, youtrack, slack, ai, ...)
    database/                     # Repository pattern: one *_repo.go per domain
    models/                       # Shared structs
    services/asana/ youtrack/     # Business logic for external API integrations
  migrations/                     # SQL files run automatically on startup via migrations.go
```

**Key pattern**: Handlers call repositories directly — no service layer for most features. Repositories use a global pgxpool (`database.GetPool()`).

**Auto-migrations**: `internal/database/migrations.go` runs all DDL on startup. Add new tables there.

### Frontend Structure

```
frontend/src/
  App.tsx                         # Router + auth guard
  contexts/AuthContext.tsx        # Auth state, token storage, 12h refresh interval
  services/api.ts                 # All API methods + TypeScript interfaces (single source of truth for types)
  pages/Dashboard.tsx             # Main shell — renders all sub-pages via tab state
  components/                     # Feature components (kanban, reports, integrations, etc.)
```

All API calls go through `api.ts`, which injects the JWT from localStorage automatically.

### Authentication Flow

1. Google Sign-In → `POST /api/auth/google` with credential (ID token)
2. Backend validates with Google, checks email whitelist, creates/fetches user in DB
3. Returns JWT (24h default, 30d if `remember_me: true`)
4. Middleware on every request: validates JWT → looks up user by **email** in DB → puts DB user in context

The middleware resolves by email (not JWT user_id) to handle cases where a token was issued when DB was unavailable (in-memory UUID mismatch). If user doesn't exist in DB yet, middleware auto-creates them.

**Dev mode**: Any token starting with `dev-mode-token-` bypasses JWT validation and uses a hardcoded admin user (`simranjot@apyhub.com`, ID `08938fa6-27b4-446f-a9aa-b8fe5c7b97c4`). This ID must exist in the `users` table.

**Whitelist**: `simranjot@apyhub.com` is always admin. Domain `@apyhub.com` grants `member` role. Configurable via DB `whitelist` table.

### PM Data Sources (Dual-Tracker Design) — RULE #1

**The active PM source controls EVERYTHING.** When the user sets their active source in Integrations → Active PM Data Source:

- **All data is fetched from that source only**: boards, list views, kanban, PM reports, tracking tab, assignee stats, daily brief, EOD summary, developer load, blocker reasons, carryover, stage report, PM assistant AI, activity feed, calendar, time tracking, issue timelines — everything.
- **All configuration comes from that source**: workflow config (priority tags, column hierarchy, hotfix rules, report defaults), open/blocked states, priority filters, done role — all source-specific.
- **Switching source immediately changes all of the above** — no mixing of YouTrack data with Asana config or vice versa.

The active source is stored in `user_data_source` table (backend) and `localStorage` key `pm_active_source` (frontend). The frontend service layer (`pmDataService.ts`) routes every call to the correct API based on `getActiveSource()`. Before building or modifying any PM feature, verify it reads the active source and calls the correct API accordingly.

Users can switch between **YouTrack** and **Asana** as their primary tracker. Preference stored in `user_data_source` table. Both integrations are separate route namespaces (`/api/youtrack/*`, `/api/asana/pm/*`) with parallel handler sets.

### Real-Time Updates

Server-Sent Events hub in `handlers/sse_hub.go`. YouTrack/notification handlers push events to the SSE hub, which broadcasts to connected frontend clients.

### Background Jobs (started in `main.go`)

- Mid-day and evening scheduled checks (blocker detection, stale task alerts)
- Daily cleanup goroutine (deletes notifications and activity logs older than 30 days)
- Reminder polling

### AI Integration

Multiple providers supported: Groq, OpenAI, Gemini. Provider selected via `AI_PROVIDER` env var. Bot prompts are editable at runtime via `bot_configs` table (allows PM to customize assistant behavior with live YouTrack data injected into prompts).

## Environment Variables

**Backend** (`backend/.env`):
```
DATABASE_URL=postgresql://...
JWT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:5173/auth/callback
FRONTEND_URL=http://localhost:5173
PORT=8080
AI_PROVIDER=groq          # or openai, gemini
GROQ_API_KEY=
OPENAI_API_KEY=
GEMINI_API_KEY=
SLACK_BOT_TOKEN=
ASANA_PAT=                # fallback if user hasn't connected Asana via UI
ASANA_PROJECT_ID=
```

**Frontend** (`frontend/.env`):
```
VITE_API_URL=http://localhost:8080/api
VITE_GOOGLE_CLIENT_ID=    # must match backend GOOGLE_CLIENT_ID
```

## Database Notes

- PostgreSQL via pgx/pgxpool. Connection pool: max 10, min 2, 1h max lifetime.
- If `DATABASE_URL` is unset, app runs with in-memory maps (limited persistence).
- The `go.mod` toolchain version must match an **actually released** Go version. `go 1.25.x` does not exist — use `go 1.24.0` or lower.
- Windows: Windows Defender may corrupt module cache downloads. Add `C:\Users\<user>\go\pkg\mod` to Defender exclusions if you see `unexpected NUL in input` errors.

---

## Frontend Development Rules

### 1 — Always follow the Workflow Config

Every PM feature must derive its column classification, roles, and thresholds from the live workflow config, **never hardcode column or state names**.

- Load with `useWorkflowConfig()` hook (`frontend/src/hooks/useWorkflowConfig.ts`)
- Column role lookup pattern: build a `Map<string, string>` from `wfConfig.column_hierarchy` (state + all aliases, lowercased) then fall back to keyword heuristics only when the map is empty
- Role semantics used throughout the app:

| Role string | Meaning |
|---|---|
| `active` | In Progress — developer is working on it |
| `blocked` | Blocked — external dependency, dev can't act |
| `dev_done` | Done / DEV — moved out of active development |
| `verified` | Verified / Ready for Stage or Prod |
| `deployed` | Deployed to Stage or Prod |
| `closed` | Fully resolved / closed |
| `backlog` / `''` | To Do / Queued — not yet started |

- Overdue / delay logic must check `isDoneNow` (role in dev_done/verified/deployed/closed) first — done tickets must **never** show overdue regardless of hours_in_state
- Blocked tickets must **never** count as overdue — the developer can't act on them
- Only `active` and `backlog/todo` (open) tickets count toward a developer's overdue metric

### 2 — Use the Established Dropdown and Calendar Components

Do not build new dropdown or calendar implementations. Use the two existing patterns:

**`pm-custom-dropdown` pattern** — used everywhere in `PMReportsPage.tsx`, `BoardPage.tsx`, `DayTrackPage.tsx`, etc.
```tsx
// Standard inline dropdown (outside-click handled via useRef + mousedown listener)
<div className="pm-custom-dropdown" ref={myRef}>
  <button className="pm-custom-dropdown-trigger" onClick={() => setOpen(o => !o)}>
    {label} <ChevronDown size={12} />
  </button>
  {open && (
    <div className="pm-custom-dropdown-menu">
      {options.map(opt => (
        <div key={opt} className="pm-custom-dropdown-item" onClick={() => { setValue(opt); setOpen(false) }}>
          {opt}
        </div>
      ))}
    </div>
  )}
</div>
```

**`WcSelectDropdown` component** — defined in `IntegrationsPage.tsx` (line 71). Used for role/config selects in the Integrations page. It renders a portal-based dropdown with `wc-sel-dropdown` class on the portal div (critical — ensures the outside-click handler doesn't close it prematurely). Use this pattern for compact select inputs inside settings/config tables.

**`CalendarView` component** — `frontend/src/components/calendar/CalendarView.tsx`. Use this for any date-range or calendar display — do not roll a new one.

Portal bug note: any portal-rendered dropdown menu **must** include `wc-sel-dropdown` in its className, otherwise the global mousedown outside-click handler will close it before the option's `onClick` fires.

### 3 — Light Mode and Dark Mode

Every new component and CSS class must have both dark (default) and light mode styles. The app ships both themes and both must be visually correct.

**Pattern:**
```css
/* Dark mode (default — no selector needed) */
.my-class {
  background: rgba(255,255,255,0.06);
  color: rgba(255,255,255,0.8);
  border: 1px solid rgba(255,255,255,0.1);
}

/* Light mode override */
[data-theme="light"] .my-class {
  background: rgba(241,245,249,0.9);
  color: #1e293b;
  border: 1px solid rgba(99,102,241,0.15);
}
```

Key light-mode color values to use consistently:
- Surface bg: `rgba(241,245,249,0.9)` or `#ffffff`
- Primary text: `#1e293b` / `#0f172a`
- Secondary text: `#475569` / `#64748b`
- Muted text: `#94a3b8`
- Border: `rgba(99,102,241,0.12)` to `rgba(99,102,241,0.2)`
- Primary accent: `#4f46e5` / `#6366f1`
- Danger: `#dc2626` / `#ef4444`
- Warning: `#d97706`
- Success: `#16a34a`

**No inline `style={{}}`** in components (except truly dynamic values like widths derived from data — e.g. a progress bar `width: ${pct}%`). All colours, spacing, and layout must be in the CSS files.

CSS files per page/feature:
- `frontend/src/styles/pages/pm-reports.css` — PMReports, Tracking, QA Pipeline
- `frontend/src/styles/pages/daily-ops.css` — Daily Ops tab
- `frontend/src/styles/pages/integrations.css` — Integrations page
- `frontend/src/index.css` — global shared classes

---

## Features Built

### Tracking Tab (`PMReportsPage.tsx` — `TrackingTab`)

9 view modes accessible from the view-mode dropdown:

| Mode | Description |
|---|---|
| **By Column** | Default — issues grouped by board column (sprint-scoped) |
| **By Assignee** | Issues grouped by developer; QA verified subsection per person |
| **Swimlane** | Each person = full-width row with urgency-coloured ticket chips + load bar |
| **Sidebar** | Left 240px avatar list; click person → their tickets fill the right panel |
| **Heatmap** | Assignee × column matrix — cell colour shows overdue/at-risk/ok count |
| **Delay Bars** | Horizontal time bar per ticket: working (blue) / bounce (orange) / review (purple); SLA marker line |
| **Alert First** | Giant blocked banner at top + 2-col in-progress cards below |
| **Split Pane** | Left health panel (donut, load bars, sprint countdown) + right flat ticket list |
| **Focus Mode** | Top 3 most-delayed tickets shown large; "Show N more" expands the rest |
| **QA Pipeline** | Verification matrix per ticket: DEV / STAGE / PROD cells with who tested + pending indicators |

**Sprint KPI bar** (top of Tracking tab):
- Completion % (done / total)
- Blocked count
- Bounced tickets count
- Sprint deadline countdown (amber when <24h)

**Per-ticket row enhancements:**
- Cycle time (first active → first done)
- Verification badges: `DEV✓` / `STG✓` / `PRD✓` with tooltip showing tester name
- Hotfix badge (orange `HF`)
- Bounce badge (`↩N`) — backward move count
- Stint count (`×N`) — separate In Progress sessions
- `overdue_level` colouring: `deadline` (red) / `sprint` (amber) / `sla` (yellow)
- Inline row expand → full state transition timeline (`IssueTransitionInline`)

**Overdue logic (backend `report.go`):**
1. If `isDoneNow` (role in dev_done/verified/deployed/closed) → `is_delayed = false`, `overdue_level = ""`
2. Else if ticket-level YouTrack due date passed → `overdue_level = "deadline"`
3. Else if sprint finish ms passed and ticket is active → `overdue_level = "sprint"`
4. Else if `hours_in_state > priority SLA threshold` → `overdue_level = "sla"`

### QA Pipeline View

Dedicated verification matrix showing per-ticket QA coverage across three stages. Key concepts:
- `verified_on_dev` / `verified_on_stage` / `verified_on_prod` — name of person who moved ticket to each verified-role column
- `isPendingDev` = no dev verif + ticket has been worked on (`total_active_hours > 0 || bounce_count > 0`)
- `isPendingStg` = has dev verif but not stage verif
- `isPendingPrd` = has stage verif but not prod verif
- QA Load cards at top show per-QA person how many tickets they've verified at each stage
- Filter toggle: "All" vs "Needs QA" (hides fully-verified tickets)

### Integrations — Column Hierarchy

- Card-based layout with left colour stripe per role (`ROLE_COLORS` constant)
- Auto-fetches YouTrack board columns on tab open (`useEffect` on `[wcSection, wcSource]`) — no manual button
- `WcSelectDropdown` portal fix: portal div must have `wc-sel-dropdown` class so outside-click handler doesn't fire on it
- Aliases column always visible (fixed width `120px` on role dropdown so aliases input isn't squeezed out)

### Daily Ops Tab

Simplified to a single **Developer Load** view (Morning Brief and Report Preview tabs removed).

Data sourced from `api.getSprintBoardStatus(sprintId)` — uses the same sprint board endpoint as the Tracking tab, so counts are always accurate and never depend on YouTrack webhooks.

Per-developer card shows:
- Real avatar image (from sprint board data) with initials fallback
- Sprint progress bar (`done / (done + active + blocked)`)
- Stat chips: done in sprint / active / blocked / bounced / overdue / hours worked
- Active issue list (first 4, `+N more`)
- Blocked issue list (separate section)

Overloaded badge rule: `activeIssues.length > 5` — purely a workload metric (in-progress tickets only).
Overdue count rule: only open tickets (`isActive || isQueued`) where `is_delayed = true`. Blocked and done tickets never count as overdue.

### Backend: Sprint Board Status (`GET /api/reports/sprint-board-status`)

Returns `SprintBoardStatusResponse { summary: SprintSummary, columns: SprintBoardColumn[] }`.

`SprintBoardIssue` fields added over time:
- `bounce_count`, `total_active_hours` — from state log scan
- `cycle_time_hours` — first active → first done
- `verified_on_dev/stage/prod` — who moved to each verified-role column
- `is_hotfix`, `stint_count`, `stints[]`
- `overdue_level` (`"deadline"` | `"sprint"` | `"sla"` | `""`)
- `move_type` (`"qa_rejected"` | `"dev_stalled"` | `""`)
- `issue_type` — from YouTrack custom field (e.g. Hotfix, Regression)

`SprintSummary` fields: `total_issues`, `done_issues`, `in_progress_count`, `blocked_count`, `bounced_count`, `hotfix_count`, `overdue_count`, `sprint_finish_ms`, `completion_pct`.

### PM Assistant RAG (`backend/internal/handlers/pm_query_rag.go`)

The PM assistant uses **zero-cost BM25 sparse retrieval** to keep every prompt under ~3,000 tokens regardless of sprint size.

**Do NOT dump all sprint issues into the prompt.** Always route through `BuildPMQueryContext()`.

#### Intent classification (classify before retrieving)

| Intent | Trigger | Retrieved context |
|--------|---------|-------------------|
| `greeting` / `general summary` | "hi", "overview", "sprint status" | Sprint KPI stats only (~150 tokens) |
| `issue_id` | Regex `[A-Z]{2,10}-\d+` in query | That one issue only |
| `assignee` | Name matched against live sprint data | That person's issues only |
| `status_filter` | "blocked", "delayed", "done", "in progress" keywords | Filtered subset |
| `general` | None of the above | BM25 top-20 issues |

#### Issue context line format (per issue in retrieval)

```
- {ID} | {Priority} | {Summary} | {Status} | {Assignee} | bounces:{N} [OVERDUE] [HOTFIX] [BLOCKED]
  → {FromState}→{ToState} ({Xh}, by {Person})   ← last 3 transitions
  BLOCKER: {reason}                               ← if blocked
```

#### KPI context (always appended, ~50 tokens)

```
## Sprint Summary: {name} | Ends: {date}
Total: N | Done: N | InProgress: N | Blocked: N | Overdue: N | Bounced: N
```

#### Entry point

```go
context, intent := BuildPMQueryContext(query, issues, trackingLogs, blockerReasons, kpis)
```

Called from `PMAssistantQuery` in `youtrack.go`. The handler:
1. Fetches sprint issues from YouTrack (`ytClient.GetAllSprintIssues`)
2. Fetches time-tracking logs **sprint-scoped** (`SprintIssueIDs` param — never empty)
3. Computes KPI counts (Overdue + Bounced) from tracking logs using `pmIsMovedBack` + `pmOverdueThreshold`
4. Calls `BuildPMQueryContext` → prepends returned context to system prompt
5. Sends to AI via `ai.QueryWithHistory` (model: `llama-3.1-8b-instant`, 131K TPM free tier)

**When adding new PM assistant features**: extend the intent classifier in `pm_query_rag.go`, not the handler in `youtrack.go`. Keep context output compact — every token costs latency and risks hitting the 131K TPM limit.

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
|------|----------|
| `detect_changes` | Reviewing code changes � gives risk-scored analysis |
| `get_review_context` | Need source snippets for review � token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on every file change via the PostToolUse hook — no manual action needed.
2. After adding a **new feature or significant refactor**, run a full rebuild: `code-review-graph build`
3. Use `detect_changes` for code review before committing.
4. Use `get_affected_flows` to understand impact of a change.
5. Use `query_graph` pattern="tests_for" to check coverage.

### Rebuild triggers
Run `code-review-graph build` manually when:
- A new feature is added (new files/modules)
- A major refactor moves or renames files
- The graph feels stale (`code-review-graph status` shows low coverage)
