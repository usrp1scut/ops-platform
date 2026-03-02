# ops-platform (initial implementation)

This repository contains an initial implementation aligned with `docs/design/ops-platform-v0.3.md`.

## Implemented in this stage

- Go backend scaffold (`ops-api`) with structured routes.
- PostgreSQL schema migrations for CMDB and AWS account onboarding.
- CMDB asset CRUD API.
- AWS account onboarding API (multi-account model, assume-role/static modes).
- Docker Compose stack with Postgres, Redis, MinIO, migration job, and API service.

## Quick start

```bash
docker compose up --build
```

Service endpoint:

- API: `http://localhost:8080`
- Health: `GET /healthz`

## Local development without Docker

1. Set environment variables:

```bash
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

## API endpoints (initial)

- `GET /api/v1/cmdb/assets`
- `POST /api/v1/cmdb/assets`
- `GET /api/v1/cmdb/assets/{assetID}`
- `PATCH /api/v1/cmdb/assets/{assetID}`
- `DELETE /api/v1/cmdb/assets/{assetID}`
- `GET /api/v1/aws/accounts`
- `POST /api/v1/aws/accounts`
- `GET /api/v1/aws/accounts/{accountID}`
- `PATCH /api/v1/aws/accounts/{accountID}`

## Next planned additions

- OIDC login and session middleware.
- Bastion gateway service with SSH session recording.
- Nightingale webhook ingestion and Lark notification routing.
- AWS sync worker for EC2/VPC/SG/RDS resources.

