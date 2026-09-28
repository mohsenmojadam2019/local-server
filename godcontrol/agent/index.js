'use strict';

const { WebSocket } = require('ws');
const { Policy } = require('./policy');
const { LocalMcpClient } = require('./local-mcp');
const { SafeProcessManager } = require('./process-manager');
const { LOCAL_MAPPING } = require('../shared/tools');

const HUB = process.env.GODCONTROL_HUB_WS || 'ws://127.0.0.1:8790/agent';
const DEVICE_TOKEN = process.env.GODCONTROL_DEVICE_TOKEN;
const LOCAL_URL = process.env.GODCONTROL_LOCAL_MCP || 'http://127.0.0.1:8787/mcp';
const LOCAL_TOKEN = process.env.GODCONTROL_LOCAL_TOKEN;

if (!DEVICE_TOKEN) throw new Error('GODCONTROL_DEVICE_TOKEN is required');
if (!LOCAL_TOKEN) throw new Error('GODCONTROL_LOCAL_TOKEN is required');

const policy = new Policy();
const local = new LocalMcpClient({ url: LOCAL_URL, token: LOCAL_TOKEN });
const processes = new SafeProcessManager({
  maxOutputBytes: policy.maxOutputBytes,
  timeoutMs: Number(process.env.GODCONTROL_PROCESS_TIMEOUT_MS || 120000),
});
const completed = new Map();
let backoff = 1000;

async function authorizeTool(tool, args) {
  const writeTools = new Set(['file_write', 'file_edit', 'file_remove']);
  if (['list_directory','get_file_info','fs_read'].includes(tool)) await policy.assertPath(args.path, false);
  if (tool === 'search') await policy.assertPath(args.root, false);
  if (['git_status','git_diff'].includes(tool)) await policy.assertPath(args.repoPath, false);
  if (writeTools.has(tool)) await policy.assertPath(args.path, true);
  if (tool === 'process_start') {
    policy.assertProgram(args.program);
    if (args.cwd) await policy.assertPath(args.cwd, false);
  }
  if (tool === 'fs_read' && args.maxBytes && args.maxBytes > policy.maxFileBytes) throw new Error('maxBytes exceeds device policy');
  if (tool === 'process_read' && args.length && args.length > policy.maxOutputBytes) throw new Error('length exceeds device policy');
}

function mapCall(tool, args) {
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
  await authorizeTool(tool, args || {});
  if (tool === 'process_start') {
    const cwd = args.cwd ? await policy.assertPath(args.cwd, false) : undefined;
    return processes.start({ program: args.program, args: args.args || [], cwd, policy });
  }
  if (tool === 'process_read') {
    return processes.read(args);
  }
  const mapped = mapCall(tool, args || {});
  return local.call(mapped.localTool, mapped.args);
}

function connect() {
  const ws = new WebSocket(HUB, { headers: { Authorization: 'Device ' + DEVICE_TOKEN } });

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

  const reconnect = () => {
    const delay = Math.min(backoff, 30000);
    backoff = Math.min(backoff * 2, 30000);
    setTimeout(connect, delay).unref();
  };
  ws.on('close', reconnect);
  ws.on('error', () => { try { ws.close(); } catch {} });
}

connect();
