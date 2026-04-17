CREATE TABLE IF NOT EXISTS cmdb_asset_relation (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_asset_id UUID NOT NULL REFERENCES cmdb_asset(id) ON DELETE CASCADE,
    to_asset_id   UUID NOT NULL REFERENCES cmdb_asset(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL,
    source        TEXT NOT NULL DEFAULT 'manual',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cmdb_relation_unique
    ON cmdb_asset_relation(from_asset_id, to_asset_id, relation_type);

CREATE INDEX IF NOT EXISTS idx_cmdb_relation_from ON cmdb_asset_relation(from_asset_id);
CREATE INDEX IF NOT EXISTS idx_cmdb_relation_to   ON cmdb_asset_relation(to_asset_id);
CREATE INDEX IF NOT EXISTS idx_cmdb_relation_type  ON cmdb_asset_relation(relation_type);
