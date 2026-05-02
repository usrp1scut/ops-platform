-- The original UNIQUE constraint on cmdb_ssh_proxy.name does not honour soft
-- deletes. After a VPC-proxy demote the row is kept with deleted_at set, and
-- a re-promote would try to INSERT a new row with the same auto-generated
-- name, tripping 23505. Replace the full uniqueness with a partial unique
-- index that ignores soft-deleted rows.

ALTER TABLE cmdb_ssh_proxy DROP CONSTRAINT IF EXISTS cmdb_ssh_proxy_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cmdb_ssh_proxy_name_unique
    ON cmdb_ssh_proxy(name)
    WHERE deleted_at IS NULL;
