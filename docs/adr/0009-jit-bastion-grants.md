# ADR-0009: JIT bastion access via grants and requests

Status: Accepted (2026-04-29)

## Context

Per the product design (`docs/design/ops-platform-v0.3.md` §6), connecting
to a managed asset is supposed to require either a direct admin grant or
an approved request — both time-bounded. None of that existed: every user
with `cmdb.asset:write` could open a terminal/RDP session indefinitely.
After session recording landed (ADR-0006 trail extended), the next gap on
the security story is *who is allowed to start a session in the first
place*.

## Decision

Introduce two tables and a small package:

- `bastion_grant` — time-bounded `(user, asset)` permissions with
  `expires_at`, optional `request_id` linkage, soft-revoke columns.
- `bastion_request` — workflow rows with `pending|approved|rejected|cancelled|expired`
  status. Approval mints a grant in the same transaction.
- `internal/bastion/` package — repository, service-style transitions
  (Approve/Revoke/Reject/Cancel), HTTP handler, and a
  `RequireActiveGrant` HTTP middleware.

Ticket-issue routes (`POST /cmdb/assets/{id}/{terminal,rdp}/ticket`) are now
gated on `(cmdb.asset:read AND active grant) OR system:admin`. Admins bypass
the grant check; the audit trail still records who connected.

Permission model:

- `bastion.grant:read|write` — admins and ops can see/issue/revoke
  grants. Approving a request requires `bastion.grant:write`.
- `bastion.request:read|write` — every built-in role (admin/ops/viewer)
  has both, so any authenticated user can submit a request and see their
  own.
- Self-approval is refused at the service layer, even for admins, so a
  grant always represents a second person's decision.

## Consequences

- New STRICT enforcement is in app code, not in `check-deps.sh` — the
  grant gate is a runtime check rather than an import-graph rule.
- Admins keep their current connect behavior (no friction). Non-admins
  must request access first; the 403 response includes
  `needs_grant=true` so the portal can open a Request-access modal.
- Schema is forward-compatible with future "approval chain" features
  (multiple approvers per request) — `decided_by_*` is single-valued
  today but the request_id linkage means a future "approval" subtable can
  attach without rewriting the grant.
- Open follow-ups deferred:
  - Email/Slack notification on new pending requests.
  - Connect-flow automatic Request-access modal popup on 403 (UI v1
    requires the user to navigate to the Grants page manually).
  - TTL job to mark expired requests `expired` — not strictly necessary
    since active-grant lookup uses `expires_at > now()` regardless.
  - Per-asset-group / per-tag grants — only per-asset for v1.
