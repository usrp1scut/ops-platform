CREATE INDEX IF NOT EXISTS idx_cmdb_asset_source_external_id ON cmdb_asset(source, external_id);
CREATE INDEX IF NOT EXISTS idx_cmdb_asset_source_updated_at ON cmdb_asset(source, updated_at DESC);

