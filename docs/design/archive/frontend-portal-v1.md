# Ops Platform Frontend Portal Design (V1)

Date: 2026-03-02  
Target Path: `/portal/`  
Audience: Platform users (operators, developers, and admins)

## 1. Design Goals

- Use one unified web portal for all operations.
- Keep bootstrap simple: local login for first-time access + OIDC SSO for enterprise login.
- Cover core module workflows in one UI:
  - CMDB browse + create
  - AWS account management + sync status/trigger
  - IAM user/role binding and role permission query
  - OIDC runtime configuration
- Reuse backend RBAC checks as the single source of truth.

## 2. Non-goals (V1)

- Bastion session launch/playback UX.
- Alert center workflow UX.
- Multi-tenant switch and tenant branding.
- Complex frontend build tooling (V1 keeps embedded static assets).

## 3. Route Strategy

- `/portal/`: unified operations portal (primary and only UI entry)
- `/`: redirect to `/portal/`
- `/ui` and `/ui/*`: redirect to `/portal/` (legacy route compatibility)

## 4. Information Architecture

Portal navigation modules:

- `Overview`
  - platform health
  - activity stream
  - key metrics (assets, AWS accounts, role count, write access)
- `CMDB`
  - asset list/search
  - create asset form
- `AWS`
  - account list
  - create account form
  - sync status/history
  - manual trigger sync
- `IAM`
  - user list/search
  - selected user role binding/unbinding
  - role list + permission detail
  - OIDC config view/update
- `My Access`
  - current identity
  - role and permission chips

## 5. Frontend Module Design

### 5.1 App Shell

Responsibilities:

- global session state
- in-page module switching
- permission-aware UI disable state
- logout/reset behavior

Core state:

- auth: `token`, `user`, `roles`, `permissions`
- cmdb: `assets`
- aws: `awsAccounts`, `awsSyncStatus`, `awsSyncRuns`
- iam: `iamUsers`, `iamRoles`, `selectedUserID`, `selectedUserIdentity`, `oidcSettings`
- ui: `view`, `activity`

### 5.2 Auth Module

Capabilities:

- local login via `POST /auth/local/login`
- OIDC login via `GET /auth/oidc/login?next=/portal/`
- token persistence in `localStorage`
- profile refresh via `GET /auth/me`

### 5.3 Module/API Mapping

CMDB:

- `GET /api/v1/cmdb/assets`
- `POST /api/v1/cmdb/assets`

AWS:

- `GET /api/v1/aws/accounts`
- `POST /api/v1/aws/accounts`
- `GET /api/v1/aws/sync/status`
- `GET /api/v1/aws/sync/runs?limit=120`
- `POST /api/v1/aws/sync/run`

IAM:

- `GET /api/v1/iam/users`
- `GET /api/v1/iam/users/{userID}`
- `POST /api/v1/iam/users/{userID}/roles`
- `DELETE /api/v1/iam/users/{userID}/roles/{roleName}`
- `GET /api/v1/iam/roles?include_permissions=true`
- `GET /api/v1/iam/roles/{roleName}/permissions`
- `GET /api/v1/iam/oidc-config`
- `PUT /api/v1/iam/oidc-config`

## 6. Security Design

- All protected requests carry `Authorization: Bearer <token>`.
- Permission gating is enforced twice:
  - backend middleware/RBAC as hard control
  - frontend disable/read-only as usability hint
- OIDC `next` is sanitized server-side:
  - must start with `/`
  - cannot start with `//`
- OIDC callback sets token and redirects to validated path.

## 7. Visual/UX Direction

- Keep a recognizable, atmospheric operations visual style.
- Prioritize scanning speed for tables/log blocks.
- Minimize context switching by keeping write operations near list views.
- Ensure mobile compatibility with responsive nav and stacked panels.

## 8. Implemented Deliverables (This Iteration)

- Unified portal page and scripts:
  - `internal/httpserver/ui/portal/index.html`
  - `internal/httpserver/ui/portal/styles.css`
  - `internal/httpserver/ui/portal/app.js`
- Legacy UI route deprecation through redirect:
  - `/ui` -> `/portal/`
  - `/ui/*` -> `/portal/`
- OIDC return-path support for portal login:
  - `GET /auth/oidc/login?next=/portal/`

## 9. Next Iteration

- Add bastion and alert module cards/actions once backend APIs are ready.
- Split portal JS into module files to improve maintainability.
- Add smoke tests for key portal flows (local login, OIDC login, CMDB create, IAM bind/unbind).
