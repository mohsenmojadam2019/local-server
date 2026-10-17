$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$tokenPath = Join-Path $env:USERPROFILE '.config\godcontrol\local-token'
$token = (Get-Content -LiteralPath $tokenPath -Raw).Trim()
$env:GODCONTROL_LOCAL_TOKEN = $token
$env:GODCONTROL_READ_ROOTS = $root
$env:GODCONTROL_WRITE_ROOTS = $root
$env:GODCONTROL_ALLOWED_PROGRAMS = 'node,npm,git,pwsh'
$env:GODCONTROL_LOCAL_MCP = 'http://127.0.0.1:8787/mcp'
$env:GODCONTROL_HUB_WS = 'wss://mcp.redcoweb.ir/agent/connect'
$env:GODCONTROL_DEVICE_ID = 'matin'
$env:GODCONTROL_DEVICE_NAME = 'matin'
$node = (Get-Command node -ErrorAction Stop).Source
Start-Process -FilePath $node -ArgumentList 'local-mcp/server.js' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
Start-Process -FilePath $node -ArgumentList 'agent/index.js' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
