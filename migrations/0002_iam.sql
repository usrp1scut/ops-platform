CREATE TABLE IF NOT EXISTS iam_user (
    id UUID PRIMARY KEY,
    oidc_subject TEXT NOT NULL UNIQUE,
    email TEXT,
    name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS iam_role (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS iam_role_permission (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    role_id UUID NOT NULL REFERENCES iam_role(id) ON DELETE CASCADE,
    resource TEXT NOT NULL,
    action TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (role_id, resource, action)
);

CREATE TABLE IF NOT EXISTS iam_user_role_binding (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES iam_user(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES iam_role(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_user_id UUID,
    actor_subject TEXT,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL DEFAULT '',
    request_ip TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    trace_id TEXT NOT NULL DEFAULT '',
    result TEXT NOT NULL DEFAULT 'success',
    details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor_user ON audit_log(actor_user_id, created_at DESC);

INSERT INTO iam_role (name, description)
VALUES
    ('admin', 'Full platform administration'),
    ('ops', 'Operate CMDB, bastion, and alerts'),
    ('viewer', 'Read-only access')
ON CONFLICT (name) DO NOTHING;

INSERT INTO iam_role_permission (role_id, resource, action)
SELECT r.id, p.resource, p.action
FROM iam_role r
JOIN (
    VALUES
        ('cmdb.asset', 'read'),
        ('cmdb.asset', 'write'),
        ('aws.account', 'read'),
        ('aws.account', 'write'),
        ('iam.user', 'read'),
        ('iam.user', 'write'),
        ('system', 'admin')
) AS p(resource, action) ON true
WHERE r.name = 'admin'
ON CONFLICT (role_id, resource, action) DO NOTHING;

INSERT INTO iam_role_permission (role_id, resource, action)
SELECT r.id, p.resource, p.action
FROM iam_role r
JOIN (
    VALUES
        ('cmdb.asset', 'read'),
        ('cmdb.asset', 'write'),
        ('aws.account', 'read'),
        ('aws.account', 'write'),
        ('iam.user', 'read')
) AS p(resource, action) ON true
WHERE r.name = 'ops'
ON CONFLICT (role_id, resource, action) DO NOTHING;

INSERT INTO iam_role_permission (role_id, resource, action)
SELECT r.id, p.resource, p.action
FROM iam_role r
JOIN (
    VALUES
        ('cmdb.asset', 'read'),
        ('aws.account', 'read'),
        ('iam.user', 'read')
) AS p(resource, action) ON true
WHERE r.name = 'viewer'
ON CONFLICT (role_id, resource, action) DO NOTHING;

