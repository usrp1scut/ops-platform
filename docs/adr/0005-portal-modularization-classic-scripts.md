# ADR-0005: Portal modularization via classic `<script>` files

Status: Accepted (2026-04-27, Phase 4)

## Context

`internal/httpserver/ui/portal/app.js` had grown to 4 286 lines wrapped in a
single IIFE. Every new feature touched the same file, every edit risked
collisions and regressions in unrelated areas. The team is small and has not
adopted a JS build toolchain; introducing one now would be premature.

## Decision

Stay no-build. Modularize using **classic** `<script>` tags rather than ES
modules:

- Drop the IIFE around `app.js`. Classic scripts share the same Script Record
  in the browser, so `const`/`let` declarations in one file are visible to
  every later file *and* to functions defined in earlier files (which
  resolve identifiers at call time, not definition time).
- Extract leaf modules to `internal/httpserver/ui/portal/modules/*.js`. They
  define functions only; they do not run any top-level code that depends on
  shared state.
- Load order in `index.html`: vendor scripts → `modules/*.js` → `app.js`. By
  the time `app.js` calls `bootstrap()`, every binding from every script is
  in scope.
- A STRICT check-deps.sh rule caps `app.js` at 3 800 lines. New feature work
  must extract to a module rather than grow the monolith.

ES modules were considered and rejected: they would force `import/export`
edits across every cross-reference, gain little since we still ship a single
HTML page, and we cannot guarantee browser-side `type="module"` resolution
for paths embedded via `//go:embed`.

## Consequences

- New frontend features land in dedicated files.
- The LOC cap is the forcing function; reviewers can rely on CI for it.
- Removed: 520 lines of `app.js` (Theme, Host keys, SSH keypairs, Bastions
  views are now their own modules).
- Open: keep peeling off AWS/IAM/OIDC/asset-drawer modules as they're touched.
