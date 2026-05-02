-- Covering index for the AWS sync composite lookup. UpsertAsset and
-- LinkAWSRelations now resolve assets by (source, account_id, region,
-- external_id) instead of external_id alone — see ADR-0010 / fix for the
-- multi-account asset collision bug. The index is non-unique because
-- existing rows may carry empty account_id/region from before the fix.

CREATE INDEX IF NOT EXISTS idx_cmdb_asset_aws_composite
    ON cmdb_asset (source, account_id, region, external_id)
    WHERE source = 'aws' AND deleted_at IS NULL;
