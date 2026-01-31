-- Global Settings table for organization-wide configurations
-- Run this in Supabase SQL Editor

-- =============================================
-- GLOBAL SETTINGS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS global_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key VARCHAR(255) UNIQUE NOT NULL,
    value TEXT,
    encrypted BOOLEAN DEFAULT false,
    description TEXT,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_global_settings_key ON global_settings(key);

-- =============================================
-- ROW LEVEL SECURITY
-- =============================================
ALTER TABLE global_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON global_settings FOR ALL USING (true);

-- =============================================
-- UPDATE TRIGGER
-- =============================================
DROP TRIGGER IF EXISTS update_global_settings_updated_at ON global_settings;
CREATE TRIGGER update_global_settings_updated_at BEFORE UPDATE ON global_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- INSERT DEFAULT ASANA SETTINGS (admin can update these)
-- =============================================
INSERT INTO global_settings (key, value, encrypted, description)
VALUES
    ('asana_pat', '', true, 'Asana Personal Access Token for organization-wide sync'),
    ('asana_project_id', '', false, 'Default Asana Project ID to sync with'),
    ('asana_workspace_id', '', false, 'Asana Workspace ID')
ON CONFLICT (key) DO NOTHING;
