# ADR-0001: Layered packages and dependency rules

Status: Accepted (2026-04-26)

## Context

By early 2026 `internal/cmdb` had become a god-package: asset CRUD, connection
profile crypto, probe state, VPC proxy promotion, HTTP handlers, and AWS write
adapters all lived together. `awssync` reached into it directly. `terminal`
and `guacproxy` each shipped their own ticket store. There was no way to
mechanically tell whether a new commit re-introduced a banned edge.

## Decision

1. Adopt a one-way layering: **delivery → application → domain → infrastructure**.
2. Each bounded context (`asset`/cmdb, `connectivity`, `awssync`, `terminal`,
   `guacproxy`, `sessions`, `hostkey`, `keypair`, `iam`) owns its own package.
   Cross-context calls go through ports defined by the *consumer*.
3. Enforce the rules with `scripts/check-deps.sh` rather than relying on review
   discipline. STRICT rules gate the build; DEBT rules are visible-but-non-failing
   while a phase is being worked off, then flipped to STRICT when the phase lands.

The target physical layout (`internal/{app,domain,infra,delivery,platform}`)
described in the design doc is *aspirational*. We did not relocate every
package because the cost outweighed the benefit while moves were still in
flight; the dependency rules are what actually matter, and they are enforced
inside the current layout.

## Consequences

- New banned edges fail CI immediately (e.g. `awssync` importing `cmdb`).
- Reviewers can see dependency intent in `check-deps.sh` instead of reading
  through every PR.
- The cost of relocating files later is lowered because the import graph is
  already well-shaped.
- The deferred physical reshuffle is a known follow-up; documented under
  Phase 5 future work.
