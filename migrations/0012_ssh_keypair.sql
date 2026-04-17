ALTER TABLE cmdb_asset ADD COLUMN IF NOT EXISTS key_name TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_cmdb_asset_key_name ON cmdb_asset(key_name) WHERE key_name != '';

CREATE TABLE IF NOT EXISTS ssh_keypair (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                   TEXT NOT NULL UNIQUE,
    fingerprint            TEXT NOT NULL DEFAULT '',
    private_key_encrypted  TEXT NOT NULL,
    passphrase_encrypted   TEXT NOT NULL DEFAULT '',
    uploaded_by            TEXT NOT NULL DEFAULT '',
    description            TEXT NOT NULL DEFAULT '',
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
