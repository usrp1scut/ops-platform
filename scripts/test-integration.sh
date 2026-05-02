#!/usr/bin/env bash
# Run the integration test suite against a real Postgres.
#
# By default the harness uses a dedicated test database (ops_platform_test) on
# the local docker-compose Postgres so the dev `ops_platform` schema isn't
# polluted. The DB is created on first run.
#
# Override with:
#   OPS_TEST_DATABASE_URL='postgres://...'  # custom DSN
#   OPS_MASTER_KEY='32-char-key'
#
# Usage:
#   bash scripts/test-integration.sh           # quiet
#   bash scripts/test-integration.sh -v        # verbose (per-test logs)
#   bash scripts/test-integration.sh -run Foo  # filter

set -euo pipefail

cd "$(dirname "$0")/.."

: "${OPS_TEST_DATABASE_URL:=postgres://ops:ops@localhost:5432/ops_platform_test?sslmode=disable}"
: "${OPS_MASTER_KEY:=01234567890123456789012345678901}"

export OPS_TEST_DATABASE_URL OPS_MASTER_KEY

# Refuse to run if the dev Postgres isn't up — the harness skips, but we want
# a louder signal so CI doesn't false-pass on a missing dependency.
if ! command -v pg_isready >/dev/null 2>&1; then
  : # pg_isready optional; harness will Skip if it can't connect.
else
  pg_isready -d "$OPS_TEST_DATABASE_URL" >/dev/null 2>&1 || \
  pg_isready -h localhost -p 5432 -U ops >/dev/null 2>&1 || {
    echo "Postgres at ${OPS_TEST_DATABASE_URL} unreachable — start docker-compose first." >&2
    exit 1
  }
fi

exec go test -tags=integration -count=1 ./test/integration/... "$@"
