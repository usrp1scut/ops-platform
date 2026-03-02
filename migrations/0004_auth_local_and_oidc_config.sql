CREATE TABLE IF NOT EXISTS iam_local_user (
    username TEXT PRIMARY KEY,
    user_id UUID NOT NULL UNIQUE REFERENCES iam_user(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS iam_oidc_config (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    issuer_url TEXT NOT NULL DEFAULT '',
    client_id TEXT NOT NULL DEFAULT '',
    client_secret_encrypted TEXT NOT NULL DEFAULT '',
    redirect_url TEXT NOT NULL DEFAULT '',
    authorize_url TEXT NOT NULL DEFAULT '',
    token_url TEXT NOT NULL DEFAULT '',
    userinfo_url TEXT NOT NULL DEFAULT '',
    scopes JSONB NOT NULL DEFAULT '["openid","profile","email"]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
