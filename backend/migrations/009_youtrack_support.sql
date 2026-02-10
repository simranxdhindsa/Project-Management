-- Add YouTrack support to tasks table
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS youtrack_id VARCHAR(255);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS youtrack_url VARCHAR(500);

-- Create index for YouTrack ID lookups
CREATE INDEX IF NOT EXISTS idx_tasks_youtrack_id ON tasks(youtrack_id);

-- Add comment for clarity
COMMENT ON COLUMN tasks.youtrack_id IS 'YouTrack issue ID (e.g., PM-123)';
COMMENT ON COLUMN tasks.youtrack_url IS 'Direct URL to the YouTrack issue';
