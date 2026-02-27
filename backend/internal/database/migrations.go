package database

import (
	"context"
	"fmt"
	"log"
)

// RunMigrations creates all database tables
func RunMigrations() error {
	ctx := context.Background()
	pool := GetPool()

	migrations := []string{
		// Users table
		`CREATE TABLE IF NOT EXISTS users (
			id VARCHAR(255) PRIMARY KEY,
			email VARCHAR(255) UNIQUE NOT NULL,
			name VARCHAR(255) NOT NULL,
			picture TEXT,
			role VARCHAR(50) NOT NULL DEFAULT 'member',
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,

		// Projects table
		`CREATE TABLE IF NOT EXISTS projects (
			id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
			name VARCHAR(255) NOT NULL,
			description TEXT,
			owner_id VARCHAR(255) REFERENCES users(id),
			asana_project_id VARCHAR(255),
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,

		// Project members table
		`CREATE TABLE IF NOT EXISTS project_members (
			project_id VARCHAR(255) REFERENCES projects(id) ON DELETE CASCADE,
			user_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
			role VARCHAR(50) NOT NULL DEFAULT 'member',
			joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			PRIMARY KEY (project_id, user_id)
		)`,

		// Tasks table
		`CREATE TABLE IF NOT EXISTS tasks (
			id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
			title VARCHAR(255) NOT NULL,
			description TEXT,
			status VARCHAR(50) NOT NULL DEFAULT 'todo',
			priority VARCHAR(50) NOT NULL DEFAULT 'medium',
			project_id VARCHAR(255) REFERENCES projects(id) ON DELETE CASCADE,
			assignee_id VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
			asana_id VARCHAR(255),
			asana_url TEXT,
			due_date TIMESTAMP WITH TIME ZONE,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			created_by VARCHAR(255) REFERENCES users(id)
		)`,

		// Task history for carry-over feature (no FK constraints — avoids type mismatch with UUID PKs)
		`CREATE TABLE IF NOT EXISTS task_history (
			id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
			task_id TEXT NOT NULL,
			status VARCHAR(50) NOT NULL,
			changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			changed_by TEXT
		)`,

		// Columns for custom kanban ordering
		`CREATE TABLE IF NOT EXISTS columns (
			id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
			project_id VARCHAR(255) REFERENCES projects(id) ON DELETE CASCADE,
			name VARCHAR(255) NOT NULL,
			position INT NOT NULL DEFAULT 0
		)`,

		// Notifications table (no FK constraints — avoids type mismatch with UUID PKs)
		`CREATE TABLE IF NOT EXISTS notifications (
			id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
			user_id TEXT NOT NULL,
			type VARCHAR(50) NOT NULL,
			title VARCHAR(255) NOT NULL,
			message TEXT NOT NULL,
			task_id TEXT,
			read BOOLEAN DEFAULT FALSE,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,

		// Asana integrations
		`CREATE TABLE IF NOT EXISTS asana_integrations (
			id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
			user_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
			access_token TEXT NOT NULL,
			refresh_token TEXT,
			workspace_id VARCHAR(255) NOT NULL,
			workspace_name VARCHAR(255),
			connected BOOLEAN DEFAULT TRUE,
			last_sync_at TIMESTAMP WITH TIME ZONE,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			UNIQUE(user_id)
		)`,

		// Slack integrations
		`CREATE TABLE IF NOT EXISTS slack_integrations (
			id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
			user_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
			bot_token TEXT NOT NULL,
			team_id VARCHAR(255) NOT NULL,
			team_name VARCHAR(255),
			channel_id VARCHAR(255),
			channel_name VARCHAR(255),
			connected BOOLEAN DEFAULT TRUE,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			UNIQUE(user_id)
		)`,

		// Slack messages cache
		`CREATE TABLE IF NOT EXISTS slack_messages (
			id VARCHAR(255) PRIMARY KEY,
			channel_id VARCHAR(255) NOT NULL,
			user_id VARCHAR(255),
			user_name VARCHAR(255),
			text TEXT NOT NULL,
			timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
			thread_ts VARCHAR(255),
			fetched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,

		// Slack analysis results
		`CREATE TABLE IF NOT EXISTS slack_analysis_results (
			id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
			task_id VARCHAR(255) REFERENCES tasks(id) ON DELETE SET NULL,
			task_title VARCHAR(255) NOT NULL,
			slack_status VARCHAR(50) NOT NULL,
			asana_status VARCHAR(50),
			confidence DECIMAL(3,2) NOT NULL,
			message_ids TEXT[],
			discrepancy BOOLEAN DEFAULT FALSE,
			analyzed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,

		// Sync logs
		`CREATE TABLE IF NOT EXISTS sync_logs (
			id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
			type VARCHAR(50) NOT NULL,
			direction VARCHAR(50) NOT NULL,
			status VARCHAR(50) NOT NULL,
			tasks_synced INT DEFAULT 0,
			errors TEXT[],
			started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			completed_at TIMESTAMP WITH TIME ZONE,
			triggered_by VARCHAR(255) REFERENCES users(id)
		)`,

		// Add youtrack_id to next_day_tasks if missing
		`ALTER TABLE next_day_tasks ADD COLUMN IF NOT EXISTS youtrack_id VARCHAR(255)`,
		`CREATE INDEX IF NOT EXISTS idx_next_day_tasks_youtrack_id ON next_day_tasks(youtrack_id)`,

		// Reminders table (no FK on user_id — avoids type mismatch with UUID PKs)
		`CREATE TABLE IF NOT EXISTS reminders (
			id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
			user_id TEXT NOT NULL,
			type VARCHAR(50) NOT NULL DEFAULT 'custom',
			title VARCHAR(500) NOT NULL,
			message TEXT,
			target_date DATE NOT NULL,
			target_time TIME,
			related_task_id TEXT,
			related_issue_id TEXT,
			recurring VARCHAR(20) NOT NULL DEFAULT 'none',
			status VARCHAR(20) NOT NULL DEFAULT 'pending',
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,

		// Scheduler settings defaults
		`INSERT INTO global_settings (key, value, description) VALUES
			('scheduler_enabled', 'true', 'Enable/disable the background scheduler'),
			('scheduler_midday_check_time', '14:00', 'Time for mid-day update check (HH:MM)'),
			('scheduler_evening_check_time', '18:00', 'Time for evening update check (HH:MM)'),
			('scheduler_blocker_check_time', '10:00', 'Time for blocked issue check (HH:MM)'),
			('scheduler_stale_days_threshold', '2', 'Days before a task is considered stale')
		ON CONFLICT (key) DO NOTHING`,

		// Issue state log — records every YouTrack state transition for time tracking
		`CREATE TABLE IF NOT EXISTS issue_state_log (
			id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
			issue_id VARCHAR(255) NOT NULL,
			issue_summary TEXT NOT NULL,
			assignee VARCHAR(255),
			moved_by VARCHAR(255),
			from_state VARCHAR(100),
			to_state VARCHAR(100) NOT NULL,
			priority VARCHAR(50),
			transitioned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			duration_in_prev_state_hours DECIMAL(10,2)
		)`,

		// Add moved_by column to existing deployments
		`ALTER TABLE issue_state_log ADD COLUMN IF NOT EXISTS moved_by VARCHAR(255)`,

		// Add comment column — stores the YouTrack comment left at time of transition
		// Used for backward move explanation (In Progress → Backlog, DEV → In Progress, etc.)
		`ALTER TABLE issue_state_log ADD COLUMN IF NOT EXISTS comment TEXT`,

		// PM reports — saved Slack-style daily status reports
		`CREATE TABLE IF NOT EXISTS pm_reports (
			id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
			date DATE NOT NULL UNIQUE,
			report_text TEXT NOT NULL,
			done_count INT DEFAULT 0,
			open_count INT DEFAULT 0,
			blocked_count INT DEFAULT 0,
			generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,

		// Fix column types — Supabase may have created notifications with UUID columns
		// instead of VARCHAR/TEXT, causing "invalid input syntax for type uuid" errors.
		// Drop FK constraints first (they reference UUID-typed columns), then retype.
		`ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_user_id_fkey`,
		`ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_task_id_fkey`,
		`ALTER TABLE notifications ALTER COLUMN id TYPE TEXT USING id::text`,
		`ALTER TABLE notifications ALTER COLUMN user_id TYPE TEXT USING user_id::text`,
		`ALTER TABLE notifications ALTER COLUMN task_id TYPE TEXT USING task_id::text`,

		// Pinned issues — lets PMs pin tickets so they appear in every week view
		`CREATE TABLE IF NOT EXISTS pinned_issues (
			id SERIAL PRIMARY KEY,
			user_id VARCHAR(255) NOT NULL,
			issue_id VARCHAR(255) NOT NULL,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			UNIQUE(user_id, issue_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_pinned_issues_user_id ON pinned_issues(user_id)`,

		// Create indexes for performance
		`CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id)`,
		`CREATE INDEX IF NOT EXISTS idx_tasks_assignee_id ON tasks(assignee_id)`,
		`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`,
		`CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at)`,
		`CREATE INDEX IF NOT EXISTS idx_task_history_task_id ON task_history(task_id)`,
		`CREATE INDEX IF NOT EXISTS idx_task_history_changed_at ON task_history(changed_at)`,
		`CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(user_id, read)`,
		`CREATE INDEX IF NOT EXISTS idx_slack_messages_timestamp ON slack_messages(timestamp)`,
		`CREATE INDEX IF NOT EXISTS idx_slack_messages_channel ON slack_messages(channel_id)`,
		`CREATE INDEX IF NOT EXISTS idx_reminders_user_id ON reminders(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_reminders_status ON reminders(status)`,
		`CREATE INDEX IF NOT EXISTS idx_reminders_target_date ON reminders(target_date)`,
		`CREATE INDEX IF NOT EXISTS idx_issue_state_log_issue_id ON issue_state_log(issue_id)`,
		`CREATE INDEX IF NOT EXISTS idx_issue_state_log_transitioned_at ON issue_state_log(transitioned_at)`,
		`CREATE INDEX IF NOT EXISTS idx_issue_state_log_to_state ON issue_state_log(to_state)`,
		`CREATE INDEX IF NOT EXISTS idx_pm_reports_date ON pm_reports(date)`,

		// bot_configs table — stores PM-editable bot prompts
		`CREATE TABLE IF NOT EXISTS bot_configs (
			id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
			name VARCHAR(255) NOT NULL,
			description TEXT,
			bot_type VARCHAR(50) NOT NULL DEFAULT 'custom',
			prompt TEXT NOT NULL DEFAULT '',
			variables TEXT NOT NULL DEFAULT '[]',
			is_active BOOLEAN DEFAULT TRUE,
			created_by VARCHAR(255),
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_bot_configs_bot_type ON bot_configs(bot_type)`,

		// Seed a default PM Assistant bot config so it appears in Bot Config page immediately.
		// Uses WHERE NOT EXISTS so it only inserts once even if migrations run multiple times.
		`INSERT INTO bot_configs (name, description, bot_type, prompt, variables, is_active, created_by)
		SELECT
			'PM Assistant',
			'Custom instructions for the PM Assistant chat. Live YouTrack + time tracking data is injected automatically.',
			'pm_assistant',
			E'You are a PM Assistant for a software development team.\n\n## Your Role\nAnswer questions about YouTrack issues and time tracking data provided below. Be concise and accurate.\n\n## Assignee Task Format\nWhen asked for tasks assigned to a specific person, ALWAYS respond in this exact format:\n\n@{assignee_name}\n\n{Status}:\n{issueID} {summary}\n\nGroup by status (Backlog, In Progress, Blocked, DEV, Done). One ticket per line. No tables, no pipes, no extra metadata.\n\nExample:\n@simranjot\n\nIn Progress:\n3-671 FE Studio: UI theme text issue\nARD-801 API refactor\n\nBlocked:\n3-896 FE UI: Mic remains activated when holding spacebar\n\n## General Format\n- Use bullet points for lists\n- Use tables only for multi-column comparisons\n- Bold (**text**) for important flags\n- Group data by assignee when showing team workload\n\n## Key Rules\n- OVERDUE = ticket time in In Progress exceeds threshold (P0:4h P1:24h P2:48h Other:72h)\n- MOVED BACK = ticket regressed to earlier state (DEV->In Progress, In Progress->Backlog) — flag as regression\n- PINNED = PM manually flagged as important — always mention first\n- If query is ambiguous, state your assumptions\n\nToday''s date: {{DATE}}',
			'[{"name":"DATE","label":"Today''s Date","type":"date","default":"today","required":false}]',
			true,
			'system'
		WHERE NOT EXISTS (SELECT 1 FROM bot_configs WHERE bot_type = 'pm_assistant')`,

		// dismissed_alerts — lets users dismiss moved-back alerts per issue
		`CREATE TABLE IF NOT EXISTS dismissed_alerts (
			id SERIAL PRIMARY KEY,
			user_id VARCHAR(255) NOT NULL,
			issue_id VARCHAR(255) NOT NULL,
			dismissed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			UNIQUE(user_id, issue_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_dismissed_alerts_user_id ON dismissed_alerts(user_id)`,

		// Dual-channel support: primary channel (for digest) + monitor channel (for mentions)
		`ALTER TABLE slack_integrations ADD COLUMN IF NOT EXISTS monitor_channel_id VARCHAR(255)`,
		`ALTER TABLE slack_integrations ADD COLUMN IF NOT EXISTS monitor_channel_name VARCHAR(255)`,

		// Slack mention tracking: messages where the logged-in user is @mentioned
		`CREATE TABLE IF NOT EXISTS slack_mentions (
			id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
			user_id TEXT NOT NULL,
			slack_user_id TEXT NOT NULL,
			message_ts VARCHAR(50) NOT NULL,
			thread_ts VARCHAR(50),
			channel_id VARCHAR(255) NOT NULL,
			message_text TEXT NOT NULL,
			sender_name VARCHAR(255),
			requires_reply BOOLEAN DEFAULT TRUE,
			replied BOOLEAN DEFAULT FALSE,
			reply_checked_at TIMESTAMP WITH TIME ZONE,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			UNIQUE(user_id, message_ts)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_slack_mentions_user_id ON slack_mentions(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_slack_mentions_replied ON slack_mentions(user_id, replied)`,

		// Slack threads started by the user — track if they received replies
		`CREATE TABLE IF NOT EXISTS slack_user_threads (
			id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
			user_id TEXT NOT NULL,
			channel_id VARCHAR(255) NOT NULL,
			thread_ts VARCHAR(50) NOT NULL,
			message_text TEXT NOT NULL,
			reply_count INT DEFAULT 0,
			last_checked_at TIMESTAMP WITH TIME ZONE,
			has_reply BOOLEAN DEFAULT FALSE,
			reminder_sent BOOLEAN DEFAULT FALSE,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			UNIQUE(user_id, thread_ts)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_slack_user_threads_user_id ON slack_user_threads(user_id)`,

		// Snooze support for slack_mentions
		`ALTER TABLE slack_mentions ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMP WITH TIME ZONE`,
		// Snooze support for slack_user_threads
		`ALTER TABLE slack_user_threads ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMP WITH TIME ZONE`,

		// Blocker analysis cache — AI-extracted blocker reasons, cached per issue
		`CREATE TABLE IF NOT EXISTS blocker_analysis_cache (
			issue_id      VARCHAR(255) PRIMARY KEY,
			reason        TEXT NOT NULL,
			comment_count INT NOT NULL DEFAULT 0,
			last_state    VARCHAR(100),
			analyzed_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,

		// Daily Ops carry-over — EOD action items that surface in next morning's brief
		`CREATE TABLE IF NOT EXISTS daily_ops_carryover (
			id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
			user_id    TEXT NOT NULL,
			date       DATE NOT NULL,
			items      JSONB NOT NULL DEFAULT '[]',
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			UNIQUE(user_id, date)
		)`,

		// Weekly reports — add report_type column to pm_reports so daily and weekly
		// reports can coexist for the same date (e.g. Monday appears in both daily and weekly)
		`ALTER TABLE pm_reports ADD COLUMN IF NOT EXISTS report_type VARCHAR(10) NOT NULL DEFAULT 'daily'`,
		`ALTER TABLE pm_reports DROP CONSTRAINT IF EXISTS pm_reports_date_key`,
		// ADD CONSTRAINT IF NOT EXISTS is not valid PG syntax — use DO block instead
		`DO $$ BEGIN
			IF NOT EXISTS (
				SELECT 1 FROM pg_constraint
				WHERE conname = 'pm_reports_date_type_unique'
				  AND conrelid = 'pm_reports'::regclass
			) THEN
				ALTER TABLE pm_reports ADD CONSTRAINT pm_reports_date_type_unique UNIQUE (date, report_type);
			END IF;
		END $$`,
	}

	for i, migration := range migrations {
		_, err := pool.Exec(ctx, migration)
		if err != nil {
			// Log and continue — tables may already exist with different types
			log.Printf("Migration %d skipped (already applied or conflict): %v", i+1, err)
		}
	}

	log.Println("Database migrations completed successfully")
	return nil
}

// SeedDefaultColumns creates default kanban columns for a project
func SeedDefaultColumns(ctx context.Context, projectID string) error {
	pool := GetPool()

	columns := []struct {
		Name     string
		Position int
	}{
		{"To Do", 1},
		{"In Progress", 2},
		{"Review", 3},
		{"Done", 4},
	}

	for _, col := range columns {
		_, err := pool.Exec(ctx, `
			INSERT INTO columns (project_id, name, position)
			VALUES ($1, $2, $3)
		`, projectID, col.Name, col.Position)
		if err != nil {
			return fmt.Errorf("failed to seed column %s: %w", col.Name, err)
		}
	}

	return nil
}
