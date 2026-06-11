# Velocity

React + Go project management tool. Frontend (Vite, port 5173) talks to a Go REST API (port 8080).

## Getting Started

### Prerequisites

- Go 1.24+
- Node.js 20+
- PostgreSQL (or leave `DATABASE_URL` unset for in-memory mode)
- [`air`](https://github.com/air-verse/air) for Go hot-reload: `go install github.com/air-verse/air@latest`

### Environment

Copy and fill in the env files:

```
backend/.env
frontend/.env
```

See `CLAUDE.md` for the full list of required variables.

---

## npm Scripts (run from project root)

| Command | What it does |
|---|---|
| `npm run dev` | Starts both backend (air) and frontend (Vite) together |
| `npm run be` | Backend only — Go hot-reload via `air` on port 8080 |
| `npm run fe` | Frontend only — Vite dev server on port 5173 |
| `npm run kill` | Kills whatever is running on port 8080 |
| `npm run restart` | Kills port 8080 then restarts the backend |

### Typical workflow

```bash
# First time
cd frontend && npm install

# Daily dev — everything at once
npm run dev

# If the backend gets stuck
npm run restart

# Frontend only (backend already running)
npm run fe
```

---

## Architecture

```
velocity/
  backend/       Go REST API (port 8080)
  frontend/      Vite + React (port 5173)
  docs/features/ Feature-level documentation
  CLAUDE.md      AI coding assistant context
```

All frontend API calls go to `/api` on port 8080. Protected routes require `Authorization: Bearer <JWT>`.

See [`CLAUDE.md`](./CLAUDE.md) for detailed architecture, backend route layout, and development rules.
