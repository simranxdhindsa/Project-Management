-- Additional tables for Asana and Slack integrations
-- Run this in Supabase SQL Editor after 001_initial_schema.sql

-- =============================================
-- ASANA INTEGRATIONS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS asana_integrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    workspace_id VARCHAR(255),
    workspace_name VARCHAR(255),
    connected BOOLEAN DEFAULT true,
    last_sync_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asana_integrations_user ON asana_integrations(user_id);

-- =============================================
-- SLACK INTEGRATIONS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS slack_integrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    bot_token TEXT NOT NULL,
    team_id VARCHAR(255),
    team_name VARCHAR(255),
    channel_id VARCHAR(255),
    channel_name VARCHAR(255),
    connected BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_slack_integrations_user ON slack_integrations(user_id);

-- =============================================
-- SLACK MESSAGES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS slack_messages (
    id VARCHAR(255) PRIMARY KEY,
    channel_id VARCHAR(255) NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    user_name VARCHAR(255),
    text TEXT,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    thread_ts VARCHAR(255),
    fetched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_slack_messages_channel ON slack_messages(channel_id);
CREATE INDEX IF NOT EXISTS idx_slack_messages_timestamp ON slack_messages(timestamp);

-- =============================================
-- SLACK ANALYSIS RESULTS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS slack_analysis_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
    task_title VARCHAR(500) NOT NULL,
    slack_status VARCHAR(50) NOT NULL,
    asana_status VARCHAR(50),
    confidence DECIMAL(5,2) DEFAULT 0,
    message_ids TEXT[] DEFAULT '{}',
    discrepancy BOOLEAN DEFAULT false,
    analyzed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_slack_analysis_task ON slack_analysis_results(task_id);
CREATE INDEX IF NOT EXISTS idx_slack_analysis_discrepancy ON slack_analysis_results(discrepancy);

-- =============================================
-- SYNC LOGS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS sync_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type VARCHAR(50) NOT NULL, -- 'asana', 'slack'
    direction VARCHAR(50) NOT NULL, -- 'push', 'pull', 'both'
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'success', 'failed', 'partial'
    tasks_synced INTEGER DEFAULT 0,
    errors TEXT[] DEFAULT '{}',
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    triggered_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_logs_type ON sync_logs(type);
CREATE INDEX IF NOT EXISTS idx_sync_logs_started ON sync_logs(started_at);

-- =============================================
-- PROJECT MEMBERS TABLE (if not exists)
-- =============================================
CREATE TABLE IF NOT EXISTS project_members (
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'member',
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);

-- =============================================
-- COLUMNS TABLE (for custom Kanban columns)
-- =============================================
CREATE TABLE IF NOT EXISTS columns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    position INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_columns_project ON columns(project_id);

-- =============================================
-- ROW LEVEL SECURITY
-- =============================================
ALTER TABLE asana_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE slack_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE slack_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE slack_analysis_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE columns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated" ON asana_integrations FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated" ON slack_integrations FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated" ON slack_messages FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated" ON slack_analysis_results FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated" ON sync_logs FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated" ON project_members FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated" ON columns FOR ALL USING (true);

-- =============================================
-- UPDATE TRIGGERS
-- =============================================
DROP TRIGGER IF EXISTS update_asana_integrations_updated_at ON asana_integrations;
CREATE TRIGGER update_asana_integrations_updated_at BEFORE UPDATE ON asana_integrations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_slack_integrations_updated_at ON slack_integrations;
CREATE TRIGGER update_slack_integrations_updated_at BEFORE UPDATE ON slack_integrations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
