# ADR-0002: Unified connectivity ticket service

Status: Accepted (2026-04-26, Phase 1)

## Context

Both `terminal` (xterm/SSH WebSocket) and `guacproxy` (RDP/Guacamole) issued
short-lived tickets so the browser could open a `/ws/...` socket without a
bearer token in URL. Each kept its own `tickets map[string]Ticket`, mutex,
and GC loop, with subtly different TTL/eviction. Audit hooks were duplicated
on both sides.

## Decision

Extract a single `internal/connectivity.TicketService`:

- `IssueTicket(userID, userName, assetID) → (token, expiresAt, error)`
- `ConsumeTicket(token) → (Ticket, error)` (single-use)
- Background GC, default TTL 60 s, GC every 30 s.

Both `terminal.Handler` and `guacproxy.Handler` are constructed with a pointer
to the same `*TicketService`. `httpserver.Server` instantiates one and injects
it into both. The dependency check-deps.sh rule forbids `tickets +map[` in
either package — the only legal home for ticket lifecycle is the connectivity
package.

## Consequences

- TTL, eviction, audit are uniform across SSH and RDP.
- Future move to a Redis-backed store is a one-package change.
- Removed: per-handler ticket maps, per-handler GC goroutines.
- Defers (out of scope): per-user concurrency caps, ticket revocation API.
