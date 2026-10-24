'use strict';

/**
 * Auto-connect supervises the already-authorized GodControl agent.
 * The local consent file is an OFF switch, NOT an authentication credential.
 * The Hub still checks OAuth/device identity and the agent still enforces roots.
 */
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { configPaths, readJson, consentStatus, validateSettings } = require('./config');
const { defaultConfigPath } = require('../agent/oauth');

const paths = configPaths();
const settings = validateSettings(readJson(paths.settings));
const authPath = defaultConfigPath();
const consent = () => consentStatus(readJson(paths.consent), settings.deviceId);

function readDpapiSecret() {
  if (process.platform !== 'win32' || !fs.existsSync(paths.dpapiSecret)) return '';
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'read-secret.ps1'), '-Path', paths.dpapiSecret,
  ], { encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 65536 });
  if (result.status !== 0 || result.error) throw new Error('Could not decrypt current-user local MCP secret');
  return (result.stdout || '').trim();
}

function childEnvironment() {
  const env = { ...process.env };
  // Explicit operator-provided systemd environments (e.g. trusted SSH tunnel)
  // take precedence over non-secret per-user settings.
  env.GODCONTROL_DEVICE_ID = settings.deviceId;
  env.GODCONTROL_DEVICE_NAME = env.GODCONTROL_DEVICE_NAME || settings.deviceName || settings.deviceId;
  env.GODCONTROL_HUB_WS = env.GODCONTROL_HUB_WS || settings.hubUrl || 'wss://mcp.redcoweb.ir/agent/connect';
  env.GODCONTROL_LOCAL_MCP = env.GODCONTROL_LOCAL_MCP || settings.localMcp || 'http://127.0.0.1:18787/mcp';
  if (process.platform === 'win32') env.GODCONTROL_LOCAL_PORT = new URL(env.GODCONTROL_LOCAL_MCP).port || '18787';
  env.GODCONTROL_READ_ROOTS = settings.readRoots.join(',');
  env.GODCONTROL_WRITE_ROOTS = settings.writeRoots.join(',');
  env.GODCONTROL_ALLOWED_PROGRAMS = settings.allowedPrograms.join(',');
  if (!env.GODCONTROL_LOCAL_TOKEN && !env.GODCONTROL_TOKEN) {
    env.GODCONTROL_LOCAL_TOKEN = readDpapiSecret();
  }
  return env;
}

let localMcpChild = null;
let checkingLocalMcp = null;
function portOpen(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(750);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
  });
}
async function ensureLocalMcp(env) {
  // The Linux god workstation already runs a separately managed local MCP.
  if (process.platform !== 'win32') return;
  if (checkingLocalMcp) return checkingLocalMcp;
  checkingLocalMcp = (async () => {
    const url = new URL(env.GODCONTROL_LOCAL_MCP);
    const port = Number(url.port || 80);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (await portOpen(host, port)) return;
    if (!localMcpChild) {
      localMcpChild = spawn(process.execPath, [path.join(__dirname, '..', 'local-mcp', 'server.js')], {
        cwd: path.join(__dirname, '..'), env, stdio:'inherit', windowsHide:true,
      });
      localMcpChild.on('error', error => console.error('Local MCP start failed:', error.message));
      localMcpChild.on('exit', () => { localMcpChild = null; });
    }
    for (let attempt=0;attempt<16;attempt++) {
      if (await portOpen(host, port)) return;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('Local MCP did not open its loopback port');
  })();
  try { return await checkingLocalMcp; } finally { checkingLocalMcp = null; }
}

function status() {
  const consentResult = consent();
  const hasAuth = process.env.GODCONTROL_TRUSTED_TUNNEL === 'true'
    || !!process.env.GODCONTROL_DEVICE_TOKEN || fs.existsSync(authPath);
  const hasToken = !!(process.env.GODCONTROL_LOCAL_TOKEN || process.env.GODCONTROL_TOKEN || fs.existsSync(paths.dpapiSecret));
  return {
    deviceId: settings.deviceId,
    consent: consentResult.reason,
    enrollment: hasAuth ? 'configured' : 'missing',
    localMcpSecret: hasToken ? 'configured' : 'missing',
    ready: consentResult.ok && hasAuth && hasToken,
    consentPath: paths.consent,
  };
}

if (process.argv.includes('--check')) {
  const info = status();
  process.stdout.write(JSON.stringify(info, null, 2) + '\n');
  process.exitCode = info.ready ? 0 : 2;
} else {
  const info = status();
  if (!info.ready) {
    console.error('GodControl auto-connect not started:', info.consent, info.enrollment, info.localMcpSecret);
    process.exitCode = 2;
  } else {
    let shuttingDown = false;
    let child = null;
    let delay = 1000;
    let retry = null;
    const stop = () => {
      if (shuttingDown) return;
      shuttingDown = true;
      if (retry) clearTimeout(retry);
      if (child) child.kill();
      if (localMcpChild) localMcpChild.kill();
      clearInterval(watch);
    };
    const launch = async () => {
      if (shuttingDown) return;
      if (!consent().ok) { console.warn('Local operator disabled GodControl auto-connect'); stop(); return; }
      let env;
      try { env = childEnvironment(); }
      catch (error) { console.error(error.message); process.exitCode = 2; stop(); return; }
      if (!env.GODCONTROL_LOCAL_TOKEN && !env.GODCONTROL_TOKEN) {
        console.error('Local MCP token unavailable; agent not started'); process.exitCode = 2; stop(); return;
      }
      try { await ensureLocalMcp(env); }
      catch (error) {
        console.error('Local MCP readiness failed:', error.message);
        retry = setTimeout(launch, delay);
        delay = Math.min(delay * 2, 30000);
        return;
      }
      if (shuttingDown || !consent().ok) return;
      child = spawn(process.execPath, [path.join(__dirname, '..', 'agent', 'index.js')], {
        cwd: path.join(__dirname, '..'), stdio: 'inherit', env, windowsHide: true,
      });
      child.on('error', (err) => console.error('GodControl agent start error:', err.message));
      child.on('exit', () => {
        child = null;
        if (shuttingDown) return;
        retry = setTimeout(launch, delay);
        delay = Math.min(delay * 2, 30000);
      });
    };
    const watch = setInterval(() => {
      if (!consent().ok) { stop(); return; }
      if (child && process.platform === 'win32') {
        try { void ensureLocalMcp(childEnvironment()).catch(error => console.error('Local MCP restart failed:', error.message)); }
        catch (error) { console.error(error.message); }
      }
    }, 3000);
    watch.unref();
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    launch();
  }
}
