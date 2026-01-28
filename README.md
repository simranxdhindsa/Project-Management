# Project Management

A modern project management tool that syncs with Asana, provides Kanban/List views, and uses AI to analyze Slack messages to determine task completion status.

## Features

- **Asana Integration** - Two-way sync with Asana (tasks update in both places)
- **Kanban Board View** - Drag & drop interface like Asana
- **List View** - Table view with sortable columns and Asana links
- **Calendar Navigation** - Click any date to see tasks, with status dot indicators
- **AI-Powered Slack Analysis** - Uses Google Gemini to understand task progress from Slack messages
- **Daily Carry-Over** - See yesterday's pending tasks when you open the app
- **Notification System** - Real-time updates with badge indicators
- **Reports & Analytics** - Team productivity, individual stats, and project health metrics
- **User Roles** - Admin, Project Manager, Member, and Viewer permissions

## Tech Stack

### Frontend
- React 18 + TypeScript + Vite
- Tailwind CSS + Custom Glassmorphism Theme
- Lucide Icons
- @dnd-kit (Drag & Drop)
- Recharts (Charts)

### Backend
- Go (Golang)
- Gorilla Mux (Router)
- PostgreSQL (via Supabase)
- JWT Authentication

### Integrations
- Google OAuth
- Asana REST API
- Slack Bot API
- Google Gemini API

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- Go (v1.21 or higher)
- npm or yarn

### Installation

1. Clone the repository
```bash
git clone https://github.com/yourusername/project-management.git
cd project-management
```

2. Install frontend dependencies
```bash
cd frontend
npm install
```

3. Install backend dependencies
```bash
cd ../backend
go mod tidy
```

### Development

**Frontend** (runs on http://localhost:5173)
```bash
cd frontend
npm run dev
```

**Backend** (runs on http://localhost:8080)
```bash
cd backend
go run cmd/server/main.go
```

### Build for Production

**Frontend**
```bash
cd frontend
npm run build
```

**Backend**
```bash
cd backend
go build -o project-management cmd/server/main.go
```

## Project Structure

```
Project-Management/
├── backend/
│   ├── cmd/server/          # Entry point
│   ├── internal/
│   │   ├── auth/            # Authentication handlers
│   │   ├── handlers/        # API route handlers
│   │   ├── middleware/      # JWT & permission middleware
│   │   ├── models/          # Data models
│   │   ├── services/        # Business logic (Asana, Slack, Gemini)
│   │   └── database/        # Database connection
│   ├── go.mod
│   └── go.sum
│
├── frontend/
│   ├── src/
│   │   ├── components/      # React components
│   │   ├── pages/           # Page components
│   │   ├── hooks/           # Custom React hooks
│   │   ├── services/        # API client
│   │   └── lib/             # Utilities
│   ├── package.json
│   └── vite.config.ts
│
└── README.md
```

## Environment Variables

### Backend (.env)
```env
PORT=8080
DATABASE_URL=your_supabase_connection_string
JWT_SECRET=your_jwt_secret
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
ASANA_CLIENT_ID=your_asana_client_id
ASANA_CLIENT_SECRET=your_asana_client_secret
SLACK_BOT_TOKEN=your_slack_bot_token
GEMINI_API_KEY=your_gemini_api_key
```

### Frontend (.env)
```env
VITE_API_URL=http://localhost:8080/api
VITE_GOOGLE_CLIENT_ID=your_google_client_id
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/health | Health check |
| POST | /api/auth/google | Google OAuth callback |
| GET | /api/auth/me | Get current user |
| GET | /api/tasks | List tasks |
| POST | /api/tasks | Create task |
| PATCH | /api/tasks/:id/status | Update task status |
| POST | /api/asana/connect | Connect Asana |
| POST | /api/asana/sync | Sync with Asana |
| POST | /api/slack/analyze | Analyze Slack messages with AI |
| GET | /api/notifications | Get notifications |
| GET | /api/reports/team-productivity | Team report |

## Deployment

### Frontend (Vercel)
1. Connect your GitHub repo to Vercel
2. Set the root directory to `frontend`
3. Add environment variables

### Backend (Render)
1. Connect your GitHub repo to Render
2. Set the root directory to `backend`
3. Build command: `go build -o main cmd/server/main.go`
4. Start command: `./main`
5. Add environment variables

## License

This project is licensed under the MIT License.
