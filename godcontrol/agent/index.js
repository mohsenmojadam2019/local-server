'use strict';

const os = require('os');
const { WebSocket } = require('ws');
const { Policy } = require('./policy');
const { LocalMcpClient } = require('./local-mcp');
const { SafeProcessManager } = require('./process-manager');
const { getBearerToken } = require('./oauth');
const { LOCAL_MAPPING } = require('../shared/tools');

const HUB = process.env.GODCONTROL_HUB_WS || 'ws://127.0.0.1:8790/agent';
const DEVICE_TOKEN = process.env.GODCONTROL_DEVICE_TOKEN;
const LOCAL_URL = process.env.GODCONTROL_LOCAL_MCP || 'http://127.0.0.1:8787/mcp';
const LOCAL_TOKEN = process.env.GODCONTROL_LOCAL_TOKEN;
const DEVICE_ID = process.env.GODCONTROL_DEVICE_ID || os.hostname().replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 128);
const DEVICE_NAME = (process.env.GODCONTROL_DEVICE_NAME || os.hostname()).slice(0, 120);

const policy = new Policy();
const local = new LocalMcpClient({ url: LOCAL_URL, token: LOCAL_TOKEN });
const processEnvAllowlist = String(process.env.GODCONTROL_PROCESS_ENV_ALLOWLIST || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const processes = new SafeProcessManager({
  maxOutputBytes: policy.maxOutputBytes,
  timeoutMs: Number(process.env.GODCONTROL_PROCESS_TIMEOUT_MS || 120000),
  envAllowlist: processEnvAllowlist.length ? processEnvAllowlist : undefined,
});
const completed = new Map();
let backoff = 1000;

async function sanitizeArgs(tool, args, currentPolicy = policy) {
  const safe = { ...(args || {}) };
  const writeTools = new Set(['file_write', 'file_edit', 'file_remove']);

  if (['list_directory', 'get_file_info', 'fs_read'].includes(tool)) {
    safe.path = await currentPolicy.assertPath(safe.path, false);
  }
  if (tool === 'search') {
    safe.root = await currentPolicy.assertPath(safe.root, false);
  }
  if (['git_status', 'git_diff'].includes(tool)) {
    safe.repoPath = await currentPolicy.assertPath(safe.repoPath, false);
  }
  if (writeTools.has(tool)) {
    safe.path = await currentPolicy.assertPath(safe.path, true);
  }
  if (tool === 'process_start') {
    currentPolicy.assertProgram(safe.program);
    if (safe.cwd) safe.cwd = await currentPolicy.assertPath(safe.cwd, false);
  }
  if (tool === 'fs_read' && safe.maxBytes && safe.maxBytes > currentPolicy.maxFileBytes) {
    throw new Error('maxBytes exceeds device policy');
  }
  if (tool === 'process_read' && safe.length && safe.length > currentPolicy.maxOutputBytes) {
    throw new Error('length exceeds device policy');
  }
  return safe;
}

function mapCall(tool, args) {
  if (tool === 'file_write') {
    return { localTool: 'fs_write', args: { path: args.path, content: args.content, mode: 'rewrite' } };
  }
  if (tool === 'search') {
    const localTool = args.mode === 'files' ? 'search_files' : 'search_content';
    const mapped = { root: args.root, pattern: args.pattern, maxResults: args.maxResults };
    if (localTool === 'search_content' && args.fileGlob) mapped.fileGlob = args.fileGlob;
    return { localTool, args: mapped };
  }
  const mapping = LOCAL_MAPPING[tool];
  if (!mapping) throw new Error('Tool is not available on this agent');
  return { localTool: mapping.localTool, args: { ...args } };
}

async function execute(tool, args) {
  const safe = await sanitizeArgs(tool, args || {});
  if (tool === 'process_start') {
    return processes.start({ program: safe.program, args: safe.args || [], cwd: safe.cwd, policy });
  }
  if (tool === 'process_read') {
    return processes.read(safe);
  }
  const mapped = mapCall(tool, safe);
  return local.call(mapped.localTool, mapped.args);
}

function scheduleReconnect() {
  const delay = Math.min(backoff, 30000);
  backoff = Math.min(backoff * 2, 30000);
  setTimeout(() => { void connect(); }, delay).unref();
}

async function resolveAuthorization() {
  if (DEVICE_TOKEN) return { value: 'Device ' + DEVICE_TOKEN, oauth: false };
  const bearer = await getBearerToken();
  return { value: 'Bearer ' + bearer, oauth: true };
}

async function connect() {
  if (!LOCAL_TOKEN) throw new Error('GODCONTROL_LOCAL_TOKEN is required');

  let auth;
  try {
    auth = await resolveAuthorization();
  } catch (error) {
    console.error('GodControl agent authorization unavailable:', error.message);
    scheduleReconnect();
    return;
  }

  const hubUrl = new URL(HUB);
  if (auth.oauth) {
    hubUrl.searchParams.set('device_id', DEVICE_ID);
    hubUrl.searchParams.set('name', DEVICE_NAME);
  }
  const ws = new WebSocket(hubUrl.toString(), { headers: { Authorization: auth.value } });

  ws.on('open', () => {
    backoff = 1000;
    console.log('GodControl agent connected');
  });

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (msg.type !== 'call' || !msg.callId) return;

    ws.send(JSON.stringify({ type: 'ack', callId: msg.callId }));
    if (completed.has(msg.callId)) {
      ws.send(JSON.stringify(completed.get(msg.callId)));
      return;
    }

    let reply;
    try {
      const result = await execute(msg.tool, msg.args || {});
      reply = { type: 'result', callId: msg.callId, ok: true, result };
    } catch (error) {
      reply = { type: 'result', callId: msg.callId, ok: false, error: error.message };
    }
    completed.set(msg.callId, reply);
    if (completed.size > 500) completed.delete(completed.keys().next().value);
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(reply));
  });

  ws.on('close', scheduleReconnect);
  ws.on('error', () => { try { ws.close(); } catch {} });
}

if (require.main === module) void connect();

module.exports = { sanitizeArgs, mapCall, execute, connect, resolveAuthorization };
