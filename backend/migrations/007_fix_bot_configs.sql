-- Fix bot_configs table to use VARCHAR for created_by instead of UUID
-- Run this in Supabase SQL Editor

-- Drop the table if it exists and recreate it with correct schema
DROP TABLE IF EXISTS bot_configs CASCADE;

CREATE TABLE bot_configs (
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

CREATE INDEX idx_bot_configs_type ON bot_configs(bot_type);
CREATE INDEX idx_bot_configs_active ON bot_configs(is_active);

-- No default data - users will create their own bot configs via the UI
