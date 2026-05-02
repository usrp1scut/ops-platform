#!/usr/bin/env bash
# scripts/check-deps.sh
#
# Static dependency-rule checks for the ops-platform refactor (see
# docs/design/architecture-refactor-v1.md §5).
#
# Each rule is one of:
#   STRICT   — violation = exit 1 (gates merges)
#   DEBT     — known violation, prints with line numbers, does NOT fail
#              (used while a Phase is being worked off)
#
# As Phases land, flip rules from DEBT to STRICT.

set -uo pipefail

cd "$(dirname "$0")/.."

RC=0
have_violations=0

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
bold()   { printf '\033[1m%s\033[0m\n' "$*"; }

# rule kind=STRICT|DEBT, name, finder command (prints matches)
check() {
  local kind="$1" name="$2"; shift 2
  local out
  out="$("$@" 2>/dev/null || true)"
  if [[ -z "$out" ]]; then
    green "  [PASS] $name"
    return 0
  fi
  if [[ "$kind" == STRICT ]]; then
    red "  [FAIL] $name"
    echo "$out" | sed 's/^/         /'
    RC=1
  else
    yellow "  [DEBT] $name"
    echo "$out" | sed 's/^/         /'
  fi
  have_violations=1
}

bold "== ops-platform dependency rules =="

# --- STRICT rules (already clean as of Phase 0) ---

bold "[STRICT] no duplicate writeJSON / writeError definitions outside platform/httpx"
check STRICT "writeJSON / writeError defined only in platform/httpx" \
  bash -c 'grep -rn --include="*.go" -E "^func (writeJSON|writeError|WriteJSON|WriteError)\(" internal/ \
    | grep -v "internal/platform/httpx/"'

bold "[STRICT] httpserver/response.go orphan removed"
check STRICT "no internal/httpserver/response.go" \
  bash -c '[[ -f internal/httpserver/response.go ]] && echo "internal/httpserver/response.go still exists; should be replaced by internal/platform/httpx" || true'

bold "[STRICT] Phase 1: ticket lifecycles must live in internal/connectivity"
check STRICT "terminal/guacproxy must not declare their own ticket maps" \
  bash -c 'grep -rn --include="*.go" -E "tickets +map\[" internal/terminal/ internal/guacproxy/'

bold "[STRICT] Phase 2: repository must not contain cross-aggregate orchestration"
check STRICT "Promote/Demote/Reapply must live on a service, not Repository" \
  bash -c 'grep -rn --include="*.go" -E "func \(r \*Repository\) (Promote|Demote|Reapply)" internal/cmdb/'

bold "[STRICT] Phase 3: awssync must not import cmdb directly"
check STRICT "awssync must depend only on its own ports" \
  bash -c 'grep -rn --include="*.go" "\"ops-platform/internal/cmdb\"" internal/awssync/'

bold "[STRICT] Phase 3: awssync must not run raw SQL against cmdb_ tables"
check STRICT "awssync must write cmdb_* tables only via the AssetWriter port" \
  bash -c 'grep -rn --include="*.go" -E "(INSERT INTO|UPDATE) cmdb_" internal/awssync/'

bold "[STRICT] Phase 6: SSH proxy CRUD lives in internal/sshproxy"
check STRICT "cmdb.Repository must not host SSH proxy CRUD methods" \
  bash -c 'grep -rn --include="*.go" -E "func \(r \*Repository\) (Create|Update|Delete|Get|List)SSHProxy" internal/cmdb/'

bold "[STRICT] Phase 4: portal app.js must not regrow into a monolith"
# Cap raised across redesign phases as structural code (modal infra, filter
# chips, drawer tabs, sessions workspace, platform admin modal + sync
# diagnosis) genuinely belongs in app.js until the eventual `assets/` /
# `platform/` module split called out in Redesign §10.1. Current cap 4500;
# Phase 5 should accompany this with at least one module extraction so the
# cap can drop again.
check STRICT "internal/httpserver/ui/portal/app.js must stay under 4500 lines (extract feature modules under ui/portal/modules/)" \
  bash -c 'lines=$(wc -l < internal/httpserver/ui/portal/app.js); if [[ "$lines" -gt 4500 ]]; then echo "app.js is $lines lines (cap 4500)"; fi'

# --- Summary ---

echo
if [[ $RC -ne 0 ]]; then
  red "FAILED — strict rules violated"
elif [[ $have_violations -ne 0 ]]; then
  yellow "OK — strict rules pass, debt items still present"
else
  green "OK — clean"
fi
exit $RC
