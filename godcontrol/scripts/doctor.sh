#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node -v
npm run check
npm test
echo "GodControl doctor: PASS"
