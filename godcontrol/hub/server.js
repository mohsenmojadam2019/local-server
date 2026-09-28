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

function page(title, body) {
  return '<!doctype html><meta charset="utf-8"><title>' + title + '</title><style>body{font:16px system-ui;max-width:760px;margin:60px auto;padding:0 20px;line-height:1.7;color:#172033}code{background:#eef2f7;padding:2px 5px;border-radius:5px}</style><h1>' + title + '</h1>' + body;
}

app.get('/', (_req, res) => res.type('html').send(page('GodControl', '<p>Secure remote control bridge for devices you explicitly enroll.</p><p><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/support">Support</a></p>')));
app.get('/privacy', (_req, res) => res.type('html').send(page('GodControl Privacy', '<p>GodControl routes tool requests to devices you enroll. Access tokens and device secrets are not returned in tool responses. Audit logs store operational metadata, not raw credentials.</p>')));
app.get('/terms', (_req, res) => res.type('html').send(page('GodControl Terms', '<p>You may connect only devices and accounts you are authorized to control. Device policy limits file paths and executable commands.</p>')));
app.get('/support', (_req, res) => res.type('html').send(page('GodControl Support', '<p>For support, use the project issue tracker or the publisher contact listed in the plugin directory.</p>')));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'godcontrol-hub', version: '0.1.0' }));

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
  if (url.pathname !== '/agent') return socket.destroy();
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
