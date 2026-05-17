-- Merge the per-protocol session capabilities bastion.session:ssh and
-- bastion.session:rdp into a single bastion.session:connect. SSH, RDP, VNC
-- and Telnet are the same access risk class (an interactive remote session
-- brokered by the bastion), so they share one capability.
--
-- Dev-stage hard cut: no backward-compat window. The built-in capability
-- catalog is code-side, so in practice no role rows carry ssh/rdp today;
-- this migration is the defensive path for any operator-created rows.
--
-- Scope merge rule (decision: union / broader on conflict): a role's new
-- :connect row is UNSCOPED (NULL) when any source row was unscoped or the
-- ssh/rdp rows carried differing scopes (their union is broader than either
-- and is not representable as one AND-scope); otherwise the shared scope is
-- kept. Privilege broadening is explicitly accepted.

INSERT INTO iam_role_permission (role_id, resource, action, scope_json)
SELECT
    role_id,
    'bastion.session',
    'connect',
    CASE
        WHEN bool_or(scope_json IS NULL) THEN NULL
        WHEN count(DISTINCT scope_json::text) > 1 THEN NULL
        ELSE min(scope_json)
    END
FROM iam_role_permission
WHERE resource = 'bastion.session' AND action IN ('ssh', 'rdp')
GROUP BY role_id
ON CONFLICT (role_id, resource, action) DO UPDATE
    SET scope_json = CASE
        WHEN iam_role_permission.scope_json IS NULL OR EXCLUDED.scope_json IS NULL THEN NULL
        WHEN iam_role_permission.scope_json::text <> EXCLUDED.scope_json::text THEN NULL
        ELSE EXCLUDED.scope_json
    END;

DELETE FROM iam_role_permission
WHERE resource = 'bastion.session' AND action IN ('ssh', 'rdp');
