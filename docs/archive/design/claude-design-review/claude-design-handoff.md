# Claude Design Handoff

Date: 2026-05-16
Product: Ops Platform
Audience: product designer, UX reviewer, frontend maintainer

## 1. What this product is

Ops Platform is an internal operations console for platform engineers and
operators. It is not a marketing site and should remain dense, task-oriented,
and fast to scan.

Primary users:

- Operator: finds assets, requests access, opens SSH/RDP sessions, monitors live
  work, and reviews past sessions when needed.
- Approver: reviews and decides access requests.
- Admin: manages IAM, AWS onboarding, OIDC, and connectivity configuration.

Primary jobs to be done:

1. Find a target asset quickly and open a session.
2. Understand and manage active sessions.
3. Review historical sessions and recordings for audit.
4. Request, approve, and inspect access.
5. Maintain inventory, connection profiles, cloud onboarding, and identity
   configuration.

## 2. Current frontend shape

The current frontend is a React/Vite single-page application mounted as the
primary `/portal/` experience.

Top-level navigation:

- Workspace: Overview, CMDB, Sessions, Access, Connectivity
- Platform: AWS, IAM, OIDC, Profile

Current UI language:

- dark sidebar plus light content surface;
- compact, high-density internal-tool layout;
- teal accent color;
- common patterns are toolbar + table + drawer/modal;
- light/dark theme tokens;
- tables are the default representation for large resource sets;
- modal dialogs are preferred for creation flows so the main page remains
  list-first;
- drawers are used for deep object inspection without leaving the list context.

Relevant code anchors:

- `web/src/app/router.tsx`
- `web/src/app/layout/AppShell.tsx`
- `web/src/styles/tokens.css`
- `web/src/styles/app.css`
- `web/src/features/sessions/SessionsPage.tsx`
- `web/src/features/cmdb/AssetsPage.tsx`
- `web/src/features/access/AccessPage.tsx`
- `web/src/features/iam/IamPage.tsx`

## 3. Current information architecture

### 3.1 Sessions

Sessions already moved toward a task-oriented workspace:

- Live mode uses a left asset rail and a right terminal/RDP workspace.
- The asset rail is grouped by environment and VPC and supports quick launch.
- Audit mode exposes filters, summary metrics, historical session rows, and
  recording inspection.
- Live and Audit currently remain two modes inside one top-level Sessions route.

Question for design review:

- Is the current Live/Audit mode split sufficient, or should these become more
  explicit product surfaces with stronger navigation separation?

### 3.2 CMDB

CMDB is table-first:

- toolbar search and facets;
- wide asset inventory table;
- inline SSH/RDP actions for connectable hosts;
- right-side detail drawer with Summary, Connection, Probe, Relations, and
  Metadata tabs.

Question for design review:

- Should fast asset discovery and quick connect stay embedded inside CMDB and
  Sessions, or should there be a more explicit "connect" experience that
  surfaces the tree/grouped view earlier?

### 3.3 IAM

IAM currently behaves like a user-role administration page:

- user search and selection;
- role bind/unbind;
- role permission table;
- effective IAM permissions collapsed into a secondary details area.

Question for design review:

- How should IAM evolve from "role binding" toward clearer operational
  permission governance: who can do what, why, and what that unlocks in the
  product?

## 4. Strengths worth preserving

- The shell is already calm and work-focused.
- The design is compact enough for operations work.
- Session live mode is moving in a useful direction with asset rail + workspace.
- CMDB preserves strong tabular affordances for inventory management.
- Access workflows are list-first and reasonably clear.
- Drawers keep users in context when inspecting assets.

## 5. Current design tensions

These are hypotheses to challenge, not predetermined conclusions.

1. The product may still be organized more by backend module than by operator
   workflow.
2. Sessions Live and Sessions Audit are visually separated, but still share one
   route and one conceptual bucket.
3. Quick connect exists, but the product does not yet make "find asset and
   connect" feel like the first-class path through the whole system.
4. IAM exposes users, roles, and permissions, but does not yet make permission
   consequences legible enough for operators and admins.
5. Several pages use dense tables well, but the overall product may need a
   clearer distinction between:
   - operational workspaces;
   - administrative resource management;
   - audit/review surfaces.

## 6. Design questions to answer

Please review the product against these questions:

1. What should the top-level information architecture be if optimized for the
   most frequent operator tasks rather than current backend modules?
2. Should Sessions Live and Sessions Audit remain modes of one feature, become
   sibling pages, or be restructured in another way?
3. Where should asset tree/group navigation live so quick connect becomes
   discoverable without weakening CMDB administration?
4. How should IAM communicate "who can do what" more clearly than a role table?
5. Which current UI patterns should remain unchanged because they are already
   appropriate for a dense internal tool?
6. Where is the current interface over-explaining, under-explaining, or forcing
   the wrong mental model?

## 7. Requested output from Claude Design

Please provide:

1. A UX/IA review with the five highest-impact issues ranked by severity.
2. Two or three alternative top-level information architectures.
3. A recommended direction with tradeoffs.
4. Focused redesign proposals for:
   - Sessions
   - Asset discovery / quick connect
   - IAM
5. Wireframes or polished screen concepts for the recommended direction.
6. One end-to-end flow for:
   - find asset -> request access if needed -> open SSH/RDP
   - inspect active session -> review historical session -> inspect recording
7. A list of things that should not change.

## 8. Constraints

- This is an authenticated internal operations console, not a public website.
- Preserve high information density.
- Do not optimize for visual novelty at the cost of speed or scanability.
- Tables remain necessary for inventory and audit workloads.
- Permission and audit concepts must stay visible.
- The frontend cannot assume a backend domain redesign as part of the first
  iteration.
- Legacy parity matters, but the replacement may use a different layout if it
  makes the same task faster and clearer.

## 9. Screenshot set

Use the attached screenshots as the source of truth for the current UI.
These screenshots are **local-only review materials** and may contain internal
asset names, IP addresses, or account identifiers. Do not commit them to source
control or upload them to a public repository.

| File | What it shows | What to inspect |
| --- | --- | --- |
| `assets/01-overview.png` | Shell and overview page | Overall chrome, density, current visual language |
| `assets/02-sessions-live.png` | Sessions Live workspace | Asset rail, terminal workspace, quick-launch model |
| `assets/03-sessions-audit.png` | Sessions Audit mode | Whether audit deserves stronger separation |
| `assets/04-cmdb-table.png` | CMDB inventory table | Table-first inventory management |
| `assets/05-cmdb-drawer.png` | Asset detail drawer | Drill-down pattern and information density |
| `assets/06-access.png` | Bastion access workflows | Request/approval model and page hierarchy |
| `assets/07-iam.png` | IAM page | Current emphasis on role binding vs governance |

## 10. Suggested first prompt

```text
I am redesigning Ops Platform, an internal operations console for platform
engineers and operators. Please first review the information architecture and
task flows before making the UI prettier.

Primary users:
- Operator: finds assets, requests access, opens SSH/RDP sessions, monitors live
  work, and reviews past sessions.
- Approver: reviews and decides access requests.
- Admin: manages IAM, AWS onboarding, OIDC, and connectivity configuration.

Primary jobs:
1. Find a target asset quickly and open a session.
2. Understand and manage active sessions.
3. Review historical sessions and recordings for audit.
4. Request and approve access.
5. Maintain inventory, connection profiles, and identity configuration.

Current navigation:
Overview / CMDB / Sessions / Access / Connectivity / AWS / IAM / OIDC / Profile

Current UI language:
Dense internal-tool layout, dark sidebar, light content surface, teal accent,
toolbar + table + drawer/modal patterns, light/dark themes.

Please use the attached screenshots and handoff notes to:
1. identify the five highest-impact UX/IA problems;
2. propose 2-3 different information architecture directions;
3. recommend one direction with tradeoffs;
4. redesign Sessions, asset discovery / quick connect, and IAM;
5. produce wireframes or polished concepts plus the two requested end-to-end
   flows;
6. explicitly call out what should stay unchanged.
```

## 11. Repository files worth attaching if code context is supported

Attach these only if Claude Design can use code context directly:

- `docs/archive/design/frontend-refactor-v2.md`
- `web/src/app/router.tsx`
- `web/src/app/layout/AppShell.tsx`
- `web/src/styles/tokens.css`
- `web/src/styles/app.css`
- `web/src/features/sessions/SessionsPage.tsx`
- `web/src/features/cmdb/AssetsPage.tsx`
- `web/src/features/access/AccessPage.tsx`
- `web/src/features/iam/IamPage.tsx`

These files are enough to explain the product structure without forcing the
designer to read the entire repository.
