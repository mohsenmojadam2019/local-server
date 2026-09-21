const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const net = require('net');
const http = require('http');
const https = require('https');
const { randomUUID } = require('crypto');

function normalizeHost(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
}

function slugify(value = '') {
  const cleaned = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || `project-${Date.now()}`;
}

function safeProjectId() {
  return randomUUID();
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function pathExists(target) {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

function isPortAvailable(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ port, host }, () => server.close(() => resolve(true)));
  });
}

async function findAvailablePort(start = 3000, end = 65000, host = '127.0.0.1') {
  for (let port = start; port <= end; port += 1) {
    if (await isPortAvailable(port, host)) return port;
  }
  throw new Error('هیچ پورت آزادی در بازه مشخص‌شده پیدا نشد.');
}

function requestHealth(url, timeout = 1800) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      resolve({ ok: false, status: null, error: 'invalid_url' });
      return;
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request(parsed, { method: 'GET', timeout }, (res) => {
      res.resume();
      resolve({ ok: res.statusCode >= 200 && res.statusCode < 500, status: res.statusCode, error: null });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (error) => resolve({ ok: false, status: null, error: error.message }));
    req.end();
  });
}

function getLanAddresses() {
  const out = [];
  const interfaces = os.networkInterfaces();
  for (const [name, items] of Object.entries(interfaces)) {
    for (const item of items || []) {
      if (item.family === 'IPv4' && !item.internal) out.push({ name, address: item.address });
    }
  }
  return out;
}

async function readJson(file, fallback) {
  try {
    const raw = await fsp.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(file, value) {
  await ensureDir(path.dirname(file));
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
  await fsp.rename(temp, file);
}

function shellEscapeForDisplay(value) {
  return String(value).replace(/[\r\n]/g, ' ');
}

module.exports = {
  normalizeHost,
  slugify,
  safeProjectId,
  ensureDir,
  pathExists,
  isPortAvailable,
  findAvailablePort,
  requestHealth,
  getLanAddresses,
  readJson,
  writeJsonAtomic,
  shellEscapeForDisplay,
};
