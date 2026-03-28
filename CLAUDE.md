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
