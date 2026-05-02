# Maintenance notes

How the post-refactor codebase is organized and how to extend it without
re-introducing the boundaries Phase 0–5 just removed.

## Where things live

| Concern                                         | Package                                  |
| ----------------------------------------------- | ---------------------------------------- |
| HTTP response / error helpers                   | `internal/platform/httpx`                |
| Auth, RBAC, audit middleware                    | `internal/iam`                           |
| Asset CRUD, connection profiles, relations      | `internal/cmdb`                          |
| VPC proxy promote/demote, peer propagation      | `internal/cmdb` (`VPCProxyService`)      |
| AWS account onboarding (credentials)            | `internal/aws`                           |
| AWS resource sync (EC2/VPC/SG/RDS → assets)     | `internal/awssync`                       |
| Asset host-fact probe (SSH/Postgres/RDP)        | `internal/bastionprobe`                  |
| WebSocket SSH terminal                          | `internal/terminal`                      |
| WebSocket RDP via Guacamole                     | `internal/guacproxy`                     |
| Short-lived WebSocket tickets (SSH + RDP)       | `internal/connectivity`                  |
| Pinned host-key store (TOFU + override)         | `internal/hostkey`                       |
| Encrypted SSH private-key store                 | `internal/keypair`                       |
| Live-session metadata + audit                   | `internal/sessions`                      |
| Frontend (vanilla JS, no build)                 | `internal/httpserver/ui/portal/`         |

## Adding a new feature

### A new HTTP endpoint in an existing context

1. Add the handler method to the context's `handler.go`.
2. Mount it from `internal/httpserver/server.go` under the right route group.
3. Use `httpx.WriteJSON` / `httpx.WriteError` — never write a local helper.
4. If it writes any state, add an `iam.RequirePermission(...)` middleware on
   the route.

### A new resource in CMDB

1. Add CRUD to `internal/cmdb/repository.go`. **Repository methods are pure
   persistence** — no transactions that span aggregates, no orchestration.
2. If the operation crosses aggregates, add it to a service struct in the same
   package (see `VPCProxyService` for the pattern). The service owns the
   transaction boundary.
3. Add request/response types to `model.go` next to existing peers.

### A new AWS resource type to sync

1. Extend `internal/awssync` with the SDK calls and normalization.
2. If a new asset shape is needed, extend `awssync.AssetUpsert` (the DTO).
3. The adapter at `internal/cmdb/aws_writer.go` translates the DTO to SQL.
4. **Do not** import `internal/cmdb` from awssync — that edge is a STRICT
   rule. If you need cmdb behavior, add it to a port in `awssync/port.go`.

### A new probe protocol

1. Extend `internal/bastionprobe.Service` with a `dial<Proto>` method. Run any
   `target.ProxyRequired && target.Proxy == nil` guard *before* I/O — see
   `dialSSH` / `dialPostgres` for the pattern (ADR-0006).
2. Cleanup of any tunnelled SSH session must be returned to the caller (e.g.
   `dialPostgres` returns a cleanup func). Closing the protocol-level
   connection alone is not enough.

### A new portal view

1. Create `internal/httpserver/ui/portal/modules/<name>.js`. Define functions
   only — no top-level code that references `state` / `elements` / `api`,
   because module files load before `app.js`.
2. Add the script tag to `index.html` *before* `app.js`.
3. Wire bootstrap calls (`refresh<Name>`, `bind<Name>Events`) from `app.js`'s
   `bootstrap()` / `bindEvents()`.
4. The `app.js` LOC cap (3800) is enforced by `scripts/check-deps.sh`. New
   non-trivial features should land as modules, not in `app.js`.

## Testing

- Unit tests live next to the code (`*_test.go`).
- The dial-guard tests (`internal/bastionprobe/service_test.go`) construct an
  empty `*Service` because the guards run before any service dependency is
  touched. Keep new guards in that prefix so they remain unit-testable.

### Integration tests

`test/integration/` boots ops-api in-process against a real Postgres and
issues an admin token before each test. Run with:

```bash
bash scripts/test-integration.sh           # default: ops_platform_test DB
bash scripts/test-integration.sh -v        # verbose
bash scripts/test-integration.sh -run Foo  # filter
```

Files in `test/integration/` are guarded by the `integration` build tag, so
default `go test ./...` stays unit-only and fast. The harness:

- creates the test DB if it doesn't exist (uses ops/ops on localhost:5432 by
  default — same creds as docker-compose);
- re-applies every migration on each run (idempotent `IF NOT EXISTS`);
- spins up a fresh `httptest.Server` per `Bootstrap(t)` so tests don't share
  HTTP state. Test DB rows persist across runs — write tests that clean up
  after themselves.

When adding a new STRICT dependency rule (or fixing a bug that crossed a
boundary), prefer to add an integration test in this package. It catches
the kind of regression unit tests can't see (auth wiring, route mounting,
end-to-end serialization).

The "probe via bastion proxy actually releases the SSH session" case is
covered by `proxy_lifecycle_test.go`, which uses an in-process
`golang.org/x/crypto/ssh` server (no Docker) and asserts on its active-
session counter after each probe.

## CI checks (mandatory)

```bash
go build ./...
go test ./...                              # unit tests
bash scripts/check-deps.sh                 # architectural rules
bash scripts/test-integration.sh           # integration baseline (needs Postgres)
```

`check-deps.sh` is the architectural CI: it gates every STRICT rule listed in
`docs/architecture/dependency-graph.md`. Adding a new boundary rule? Append a
`check STRICT` block; adding a known-debt area to be worked off? Use
`check DEBT` and flip it to STRICT in the PR that finishes the work.
