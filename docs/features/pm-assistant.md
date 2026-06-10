# PM Assistant — AI Chat

## Overview

AI chat over YouTrack sprint data. Allows natural-language queries about tickets, assignees, blockers, and sprint health.

## Two-Step LLM Flow

1. Translate user query → YQL (YouTrack Query Language)
2. Fetch matching issues from YouTrack API
3. Respond with per-ticket context: bounce counts, overdue flags, state history

## Full Technical Reference

**Read [`backend/YQL.md`](../../backend/YQL.md) before modifying the PM Assistant.**

Covers:
- YQL syntax and supported fields
- Subsystem exclusion logic
- Analytics overrides
- Bounce detection algorithm
- Bot prompt file locations
- Model configuration (`AI_PROVIDER` env var)
- Known limitations

## AI Provider

Selected via `AI_PROVIDER` env var: `groq`, `openai`, or `gemini`. Bot prompts editable at runtime via the `bot_configs` table (Bot Config tab in UI).

## Key Files

- `backend/internal/handlers/ai.go` — chat handler
- `backend/internal/services/youtrack/` — YQL execution
- `frontend/src/pages/` — PM Assistant UI
