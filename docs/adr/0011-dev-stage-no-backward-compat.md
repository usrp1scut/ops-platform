# ADR: Development stage — no backward-compatibility shims

Status: Accepted

## Context

The project is still pre-release: there are no external consumers, no
published API contract, and no deployed installs that must survive an
upgrade unattended. Despite that, normal engineering instinct keeps
adding compatibility machinery — soft migration windows, dual-read
fallbacks, deprecation aliases, version shims, "keep the old field too"
branches. That machinery is pure carrying cost here: it is logic written
for a constraint (existing consumers / in-place upgrades) that does not
yet exist, and it obscures the real shape of the code.

This was already exercised in phase 12: merging `bastion.session:ssh`
and `bastion.session:rdp` into `bastion.session:connect` was done as a
hard cut with no compatibility window (the data migration converts dev
data, but nothing dual-runs the old permission strings).

## Decision

While the project is in the development stage, do **not** introduce
backward-compatibility or migration-compatibility logic unless a task
explicitly requires it. Prefer hard cuts: change the code and schema
directly. Data migrations that convert existing dev data are still
expected; what is rejected is a dual-running compatibility period around
them.

## Reasons

- No external consumers or in-place-upgrade installs exist, so the
  scenario the compat logic protects cannot occur.
- Compat shims add branches, flags, and dead-ish paths that make the
  current behavior harder to read and reason about.
- Hard cuts keep the codebase honest about its real, single behavior —
  consistent with the project's preference for honest, non-misleading
  implementations.

## Alternatives

- **Always keep a compatibility window.** Rejected: it pays upgrade-
  safety cost with no upgrade-safety benefit at this stage.
- **Case-by-case, no written stance.** Rejected: without a recorded
  decision every hard cut gets re-litigated and reviewers cannot tell an
  intentional cut from an oversight.

## Consequences

- Easier: smaller diffs, fewer flags, the code states one behavior.
- Harder / watch: the moment the project gains external consumers, a
  public API contract, or unattended in-place upgrades, this ADR must be
  superseded and a real compatibility policy adopted. Until then,
  reviewers should treat an unprompted compat shim as the thing to
  question, not the hard cut.
- Data migrations remain mandatory for converting existing dev data;
  "hard cut" is about behavior compatibility, not skipping migrations.

## Follow-up

Revisit (supersede with a new ADR) when any of these is true: a release
is cut, an external/third-party consumer integrates against the API, or
deployments must upgrade in place without a data reset.
