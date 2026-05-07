-- Migration 006: Daily Task Lists for Slack message generation
-- Run this in Supabase SQL Editor

-- Main daily task list table (one per date per project)
CREATE TABLE IF NOT EXISTS daily_task_lists (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    date DATE NOT NULL,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(date, project_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_task_lists_date ON daily_task_lists(date);
CREATE INDEX IF NOT EXISTS idx_daily_task_lists_project ON daily_task_lists(project_id);

-- User assignments within a daily task list
CREATE TABLE IF NOT EXISTS daily_task_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    daily_list_id UUID REFERENCES daily_task_lists(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    user_name VARCHAR(255) NOT NULL,
    slack_handle VARCHAR(100) NOT NULL,
    position INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_task_assignments_list ON daily_task_assignments(daily_list_id);

-- Individual task items within an assignment
CREATE TABLE IF NOT EXISTS daily_task_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    assignment_id UUID REFERENCES daily_task_assignments(id) ON DELETE CASCADE,
    task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
    title VARCHAR(500) NOT NULL,
    priority VARCHAR(20) DEFAULT 'medium',
    position INT NOT NULL DEFAULT 0,
    carried_over BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_task_items_assignment ON daily_task_items(assignment_id);

-- Add slack_handle to users table for default mapping
ALTER TABLE users ADD COLUMN IF NOT EXISTS slack_handle VARCHAR(100);
