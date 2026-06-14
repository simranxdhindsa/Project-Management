# Changelog

All notable changes to Velocity are listed here. Most recent entries appear first.

---

## 2026-06-11

### Features
- Sprint Pulse Kanban is now a real swimlane — tier rows × state columns, draggable, with danger pulse
- Sprint Pulse Kanban uses real workflow state columns with drag-and-drop

### Enhancements
- SprintControlsBar shared component — replaces duplicated controls bar across Sprint Dashboard and Sprint Pulse
- Dev Report moved to first tab position
- Replaced "Yesterday" with "Last 2 Days" in date range options

### Bug Fixes
- Fixed issue timelines to include tickets completed in range even if In Progress started earlier
- Fixed `drIsDone` to use exact match; hide loading spinner on report tab
- Fixed pm-custom-dropdown active/hover colours to use theme CSS variables instead of hardcoded values
- Fixed priority badge to show raw YouTrack priority value instead of mapped internal label
- Fixed carousel CSS

### Refactors
- Added reusable `CustomDropdown` component; replaced native selects in Dev Activity page
- Replaced Schedule For `<select>` with `pm-custom-dropdown` in DayTrack Plan Ahead

---

## 2026-06-10

### Features
- Dev Activity — 4-view activity report (Feed, Cards, Log, Heatmap)

### Enhancements
- Restored name header and blank line spacing in DayTrack personal Slack report
- AI Fill: Bot Prompt Migration

### Bug Fixes
- Fixed priority badge showing mapped label instead of raw YouTrack field value

---

## 2026-06-06

### Refactors
- Split dev-activity.css into 6 per-subtab files for maintainability
- Lean CLAUDE.md: moved feature docs to docs/features/, added feature reference table

---

## 2026-06-05

### Features
- Sprint Pulse page — 4-view priority intelligence dashboard (Board, Focus, Signal, Pulse Board)

### Enhancements
- Sprint Pulse as dashboard view; ticket ID/title click + sprint selector integration
- Added Sprint Tracker view

---

## 2026-06-04

### Enhancements
- Fixed Dev Activity: attribution by moved_by, heatmap presence dots, blocked transition, DEV_DONE_STATES, 0-stint filter, priority dot colours
- Fixed Dev Report attribution: use moved_by for done stints, fix ImportHistory assignee fallback
- Fixed velocity dropdown to use pm-custom-dropdown pattern; hide controls in dashboard view
