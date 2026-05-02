-- Tighten AWS asset uniqueness:
--   1. include type in the key so RDS DBInstanceIdentifier can't collide
--      with an EC2 instance ID that happens to overlap;
--   2. enforce the key with a UNIQUE partial index so concurrent syncs
--      (ops-worker + API-triggered run) can't race a duplicate insert in
--      the gap between SELECT and INSERT.
--
-- Prior to this migration, 0019 added a non-unique covering index on
-- (source, account_id, region, external_id). UpsertAsset performed
-- SELECT-then-INSERT, vulnerable to the race the unique constraint now
-- closes via INSERT ... ON CONFLICT DO UPDATE.

-- Step 1: dedupe. Keep the most recently updated row per composite key,
-- soft-delete the rest. Without this, the UNIQUE index creation would
-- fail on any pre-existing duplicates.
WITH ranked AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY source, account_id, region, type, external_id
            ORDER BY updated_at DESC, created_at DESC, id
        ) AS rn
    FROM cmdb_asset
    WHERE source = 'aws'
      AND deleted_at IS NULL
      AND external_id IS NOT NULL
      AND external_id <> ''
)
UPDATE cmdb_asset
SET deleted_at = now(),
    updated_at = now()
FROM ranked
WHERE cmdb_asset.id = ranked.id AND ranked.rn > 1;

-- Step 2: drop the now-superseded non-unique index from 0019. The new
-- unique index covers the same column prefix.
DROP INDEX IF EXISTS idx_cmdb_asset_aws_composite;

-- Step 3: enforce the composite key. Partial: only AWS-source live rows.
-- We require external_id IS NOT NULL AND non-empty so manual rows with
-- empty external_id (legitimate state for source='manual') don't collide.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cmdb_asset_aws_unique
    ON cmdb_asset (source, account_id, region, type, external_id)
    WHERE source = 'aws'
      AND deleted_at IS NULL
      AND external_id IS NOT NULL
      AND external_id <> '';
