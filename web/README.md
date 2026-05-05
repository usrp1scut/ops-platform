# web/

React/TypeScript/Vite frontend for the ops-platform. The build output is
embedded into the Go API binary and served at `/portal-v2/` alongside the
legacy classic-script portal at `/portal/`.

The split lets us migrate one feature at a time without breaking operators
who depend on the old console.

## Stack

- React 19 + TypeScript (strict)
- Vite 7
- React Router 7
- TanStack Query 5
- React Hook Form + Zod
- lucide-react (icons)
- Vitest 4 (unit tests)

## Local development

The dev server runs on Vite (port 5173 by default) and proxies API/auth/ws
requests to the Go backend on `:8080`.

```bash
# Terminal 1 — backend (from repo root)
docker compose up -d postgres redis guacd minio
go run ./cmd/migrate
go run ./cmd/ops-api          # listens on :8080

# Terminal 2 — frontend
cd web
npm install                   # first time only
npm run dev                   # http://localhost:5173
```

Sign in with the same credentials as the legacy portal (default
`admin / admin123456`). Tokens are stored under the same `localStorage`
key (`ops_platform_access_token`), so switching between 5173 and
`http://localhost:8080/portal/` does not require re-login.

The dev proxy forwards these prefixes to `:8080`:

| Prefix      | Target                          |
| ----------- | ------------------------------- |
| `/api/*`    | http://localhost:8080           |
| `/auth/*`   | http://localhost:8080           |
| `/healthz`  | http://localhost:8080           |
| `/ws/*`     | ws://localhost:8080 (WebSocket) |

If 5173 is occupied, pick another port:

```bash
npm run dev -- --port 5180
```

## Scripts

| Command           | What it does                                                |
| ----------------- | ----------------------------------------------------------- |
| `npm run dev`     | Vite dev server with HMR                                    |
| `npm run build`   | `tsc --noEmit && vite build` → `dist/`                      |
| `npm run typecheck` | strict `tsc --noEmit`                                     |
| `npm test`        | Vitest single run (used by CI)                              |
| `npm run preview` | Serve the production `dist/` locally for smoke checks       |

## Building for the embedded `/portal-v2/` mount

The Go binary embeds `internal/httpserver/ui/v2/static/`. The build pipeline
overlays a fresh `web/dist/` over that directory. Vite must be told to build
with the right base path so its asset URLs match the mount point:

```bash
cd web
MSYS_NO_PATHCONV=1 VITE_BASE=/portal-v2/ npm run build
cp -R dist/. ../internal/httpserver/ui/v2/static/
cd ..
go build ./cmd/ops-api
```

`MSYS_NO_PATHCONV=1` is required on Git Bash / MSYS — without it, the shell
rewrites `/portal/` to a Windows path and `dist/index.html` ends up
referencing `/Program Files/Git/portal/assets/...` instead of the intended
`/portal-v2/assets/...`. Other shells (zsh, bash on Linux/macOS, PowerShell)
do not need the prefix.

The Docker build does this automatically in the `web-builder` stage — see
the repo-root `Dockerfile`.

## Project layout

```
web/
  src/
    api/          REST + WebSocket clients (one file per backend domain)
    app/          Router, providers, layout shell, route guard
    features/     Page-level components grouped by domain
      auth/       Login + AuthProvider context
      cmdb/       Asset list, drawer, AssetForm
      sessions/   Live SSH/RDP launch + session audit
      connectivity/ SSH proxy, host keys, keypairs
      ...
    components/   Cross-feature UI primitives (PanelState, PermissionList)
    lib/          Pure helpers (form ↔ payload, validation, basename)
    types/        Shared TypeScript types
    styles/       app.css (single global stylesheet for now)
  public/vendor/  Self-contained xterm/guacamole assets
  index.html      Vite entry
```

`lib/` is intentionally framework-free so it can be unit-tested without a
DOM. Every feature has a paired `*.test.ts` next to its `lib/` file (e.g.
`assets.ts` ↔ `assets.test.ts`).

## Permissions

The frontend treats permissions as UX hints — the backend remains the only
trusted authorization boundary. `useAuth().can(permission)` returns `true`
when the user has `system:admin` or the explicit permission. The supported
names live in `src/lib/permissions.ts`.

Guarded actions follow the pattern:

```tsx
{canWriteAssets ? (
  <button onClick={...}>Edit</button>
) : (
  <PanelState kind="permission" message="cmdb.asset:write required" />
)}
```

## Running smoke tests

```bash
npm test                          # all tests
npm test -- --run src/lib         # only lib helpers
npm test -- --run src/api/cmdb    # only cmdb api client
```

Vitest mocks `fetch` per case and asserts the URL/method/body the API
helpers produce. Pure helpers in `lib/` are tested in isolation.

## Migration status

The migration plan and per-phase deliverables live in
`docs/design/frontend-refactor-v2.md`. The current state:

- Phase 0–5 ✅ — all features parity-complete with legacy portal.
- Phase 6 ⏳ — `/portal-v2/` is mounted alongside `/portal/`; cutover (the
  swap) is the next planned change.
