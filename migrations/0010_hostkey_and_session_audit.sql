-- host-key pinning (TOFU) and terminal session audit

CREATE TABLE IF NOT EXISTS ssh_known_host (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    scope TEXT NOT NULL CHECK (scope IN ('asset', 'proxy')),
    target_id UUID NOT NULL,
    host TEXT NOT NULL,
    port INT NOT NULL,
    key_type TEXT NOT NULL,
    fingerprint_sha256 TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'override_pending')),
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    override_by TEXT NOT NULL DEFAULT '',
    override_at TIMESTAMPTZ,
    override_expires_at TIMESTAMPTZ,
    last_mismatch_at TIMESTAMPTZ,
    last_mismatch_fingerprint TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ssh_known_host_target
    ON ssh_known_host(scope, target_id);

CREATE TABLE IF NOT EXISTS terminal_session (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL DEFAULT '',
    asset_id UUID NOT NULL,
    asset_name TEXT NOT NULL DEFAULT '',
    proxy_id UUID,
    proxy_name TEXT NOT NULL DEFAULT '',
    client_ip TEXT NOT NULL DEFAULT '',
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at TIMESTAMPTZ,
    exit_code INT,
    bytes_in BIGINT NOT NULL DEFAULT 0,
    bytes_out BIGINT NOT NULL DEFAULT 0,
    error_msg TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_terminal_session_user ON terminal_session(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_terminal_session_asset ON terminal_session(asset_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_terminal_session_started ON terminal_session(started_at DESC);
