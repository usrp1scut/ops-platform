# Internal package dependency graph

Snapshot post-Phase 5 (2026-04-28). Regenerate with the script at the bottom.

## Layers (logical)

```
            ┌────────────────────────────────────────────────────┐
            │  cmd/ops-api · cmd/ops-worker · cmd/bastion-probe  │  composition roots
            └────────────────────────────────────────────────────┘
                              │ wires
                              ▼
            ┌────────────────────────────────────────────────────┐
            │              internal/httpserver                   │  delivery
            └────────────────────────────────────────────────────┘
                              │
   ┌──────────────────────────┼──────────────────────────────────┐
   ▼                          ▼                                  ▼
 cmdb · iam · aws       awssync · bastionprobe          terminal · guacproxy · sessions
 (asset / iam /          (sync / probe                  (connection delivery)
  account domains)        application)
                              │
                              ▼
                        connectivity                          ← shared connection-domain
                                                                (ticket service)
                              │
                              ▼
   hostkey · keypair · security · platform/httpx · store · config    ← infra / platform
```

## Direct internal-package imports

| from                       | imports                                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| cmd/ops-api                | config, httpserver, store                                                                                                                                          |
| cmd/ops-worker             | aws, awssync, cmdb, config, store                                                                                                                                  |
| cmd/bastion-probe          | bastionprobe, cmdb, config, hostkey, keypair, store                                                                                                                |
| internal/httpserver        | aws, awssync, bastionprobe, cmdb, config, connectivity, guacproxy, hostkey, iam, keypair, platform/httpx, sessions, terminal                                       |
| internal/cmdb              | awssync, platform/httpx, security, sshproxy                                                                                                                        |
| internal/sshproxy          | platform/httpx, security                                                                                                                                           |
| internal/bastion           | iam, platform/httpx                                                                                                                                                |
| internal/awssync           | aws, config                                                                                                                                                        |
| internal/aws               | platform/httpx, security                                                                                                                                           |
| internal/bastionprobe      | cmdb, config, hostkey, sshproxy                                                                                                                                    |
| internal/terminal          | connectivity, iam, platform/httpx, sessions                                                                                                                        |
| internal/guacproxy         | bastionprobe, connectivity, iam, platform/httpx, sessions                                                                                                          |
| internal/iam               | config, platform/httpx, security                                                                                                                                   |
| internal/hostkey           | iam, platform/httpx                                                                                                                                                |
| internal/keypair           | iam, platform/httpx, security                                                                                                                                      |
| internal/sessions          | platform/httpx                                                                                                                                                     |
| internal/connectivity      | (none)                                                                                                                                                             |

`internal/{platform/httpx, security, store, config}` are the leaves — nothing
in `internal/*` should depend on anything outside them and other internals.

## Edges enforced by `scripts/check-deps.sh` (STRICT)

1. `writeJSON / writeError` defined only under `internal/platform/httpx`.
2. `internal/httpserver/response.go` is gone (removed in Phase 0).
3. `internal/{terminal,guacproxy}` may not declare `tickets +map[...]` — ticket
   lifecycle lives only in `internal/connectivity`.
4. `*cmdb.Repository` has no `Promote|Demote|Reapply` methods — those live on
   `*cmdb.VPCProxyService`.
5. `internal/awssync` may not import `ops-platform/internal/cmdb`.
6. `internal/awssync` may not run raw `INSERT|UPDATE cmdb_*` SQL.
7. `internal/httpserver/ui/portal/app.js` ≤ 3800 lines.
8. `cmdb.Repository` may not define `(Create|Update|Delete|Get|List)SSHProxy`
   methods — SSH proxy CRUD lives only in `internal/sshproxy`.

## Notable edges that look "wrong" but are intentional

- **`internal/cmdb` → `internal/awssync`**. cmdb implements the
  `awssync.AssetWriter` port (see ADR-0004). The dependency direction in the
  abstraction is awssync ← cmdb (cmdb depends *on the port owned by* awssync).
  When cmdb is later split into asset-domain and aws-adapter packages, this
  edge will move to the adapter package only.

- **`internal/bastionprobe` → `internal/cmdb`**. probe loads probe-targets via
  `cmdb.Repository.ListBastionProbeTargets`. This will become a port-based
  edge once the application-service split lands.

## How to regenerate

```bash
for pkg in $(go list ./internal/... ./cmd/...); do
  short=${pkg#ops-platform/}
  imports=$(go list -f '{{range .Imports}}{{.}}{{"\n"}}{{end}}' "$pkg" \
              | grep '^ops-platform/' | sort -u | sed 's|ops-platform/||')
  [[ -n "$imports" ]] && { echo "$short:"; echo "$imports" | sed 's/^/  /'; }
done
```
