-- Migration 007: Bot configuration system for AI analysis
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS bot_configs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT DEFAULT '',
    bot_type VARCHAR(50) NOT NULL DEFAULT 'custom',
    prompt TEXT NOT NULL DEFAULT '',
    response_structure JSONB DEFAULT '{}',
    variables JSONB DEFAULT '[]',
    is_active BOOLEAN DEFAULT false,
    created_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_configs_type ON bot_configs(bot_type);
CREATE INDEX IF NOT EXISTS idx_bot_configs_active ON bot_configs(is_active);

-- No default data - users will create their own bot configs via the UI
