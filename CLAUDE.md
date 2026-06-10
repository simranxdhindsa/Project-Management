# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Commands

### Backend (run from `backend/`)
```bash
air          # Hot-reload dev server — PREFERRED. Rebuilds on every .go/.toml/.env save.
go build .   # Compile only (to verify, never to restart)
go test ./...
```
**Never manually restart the backend** when `air` is running — file saves trigger rebuilds automatically.

### Frontend (run from `frontend/`)
```bash
npm run dev    # Vite dev server on :5173
npm run build
npm run lint
```

## Workflow Rule

After every task, output a short commit message (don't run git commit). Plain one-liner, no prefixes.

**Documentation rule:** When implementing a significant new feature or fixing something with non-obvious context, ask whether it should be noted in CLAUDE.md (if it's a pattern/rule) or in the relevant `docs/features/*.md` file (if it's feature-specific detail). Don't silently skip it and don't add it without asking.

## Architecture

Velocity is a React + Go project management tool. Frontend (port 5173) → Go REST API (port 8080) at `/api`. All protected routes require `Authorization: Bearer <JWT>`.

### Backend
```
backend/
  main.go               # Route registration (200+ routes), server init, background jobs
  internal/
    auth/               # JWT + Google OAuth
    middleware/auth.go  # JWT → DB user → context
    handlers/           # One file per domain
    database/           # Repository pattern: one *_repo.go per domain
    models/             # Shared structs
    services/asana/ youtrack/
  migrations/           # Auto-run on startup via migrations.go (use CREATE TABLE IF NOT EXISTS)
```

### Frontend
```
frontend/src/
  App.tsx               # Router + auth guard
  contexts/AuthContext.tsx
  services/api.ts       # All API methods + TS interfaces — single source of truth for types
  pages/Dashboard.tsx   # Main shell — tab state drives all sub-pages
  components/
```

→ Auth details: [`docs/features/auth.md`](docs/features/auth.md)

## PM Data Source Rules — RULE #1

**The active PM source controls everything.** Set in Integrations → Active PM Data Source; stored in `user_data_source` table and `localStorage` key `pm_active_source`. `pmDataService.ts` routes every call via `getActiveSource()`.

**Before touching any PM feature, verify it reads the active source.**

- **No hardcoding** — fetch states, priorities, assignees, sprint names live. Never hardcode them.
- **YouTrack priority = raw field value** — `youtrack.GetPriority(issue)` returns the literal value (e.g. "Normal"). Do NOT pass through `mapYTPriorityFromConfig` before storing in `SprintBoardIssue.Priority`.
- **Sprint board issues via YQL** — use `ytClient.GetIssuesByStateForSprint()` (`/api/issues?query=sprint:{name}`), not the agile endpoint (`/api/agiles/{board}/sprints/{sprint}/issues` returns empty custom fields).

## Environment Variables

**`backend/.env`:**
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
ASANA_PAT=
ASANA_PROJECT_ID=
```

**`frontend/.env`:**
```
VITE_API_URL=http://localhost:8080/api
VITE_GOOGLE_CLIENT_ID=
VITE_ENVIRONMENT=production   # hides dev login in prod builds
```

## Database Notes

- PostgreSQL via pgx/pgxpool. Pool: max 10, min 2, 1h lifetime.
- `DATABASE_URL` unset → in-memory maps (no persistence).
- `go.mod` toolchain must be a released version (`go 1.24.0`, not `go 1.25.x`).

---

## Frontend Development Rules

### 1 — Workflow Config

Every PM feature derives column roles from the live workflow config — never hardcode column/state names.

- Load with `useWorkflowConfig()` (`frontend/src/hooks/useWorkflowConfig.ts`)
- Build a `Map<string, string>` from `wfConfig.column_hierarchy` (lowercased); keyword fallback only when map is empty

| Role | Meaning |
|---|---|
| `active` | In Progress |
| `blocked` | Blocked |
| `dev_done` | Done / DEV |
| `verified` | Ready for Stage/Prod |
| `deployed` | Deployed |
| `closed` | Fully resolved |
| `backlog` / `''` | To Do / Queued |

Done (`dev_done`, `verified`, `deployed`, `closed`) and blocked tickets **never** count as overdue. Only `active` + `backlog` count.

### 2 — Dropdown & Calendar Components

Never build new dropdown or calendar implementations.

**`pm-custom-dropdown` pattern** (portal-based, used everywhere):
```tsx
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

**`WcSelectDropdown`** — for `{id, name}` option lists (defined in `IntegrationsPage.tsx`). Portal div **must** have `wc-sel-dropdown` in className or the outside-click handler fires before `onClick`.

**`CalendarView`** — `frontend/src/components/calendar/CalendarView.tsx`. Use for all date-range displays.

### 3 — Persisted UI State

Use `usePersistedState` from `frontend/src/hooks/usePersistedState.ts`. Never call `localStorage` directly in a component.

1. Add key to `PERSIST` constant in `usePersistedState.ts`
2. Replace `useState` with `usePersistedState(PERSIST.MY_KEY, defaultValue, { validate: [...] })`

Tabs stay mounted via `.dash-tab-hidden` CSS (session keep-alive). `usePersistedState` handles cross-session persistence.

### 4 — Theming

Every component must work in both dark (default) and light mode. Use CSS variables or `[data-theme="light"]` overrides — never hardcoded colours that only work in one theme.

```css
.my-class { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.8); }
[data-theme="light"] .my-class { background: rgba(241,245,249,0.9); color: #1e293b; }
```

Light-mode palette: surface `#fff` / `rgba(241,245,249,0.9)`, text `#1e293b`, muted `#94a3b8`, border `rgba(99,102,241,0.12–0.2)`, accent `#4f46e5`, danger `#dc2626`, warning `#d97706`, success `#16a34a`.

No `style={{}}` for colours/layout — CSS files only.

### 5 — CSS File Organisation

One CSS file per subtab/view + one shared base file. Never put all subtab styles in a single large file.

**CSS files by page:**
- `styles/pages/pm-reports.css` — PMReports, Tracking, QA Pipeline
- `styles/pages/daily-ops.css` — Daily Ops tab
- `styles/pages/integrations.css` — Integrations page
- `styles/pages/pm-features.css` — Velocity + Burndown charts (`.pmf-*`)
- `styles/pages/dev-activity-base.css` + `dev-activity-{feed,cards,log,heatmap,report}.css` — Dev Activity 5 subtabs
- `index.css` — global shared classes

When adding a new multi-subtab page: `<page>-base.css` + one `<page>-<subtab>.css` per view. Import all in the page component and in `index.css`.

---

## MCP Tools: code-review-graph

**Always use code-review-graph tools BEFORE Grep/Glob/Read for codebase exploration.**

| Tool | Use when |
|---|---|
| `semantic_search_nodes` / `query_graph` | Exploring code |
| `get_impact_radius` | Blast radius of a change |
| `detect_changes` + `get_review_context` | Code review |
| `get_affected_flows` | Impacted execution paths |
| `get_architecture_overview` + `list_communities` | Architecture questions |

Graph auto-updates on file change. Run `code-review-graph build` after a major refactor.

---

## Feature Reference Docs

Detailed descriptions of each feature/tab live in `docs/features/`. Read the relevant file before working on that feature.

| File | Covers |
|---|---|
| [`docs/features/auth.md`](docs/features/auth.md) | Login flow, dev mode, access control |
| [`docs/features/pm-reports.md`](docs/features/pm-reports.md) | Tracking tab (12 views), Velocity chart, Burndown chart |
| [`docs/features/daily-ops.md`](docs/features/daily-ops.md) | Developer Load view |
| [`docs/features/pm-assistant.md`](docs/features/pm-assistant.md) | AI chat, YQL reference |
| [`docs/features/board.md`](docs/features/board.md) | Kanban board, List view, Sprint Dashboard |
| [`docs/features/dev-activity.md`](docs/features/dev-activity.md) | Dev Activity page — 5 subtabs, CSS map, skeuomorphic report design |
| [`docs/features/other-tabs.md`](docs/features/other-tabs.md) | Calendar, Reminders, Day Track, Integrations, Settings, Admin, Reports, Slack, Bot Config, AI Analysis |
