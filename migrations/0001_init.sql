CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS cmdb_asset (
    id UUID PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    env TEXT NOT NULL DEFAULT 'default',
    source TEXT NOT NULL DEFAULT 'manual',
    external_id TEXT,
    external_arn TEXT,
    tags JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cmdb_asset_type_env ON cmdb_asset(type, env);
CREATE INDEX IF NOT EXISTS idx_cmdb_asset_external_id ON cmdb_asset(external_id);
CREATE INDEX IF NOT EXISTS idx_cmdb_asset_updated_at ON cmdb_asset(updated_at DESC);

CREATE TABLE IF NOT EXISTS cmdb_change_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id UUID,
    change_type TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'system',
    diff_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    actor_user_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS aws_account (
    id UUID PRIMARY KEY,
    account_id TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    auth_mode TEXT NOT NULL,
    role_arn TEXT,
    external_id TEXT,
    access_key_id TEXT,
    secret_access_key_encrypted TEXT,
    region_allowlist JSONB NOT NULL DEFAULT '[]'::jsonb,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS aws_sync_run (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES aws_account(id),
    region TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    status TEXT NOT NULL,
    resources_processed INT NOT NULL DEFAULT 0,
    error_message TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_aws_sync_run_account_started_at ON aws_sync_run(account_id, started_at DESC);

