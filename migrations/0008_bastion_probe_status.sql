ALTER TABLE cmdb_asset_connection
    ADD COLUMN IF NOT EXISTS last_probe_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_probe_status TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS last_probe_error  TEXT NOT NULL DEFAULT '';
