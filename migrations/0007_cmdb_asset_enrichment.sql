-- Promote common AWS/infra metadata to first-class columns, and separate
-- system-managed tags from user-owned labels so sync won't clobber user edits.

ALTER TABLE cmdb_asset
    ADD COLUMN IF NOT EXISTS region         TEXT        NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS zone           TEXT        NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS account_id     TEXT        NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS instance_type  TEXT        NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS os_image       TEXT        NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS vpc_id         TEXT        NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS subnet_id      TEXT        NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS owner          TEXT        NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS business_unit  TEXT        NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS criticality    TEXT        NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS expires_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS system_tags    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS labels         JSONB       NOT NULL DEFAULT '{}'::jsonb;

-- Backfill: for AWS-sourced assets, extract the well-known keys into columns,
-- move sync-provided metadata into system_tags, and leave user-authored keys in labels.
UPDATE cmdb_asset
SET region        = COALESCE(NULLIF(region, ''),        COALESCE(tags->>'aws_region', '')),
    account_id    = COALESCE(NULLIF(account_id, ''),    COALESCE(tags->>'aws_account_id', '')),
    instance_type = COALESCE(NULLIF(instance_type, ''), COALESCE(tags->>'instance_type', tags->>'instance_class', '')),
    vpc_id        = COALESCE(NULLIF(vpc_id, ''),        COALESCE(tags->>'vpc_id', '')),
    zone          = COALESCE(NULLIF(zone, ''),          COALESCE(tags->>'availability_zone', tags->>'az', '')),
    subnet_id     = COALESCE(NULLIF(subnet_id, ''),     COALESCE(tags->>'subnet_id', '')),
    os_image      = COALESCE(NULLIF(os_image, ''),      COALESCE(tags->>'image_id', tags->>'ami_id', '')),
    system_tags = (
        SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)
        FROM jsonb_each(CASE WHEN jsonb_typeof(tags) = 'object' THEN tags ELSE '{}'::jsonb END)
        WHERE key IN (
            'aws_account_id','aws_region','aws_resource_type',
            'instance_type','instance_class','engine','engine_version',
            'multi_az','endpoint','cidr','is_default','group_name','description',
            'vpc_id','subnet_id','availability_zone','az','image_id','ami_id',
            'public_ip','private_ip'
        )
    ),
    labels = (
        SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)
        FROM jsonb_each(CASE WHEN jsonb_typeof(tags) = 'object' THEN tags ELSE '{}'::jsonb END)
        WHERE key NOT IN (
            'aws_account_id','aws_region','aws_resource_type',
            'instance_type','instance_class','engine','engine_version',
            'multi_az','endpoint','cidr','is_default','group_name','description',
            'vpc_id','subnet_id','availability_zone','az','image_id','ami_id',
            'public_ip','private_ip',
            'os_name','os_version','kernel','arch','hostname',
            'cpu_model','cpu_cores','memory_mb','probe_at','probe_by','probe_software'
        )
    )
WHERE tags IS NOT NULL AND jsonb_typeof(tags) = 'object' AND tags <> '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_cmdb_asset_region       ON cmdb_asset(region)       WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cmdb_asset_account_id   ON cmdb_asset(account_id)   WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cmdb_asset_criticality  ON cmdb_asset(criticality)  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cmdb_asset_owner        ON cmdb_asset(owner)        WHERE deleted_at IS NULL;
