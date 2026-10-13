ALTER TABLE tickets ADD COLUMN team_key TEXT;
ALTER TABLE tickets ADD COLUMN sla_started_at TEXT;
ALTER TABLE tickets ADD COLUMN first_response_at TEXT;
ALTER TABLE tickets ADD COLUMN resolved_at TEXT;
ALTER TABLE tickets ADD COLUMN closed_at TEXT;
ALTER TABLE tickets ADD COLUMN resolution_category TEXT;
ALTER TABLE tickets ADD COLUMN resolution_summary TEXT;
ALTER TABLE tickets ADD COLUMN reopen_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tickets ADD COLUMN last_reopen_reason TEXT;
