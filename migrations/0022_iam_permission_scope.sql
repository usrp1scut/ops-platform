-- Capability scoping for role permissions.
--
-- Until now a role permission was a binary (role, resource, action) tuple:
-- the holder could act on every resource instance. The IAM capability matrix
-- (design review p.11) needs a third state between "all" and "none" --
-- "partial", e.g. ssh only into env=default,dev, or cmdb.asset:write only
-- where source=aws.
--
-- scope_json is a nullable JSONB array of constraints. NULL (the default for
-- every existing row) means UNSCOPED == "all", so this migration is a no-op
-- for current behaviour: nothing is narrowed until an admin sets a scope.
--
-- Constraint shape (AND across array entries; values are OR within an entry):
--   [{"dimension":"env","op":"in","values":["default","dev"]},
--    {"dimension":"source","op":"eq","values":["aws"]}]
-- op is one of: in | not_in | eq. dimension is a resource attribute name
-- (env, source, ...) resolved against the target resource at enforcement time.

ALTER TABLE iam_role_permission
    ADD COLUMN IF NOT EXISTS scope_json JSONB;

COMMENT ON COLUMN iam_role_permission.scope_json IS
    'NULL = unscoped (all). Otherwise JSONB array of {dimension,op,values} constraints, AND-combined. See migration 0022.';
