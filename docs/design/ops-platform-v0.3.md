# Ops Platform Design Doc (V0.3)

Date: 2026-03-02
Scope: Single-tenant. Backend in Go. Deploy via Docker Compose and Kubernetes. OIDC login (sync users only). CMDB covers cloud + on-prem (PC), AWS sync first. Observability via Prometheus + Nightingale; notifications via Lark.

## 1. Goals / Non-goals

### Goals (Phase 1)
- Unify identity and access with OIDC SSO; central audit trail.
- CMDB as source of truth for assets and relationships; change history and ownership.
- Bastion for SSH access with session recording and least-privilege authorization.
- Alert integration: ingest alerts from Nightingale, enrich with CMDB context, route notifications to Lark, track acknowledgement/suppression locally (and sync back if feasible).
- Extensible modular architecture: add modules later without changing the core auth/audit/data model.

### Non-goals (Phase 1)
- Full ITSM / complex ticketing (only minimal approval flow for bastion access).
- Replacing Nightingale/Prometheus (platform integrates with them).
- Full ABAC policy engine (start with RBAC + resource scoping; leave room for ABAC later).

## 2. Architecture (Logical)

### Services (initial split; can be combined for MVP)
- `ops-api`: IAM, CMDB, Bastion control plane, Alert Hub API, Admin APIs.
- `ops-bastion-gateway`: SSH proxy and session recorder; horizontally scalable.
- `ops-worker`: async jobs (AWS sync, alert processing, cleanup/retention, periodic health checks).

### Dependencies
- PostgreSQL: primary data store (CMDB, IAM state, alert index, audit index).
- Redis: cache/session/locks, optional job queue.
- Object Storage (S3/MinIO): session recordings, import/export artifacts.

### Integration Points
- OIDC IdP: authenticate users; sync user profile only.
- AWS: multi-account resource sync via AssumeRole or static credentials.
- Nightingale: alert webhook ingestion (and optional callback APIs for ack/silence).
- Lark: message send via Bot webhook or app API.

## 3. IAM & Security

### OIDC (sync users only)
- Flow: Authorization Code + PKCE.
- User identity:
  - Primary key: `oidc_subject` (OIDC `sub`).
  - Optional fields: `email`, `name`, `preferred_username`, `picture`.
- No group/department sync in Phase 1:
  - Platform roles are managed inside platform (admin assigns roles/scopes to users).
  - Future: add SCIM / group claim mapping without breaking user identity.

### RBAC model (Phase 1)
- Entities:
  - `role`: set of permissions.
  - `permission`: `resource` + `action` (+ optional `scope` constraints).
  - `binding`: user -> role with `scope` (e.g. env/project/asset_group).
- Actions (examples):
  - CMDB: `asset.read`, `asset.write`, `relation.write`, `schema.admin`
  - Bastion: `connect`, `approve`, `session.read`, `credential.admin`
  - Alerts: `alert.read`, `alert.ack`, `alert.silence`, `route.admin`
  - Admin: `user.admin`, `system.admin`
- Scope strategy:
  - `env` (prod/stage/dev), `project` (optional), `asset_group`.
  - Enforced at query layer and in permission checks.

### Audit
- All write operations append to `audit_log` with:
  - actor (`user_id`, `oidc_subject`), action, resource type/id, request metadata (ip/ua), result, `trace_id`.
- Sensitive events:
  - Credential read/use, bastion connect, session start/stop, alert ack/silence, role binding changes.

### Secrets
- Minimum viable:
  - Encrypt stored credentials with AES-GCM.
  - Master key from env/secret (`OPS_KMS_MASTER_KEY`) and rotation plan documented.
- Next:
  - Integrate KMS/Vault for envelope encryption and rotation.

## 4. CMDB

### Data model (relational + extensible fields)

#### Core tables (proposed)
- `cmdb_asset`
  - `id` (uuid), `type` (string), `name`, `status`, `env`, `owner_user_id` (nullable)
  - `source` (enum: manual/import/aws/agent), `external_id` (nullable), `external_arn` (nullable)
  - `tags` (jsonb), `search_text` (tsvector or generated), `created_at`, `updated_at`
- `cmdb_asset_attr_def`
  - `id`, `asset_type`, `key`, `value_type` (string/number/bool/json), `required`, `indexed`, `visible`
- `cmdb_asset_attr_value`
  - `asset_id`, `key`, `value_json` (jsonb), `updated_at`
- `cmdb_asset_relation`
  - `id`, `from_asset_id`, `to_asset_id`, `relation_type`, `created_at`
- `cmdb_change_log`
  - `id`, `asset_id` (nullable), `relation_id` (nullable), `change_type`, `diff_json`, `actor_user_id` (nullable), `source`, `created_at`
- `cmdb_asset_group`
  - `id`, `name`, `env`, `query_json` (optional dynamic group), `created_at`
- `cmdb_asset_group_member`
  - `group_id`, `asset_id`

#### Indexing notes
- `cmdb_asset(type, env)`, `cmdb_asset(external_id)`, `cmdb_asset(external_arn)` unique with `(source, external_id)` when applicable.
- Common filters (owner/env/type/tag keys) should be indexed explicitly; avoid over-indexing jsonb.

### Asset types (Phase 1)
- AWS: `aws_account`, `aws_region`, `aws_ec2_instance`, `aws_ebs_volume`, `aws_elb`, `aws_rds_instance`, `aws_vpc`, `aws_subnet`, `aws_security_group`
- On-prem: `pc` (minimal), `host` (optional)

### CMDB APIs (Phase 1)
- Assets:
  - `GET /api/cmdb/assets?type=&env=&q=&tag=` list/search
  - `POST /api/cmdb/assets` create (manual/import)
  - `GET /api/cmdb/assets/{id}` detail
  - `PATCH /api/cmdb/assets/{id}` update
  - `DELETE /api/cmdb/assets/{id}` (soft-delete recommended)
- Relations:
  - `POST /api/cmdb/relations` create
  - `DELETE /api/cmdb/relations/{id}`
- Schema:
  - `GET/POST /api/cmdb/asset-types/{type}/attrs` manage custom fields
- Import/Export:
  - `POST /api/cmdb/import` (csv/xlsx)
  - `GET /api/cmdb/export?...`

## 5. AWS Multi-Account Sync

### Account onboarding
- `aws_account` record includes:
  - `account_id` (12 digits), `display_name`, `enabled`
  - auth mode:
    - `assume_role`: `role_arn`, optional `external_id`
    - `static`: `access_key_id` + `secret_access_key` (encrypted), optional session token
  - region allowlist: `["us-east-1", "ap-southeast-1", ...]` (configurable)
  - tag policy: optional list of tag keys to sync

### Recommended auth: AssumeRole
- Best practice: platform runs with a base AWS identity and assumes `role_arn` in each target account via STS.
- If base identity is not available (non-AWS runtime), allow static credentials per account as Phase 1 fallback.

### Sync mechanics
- Job model:
  - Periodic full sync per account/region/resource type (Phase 1).
  - Concurrency controls to avoid AWS API throttling (token bucket + per-account limits).
- Idempotency:
  - Use stable keys:
    - `external_id` = AWS resource ID (e.g. `i-...`, `vpc-...`, `sg-...`)
    - `external_arn` where available
  - Upsert into `cmdb_asset` by `(source='aws', external_id)` (or `(external_arn)` if preferred).
- Deletion:
  - Do not hard-delete; mark `status=terminated/deleted` with `last_seen_at`.
  - Retention job purges after N days (configurable).
- Conflict policy:
  - Fields sourced from AWS are overwritten on sync.
  - Operator-owned fields:
    - store in custom attrs namespace (`ops.*`) or keep separate columns (e.g. `owner_user_id`, `env`) and never overwrite unless explicitly configured.

### Sync state & observability
- Tables:
  - `aws_sync_run(id, account_id, region, resource_type, started_at, finished_at, status, error)`
  - `aws_sync_checkpoint(account_id, region, resource_type, cursor_json, updated_at)` (Phase 2 if incremental)
- Metrics:
  - sync duration, resources processed, api errors, throttles, last successful sync per account.

### AWS resource mapping (examples)
- EC2 instance:
  - `name` from `Name` tag or instance id
  - `tags` full set or allowlisted
  - relations:
    - instance -> subnet, instance -> security_group, instance -> vpc
- RDS:
  - instance -> vpc, instance -> security_group, instance -> subnet_group (optional)

## 6. Bastion (SSH)

### Flow
1. User authenticates via OIDC and is authorized to `bastion.connect` for target asset/group.
2. `ops-api` issues a short-lived connect token scoped to session (JWT with session id).
3. Browser connects WebSocket to `ops-bastion-gateway` with token.
4. Gateway establishes SSH using managed credential, streams I/O, records session.

### Authorization & approval (Phase 1)
- Policy: user must have connect permission AND a valid grant:
  - `direct grant`: admin grants access to asset/group with expiry
  - `approval grant`: user requests -> approver approves -> grant issued with expiry

### Recording & retention
- Store recording segments in object storage, index in DB:
  - `bastion_session(id, user_id, asset_id, started_at, ended_at, status, recording_uri, bytes, client_ip)`
  - `bastion_command` optional (Phase 2, if structured command extraction added)
- Retention policy by env (e.g. prod 180d, non-prod 30d).

## 7. Alert Hub (Nightingale + Lark)

### Ingestion
- Endpoint: `POST /api/alerts/nightingale/webhook`
- Normalize to internal model:
  - `fingerprint` (stable hash of labels + rule id), `labels`, `severity`, `status` (firing/resolved), timestamps, raw payload stored (bounded).
- Dedup/group:
  - Group by `fingerprint` + `env` + `cluster` (configurable).

### Enrichment
- Match to CMDB by (priority order):
  1. `aws_instance_id` / `instance_id` label -> `cmdb_asset.external_id`
  2. `ip` label -> attribute match (if stored)
  3. `hostname`/`node` -> `cmdb_asset.name`
- Attach:
  - asset owner, env, related app/service (via relations), last change, recent bastion sessions.

### Notification to Lark
- Outbound adapter:
  - Lark bot webhook URL per route (Phase 1) or per org (single-tenant).
- Message format:
  - Lark interactive card with: severity, status, title, key labels, asset link, runbook link, ack/silence actions (links back to platform).

### Alert lifecycle (Phase 1)
- Internal state:
  - `alert_instance` + `alert_event` tables for history.
  - `ack` and `silence` stored locally; optionally call Nightingale API later.
- APIs:
  - `GET /api/alerts?status=&severity=&env=&q=` list
  - `POST /api/alerts/{id}/ack`
  - `POST /api/alerts/{id}/silence` (duration + reason)

## 8. Deployment

### Docker Compose (dev / small trial)
- Services: `ops-api`, `ops-bastion-gateway`, `ops-worker`, `postgres`, `redis`, `minio`.
- Config via env:
  - `OIDC_*`, `DB_*`, `REDIS_*`, `S3_*`, `LARK_*`, `MASTER_KEY`, `NIGHTINGALE_*`.

### Kubernetes (prod)
- Helm chart:
  - support external managed Postgres/Redis/S3 (recommended).
  - separate deployments for api/gateway/worker.
- Ingress + TLS:
  - terminate TLS at ingress; internal mTLS is Phase 2.

## 9. Rollout Plan (12 weeks baseline)
- Weeks 1-2: Auth/RBAC/Audit skeleton, base UI, DB migrations, service packaging (compose/helm).
- Weeks 3-5: CMDB core + AWS multi-account onboarding + EC2/VPC/SG/RDS sync.
- Weeks 6-8: Bastion SSH gateway + grants/approval + recording + retention.
- Weeks 9-10: Nightingale webhook ingestion + enrichment + Lark routing + alert list & ack/silence.
- Weeks 11-12: hardening (rate limits, indexes, backups), docs/runbooks, security review, pilot rollout.

## 10. Open Decisions (need confirmation)
- OIDC provider specifics (issuer URL, claims available); whether to enforce MFA at IdP.
- AWS auth baseline:
  - Preferred: a single platform principal to AssumeRole into all accounts.
  - Fallback: static per-account credentials (acceptable but higher risk).
- Nightingale integration:
  - webhook payload format and whether Nightingale provides APIs for ack/silence to keep states consistent.

