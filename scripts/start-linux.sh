#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v node >/dev/null || { echo "Node.js 20+ is required"; exit 1; }
[ -d node_modules ] || npm install
exec npm start
