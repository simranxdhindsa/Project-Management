-- Migration 005: Add Asana sections support for dynamic Kanban columns
-- Run this in Supabase SQL Editor

-- Store Asana sections for each project (mirrors Asana's actual sections)
CREATE TABLE IF NOT EXISTS asana_sections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    asana_section_gid VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    position INT NOT NULL DEFAULT 0,
    color VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(project_id, asana_section_gid)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_asana_sections_project ON asana_sections(project_id);
CREATE INDEX IF NOT EXISTS idx_asana_sections_gid ON asana_sections(asana_section_gid);

-- Add section reference to tasks (stores the Asana section GID and name)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS asana_section_gid VARCHAR(255);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS section_name VARCHAR(255);

-- Create index for section-based queries
CREATE INDEX IF NOT EXISTS idx_tasks_section ON tasks(asana_section_gid);

-- Update existing tasks to have a default section_name based on their status
-- This provides backward compatibility
UPDATE tasks
SET section_name = CASE
    WHEN status = 'todo' THEN 'To Do'
    WHEN status = 'in_progress' THEN 'In Progress'
    WHEN status = 'review' THEN 'Review'
    WHEN status = 'done' THEN 'Done'
    ELSE 'To Do'
END
WHERE section_name IS NULL;
