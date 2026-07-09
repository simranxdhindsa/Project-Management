# Update Reminders

Automated Slack-based reminder system. PMs create rules that check who has/hasn't posted daily standup updates in Slack channels and fire reminder messages on a configurable schedule.

## UI placement

Sub-tab inside the **Slack** page (`'update-reminders'` tab key). Renders `<UpdateRemindersTab>` from `frontend/src/pages/UpdateRemindersTab.tsx`.

## Features

### Rule CRUD
- Create / edit / delete / enable-disable reminder rules
- Each rule: name, schedule (time + days + timezone), source channels, detection mode, roster, leave handling, delivery targets, message templates
- Admin/ProjectManager can see and modify all rules; regular users only their own

### Schedule
- Fires at `HH:MM` in the rule's timezone (stored as `schedule_time` + `timezone` fields)
- Days-of-week bitmask stored as `schedule_days: []int` (0=Sun … 6=Sat)
- Scheduler checks every 60s; uses `firedToday["ur:"+ruleID]` key for double-fire prevention

### Detection modes
- `any_message` — any message from a roster member in the check window counts
- `keywords` — message must contain one of the comma-separated keywords
- `pattern` — message must match a regex

### Check window
- `check_day_offset`: 0=today, -1=yesterday, -2=2 days ago, etc.
- `check_window_start` / `check_window_end`: HH:MM 24h bounds within that day

### Roster
- Per-rule list of Slack members to track (`update_reminder_roster` table)
- Members can be individually enabled/disabled without removing them
- Added from workspace user search (fetched via `users.list` Slack API)

### Leave handling
- Optional leave channel: bot reads messages for leave keywords
- `leave_action: exclude` — on-leave members disappear from reminder entirely
- `leave_action: list_separately` — on-leave members listed under `{on_leave_names}` placeholder

### Dry run / Run now
- **Dry Run** — computes fresh snapshot, diffs against saved snapshot, returns rendered message; does NOT send
- **Run Now** — `force_snapshot: true` sends fresh computed state; `force_snapshot: false` sends saved snapshot
- If diff detected (someone posted since last snapshot), UI warns and lets user choose "Send Updated" or "Send Original Snapshot"

### Quick Send
- Collapsible card at top of the tab
- Send a one-off message to any channel or DM any workspace member
- Session-only send history (last 10)

### Run history
- 30-day retention in `update_reminder_runs` table
- `expires_at` set on insert; nightly purge via `PurgeUpdateReminderRuns()` called from scheduler

## Backend

| File | Role |
|------|------|
| `backend/internal/models/update_reminder.go` | All structs: rule, snapshot, diff, roster member, run, requests |
| `backend/internal/database/update_reminder_repo.go` | CRUD for rules, roster, run history; `GetAllEnabledRules` for scheduler |
| `backend/internal/services/update_reminder/service.go` | `ComputeSnapshot`, `DiffSnapshot`, `RenderTemplate`, `Execute`, `ExecuteScheduled`, `QuickSend` |
| `backend/internal/handlers/update_reminder.go` | REST handlers; `ownerOrAdmin` helper |
| `backend/internal/services/scheduler/service.go` | `fireUpdateReminders()` called each tick; purge task |

## API routes

All under `/api/update-reminders` (JWT-protected):

```
GET    /api/update-reminders               — list rules (admin sees all)
POST   /api/update-reminders               — create rule
GET    /api/update-reminders/:id           — get rule
PUT    /api/update-reminders/:id           — update rule
DELETE /api/update-reminders/:id           — delete rule
PATCH  /api/update-reminders/:id/toggle    — enable/disable { enabled: bool }
GET    /api/update-reminders/:id/roster    — list roster members
POST   /api/update-reminders/:id/roster    — add member { display_name, slack_user_id, enabled }
PUT    /api/update-reminders/:id/roster/:mid   — update member { enabled?, display_name? }
DELETE /api/update-reminders/:id/roster/:mid   — remove member
POST   /api/update-reminders/:id/dry-run   — dry run (no send)
POST   /api/update-reminders/:id/run-now   — run { force_snapshot: bool }
GET    /api/update-reminders/:id/history   — last 30 days of runs
POST   /api/slack/quick-send              — { channel_id?, message, dm_user_id? }
GET    /api/slack/workspace-users         — paginated users.list from Slack
```

## DB tables

- `update_reminder_rules` — rule config (JSONB columns for arrays/objects)
- `update_reminder_roster` — per-rule member list (FK → rules ON DELETE CASCADE)
- `update_reminder_runs` — run history with `expires_at` for 30-day TTL

## Template placeholders

`{names}` · `{mentions}` · `{date}` · `{count}` · `{on_leave_names}`

## Frontend data access pattern

The backend returns **bare arrays/objects** (not `{ success, data }` wrappers). Always read `r` directly:

```ts
// CORRECT
const r = await api.listUpdateReminderRules()
if (Array.isArray(r)) setRules(r)

// WRONG — r.data is always undefined
if (r.data) setRules(r.data)
```

## CSS

`frontend/src/styles/pages/slack-update-reminders.css` — all `.ur-*` classes.
