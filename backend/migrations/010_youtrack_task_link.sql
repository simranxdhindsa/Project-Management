-- Add youtrack_id column to next_day_tasks for linking tasks to YouTrack issues
ALTER TABLE next_day_tasks ADD COLUMN IF NOT EXISTS youtrack_id VARCHAR(255);
CREATE INDEX IF NOT EXISTS idx_next_day_tasks_youtrack_id ON next_day_tasks(youtrack_id);
