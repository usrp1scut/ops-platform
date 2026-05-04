# Frontend Migration Inventory

Date: 2026-05-03
Status: Baseline for frontend refactor V2

This inventory starts Phase 0 from `docs/design/frontend-refactor-v2.md`.
It records the legacy embedded portal surface before replacement UI is built.

## Source Files

- Shell: `internal/httpserver/ui/portal/index.html`
- Main orchestration: `internal/httpserver/ui/portal/app.js`
- Classic script modules:
  - `modules/router.js`
  - `modules/theme.js`
  - `modules/modal.js`
  - `modules/bastions.js`
  - `modules/grants.js`
  - `modules/hostkeys.js`
  - `modules/keypairs.js`
  - `modules/replay.js`
- Vendor runtime assets:
  - `vendor/xterm/*`
  - `vendor/guacamole/guacamole-common.min.js`

## Current Portal Navigation

The legacy portal uses hash routing in `modules/router.js`.

| Section | Subsections | Backing view |
| --- | --- | --- |
| `overview` | `overview` | `view-overview` |
| `assets` | `inventory` | `view-cmdb` |
| `assets` | `connectivity` | `view-connectivity` |
| `sessions` | `live`, `audit` | `view-sessions` |
| `access` | `my-requests`, `pending`, `active-grants` | `view-grants` |
| `platform` | `cloud-accounts` | `view-aws` |
| `platform` | `iam` | `view-iam` |
| `platform` | `oidc` | `view-oidc` |
| `profile` | `profile` | `view-profile` |

Legacy single-view aliases still map into that model:
`cmdb`, `connectivity`, `bastions`, `proxies`, `hostkeys`, `keypairs`,
`grants`, `aws`, and `iam`.

## API Usage Baseline

The replacement frontend should preserve relative URLs.

| Area | Current paths |
| --- | --- |
| Health | `GET /healthz` |
| Auth | `POST /auth/local/login`, `GET /auth/oidc/login`, `GET /auth/oidc/callback`, `GET /auth/me` |
| CMDB assets | `GET/POST /api/v1/cmdb/assets`, `GET/PUT/DELETE /api/v1/cmdb/assets/{id}` |
| CMDB facets | `GET /api/v1/cmdb/assets/facets` |
| Asset connection | `GET/PUT /api/v1/cmdb/assets/{id}/connection`, `POST /api/v1/cmdb/assets/{id}/connection/test` |
| Asset probe | `GET /api/v1/cmdb/assets/{id}/probe/latest`, `POST /api/v1/cmdb/assets/{id}/probe/run` |
| Asset relations | `GET /api/v1/cmdb/assets/{id}/relations`, `DELETE /api/v1/cmdb/assets/{id}/relations/{relationID}` |
| VPC proxy | `POST /api/v1/cmdb/assets/{id}/promote-vpc-proxy`, `POST /api/v1/cmdb/assets/{id}/demote-vpc-proxy` |
| SSH proxy | `/api/v1/cmdb/ssh-proxies` |
| Host keys | `/api/v1/cmdb/hostkeys`, `/api/v1/cmdb/hostkeys/{scope}/{id}/override`, `/api/v1/cmdb/hostkeys/asset/{assetID}/override` |
| Keypairs | `/api/v1/ssh-keypairs` |
| Sessions | `GET /api/v1/cmdb/sessions`, `GET /api/v1/cmdb/sessions/{id}/recording` |
| Terminal/RDP tickets | `POST /api/v1/cmdb/assets/{id}/terminal/ticket`, `POST /api/v1/cmdb/assets/{id}/rdp/ticket` |
| Terminal/RDP WebSocket | `/ws/v1/cmdb/assets/{id}/terminal`, `/ws/v1/cmdb/assets/{id}/rdp` |
| Bastion access | `/api/v1/bastion/requests`, request approve/reject/cancel actions, `/api/v1/bastion/grants` |
| AWS accounts | `/api/v1/aws/accounts`, `/api/v1/aws/accounts/{id}/test` |
| AWS sync | `/api/v1/aws/sync/status`, `/api/v1/aws/sync/runs`, `/api/v1/aws/sync/run` |
| IAM | `/api/v1/iam/users`, `/api/v1/iam/roles`, `/api/v1/iam/roles/{roleName}/permissions`, user role bind/unbind |
| OIDC settings | `GET/PUT /api/v1/iam/oidc-config`, `POST /api/v1/iam/oidc-config/test` |

## Permission Usage Baseline

The frontend uses permissions as UX hints only. The backend remains the
enforcement boundary.

- `system:admin`
- `cmdb.asset:read`
- `cmdb.asset:write`
- `aws.account:read`
- `aws.account:write`
- `iam.user:read`
- `iam.user:write`
- `bastion.grant:read`
- `bastion.grant:write`
- `bastion.request:read`
- `bastion.request:write`

The legacy helper treats `system:admin` as a universal frontend grant.

## Critical Workflow Checklist

- [ ] Local login
- [ ] OIDC login launch and callback
- [ ] Profile and permission display
- [ ] Asset list, search, filter, and pagination
- [ ] Asset create, update, and delete
- [ ] Asset drawer details
- [ ] AWS account create, update, list, test, sync status, sync runs, and sync trigger
- [ ] IAM user list, role binding, role unbinding, and role permission display
- [ ] OIDC settings update and connection test
- [ ] SSH proxy management
- [ ] Host key override management
- [ ] Keypair management
- [ ] Bastion grants and requests
- [ ] Terminal ticket launch and WebSocket session
- [ ] RDP ticket launch and Guacamole WebSocket session
- [ ] Session list and replay

## Phase 1 Acceptance Target

The first replacement slice should prove the new app boundary without changing
the Go API:

- `web/` builds with Vite, React, and TypeScript.
- Dev proxy forwards `/healthz`, `/auth`, `/api`, and `/ws` to `localhost:8080`.
- The new app can call `/healthz` and `/auth/me` through the shared API client.
- Local login stores the same `ops_platform_access_token` key used by the
  current portal.
- The embedded legacy portal remains untouched.

## Deferred Review Findings

- [ ] Route base and OIDC redirect base are not yet adapted for a `/portal/`
  production mount. The current React router has no `basename`, and OIDC login
  defaults the `next` path to `/`. This is acceptable during the Vite Phase 1
  skeleton because development runs at `/`, but it must be fixed before cutover
  when the new frontend becomes the primary `/portal/` experience.
