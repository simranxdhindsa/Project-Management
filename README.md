# Ardoise Project Management

A PM command centre built for the Ardoise/Apyhub delivery workflow. Connects to YouTrack for live issue tracking, Slack for reporting and monitoring, and uses AI to surface blocker reasons, generate EOD action plans, and keep the PM's daily loop tight.

---

## What it does

### PM Reports — Daily Ops tab
The core of the PM's daily workflow, all in one place.

**Morning Brief**
- Pulls live YouTrack issues grouped by priority (P0 → P3)
- Shows done yesterday, blocked issues (our side vs Ardoise side), open/unassigned items
- AI analyses each blocked ticket's comments to extract the blocker reason — cached, only re-run when a new comment is added or the issue moves out of Blocked state
- Carry-over checklist from yesterday's EOD plan shown at the top
- Generates the exact Slack report format used by the PM — editable before posting
- One-click post to any Slack channel (Ardoise, Apyhub, or any configured channel)

**EOD Wrap-up**
- Shows what was completed today, still in progress, had no movement (skipped), and newly blocked
- Filter to just "No Movement" or just "Blockers" for quick focus
- AI generates a bullet-point next-day action plan from today's data
- "Save as Action Items" splits the plan into a checklist that appears in tomorrow's Morning Brief carry-over section

**Developer Load**
- Per-developer view: active issues, blocked issues, done today, avg hours per P1/P2
- Overloaded flag (>3 In Progress) and missing-update flag (no YouTrack activity today)
- Sorted by overloaded first, then by active issue count

**Blocker sync across tabs**
Blocked issues identified in Daily Ops automatically show a 🚧 badge in Issue Timeline and a ⚠ chip in Time Tracking — no manual cross-referencing.

### PM Reports — other tabs
| Tab | What it shows |
|---|---|
| Time Tracking | Every YouTrack state transition with duration, overdue flags, pinned rows |
| Issue Timeline | Full state history per issue, with blocked badges |
| Daily Report | Date-stamped saved reports |
| Assignee Stats | Per-developer open/in-progress/done/blocked counts and avg time |
| PM Assistant | AI chat over your YouTrack data |

### Slack Intelligence
- Monitors a configured channel for @mentions of the logged-in user
- Tracks threads the PM started and flags unanswered ones
- Digest posting, mention dismissal, snooze (2h or until tomorrow)
- Follow-up reminders tied to Slack threads — appear in Reminders page

### Reminders
Set reminders on any YouTrack issue directly from Daily Ops issue rows (hover → 🔔 Remind). Also supports task-based, Slack follow-up, and custom reminders. Real-time SSE notifications.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| Styling | Custom glassmorphism CSS (no Tailwind) |
| Icons | Lucide React |
| Backend | Go (gorilla/mux) |
| Database | PostgreSQL (pgx driver) |
| Auth | Google OAuth + JWT |
| Issue tracking | YouTrack REST API |
| Messaging | Slack Bot API |
| AI | Groq (llama-3.3-70b-versatile) with OpenAI fallback |

---

## Project structure

```
Project-Management/
├── backend/
│   ├── cmd/server/main.go          # Entry point, route registration
│   └── internal/
│       ├── auth/                   # Google OAuth + JWT
│       ├── database/
│       │   ├── migrations.go       # All CREATE TABLE statements
│       │   ├── reminder_repo.go
│       │   ├── slack_repo.go
│       │   ├── report_repo.go
│       │   └── ...
│       ├── handlers/
│       │   ├── youtrack.go         # Daily brief, EOD, developer load, blocker reasons, carry-over
│       │   ├── slack.go            # Slack connect, scan, post, morning report
│       │   ├── ai.go               # EOD plan generation
│       │   └── ...
│       ├── middleware/             # JWT auth, user context
│       ├── models/                 # Reminder, SlackMention, SlackIntegration, etc.
│       └── services/
│           ├── youtrack/           # YouTrack REST client (issues, comments, activities)
│           └── slack/              # Slack client + service (scan, post, digest)
│
└── frontend/
    └── src/
        ├── pages/
        │   ├── PMReportsPage.tsx       # Tab shell + shared blockerIssueIds state
        │   ├── DailyOpsTab.tsx         # Morning brief, EOD, developer load
        │   ├── SlackIntelligencePage.tsx
        │   └── ...
        ├── services/api.ts             # All API methods + TypeScript interfaces
        └── index.css                   # All styles (do-*, si-*, pr-* class namespaces)
```

---

## Database tables (key ones)

| Table | Purpose |
|---|---|
| `issue_state_log` | Every YouTrack state transition — drives time tracking, EOD summary, developer load |
| `blocker_analysis_cache` | AI-extracted blocker reason per issue, cached by comment count |
| `daily_ops_carryover` | EOD action items per user per date — tomorrow's morning carry-over |
| `slack_mentions` | @mentions of the PM user, with replied/snoozed state |
| `slack_user_threads` | Threads the PM started, tracks reply count |
| `reminders` | All reminders (task, issue, Slack follow-up, custom) |
| `pm_reports` | Saved daily reports by date |
| `slack_integrations` | Bot token, digest channel, monitor channel per user |

---

## Environment variables

### Backend
```env
PORT=8080
DATABASE_URL=postgres://...
JWT_SECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
YOUTRACK_URL=https://yourinstance.youtrack.cloud
YOUTRACK_TOKEN=perm:...
GROQ_API_KEY=...          # preferred AI provider
OPENAI_API_KEY=...        # fallback if GROQ_API_KEY not set
```

### Frontend
```env
VITE_API_URL=http://localhost:8080/api
VITE_GOOGLE_CLIENT_ID=...
```

---

## Running locally

```bash
# Backend (port 8080)
cd backend
go run cmd/server/main.go

# Frontend (port 5173)
cd frontend
npm install
npm run dev
```

---

## Key API routes

### YouTrack
| Method | Route | Description |
|---|---|---|
| GET | `/api/youtrack/daily-brief` | Morning brief — issues grouped by priority, done yesterday, blockers |
| GET | `/api/youtrack/eod-summary` | Today's completed, in-progress, no-movement, new blockers |
| GET | `/api/youtrack/developer-load` | Per-developer active/blocked/done + overload flags |
| GET | `/api/youtrack/blocker-reasons?ids=...` | AI-extracted blocker reasons (cached) |
| POST | `/api/youtrack/save-plan` | Save EOD action items as carry-over checklist |
| GET | `/api/youtrack/carryover` | Yesterday's + today's carry-over items |

### Slack
| Method | Route | Description |
|---|---|---|
| POST | `/api/slack/post-morning-report` | Post formatted report to one or more channels |
| POST | `/api/slack/scan` | Scan channel for @mentions and user threads |
| GET | `/api/slack/mentions` | List @mentions with replied/snoozed state |
| GET | `/api/slack/channels` | List available Slack channels |

### AI
| Method | Route | Description |
|---|---|---|
| POST | `/api/ai/eod-plan` | Generate next-day action plan from EOD data |
| POST | `/api/youtrack/pm-query` | PM Assistant — AI chat over YouTrack data |

---

## Issue lifecycle

```
Backlog → In Progress → Dev → Ready for Stage → Stage → Ready for PROD → PROD
                                                                         ↓
                                                                       Closed
```

- **Done** = transitioned to Dev, Ready for Stage, Stage, Ready for PROD, or PROD
- **Pending PM/QA** = sitting in Dev state (dev finished, PM needs to verify)
- **Blocked** = stuck, appears in Daily Ops blocked sections with AI reason
- **Closed** = excluded from all active reports
