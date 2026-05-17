#!/usr/bin/env bash
# scripts/check-deps.sh
#
# Static dependency-rule checks for the ops-platform refactor. Durable
# decisions live in docs/adr/; the current enforced graph lives in
# docs/architecture/dependency-graph.md.
# Each rule is one of:
#   STRICT   鈥?violation = exit 1 (gates merges)
#   DEBT     鈥?known violation, prints with line numbers, does NOT fail
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

bold "[STRICT] API binary must stay UI-free after the React/Vite split"
check STRICT "legacy embedded portal tree remains removed" \
  bash -c '[[ -d internal/httpserver/ui/portal ]] && echo "internal/httpserver/ui/portal should stay removed; frontend lives under web/" || true'

# --- Summary ---

echo
if [[ $RC -ne 0 ]]; then
  red "FAILED 鈥?strict rules violated"
elif [[ $have_violations -ne 0 ]]; then
  yellow "OK 鈥?strict rules pass, debt items still present"
else
  green "OK 鈥?clean"
fi
exit $RC
