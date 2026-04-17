CREATE TABLE IF NOT EXISTS cmdb_ssh_proxy (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    network_zone TEXT NOT NULL DEFAULT '',
    host TEXT NOT NULL,
    port INT NOT NULL DEFAULT 22,
    username TEXT NOT NULL,
    auth_type TEXT NOT NULL DEFAULT 'password',
    password_encrypted TEXT NOT NULL DEFAULT '',
    private_key_encrypted TEXT NOT NULL DEFAULT '',
    passphrase_encrypted TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cmdb_ssh_proxy_zone ON cmdb_ssh_proxy(network_zone) WHERE deleted_at IS NULL;

ALTER TABLE cmdb_asset_connection
    ADD COLUMN IF NOT EXISTS proxy_id UUID REFERENCES cmdb_ssh_proxy(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS database_name TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_cmdb_asset_connection_proxy_id ON cmdb_asset_connection(proxy_id);
