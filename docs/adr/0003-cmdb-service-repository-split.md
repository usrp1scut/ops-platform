# ADR-0003: CMDB service / repository split

Status: Accepted (2026-04-26, Phase 2)

## Context

`*cmdb.Repository` had grown methods like `PromoteVPCProxy`, `DemoteVPCProxy`,
`ReapplyProxyPropagation`. These weren't persistence — they orchestrated
across asset, connection, ssh_proxy, and asset_relation tables, with their own
transaction boundaries. The repository had become an application-service in
disguise.

## Decision

Introduce `internal/cmdb.VPCProxyService`:

- Owns `Promote`, `Demote`, `ReapplyPropagation`.
- Owns `*sql.Tx` boundaries.
- Calls free functions in `vpcproxy.go` (`upsertProxyForAsset`,
  `ensureProxyAssetConnection`, `propagateProxyToVPCPeers`) that operate on
  `*sql.Tx` and only touch persistence.

`*cmdb.Repository` is now restricted to single-aggregate CRUD. The
check-deps.sh rule rejects any `func (r *Repository) (Promote|Demote|Reapply)`.

The asset CRUD service split (`AssetService`) was deferred — the current
handler→repository call shape is workable, and a service-layer for it would
add ceremony without yet paying off. Open follow-up.

## Consequences

- Repository contract is honest: it returns/persists rows, nothing else.
- Cross-table consistency lives in one place per use case.
- `awssync` can depend on a thin port (`VPCProxyReapplier`) instead of the
  whole repository. See ADR-0004.
- Open: full asset/connectivity application-service refactor.
