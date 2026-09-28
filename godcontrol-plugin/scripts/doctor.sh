#!/usr/bin/env bash
set -euo pipefail
command -v node >/dev/null
node -e 'if (process.versions.node.split(".")[0] < 22) process.exit(1)'
test -f package-lock.json
if [[ "${NODE_ENV:-development}" == production && -z "${DATABASE_URL:-}" ]]; then echo "DATABASE_URL is required in production" >&2; exit 1; fi
echo "node=$(node --version)"
echo "config=check environment before starting"
