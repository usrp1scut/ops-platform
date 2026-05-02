-- Add bastion.session:read permission. Holders may list and replay other
-- users' sessions; users without it see only their own. Admin and ops roles
-- get it; viewer does NOT (they previously could enumerate every session
-- via cmdb.asset:read, which leaked who-connected-where to read-only users).

INSERT INTO iam_role_permission (role_id, resource, action)
SELECT r.id, p.resource, p.action
FROM iam_role r
JOIN (
    VALUES
        ('bastion.session', 'read')
) AS p(resource, action) ON true
WHERE r.name IN ('admin', 'ops')
ON CONFLICT (role_id, resource, action) DO NOTHING;
