-- Migration 008: Daily Task Management System
-- Purpose: Store AI analysis results and enable task carry-forward workflow

-- Table 1: Daily Analyses
-- Stores the raw AI analysis results for each day
CREATE TABLE IF NOT EXISTS daily_analyses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    date DATE NOT NULL UNIQUE,
    morning_message TEXT NOT NULL,
    evening_message TEXT,
    analysis_result JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_daily_analyses_date ON daily_analyses(date);

-- Table 2: Daily Tasks
-- Individual task records from analysis with detected status
CREATE TABLE IF NOT EXISTS daily_tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    analysis_id UUID REFERENCES daily_analyses(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    assignee VARCHAR(255) NOT NULL,
    task_title VARCHAR(500) NOT NULL,
    status VARCHAR(50) NOT NULL, -- 'done', 'pending', 'in_progress', 'blocked', 'not_mentioned', 'skipped'
    original_title VARCHAR(500), -- from morning assignment
    confidence FLOAT DEFAULT 0.0,
    evidence TEXT,
    carried_from_date DATE, -- if carried forward from previous day
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_daily_tasks_date ON daily_tasks(date);
CREATE INDEX idx_daily_tasks_assignee ON daily_tasks(assignee);
CREATE INDEX idx_daily_tasks_status ON daily_tasks(status);
CREATE INDEX idx_daily_tasks_analysis_id ON daily_tasks(analysis_id);

-- Table 3: Next Day Tasks (for editing before posting to Slack)
-- Editable task list for tomorrow with manual control
CREATE TABLE IF NOT EXISTS next_day_tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    target_date DATE NOT NULL,
    assignee VARCHAR(255) NOT NULL,
    task_title VARCHAR(500) NOT NULL,
    priority VARCHAR(20) DEFAULT 'medium', -- 'high', 'medium', 'low'
    position INT DEFAULT 0, -- for ordering within assignee's list
    is_carried_forward BOOLEAN DEFAULT false,
    source_date DATE, -- original date if carried forward
    source_task_id UUID, -- reference to original daily_task if carried forward
    notes TEXT, -- optional notes for the task
    created_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_next_day_tasks_target_date ON next_day_tasks(target_date);
CREATE INDEX idx_next_day_tasks_assignee ON next_day_tasks(assignee);
CREATE INDEX idx_next_day_tasks_position ON next_day_tasks(target_date, assignee, position);

-- Update trigger for daily_analyses
CREATE OR REPLACE FUNCTION update_daily_analyses_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_daily_analyses_updated_at
    BEFORE UPDATE ON daily_analyses
    FOR EACH ROW
    EXECUTE FUNCTION update_daily_analyses_updated_at();

-- Update trigger for next_day_tasks
CREATE OR REPLACE FUNCTION update_next_day_tasks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_next_day_tasks_updated_at
    BEFORE UPDATE ON next_day_tasks
    FOR EACH ROW
    EXECUTE FUNCTION update_next_day_tasks_updated_at();

-- Comments for documentation
COMMENT ON TABLE daily_analyses IS 'Stores AI analysis results for each day with morning assignments and evening updates';
COMMENT ON TABLE daily_tasks IS 'Individual task records extracted from analysis with detected status and evidence';
COMMENT ON TABLE next_day_tasks IS 'Editable task list for tomorrow with manual control before posting to Slack';

COMMENT ON COLUMN daily_tasks.status IS 'Detected status: done, pending, in_progress, blocked, not_mentioned, skipped';
COMMENT ON COLUMN daily_tasks.confidence IS 'AI confidence score (0.0 to 1.0) for the detected status';
COMMENT ON COLUMN daily_tasks.carried_from_date IS 'Original date if this task was carried forward from a previous day';
COMMENT ON COLUMN next_day_tasks.position IS 'Display order within assignee list (0-based)';
COMMENT ON COLUMN next_day_tasks.is_carried_forward IS 'True if task was automatically carried from previous day';
