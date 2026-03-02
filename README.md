# ops-platform (initial implementation)

This repository contains an initial implementation aligned with `docs/design/ops-platform-v0.3.md`.

## Implemented in this stage

- Go backend scaffold (`ops-api`) with structured routes.
- PostgreSQL schema migrations for CMDB and AWS account onboarding.
- IAM schema + seeded roles/permissions (`admin`, `ops`, `viewer`).
- OIDC login endpoints with user sync (profile only).
- Platform bearer token auth + RBAC middleware + write-operation audit log.
- Embedded frontend console for platform operations.
- CMDB asset CRUD API.
- AWS account onboarding API (multi-account model, assume-role/static modes).
- AWS sync worker v1 (`ops-worker`) for EC2/VPC/SG/RDS asset ingestion.
- Docker Compose stack with Postgres, Redis, MinIO, migration job, API service, and worker.

## Quick start

```bash
docker compose up --build
```

If you need proxy during build/runtime, set optional env vars before starting:

```bash
export GOPROXY='https://goproxy.cn,direct'
export HTTP_PROXY=http://127.0.0.1:7890
export HTTPS_PROXY=http://127.0.0.1:7890
docker compose up --build
```

If you set `OPS_MASTER_KEY`, ensure it is exactly 32 ASCII characters:

```bash
export OPS_MASTER_KEY='01234567890123456789012345678901'
docker compose up --build
```

OIDC is optional in local startup. To enable:

```bash
export OPS_OIDC_ISSUER_URL='https://your-idp.example.com/oauth2'
export OPS_OIDC_CLIENT_ID='ops-platform'
export OPS_OIDC_CLIENT_SECRET='your-client-secret'
export OPS_OIDC_REDIRECT_URL='http://localhost:8080/auth/oidc/callback'
export OPS_OIDC_BOOTSTRAP_ADMIN_SUBS='oidc-subject-1,oidc-subject-2'
docker compose up --build
```

AWS sync worker controls (optional):

```bash
export OPS_SYNC_INTERVAL='15m'
export OPS_SYNC_RUN_ON_START='true'
docker compose up --build
```

AWS sync scope in v1:

- EC2 instances
- VPC
- Security Groups
- RDS instances

Auth behavior:

- `static` account mode uses `access_key_id` + `secret_access_key` stored in platform.
- `assume_role` mode requires `role_arn`; base credentials come from:
  - account-level key pair if provided, or
  - worker runtime environment (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`), or
  - default AWS SDK credential chain.

Service endpoint:

- API: `http://localhost:8080`
- Health: `GET /healthz`
- Platform UI: `http://localhost:8080/ui/`

## Local development without Docker

1. Set environment variables:

```bash
export GOPROXY='https://goproxy.cn,direct'
export OPS_DATABASE_URL='postgres://ops:ops@localhost:5432/ops_platform?sslmode=disable'
export OPS_MASTER_KEY='01234567890123456789012345678901'
```

2. Run migrations:

```bash
go run ./cmd/migrate
```

3. Run API:

```bash
go run ./cmd/ops-api
```

4. Run AWS sync worker:

```bash
go run ./cmd/ops-worker
```

## API endpoints (initial)

- `GET /auth/oidc/login`
- `GET /auth/oidc/callback`
- `GET /auth/me` (requires `Authorization: Bearer <token>`)
- `GET /api/v1/cmdb/assets`
- `POST /api/v1/cmdb/assets`
- `GET /api/v1/cmdb/assets/{assetID}`
- `PATCH /api/v1/cmdb/assets/{assetID}`
- `DELETE /api/v1/cmdb/assets/{assetID}`
- `GET /api/v1/aws/accounts`
- `POST /api/v1/aws/accounts`
- `GET /api/v1/aws/accounts/{accountID}`
- `PATCH /api/v1/aws/accounts/{accountID}`
- `POST /api/v1/aws/sync/run`
- `GET /api/v1/aws/sync/status`
- `GET /api/v1/aws/sync/runs?limit=120`
- `GET /api/v1/iam/users`
- `GET /api/v1/iam/users/{userID}`
- `GET /api/v1/iam/roles`
- `GET /api/v1/iam/roles?include_permissions=true`
- `GET /api/v1/iam/roles/{roleName}/permissions`
- `POST /api/v1/iam/users/{userID}/roles` (body: `{"role_name":"ops"}`)
- `DELETE /api/v1/iam/users/{userID}/roles/{roleName}`

All `/api/v1/*` endpoints require platform bearer token.
Token is returned by `GET /auth/oidc/callback` after successful OIDC login.

## Frontend console flow

1. Open `http://localhost:8080/ui/`.
2. Click `OIDC Login` and complete IdP login (if OIDC is configured).
3. Browser callback auto-saves token to `localStorage` and redirects back to `/ui/`.
4. Use left navigation to operate `Overview`, `CMDB`, `AWS Accounts`, and `IAM`.

## Next planned additions

- Bastion gateway service with SSH session recording.
- Nightingale webhook ingestion and Lark notification routing.
