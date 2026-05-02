-- VPC proxy promotion + AMI-derived OS metadata.

ALTER TABLE cmdb_asset
    ADD COLUMN IF NOT EXISTS is_vpc_proxy BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS ami_name     TEXT    NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS ami_owner_id TEXT    NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS os_family    TEXT    NOT NULL DEFAULT '';

-- At most one promoted proxy per VPC (excluding soft-deleted).
CREATE UNIQUE INDEX IF NOT EXISTS idx_cmdb_asset_vpc_proxy_unique
    ON cmdb_asset(vpc_id)
    WHERE is_vpc_proxy = true AND deleted_at IS NULL AND vpc_id != '';

CREATE INDEX IF NOT EXISTS idx_cmdb_asset_os_family
    ON cmdb_asset(os_family) WHERE deleted_at IS NULL;

ALTER TABLE cmdb_ssh_proxy
    ADD COLUMN IF NOT EXISTS source_asset_id UUID REFERENCES cmdb_asset(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cmdb_ssh_proxy_source_asset
    ON cmdb_ssh_proxy(source_asset_id) WHERE source_asset_id IS NOT NULL;

-- auto_managed=true means this profile was created/updated by sync/promotion
-- and may be overwritten by future sync runs. User edits via the upsert API
-- flip it to false so sync leaves it alone.
ALTER TABLE cmdb_asset_connection
    ADD COLUMN IF NOT EXISTS auto_managed BOOLEAN NOT NULL DEFAULT false;
