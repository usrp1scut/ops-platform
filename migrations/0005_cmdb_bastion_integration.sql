CREATE TABLE IF NOT EXISTS cmdb_asset_connection (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id UUID NOT NULL UNIQUE REFERENCES cmdb_asset(id) ON DELETE CASCADE,
    protocol TEXT NOT NULL DEFAULT 'ssh',
    host TEXT NOT NULL,
    port INT NOT NULL DEFAULT 22,
    username TEXT NOT NULL,
    auth_type TEXT NOT NULL DEFAULT 'password',
    password_encrypted TEXT NOT NULL DEFAULT '',
    private_key_encrypted TEXT NOT NULL DEFAULT '',
    passphrase_encrypted TEXT NOT NULL DEFAULT '',
    bastion_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cmdb_asset_connection_asset_id ON cmdb_asset_connection(asset_id);
CREATE INDEX IF NOT EXISTS idx_cmdb_asset_connection_host ON cmdb_asset_connection(host);

CREATE TABLE IF NOT EXISTS cmdb_asset_probe_snapshot (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id UUID NOT NULL REFERENCES cmdb_asset(id) ON DELETE CASCADE,
    os_name TEXT NOT NULL DEFAULT '',
    os_version TEXT NOT NULL DEFAULT '',
    kernel TEXT NOT NULL DEFAULT '',
    arch TEXT NOT NULL DEFAULT '',
    hostname TEXT NOT NULL DEFAULT '',
    uptime_seconds BIGINT NOT NULL DEFAULT 0,
    cpu_model TEXT NOT NULL DEFAULT '',
    cpu_cores INT NOT NULL DEFAULT 0,
    memory_mb INT NOT NULL DEFAULT 0,
    disk_summary TEXT NOT NULL DEFAULT '',
    software JSONB NOT NULL DEFAULT '[]'::jsonb,
    raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    collected_by TEXT NOT NULL DEFAULT 'bastion-probe',
    collected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cmdb_asset_probe_snapshot_asset_collected_at
    ON cmdb_asset_probe_snapshot(asset_id, collected_at DESC);
