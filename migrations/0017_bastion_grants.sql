-- JIT bastion access: time-bounded grants and the request/approval workflow
-- that produces them. Issuing a terminal/RDP ticket consults bastion_grant
-- so non-admin users can only connect within an active grant window.
--
-- See ADR-0009 for the design rationale.

CREATE TABLE IF NOT EXISTS bastion_grant (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL,
    user_name       TEXT NOT NULL DEFAULT '',
    asset_id        UUID NOT NULL,
    asset_name      TEXT NOT NULL DEFAULT '',
    granted_by_id   UUID NOT NULL,
    granted_by_name TEXT NOT NULL DEFAULT '',
    reason          TEXT NOT NULL DEFAULT '',
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    revoked_by_id   UUID,
    revoked_by_name TEXT NOT NULL DEFAULT '',
    revoke_reason   TEXT NOT NULL DEFAULT '',
    request_id      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "active grant for (user, asset)" lookup is on the hot path of every ticket
-- issue, so cover it explicitly. expires_at predicate is part of the lookup
-- so we accept tying it into the index condition for simplicity.
CREATE INDEX IF NOT EXISTS idx_bastion_grant_active
    ON bastion_grant (user_id, asset_id, expires_at DESC)
    WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bastion_grant_user
    ON bastion_grant (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS bastion_request (
    id                         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                    UUID NOT NULL,
    user_name                  TEXT NOT NULL DEFAULT '',
    asset_id                   UUID NOT NULL,
    asset_name                 TEXT NOT NULL DEFAULT '',
    reason                     TEXT NOT NULL DEFAULT '',
    requested_duration_seconds INT NOT NULL CHECK (requested_duration_seconds > 0),
    status                     TEXT NOT NULL DEFAULT 'pending',
    decided_by_id              UUID,
    decided_by_name            TEXT NOT NULL DEFAULT '',
    decided_at                 TIMESTAMPTZ,
    decision_reason            TEXT NOT NULL DEFAULT '',
    grant_id                   UUID,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT bastion_request_status_chk
        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'expired'))
);

CREATE INDEX IF NOT EXISTS idx_bastion_request_pending
    ON bastion_request (created_at DESC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_bastion_request_user
    ON bastion_request (user_id, created_at DESC);

-- Seed permissions. Permissions are stored inline on iam_role_permission
-- (no separate iam_permission table). bastion.grant write is for admins
-- and ops; bastion.request read/write is granted to all built-in roles
-- so any authenticated user can submit a request and see their own.
INSERT INTO iam_role_permission (role_id, resource, action)
SELECT r.id, p.resource, p.action
FROM iam_role r
JOIN (
    VALUES
        ('bastion.grant', 'read'),
        ('bastion.grant', 'write'),
        ('bastion.request', 'read'),
        ('bastion.request', 'write')
) AS p(resource, action) ON true
WHERE r.name = 'admin'
ON CONFLICT (role_id, resource, action) DO NOTHING;

-- ops can approve and read everything (but not necessarily admin elsewhere)
INSERT INTO iam_role_permission (role_id, resource, action)
SELECT r.id, p.resource, p.action
FROM iam_role r
JOIN (
    VALUES
        ('bastion.grant', 'read'),
        ('bastion.grant', 'write'),
        ('bastion.request', 'read'),
        ('bastion.request', 'write')
) AS p(resource, action) ON true
WHERE r.name = 'ops'
ON CONFLICT (role_id, resource, action) DO NOTHING;

-- viewers can only see their own requests and read grants they belong to.
INSERT INTO iam_role_permission (role_id, resource, action)
SELECT r.id, p.resource, p.action
FROM iam_role r
JOIN (
    VALUES
        ('bastion.grant', 'read'),
        ('bastion.request', 'read'),
        ('bastion.request', 'write')
) AS p(resource, action) ON true
WHERE r.name = 'viewer'
ON CONFLICT (role_id, resource, action) DO NOTHING;
