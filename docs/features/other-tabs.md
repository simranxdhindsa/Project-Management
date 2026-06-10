# Other Tabs & Pages

## Calendar

`frontend/src/components/calendar/CalendarView.tsx` — date-range view of sprint issues. Use this component for any calendar/date-range display in the app, never build a new one.

## Reminders

Reminder creation and management. Backend polling started in `main.go` as a background job.

## Day Track (`DayTrackPage.tsx`)

Daily planner — log what you worked on, plan ahead for the next day. "Schedule For" dropdown and all other dropdowns use the `pm-custom-dropdown` portal pattern.

## Integrations (`IntegrationsPage.tsx`)

- **YouTrack setup**: base URL, project ID, board ID (fetched as dropdown via `api.getYouTrackBoards()`), permanent token (optional on update — backend reuses saved token if field is empty)
- **Asana setup**: PAT, workspace, project
- **Active PM Data Source**: switches the global data source between YouTrack and Asana — affects every PM feature
- **Column Hierarchy / Workflow Config**: defines column roles (`active`, `blocked`, `dev_done`, etc.) and priority tag mappings

CSS: `styles/pages/integrations.css`

## Settings

Access control management — whitelist entries, denied emails denylist. Admin-only.

## Admin

User management, role assignment.

## Reports

Deployment report builder — `frontend/src/components/deployment/` components. Lets you assemble a deployment report from completed tickets.

## Bot Config

Runtime editing of AI bot prompts stored in the `bot_configs` table. Changes take effect immediately without a redeploy.

## AI Analysis

Slack message analysis via the configured AI provider (Groq/OpenAI/Gemini).

## Slack

Slack integration management — bot token, channel selection.
