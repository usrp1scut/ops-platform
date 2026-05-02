# ADR-0004: AWS sync depends on AssetWriter port

Status: Accepted (2026-04-26, Phase 3)

## Context

`internal/awssync` previously imported `internal/cmdb` directly, held a
`*sql.DB`, and ran raw `INSERT INTO cmdb_asset` SQL. Any cmdb schema change
required edits inside awssync; any awssync change risked stepping on cmdb
invariants. The two contexts were welded together.

## Decision

Define the port on the *consumer* side (awssync):

```go
// internal/awssync/port.go
type AssetUpsert struct { /* normalized DTO */ }
type AssetWriter interface {
    UpsertAsset(ctx context.Context, item AssetUpsert) error
    LinkAWSRelations(ctx context.Context) error
}
```

`awssync.Service` now takes `(cfg, accounts *aws.Repository, writer AssetWriter,
reapplier VPCProxyReapplier)` — no `*sql.DB`, no cmdb import. The cmdb-side
adapter (`internal/cmdb/aws_writer.go`) holds the SQL and is wired in by
`httpserver.Server` and `cmd/ops-worker`.

OS family derivation moved from cmdb to awssync (it's AWS AMI knowledge);
`DefaultUsernameForOSFamily` stayed in cmdb (asset-domain default).

Two STRICT rules enforce the boundary:
- awssync must not import `ops-platform/internal/cmdb`.
- awssync must not run raw `(INSERT|UPDATE) cmdb_*` SQL.

## Consequences

- Replacing the writer (e.g. mock for tests, second sync target) is a
  composition-root change, not an awssync change.
- The cmdb→awssync edge that the adapter introduces is acceptable: the adapter
  *implements* the awssync-defined port, so the dependency direction is still
  awssync←cmdb at the abstraction level.
- Open: when bounded contexts move under `internal/{app,domain,infra}`, the
  adapter relocates to `infra/aws/cmdbsync` or similar.
