'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function configDirectory({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (platform === 'win32') {
    return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'GodControl');
  }
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'godcontrol');
}

function configPaths(options = {}) {
  const directory = configDirectory(options);
  return {
    directory,
    settings: path.join(directory, 'agent-settings.json'),
    consent: path.join(directory, 'auto-connect.json'),
    dpapiSecret: path.join(directory, 'local-mcp-token.dpapi'),
  };
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function consentStatus(consent, deviceId) {
  if (!consent) return { ok: false, reason: 'consent_missing' };
  if (consent.version !== 1 || consent.enabled !== true) return { ok: false, reason: 'consent_disabled' };
  if (typeof consent.deviceId !== 'string' || consent.deviceId !== deviceId) {
    return { ok: false, reason: 'device_id_mismatch' };
  }
  return { ok: true, reason: 'enabled' };
}

function validateSettings(value) {
  if (!value || typeof value !== 'object') throw new Error('Missing agent-settings.json');
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(value.deviceId || '')) throw new Error('Invalid deviceId');
  if (!Array.isArray(value.readRoots) || value.readRoots.length === 0 || value.readRoots.some(x => typeof x !== 'string' || !path.isAbsolute(x))) {
    throw new Error('Configure explicit absolute readRoots');
  }
  if (!Array.isArray(value.writeRoots) || value.writeRoots.some(x => typeof x !== 'string' || !path.isAbsolute(x))) {
    throw new Error('Configure explicit absolute writeRoots (may be empty)');
  }
  if (!Array.isArray(value.allowedPrograms) || value.allowedPrograms.some(x => !/^[a-zA-Z0-9._+-]+$/.test(x))) {
    throw new Error('Invalid allowedPrograms');
  }
  const local = new URL(value.localMcp || 'http://127.0.0.1:8787/mcp');
  if (local.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(local.hostname)) {
    throw new Error('Local MCP must remain on http://localhost');
  }
  const hub = new URL(value.hubUrl || 'wss://mcp.redcoweb.ir/agent/connect');
  if (hub.protocol !== 'wss:' && !(hub.protocol === 'ws:' && ['127.0.0.1', 'localhost', '[::1]'].includes(hub.hostname))) {
    throw new Error('Hub must use wss:// (or loopback ws:// with a trusted SSH tunnel)');
  }
  return value;
}

module.exports = { configDirectory, configPaths, readJson, consentStatus, validateSettings };
