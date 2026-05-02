-- Add session-recording metadata to terminal_session.
-- recording_uri: object key inside the configured storage bucket. Empty string
--   when no recording was made (e.g. recording disabled, or upload failed).
-- recording_bytes: file size of the uploaded asciinema cast (for quick UI sort).

ALTER TABLE terminal_session
    ADD COLUMN IF NOT EXISTS recording_uri TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS recording_bytes BIGINT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_terminal_session_with_recording
    ON terminal_session(started_at DESC) WHERE recording_uri <> '';
