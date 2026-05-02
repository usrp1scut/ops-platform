# Frontend Refactor Plan (V2)

Date: 2026-05-02
Status: Proposed
Audience: platform engineers, frontend maintainers, backend maintainers

## 1. Context

The current portal is embedded in the Go API binary under
`internal/httpserver/ui/portal`. This was the right tradeoff for the initial
platform: it made the MVP easy to ship, kept deployment simple, and avoided a
separate frontend toolchain while the backend domains were still moving.

The portal has now grown beyond the original V1 scope. It covers inventory,
AWS account management, IAM, OIDC runtime settings, SSH proxy configuration,
host keys, keypairs, bastion grants, sessions, terminal launch, RDP launch, and
session replay. Most of the orchestration still lives in
`internal/httpserver/ui/portal/app.js`, with a few extracted classic-script
modules under `internal/httpserver/ui/portal/modules`.

That shape is becoming expensive to extend. The next frontend iteration should
split the user interface into a dedicated web application while preserving the
existing backend API surface.

## 2. Goals

- Move the portal source into a dedicated `web/` application.
- Keep the backend API, auth, RBAC, audit, and WebSocket behavior stable during
  the migration.
- Replace hand-written DOM rendering with a typed component model.
- Make feature ownership clearer across CMDB, AWS, IAM, bastion, sessions, and
  connectivity.
- Keep the migration incremental so the current `/portal/` can remain available
  until the replacement is complete.
- Improve testability for auth flows, permissions, tables, forms, drawers,
  WebSocket launch flows, and session replay.

## 3. Non-goals

- Do not redesign the backend domain model as part of the frontend migration.
- Do not replace RBAC with a frontend-side authorization system.
- Do not introduce server-side rendering or SEO-oriented routing.
- Do not split the repository immediately. A single repository with separate
  `web/` and Go backend trees is preferred until the API contract is more
  stable.
- Do not remove the legacy embedded portal before all critical workflows have a
  tested replacement.

## 4. Recommended Stack

- React
- TypeScript
- Vite
- React Router
- TanStack Query
- React Hook Form
- Zod
- Zustand or a small context-based auth store
- Playwright for smoke and workflow tests

Next.js is not recommended for this platform. The product is an authenticated
operations console with no SEO requirement, and the backend already owns the
server-side APIs and WebSocket endpoints. Vite keeps the build and deployment
model simpler.

## 5. Target Repository Layout

```text
web/
  package.json
  vite.config.ts
  tsconfig.json
  src/
    main.tsx
    app/
      App.tsx
      router.tsx
      providers/
      layout/
    api/
      client.ts
      auth.ts
      cmdb.ts
      aws.ts
      iam.ts
      bastion.ts
      sessions.ts
      connectivity.ts
    features/
      auth/
      overview/
      cmdb/
      aws/
      iam/
      bastion/
      sessions/
      connectivity/
    components/
      ui/
      layout/
      data-table/
      forms/
    hooks/
    lib/
    styles/
```

The Go backend remains responsible for:

- `/auth/*`
- `/api/v1/*`
- `/ws/v1/*`
- `/healthz`
- migrations
- workers
- audit, RBAC, secret encryption, and persistence

## 6. Runtime Configuration Boundary

The refactor should preserve the platform's intended configuration split:

- Infrastructure bootstrap configuration stays in environment variables.
- Runtime integration settings are managed from the portal and persisted in the
  database.

Environment-backed bootstrap configuration should include:

- `OPS_DATABASE_URL`
- `OPS_MASTER_KEY` or later KMS/Vault bootstrap settings
- `OPS_HTTP_ADDR`
- local bootstrap admin credentials
- deployment-level worker intervals where needed
- object storage bootstrap settings, unless a later platform settings module
  explicitly moves them into the database

Runtime settings should be managed from the frontend and saved through APIs:

- OIDC issuer, client ID, client secret, redirect URL, scopes, and endpoint
  overrides
- AWS account onboarding settings, role ARN, external ID, region allowlist, and
  optional static credentials
- future Nightingale webhook settings
- future Lark notification routing settings

OIDC and AWS account configuration already have database-backed models. The
refactor should make the frontend the primary operational entrypoint for those
settings, while keeping environment values only as bootstrap or fallback inputs.

## 7. API Client Design

Create a single API client layer under `web/src/api`.

Responsibilities:

- Attach `Authorization: Bearer <token>` for protected requests.
- Parse JSON responses consistently.
- Normalize backend errors into typed frontend errors.
- Clear auth state and route to login on `401`.
- Preserve relative URLs so dev, staging, and production can share the same
  frontend code:
  - `/auth/*`
  - `/api/v1/*`
  - `/ws/v1/*`

The API client should not hide domain concepts behind generic request helpers.
Each feature should expose explicit functions such as `listAssets`,
`createAsset`, `listAwsAccounts`, `updateOidcConfig`, and `issueTerminalTicket`.

## 8. Auth and Permission Model

The first migration stage should keep the current bearer-token behavior:

- local login stores the access token in `localStorage`;
- OIDC login redirects through the backend callback;
- authenticated requests send the token in the `Authorization` header.

The backend remains the only trusted authorization boundary. The frontend should
use permissions only for user experience:

- hide or disable unavailable actions;
- show helpful permission messages;
- avoid offering workflows that the backend will reject.

The frontend permission helper should support:

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

A later security hardening phase may move from `localStorage` bearer tokens to
HttpOnly cookies, but that should not block the frontend extraction.

## 9. Development Routing

During development:

```text
http://localhost:5173  -> Vite frontend
http://localhost:8080  -> Go API
```

Vite should proxy:

```text
/api  -> http://localhost:8080
/auth -> http://localhost:8080
/ws   -> ws://localhost:8080
```

This allows frontend code to call the same relative paths in development and
production.

## 10. Production Deployment Options

### Option A: Frontend served by a gateway

Use Nginx, an ingress controller, or another gateway:

```text
/        -> web static assets
/portal  -> web static assets
/api/*   -> ops-api
/auth/*  -> ops-api
/ws/*    -> ops-api WebSocket
```

This is the preferred long-term deployment model because it separates frontend
build artifacts from the Go API binary.

### Option B: Frontend embedded in Go

Build `web/dist` and embed it into `ops-api`.

This keeps deployment simple, but it is less clean as a frontend/backend
separation boundary. It can be used as a transitional deployment strategy if the
platform needs to keep a single runtime artifact for now.

## 11. Migration Plan

### Phase 0: Inventory and baseline

Create a migration inventory before writing replacement UI.

Deliverables:

- current portal route list;
- current API usage list;
- current permission usage list;
- critical workflow checklist;
- screenshots or short recordings for key flows.

Critical workflows:

- local login;
- OIDC login launch and callback;
- profile and permission display;
- asset list/search/filter/pagination;
- asset create/update/delete;
- asset drawer details;
- AWS account create/update/list;
- AWS sync trigger and run history;
- IAM user list and role binding;
- OIDC settings update;
- SSH proxy management;
- host key override management;
- keypair management;
- bastion grants and requests;
- terminal ticket launch;
- RDP ticket launch;
- session list and replay.

### Phase 1: Web skeleton

Create `web/` with Vite, React, TypeScript, routing, layout, and API client.

Deliverables:

- `npm run dev`;
- `npm run build`;
- `npm run typecheck`;
- base layout with sidebar and top user area;
- login route;
- protected route wrapper;
- health check call through the API client.

Acceptance criteria:

- the new frontend runs without changing the Go API;
- the browser can call `/healthz` and `/auth/me` through the dev proxy;
- no existing portal files are removed.

### Phase 2: Auth and permissions

Migrate the entry and identity flows.

Deliverables:

- local login;
- logout;
- token restore on page refresh;
- OIDC login redirect button;
- profile refresh;
- permission helper;
- route guard.

Acceptance criteria:

- an admin can sign in and refresh the page without losing session state;
- unauthorized users are routed back to login;
- permission-gated controls behave consistently with backend RBAC.

### Phase 3: Low-risk modules

Migrate modules without terminal/RDP WebSocket complexity first.

Order:

1. Overview
2. My Access
3. IAM
4. AWS

Deliverables:

- overview health and metrics;
- profile, roles, and permission chips;
- IAM users, roles, role permission details, bind, and unbind;
- OIDC runtime settings form;
- AWS account list, create/update form, sync status, sync runs, and manual
  trigger.

Acceptance criteria:

- all write actions show success and failure feedback;
- forms validate required fields before sending requests;
- mutations refresh the relevant query state;
- IAM and AWS behavior matches the legacy portal.

### Phase 4: CMDB

Migrate the inventory domain as its own milestone.

Deliverables:

- asset list;
- filters, search, facets, pagination;
- list/tree view switching;
- create, update, delete;
- asset detail drawer;
- connection profile display and edit;
- connection test;
- latest probe display;
- manual probe run;
- asset relations;
- VPC proxy promote and demote.

Acceptance criteria:

- the new CMDB module covers the legacy portal's supported workflows;
- filters and pagination remain stable after mutation;
- drawer refresh and error states are predictable;
- destructive actions require confirmation;
- backend validation errors are visible to the operator.

### Phase 5: Connectivity, bastion, and sessions

Migrate the highest-risk workflows after the stable CRUD modules are complete.

Deliverables:

- SSH proxy management;
- host key list and overrides;
- keypair management;
- bastion grants;
- bastion requests;
- session list and filters;
- recording lookup and replay;
- terminal ticket creation and WebSocket launch;
- RDP ticket creation and Guacamole WebSocket launch.

Acceptance criteria:

- terminal sessions can open, resize, and close correctly;
- RDP sessions can open and disconnect correctly;
- session records are created and visible;
- replay either works or shows a clear unavailable state;
- permission and grant failures are handled clearly.

### Phase 6: Cutover

Switch `/portal/` to the new frontend only after Phases 1-5 pass acceptance.

Deliverables:

- production build pipeline;
- gateway or embed integration;
- legacy portal removal plan;
- updated README;
- updated Docker Compose or deployment manifests;
- smoke tests in CI or the local check script.

Acceptance criteria:

- `docker compose up --build` exposes the new portal;
- `/api/*`, `/auth/*`, and `/ws/*` continue to route to `ops-api`;
- legacy `/ui/*` still redirects to `/portal/`;
- all critical workflows pass smoke testing.

## 12. Testing Strategy

Minimum checks:

- `npm run typecheck`
- `npm run build`
- unit tests for API client error handling;
- unit tests for permission helpers;
- form schema tests for OIDC, AWS account, and asset forms;
- Playwright smoke tests for key workflows.

Recommended Playwright smoke tests:

- local admin login;
- profile load;
- asset list load;
- asset create and delete;
- AWS account form validation;
- IAM role bind and unbind;
- OIDC settings form validation;
- terminal ticket creation with a mocked or test asset where practical.

Backend integration tests should remain in Go. The frontend should not duplicate
backend authorization tests; it should verify that permission-aware UI state is
rendered correctly.

## 13. Risk Controls

- Keep the legacy portal available until the new portal covers all critical
  workflows.
- Migrate one feature area at a time.
- Avoid changing backend response shapes during the frontend extraction.
- Add typed frontend API models before large UI migrations.
- Keep destructive operations behind confirmation dialogs.
- Test WebSocket flows late, after auth and ticket creation are stable.
- Treat frontend permission checks as hints only; backend RBAC remains the
  enforcement layer.

## 14. Suggested Timeline

```text
Week 1: Phase 0 and Phase 1
Week 2: Phase 2 and Phase 3
Weeks 3-4: Phase 4
Week 5: Phase 5
Week 6: Phase 6, cleanup, tests, and documentation
```

The timeline assumes one engineer with backend support available for API
questions. If terminal/RDP workflows require heavy browser compatibility work,
Phase 5 should be allowed to expand without delaying the lower-risk module
cutover.

## 15. Completion Definition

The frontend refactor is complete when:

- the new `web/` app is the primary `/portal/` experience;
- the old classic-script portal has been removed or explicitly marked as
  deprecated fallback;
- all critical workflows have smoke coverage;
- frontend build and typecheck are documented;
- deployment no longer requires editing Go files for frontend-only changes;
- runtime OIDC and AWS settings remain database-backed and manageable from the
  portal.
