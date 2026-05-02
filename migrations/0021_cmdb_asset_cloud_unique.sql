-- Multi-cloud hook: widen the AWS-only UNIQUE partial index to cover any
-- non-manual source. When a future syncer (aliyunsync/azuresync/gcpsync)
-- lands, its assets inherit the same atomicity guarantee without a per-
-- provider migration. Manual rows are excluded because their uniqueness
-- semantics are different (no external_id contract, name is the human key).

DROP INDEX IF EXISTS idx_cmdb_asset_aws_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cmdb_asset_cloud_unique
    ON cmdb_asset (source, account_id, region, type, external_id)
    WHERE source <> 'manual'
      AND deleted_at IS NULL
      AND external_id IS NOT NULL
      AND external_id <> '';
