# ADR-0006: Bastion proxy is fail-closed

Status: Accepted (2026-04-28, post-Phase 4 review)

## Context

A connection profile carries `proxy_id` when the asset must be reached via a
bastion. The original code in `cmdb.Repository.ListBastionProbeTargets` (and
`GetBastionProbeTarget`) silently swallowed errors from `GetSSHProxyTarget`
and only populated `target.Proxy` on success. Downstream dial code treated
`target.Proxy == nil` as "direct connection". Net effect: deleted proxy row,
decryption failure, or transient lookup error caused the worker to bypass the
bastion and dial the asset directly — exactly the path security relied on the
proxy to prevent.

## Decision

Two-layer fail-closed:

1. **Repository propagates errors.** `ListBastionProbeTargets` and
   `GetBastionProbeTarget` now wrap and return any `GetSSHProxyTarget` error
   (`resolve proxy %s for asset %s: %w`) instead of swallowing it. A broken
   proxy fails the probe — it does not silently downgrade.

2. **Probe target carries explicit intent.** `BastionProbeTarget` gained
   `ProxyRequired bool`, set whenever `proxy_id` was non-null in the source
   row. Every dial path (`dialSSH`, `dialPostgres`, `ResolveAssetRDP`) checks
   `target.ProxyRequired && target.Proxy == nil` *before any I/O* and returns
   `asset %s requires bastion proxy but none is resolved`.

Layer 2 is defense-in-depth: even if a future code path constructs a target
manually, the dial layer still refuses to bypass the bastion.

Regression tests in `internal/bastionprobe/service_test.go` cover all three
dial paths.

## Consequences

- A broken proxy now causes a probe failure (visible) instead of an unwanted
  direct connection (silent).
- The `ProxyRequired` flag adds 1 bool per target; small price for explicit
  intent at the security boundary.
- Test coverage now spans both layers:
  - `internal/bastionprobe/service_test.go` exercises the dial-layer guards
    in isolation.
  - `test/integration/proxy_test.go` (TestProxyDeletedFailsClosed) verifies
    the repo→handler→dial path end-to-end via the API.
  - `test/integration/proxy_lifecycle_test.go` stands up an in-process SSH
    server, points a real cmdb-proxy entry at it, runs N probes, and asserts
    the server's active-session counter returns to zero — proving the
    `dialPostgres` cleanup actually closes the proxy SSH client.
