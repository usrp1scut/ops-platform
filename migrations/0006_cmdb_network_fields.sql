ALTER TABLE cmdb_asset
    ADD COLUMN IF NOT EXISTS public_ip TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS private_ip TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS private_dns TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_cmdb_asset_public_ip ON cmdb_asset(public_ip);
CREATE INDEX IF NOT EXISTS idx_cmdb_asset_private_ip ON cmdb_asset(private_ip);
CREATE INDEX IF NOT EXISTS idx_cmdb_asset_private_dns ON cmdb_asset(private_dns);
