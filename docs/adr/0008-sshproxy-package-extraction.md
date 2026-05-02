# ADR-0008: SSH proxy package extracted from cmdb

Status: Accepted (2026-04-28, post-Phase 5)

## Context

ADR-0001 acknowledged that `internal/cmdb` was still doing too much: asset
CRUD, connection profiles, probe state, relations, VPC-proxy promotion,
*and* SSH proxy CRUD + HTTP handler. The cmdb decomposition was deferred
during the architecture refactor because there was no integration-test
safety net. With `test/integration/` in place (ADR-0006 / Phase 5), the
risk of moving things out of cmdb dropped enough to justify a first cut.

## Decision

Extract `internal/sshproxy/` as a separate package owning everything that
talks to the `cmdb_ssh_proxy` table outside of cross-aggregate transactions:

- `internal/sshproxy/model.go` — `SSHProxy`, `UpsertSSHProxyRequest`,
  `SSHProxyTarget`, `ErrNotFound`.
- `internal/sshproxy/repository.go` — CRUD (`List/Get/Create/Update/Delete`)
  and the dialer-friendly `GetTarget`. Also exports `Columns` and `Scan` so
  cmdb's promotion Tx helpers can reuse the row shape without duplicating
  it.
- `internal/sshproxy/handler.go` — HTTP handler mounted at
  `/api/v1/cmdb/ssh-proxies`.

`internal/cmdb` keeps:
- The asset / connection / probe / relation aggregates.
- `vpcproxy.go` Tx helpers and `VPCProxyService` — promotion intentionally
  spans `cmdb_asset`, `cmdb_asset_connection`, and `cmdb_ssh_proxy` in a
  single transaction; the orchestration belongs in the package that owns
  the cross-aggregate guarantee. The Tx helpers SELECT/INSERT/UPDATE on
  `cmdb_ssh_proxy` directly using `sshproxy.Columns` for row shape.

`cmdb.Repository` now takes a `*sshproxy.Repository` at construction so it
can delegate `BastionProbeTarget` proxy lookup without re-implementing the
SQL or owning the table.

`bastionprobe` was updated to consume `sshproxy.SSHProxyTarget` directly
(replacing `cmdb.SSHProxyTarget`).

## Consequences

- Dependency edges: cmdb → sshproxy (delegate), bastionprobe → sshproxy
  (type), httpserver/ops-worker/bastion-probe wire `sshproxy.NewRepository`
  before `cmdb.NewRepository`.
- New STRICT rule (`scripts/check-deps.sh`): `cmdb.Repository` may not
  define `(Create|Update|Delete|Get|List)SSHProxy` methods.
- `internal/cmdb` shrunk from ~3 000 to ~2 600 lines (–13%); 461 lines of
  honest SSH-proxy responsibility now live in their own package.
- Open follow-ups (deferred, larger):
  - Asset/connection/probe further split — repository.go is still 1 200+
    lines mixing aggregates.
  - `aws_writer.go` could relocate to an aws-side adapter package once the
    asset-domain split lands.
