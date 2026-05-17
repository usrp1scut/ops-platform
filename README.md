# ops-platform (initial implementation)

This repository contains an initial implementation aligned with `docs/design/ops-platform-v0.3.md`.

## Implemented in this stage

- Go backend scaffold (`ops-api`) with structured routes.
- PostgreSQL schema migrations for CMDB and AWS account onboarding.
- IAM schema + seeded roles/permissions (`admin`, `ops`, `viewer`).
- Local admin login endpoint (no OIDC required).
- OIDC login endpoints with user sync (profile only).
- OIDC runtime config API (manageable from web IAM page).
- Platform bearer token auth + RBAC middleware + write-operation audit log.
- Embedded frontend console for platform operations.
- React/Vite portal embedded at `/portal/`. The legacy classic-script
  console is preserved at `/portal-legacy/` for the post-cutover
  observation period; `/portal-v2/` (the staging path used during the
  migration) 301s to `/portal/`. See `web/README.md` and
  `docs/archive/design/frontend-refactor-v2.md`.
- GitHub Actions CI (`go test`, web typecheck/Vitest, Playwright smoke
  against an in-job Postgres + ops-api).
- CMDB asset CRUD API.
- AWS account onboarding API (multi-account model, assume-role/static modes).
- AWS sync worker v1 (`ops-worker`) for EC2/VPC/SG/RDS asset ingestion.
- Bastion probe worker v1 (`bastion-probe`) for SSH-based host facts collection.
- Docker Compose stack with Postgres, Redis, MinIO, migration job, API service, and workers.

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

Local admin defaults (change in non-dev environments):

```bash
export OPS_LOCAL_ADMIN_USERNAME='admin'
export OPS_LOCAL_ADMIN_PASSWORD='admin123456'
docker compose up --build
```

OIDC is runtime configuration. The supported operational path is:

1. Start the stack.
2. Sign in with the local bootstrap admin.
3. Open Portal -> Platform -> OIDC.
4. Save and test the provider configuration there.

The `OPS_OIDC_*` environment variables are retained only as a first-start
seed/fallback for empty databases and are not the recommended long-term
configuration path:

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

Bastion probe worker controls (optional):

```bash
export OPS_PROBE_INTERVAL='30m'
export OPS_PROBE_RUN_ON_START='true'
export OPS_PROBE_TIMEOUT='20s'
export OPS_PROBE_CONCURRENCY='4'
export OPS_PROBE_BATCH_SIZE='200'
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
- User Portal (React/Vite): `http://localhost:8080/portal/`
- User Portal (legacy classic-script, observation period):
  `http://localhost:8080/portal-legacy/`
- `/portal-v2/` (the staging path used during the migration) → 301 to
  `/portal/`
- Legacy `/ui/*` route is redirected to `/portal/`

Both portals share the same backend, the same `localStorage` token key, and
the same RBAC model — switching between them does not require re-login.
The new `/portal/` is the canonical entry point; `/portal-legacy/` will be
removed after a sprint of clean operation.

## Local development without Docker

1. Set environment variables:

```bash
export GOPROXY='https://goproxy.cn,direct'
export OPS_DATABASE_URL='postgres://ops:ops@localhost:5432/ops_platform?sslmode=disable'
export OPS_MASTER_KEY='01234567890123456789012345678901'
export OPS_LOCAL_ADMIN_USERNAME='admin'
export OPS_LOCAL_ADMIN_PASSWORD='admin123456'
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

5. Run bastion probe worker:

```bash
go run ./cmd/bastion-probe
```

6. (Optional) Run the React/Vite portal in dev mode with HMR. The Vite
   server proxies `/api`, `/auth`, `/healthz`, and `/ws` to the Go API
   on :8080, so you can iterate on the new portal without rebuilding the
   Go binary:

```bash
cd web
npm install   # first time only
npm run dev   # http://localhost:5173
```

   See `web/README.md` for full frontend instructions, including how to
   produce a production build that gets embedded into the Go binary at
   `/portal/`. The Docker build does this automatically via the
   `web-builder` stage of the root `Dockerfile`.

## API endpoints (initial)

This is the original v1 subset and is no longer exhaustive — the new
endpoints added with bastion, sessions, connectivity, host keys, keypairs,
asset relations, probe-run, and VPC proxy promote/demote are not all
listed here. The authoritative client-facing inventory lives in
`docs/archive/design/frontend-migration-inventory.md`.

- `GET /auth/oidc/login`
- `GET /auth/oidc/login?next=/portal/`
- `GET /auth/oidc/callback`
- `POST /auth/local/login`
- `GET /auth/me` (requires `Authorization: Bearer <token>`)
- `GET /api/v1/cmdb/assets`
- `POST /api/v1/cmdb/assets`
- `GET /api/v1/cmdb/assets/{assetID}`
- `PATCH /api/v1/cmdb/assets/{assetID}`
- `DELETE /api/v1/cmdb/assets/{assetID}`
- `GET /api/v1/cmdb/assets/{assetID}/connection` (masked)
- `GET /api/v1/cmdb/assets/{assetID}/connection/resolve` (includes secrets)
- `PUT /api/v1/cmdb/assets/{assetID}/connection`
- `GET /api/v1/cmdb/assets/{assetID}/probe/latest`
- `POST /api/v1/cmdb/assets/{assetID}/probe`
- `GET /api/v1/aws/accounts`
- `POST /api/v1/aws/accounts`
- `GET /api/v1/aws/accounts/{accountID}`
- `PATCH /api/v1/aws/accounts/{accountID}`
- `POST /api/v1/aws/accounts/{accountID}/test`
- `POST /api/v1/aws/sync/run`
- `GET /api/v1/aws/sync/status`
- `GET /api/v1/aws/sync/runs?limit=120`
- `GET /api/v1/iam/users`
- `GET /api/v1/iam/users/{userID}`
- `GET /api/v1/iam/roles`
- `GET /api/v1/iam/roles?include_permissions=true`
- `GET /api/v1/iam/roles/{roleName}/permissions`
- `GET /api/v1/iam/oidc-config`
- `PUT /api/v1/iam/oidc-config`
- `POST /api/v1/iam/oidc-config/test`
- `POST /api/v1/iam/users/{userID}/roles` (body: `{"role_name":"ops"}`)
- `DELETE /api/v1/iam/users/{userID}/roles/{roleName}`

All `/api/v1/*` endpoints require platform bearer token.
Token is returned by `POST /auth/local/login` or `GET /auth/oidc/callback`.

## Frontend console flow

Cutover is complete: `/portal/` is the React/Vite console, and the legacy
classic-script console is preserved at `/portal-legacy/` for the
observation period.

- `http://localhost:8080/portal/` — React/Vite console. Covers Overview,
  CMDB (with full asset CRUD, manual probe, VPC proxy promote/demote,
  relations), Sessions (live SSH + RDP, audit, replay preview), Access
  (bastion grants/requests), Connectivity (SSH proxies, host keys,
  keypairs), AWS, IAM, and OIDC. The topbar has an `Old portal` link
  that jumps back to `/portal-legacy/` while we observe.
- `http://localhost:8080/portal-legacy/` — frozen copy of the classic
  console. Used only for cross-checking suspected regressions during the
  observation period; will be removed in a follow-up.

Sign-in flow is the same on both:

1. Open the portal URL.
2. Use `Local Login` (default admin) or click `OIDC Login`.
3. Browser callback / local login saves the bearer token to
   `localStorage` under `ops_platform_access_token`.
4. Use the in-portal navigation. The token is shared between the two
   portals, so switching does not require re-login.
5. OIDC runtime config is managed from the portal's IAM module.

Design references:

- Documentation map: `docs/README.md`
- Design docs index: `docs/design/README.md`
- Core platform architecture: `docs/design/ops-platform-v0.3.md`
- Frontend refactor (done, archived): `docs/archive/design/frontend-refactor-v2.md`
- Frontend baseline inventory (archived): `docs/archive/design/frontend-migration-inventory.md`
- New portal source: `web/README.md`

## CMDB x Bastion integration (v1)

- Bastion reads per-asset connect profile from CMDB:
  - `GET /api/v1/cmdb/assets/{assetID}/connection/resolve`
- CMDB stores bastion-managed credentials (encrypted at rest with `OPS_MASTER_KEY`):
  - `PUT /api/v1/cmdb/assets/{assetID}/connection`
- Bastion writes discovered software/hardware facts back to CMDB:
  - `POST /api/v1/cmdb/assets/{assetID}/probe`
- Latest probe snapshot query:
  - `GET /api/v1/cmdb/assets/{assetID}/probe/latest`
- `bastion-probe` worker reads enabled connection profiles and probes via SSH:
  - auth type `password` or `key`
  - writes snapshots into `cmdb_asset_probe_snapshot`
  - updates CMDB asset tags with probe summary

## Next planned additions

- Bastion gateway service with SSH session recording.
- Nightingale webhook ingestion and Lark notification routing.
