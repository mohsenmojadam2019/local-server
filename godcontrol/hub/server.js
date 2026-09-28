'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const { TOOLS, BY_NAME } = require('../shared/tools');
const { AuthError, authenticate, requireScopes, resourceMetadata, challenge } = require('./auth');
const { verifyDeviceToken } = require('./device-auth');
const { DeviceRegistry } = require('./device-registry');

const PORT = Number(process.env.PORT || 8790);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN || 'http://127.0.0.1:' + PORT).replace(/\/$/, '');
const auditFile = process.env.GODCONTROL_AUDIT_FILE;

function audit(event) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event });
  if (auditFile) {
    fs.mkdirSync(path.dirname(auditFile), { recursive: true });
    fs.appendFile(auditFile, line + '\n', { mode: 0o600 }, () => {});
  }
  if (process.env.GODCONTROL_AUDIT_STDOUT === 'true') console.log(line);
}

const registry = new DeviceRegistry({ timeoutMs: Number(process.env.GODCONTROL_CALL_TIMEOUT_MS || 30000), audit });
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use((error, _req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    });
  }
  return next(error);
});

function page(title, body) {
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>' + title + '</title><style>body{font:16px system-ui;max-width:820px;margin:56px auto;padding:0 20px;line-height:1.7;color:#172033;background:#f7f8fb}main{background:#fff;border:1px solid #e2e6ee;border-radius:18px;padding:30px;box-shadow:0 12px 34px #17203312}a{color:#172033}code{background:#eef2f7;padding:2px 5px;border-radius:5px}.nav{margin-top:28px}</style></head><body><main><h1>' + title + '</h1>' + body + '<p class="nav"><a href="/">Home</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/support">Support</a></p></main></body></html>';
}

app.get('/', (_req, res) => res.type('html').send(page('GodControl', '<p>GodControl securely connects ChatGPT and Codex to computers you explicitly enroll.</p><p>Local devices connect outbound to the GodControl hub. The local MCP endpoint remains private, while OAuth scopes and device policy control access to files, Git, system information, and approved processes.</p>')));
app.get('/privacy', (_req, res) => res.type('html').send(page('GodControl Privacy', '<p>GodControl processes account identifiers, enrolled-device identifiers, connection state, and tool-routing metadata needed to perform requested actions.</p><p>Tool inputs and outputs are processed only as needed to complete a request. OAuth access tokens, device credentials, and local MCP bearer tokens are not intentionally returned in tool responses or written to application audit logs.</p><p>Operational audit records contain timestamps, account and device identifiers, tool names, call identifiers, and success or failure status. Devices can be disconnected by revoking their enrollment credentials or stopping the agent.</p>')));
app.get('/terms', (_req, res) => res.type('html').send(page('GodControl Terms', '<p>Use GodControl only with devices, repositories, accounts, and services you are authorized to control.</p><p>Write, delete, and process-execution tools may change system state. Device policy limits paths and approved executables, but users remain responsible for requested changes, backups, and normal operating-system permissions.</p><p>Service availability is not guaranteed.</p>')));
app.get('/support', (_req, res) => res.type('html').send(page('GodControl Support', '<p>Project repository: <a href="https://github.com/mohsenmojadam2019/local-server">github.com/mohsenmojadam2019/local-server</a></p><p>When reporting a problem, include the GodControl version, hub health result, agent state, and sanitized logs. Do not include authentication tokens or device secrets.</p>')));
app.get('/assets/godcontrol-logo.svg', (_req, res) => {
  res.type('image/svg+xml').send('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#172033"/><path d="M256 92c-74 0-134 60-134 134v60c0 74 60 134 134 134s134-60 134-134v-60c0-74-60-134-134-134Zm0 52c45 0 82 37 82 82v60c0 45-37 82-82 82s-82-37-82-82v-60c0-45 37-82 82-82Z" fill="#fff"/><path d="M256 190a36 36 0 1 1 0 72 36 36 0 0 1 0-72Zm-20 82h40v82h-40z" fill="#fff"/></svg>');
});
app.get('/health', (_req, res) => res.json({ ok: true, service: 'godcontrol-hub', version: '0.1.0' }));
app.get('/robots.txt', (_req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /\n'));

app.get('/.well-known/openai-apps-challenge', (_req, res) => {
  const token = process.env.OPENAI_APPS_CHALLENGE;
  if (!token) return res.sendStatus(404);
  res.type('text/plain').send(token);
});

app.get('/.well-known/oauth-protected-resource', (_req, res) => res.json(resourceMetadata(PUBLIC_ORIGIN)));

const sessions = new Map();

function rpcResult(id, result) { return { jsonrpc: '2.0', id, result }; }
function rpcError(id, code, message, meta) {
  const error = { code, message };
  if (meta) error.data = { _meta: meta };
  return { jsonrpc: '2.0', id, error };
}

async function identityForTool(req, descriptor) {
  const identity = await authenticate(req);
  const scheme = descriptor.securitySchemes?.find((s) => s.type === 'oauth2');
  requireScopes(identity, scheme?.scopes || []);
  return identity;
}

function withoutDevice(args) {
  const out = { ...(args || {}) };
  delete out.deviceId;
  return out;
}

app.post('/mcp', async (req, res) => {
  const msg = req.body || {};
  const id = msg.id ?? null;
  try {
    if (msg.method === 'initialize') {
      const sessionId = crypto.randomUUID();
      sessions.set(sessionId, { createdAt: Date.now() });
      res.setHeader('mcp-session-id', sessionId);
      return res.json(rpcResult(id, {
        protocolVersion: '2025-03-26',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'GodControl', version: '0.1.0' },
        instructions: 'Use read-only tools to inspect the selected enrolled device before making changes. File writes, removals, and process starts are policy-bounded and may require host confirmation. Never request paths or executables outside the device policy.',
      }));
    }
    if (msg.method === 'notifications/initialized') return res.status(204).end();
    if (msg.method === 'tools/list') return res.json(rpcResult(id, { tools: TOOLS }));

    if (msg.method === 'tools/call') {
      const name = msg.params?.name;
      const args = msg.params?.arguments || {};
      const descriptor = BY_NAME.get(name);
      if (!descriptor) return res.status(404).json(rpcError(id, -32601, 'Unknown tool'));

      const identity = await identityForTool(req, descriptor);
      audit({ event: 'mcp_tool_call', userId: identity.sub, tool: name });

      let result;
      if (name === 'whoami') {
        result = { id: identity.sub };
        if (identity.claims?.name) result.name = String(identity.claims.name);
        if (identity.email) result.email = identity.email;
        if (identity.claims?.nickname) result.nickname = String(identity.claims.nickname);
      } else if (name === 'devices_list') {
        result = { devices: registry.list(identity.sub) };
      } else {
        const deviceId = args.deviceId;
        if (!deviceId) return res.status(400).json(rpcError(id, -32602, 'deviceId is required'));
        if (name === 'device_ping' && !registry.list(identity.sub).some((d) => d.deviceId === deviceId)) {
          result = { deviceId, online: false };
        } else {
          result = await registry.call({ userId: identity.sub, deviceId, tool: name, args: withoutDevice(args) });
        }
      }

      const structured = result && typeof result === 'object' && !Array.isArray(result)
        ? result
        : { result };
      return res.json(rpcResult(id, {
        content: [{ type: 'text', text: JSON.stringify(structured) }],
        structuredContent: structured,
        isError: false,
      }));
    }

    return res.status(404).json(rpcError(id, -32601, 'Method not found'));
  } catch (error) {
    if (error instanceof AuthError) {
      const auth = challenge(PUBLIC_ORIGIN, error.scopes || []);
      res.setHeader('WWW-Authenticate', auth);
      return res.status(401).json(rpcError(id, -32001, error.message, { 'mcp/www_authenticate': auth }));
    }
    console.error('MCP error:', error.message);
    return res.status(500).json(rpcError(id, -32603, 'Internal error'));
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, PUBLIC_ORIGIN);
  if (url.pathname !== '/agent' && url.pathname !== '/agent/connect') return socket.destroy();
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Device ')) return socket.destroy();
  let claims;
  try {
    claims = verifyDeviceToken(auth.slice(7), process.env.GODCONTROL_DEVICE_HMAC_SECRET);
  } catch {
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.godcontrol = claims;
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws) => {
  const claims = ws.godcontrol;
  registry.register({ userId: claims.userId, deviceId: claims.deviceId, name: claims.name, socket: ws });
  ws.on('message', (data) => registry.handleMessage(ws, data));
  ws.on('close', () => registry.unregister(ws));
  ws.on('error', () => registry.unregister(ws));
  ws.on('pong', () => { ws.isAlive = true; });
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { try { ws.terminate(); } catch {} continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, 30000);
heartbeat.unref();

if (require.main === module) {
  server.listen(PORT, HOST, () => console.log('GodControl hub listening on ' + HOST + ':' + PORT));
}

module.exports = { app, server, registry };
