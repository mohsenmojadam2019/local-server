#!/usr/bin/env bash
set -euo pipefail
BASE="${1:-http://127.0.0.1:8790}"

curl -fsS "$BASE/health" | grep -q '"ok":true'
STATUS="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/.well-known/openai-apps-challenge")"
case "$STATUS" in 200|404) ;; *) echo "challenge route failed: $STATUS"; exit 1;; esac
curl -fsS "$BASE/.well-known/oauth-protected-resource" >/dev/null
curl -fsS -X POST "$BASE/mcp" -H 'content-type: application/json' -H 'accept: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}' | grep -q '"GodControl"'
curl -fsS -X POST "$BASE/mcp" -H 'content-type: application/json' -H 'accept: application/json' --data '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | grep -q '"file_remove"'

echo "GodControl smoke test: PASS"
