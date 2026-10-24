#!/usr/bin/env bash
# One-time installer on the owner's Linux workstation god. Never run on the VPS.
set -euo pipefail
if [[ "${1:-}" == '--disable' ]]; then
  systemctl --user disable --now godcontrol-autoconnect.service 2>/dev/null || true
  node -e 'const fs=require("fs");const p=process.argv[1]; if (fs.existsSync(p)) { const c=JSON.parse(fs.readFileSync(p));c.enabled=false;fs.writeFileSync(p,JSON.stringify(c,null,2)+"\n",{mode:0o600}); }' \
    "${XDG_CONFIG_HOME:-$HOME/.config}/godcontrol/auto-connect.json"
  echo 'GodControl auto-connect disabled.'
  exit 0
fi
if [[ "$(hostname -s)" != 'god' ]]; then
  echo "Refusing to install god workstation service on host $(hostname -s)" >&2
  exit 2
fi
BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/godcontrol"
mkdir -p "$CONFIG_DIR" "$HOME/.config/systemd/user"
chmod 700 "$CONFIG_DIR"
export GODCONTROL_AUTOCONNECT_CONFIG_DIR="$CONFIG_DIR"
node - "$CONFIG_DIR" "$HOME" <<'NODE'
const fs=require('fs');
const path=require('path');
const dir=process.argv[2], home=process.argv[3];
const config={
  deviceId:'god-local', deviceName:'god',
  hubUrl:'wss://mcp.redcoweb.ir/agent/connect',
  localMcp:'http://127.0.0.1:8787/mcp',
  readRoots:[path.join(home,'local-server')], writeRoots:[path.join(home,'local-server')],
  allowedPrograms:['git','node','npm']
};
fs.writeFileSync(path.join(dir,'agent-settings.json'),JSON.stringify(config,null,2)+'\n',{mode:0o600});
fs.writeFileSync(path.join(dir,'auto-connect.json'),JSON.stringify({version:1,enabled:true,deviceId:'god-local',approvedAt:new Date().toISOString()},null,2)+'\n',{mode:0o600});
NODE
NODE_BIN="$(command -v node)"
cat > "$HOME/.config/systemd/user/godcontrol-autoconnect.service" <<UNIT
[Unit]
Description=GodControl owner-controlled, consent-gated persistent connection
After=network-online.target godcontrol-mcp.service godcontrol-ssh-tunnel.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$BASE
EnvironmentFile=-%h/godcontrol-mcp/.env
EnvironmentFile=-%h/.config/godcontrol/agent.env
ExecStart=$NODE_BIN $BASE/autoconnect/launcher.js
Restart=always
RestartSec=15
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
# If legacy agent is installed, replace it to prevent duplicate connections.
LEGACY_WAS_ENABLED=0
if systemctl --user is-enabled godcontrol-agent.service >/dev/null 2>&1; then
  LEGACY_WAS_ENABLED=1
  systemctl --user disable --now godcontrol-agent.service
fi
systemctl --user enable --now godcontrol-autoconnect.service
sleep 2
if ! systemctl --user is-active --quiet godcontrol-autoconnect.service; then
  echo 'Auto-connect did not start. Restoring the prior agent service if present.' >&2
  systemctl --user disable --now godcontrol-autoconnect.service || true
  if [[ "$LEGACY_WAS_ENABLED" == '1' ]]; then systemctl --user enable --now godcontrol-agent.service; fi
  exit 1
fi
if command -v loginctl >/dev/null; then
  loginctl enable-linger "$USER" 2>/dev/null || echo 'Enable user linger as administrator if needed.'
fi
echo "Autoconnect installed for god; switch: $CONFIG_DIR/auto-connect.json"
echo "Status: systemctl --user status godcontrol-autoconnect.service"
echo "Disable: bash $BASE/autoconnect/install-god.sh --disable"
echo 'OAuth/SSH tunnel and local MCP tokens must already be legitimately configured.'
