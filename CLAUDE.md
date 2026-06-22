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

After every task, output a short commit message (don't run git commit). One-liner prefixed with the change type:

`FEATURE:` — new page, tab, or capability  
`ENHANCEMENT:` — improvement to existing feature  
`BUG:` — bug fix  
`REFACTOR:` — code restructure with no behaviour change  
`STYLE:` — UI/CSS only change  
`CHORE:` — config, tooling, dependency update

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

**Column pipeline (in order):**

| Column | Role | Who acts | Meaning |
|---|---|---|---|
| To Do | `''` (backlog) | — | Not started |
| In Progress | `active` | Developer | Developer currently working |
| Dev | `dev_done` | Developer | Developer finished; QA to verify on dev |
| Mobile Done | `dev_done` | Developer | Mobile developer finished |
| Ready for Stage | `verified` | QA | Verified on dev environment |
| Stage | `deployed` | DevOps | Code deployed to stage |
| Ready for PROD | `verified` | QA | Verified on stage environment |
| PROD | `deployed` | DevOps | Code deployed to prod |
| Verified | `verified` | QA | Verified on prod environment |
| Blocked | `blocked` | — | Developer is blocked |
| Closed | `closed` | — | **Excluded entirely** — ticket closed, no longer needed |

**Role semantics:**
- `dev_done` — developer action; `since_date` = when developer moved it → use for "Done Today" in dev load views
- `verified` — QA/PM verified; `since_date` = QA action time (do NOT use for developer "Done Today")
- `deployed` — DevOps deployed; `since_date` = deploy time (do NOT use for developer "Done Today")
- `closed` — skip entirely; do not count in done, overdue, or any progress metric

Done (`dev_done`, `verified`, `deployed`) and blocked tickets **never** count as overdue. Only `active` + `backlog` count.

**"Done Today" rule:** Only `dev_done` tickets where `isToday(since_date)`. Tickets in `verified`/`deployed` states have `since_date` updated by QA/DevOps — attributing those to the developer's "done today" would be incorrect.

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

Every component must work in both dark (default) and light mode. Always use CSS variables — **never hardcode hex values**. All variables are defined in `frontend/src/styles/tokens.css`.

```css
.my-class { background: var(--bg-surface); color: var(--text-primary); }
[data-theme="light"] .my-class { background: var(--bg-elevated); color: var(--text-primary); }
```

**Use these variables — never the raw hex:**

| Role | Variable | Notes |
|------|----------|-------|
| Accent / primary | `var(--color-primary)` | User-customisable — never hardcode |
| Accent hover | `var(--color-primary-hover)` | |
| Accent light | `var(--color-primary-light)` | |
| Accent for rgba() | `var(--color-primary-rgb)` | Use as `rgba(var(--color-primary-rgb), 0.15)` |
| Page background | `var(--bg-base)` | Darkest layer |
| Panel / surface | `var(--bg-surface)` | Sidebars, panels |
| Card / elevated | `var(--bg-elevated)` | Cards, dropdowns |
| Card glass tint | `var(--bg-card)` | `rgba(255,255,255,0.04)` tint over bg |
| Primary text | `var(--text-primary)` | |
| Secondary text | `var(--text-secondary)` | |
| Muted / label text | `var(--text-muted)` | |
| Danger | `var(--color-danger)` | Use `var(--color-danger-muted)` for bg tints |
| Warning | `var(--color-warning)` | Use `var(--color-warning-muted)` for bg tints |
| Success | `var(--color-success)` | Use `var(--color-success-muted)` for bg tints |
| Border | `var(--border-color)` | |
| Subtle border | `var(--border-subtle)` | |
| Glow / shadow | `var(--shadow-glow)` | Primary accent glow |

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

### 6 — Skeleton Loaders (Required)

**Every loading state must have a skeleton that matches the real layout.** Never use a spinner or blank space where cards/lists will appear.

**Rules:**
- Mirror the real card's padding, border-radius, and inner structure exactly — the skeleton should feel like the content "appearing" rather than replacing a placeholder
- Use the `.skeleton` CSS class for shimmer animation (defined in `index.css`)
- Make widths vary per card index so consecutive cards look organic, not identical — use a small lookup array, e.g. `const W = [55, 70, 48, 65, 58, 72]` and index with `W[i % 6]`
- Use the same CSS grid/layout classes as the real view (e.g. `ops-grid-rings`) so the skeleton occupies the correct space
- For donut/ring charts: fake a ring with a full circle `skeleton` div + an inner div in `var(--bg-surface)` color for the cutout
- For progress/fill bars: use a skeleton div at a varying `%` width inside a fixed-height container
- Export skeletons from the same file as the real components — the skeleton for `OpsViewRings` lives in `DailyOpsViews.tsx`, not a separate file
- For multi-view pages: one `ViewSkeleton({ view: string })` dispatcher that switches on view key — avoids per-view conditional chains in the parent

**Pattern:**
```tsx
const Sk = ({ w, h, r = 6 }: { w: number | string; h: number; r?: number | string }) => (
  <div className="skeleton" style={{ width: w, height: h, borderRadius: r, flexShrink: 0 }} />
)
const W = [55, 70, 48, 65, 58, 72] // vary name bar widths

function SkMyView() {
  return (
    <div className="my-grid-class"> {/* same grid class as real view */}
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} style={{ background: GLASS, borderRadius: 16, padding: 18, border: `1px solid ${BORDER}` }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <Sk w={34} h={34} r="50%" />          {/* avatar */}
            <Sk w={`${W[i % 6]}%`} h={13} r={4} /> {/* name */}
          </div>
          {/* ... mirror each real element */}
        </div>
      ))}
    </div>
  )
}

export function MyViewSkeleton({ view }: { view: string }) {
  switch (view) {
    case 'rings': return <SkRings />
    // ...
  }
}
```

### 7 — Responsive Design (Required)

**Every page and view must work at mobile (375px), tablet (768px), and desktop (1280px).** This is non-negotiable — implement responsive CSS at the same time as the feature, not as a follow-up.

Rules:
- Use CSS media queries — never conditional rendering based on `window.innerWidth`
- Move grid/layout styles to CSS classes (not inline `style={{}}`) so media queries can override them
- At `≤768px`: single-column grids, hide non-essential table columns, make horizontal tab bars scrollable (`flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none`)
- At `769px–1024px` (tablet): 2-column grids, reduced padding
- Tab bars with many items: always `flex-wrap: nowrap; overflow-x: auto` so tabs are swipeable, not wrapping

**Checklist before marking a UI task done:**
- [ ] Desktop (1280px): looks correct
- [ ] Tablet (768px): 2 columns, no overflow
- [ ] Mobile (375px): 1 column, tab bar scrollable, no horizontal scroll on page

### 7 — Shared Components First

**Before writing any UI pattern inline, check `frontend/src/components/` for an existing shared component.**

If the same UI pattern is needed in 2+ places, extract it into a shared component — never copy-paste the same JSX block. Examples of shared components already in use:

| Component | What it encapsulates |
|---|---|
| `SprintControlsBar` | `db-controls` bar — left mode dropdown + sprint selector + children slot |
| `CustomDropdown` | `pm-custom-dropdown` pattern with outside-click |
| `HoverCard` | Portal hover overlay |
| `IssueDetailPanel` | YouTrack issue detail slide-in |
| `CalendarView` | Date-range calendar |

**Rule:** If you find yourself copying a block of JSX from one page to another, stop — extract a component instead and use it in both places. The first duplication is the signal to extract; the second is too late.

---

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
| [`docs/features/daily-ops-views.md`](docs/features/daily-ops-views.md) | 6 design views in Daily Ops tab (Health Rings, Mission Control, Stuck Detector, Hotfix Command, Pulse Strips, Snapshot) |
| [`docs/features/pm-assistant.md`](docs/features/pm-assistant.md) | AI chat, YQL reference |
| [`docs/features/board.md`](docs/features/board.md) | Kanban board, List view, Sprint Dashboard |
| [`docs/features/dev-activity.md`](docs/features/dev-activity.md) | Dev Activity page — 5 subtabs, CSS map, skeuomorphic report design |
| [`docs/features/other-tabs.md`](docs/features/other-tabs.md) | Calendar, Reminders, Day Track, Integrations, Settings, Admin, Reports, Slack, Bot Config, AI Analysis |
