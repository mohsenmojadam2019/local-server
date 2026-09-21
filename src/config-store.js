const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const {
  CONFIG_DB_FILE,
  LEGACY_CONFIG_FILE,
  DEFAULT_ADMIN_HOST,
  DEFAULT_ADMIN_PORT,
  DEFAULT_PROXY_HOST,
  DEFAULT_PROXY_PORT,
} = require('./constants');
const { readJson } = require('./utils');

function envBool(name, fallback) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase());
}

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const DEFAULT_CONFIG = {
  schemaVersion: 3,
  settings: {
    adminHost: DEFAULT_ADMIN_HOST,
    adminPort: DEFAULT_ADMIN_PORT,
    proxyHost: DEFAULT_PROXY_HOST,
    proxyPort: DEFAULT_PROXY_PORT,
    autoOpenBrowser: true,
    allowLanProxy: false,
    autoStartTunnel: true,
    defaultCdnPreset: 'standard',
    logLimitPerProject: 1500,
  },
  projects: [],
  cloudflare: {
    tunnelName: 'local-server-pro',
    tunnelId: '',
    credentialsFile: '',
    managedDomains: [],
  },
};

function applyEnvironment(data) {
  const s = data.settings;
  if (process.env.LOCAL_SERVER_ADMIN_HOST) s.adminHost = process.env.LOCAL_SERVER_ADMIN_HOST;
  if (process.env.LOCAL_SERVER_ADMIN_PORT) s.adminPort = envNumber('LOCAL_SERVER_ADMIN_PORT', s.adminPort);
  if (process.env.LOCAL_SERVER_PROXY_HOST) s.proxyHost = process.env.LOCAL_SERVER_PROXY_HOST;
  if (process.env.LOCAL_SERVER_PROXY_PORT) s.proxyPort = envNumber('LOCAL_SERVER_PROXY_PORT', s.proxyPort);
  if (process.env.LOCAL_SERVER_ALLOW_LAN != null) s.allowLanProxy = envBool('LOCAL_SERVER_ALLOW_LAN', s.allowLanProxy);
  if (process.env.LOCAL_SERVER_AUTO_START_TUNNEL != null) s.autoStartTunnel = envBool('LOCAL_SERVER_AUTO_START_TUNNEL', s.autoStartTunnel);
  if (process.env.LOCAL_SERVER_TUNNEL_NAME) data.cloudflare.tunnelName = process.env.LOCAL_SERVER_TUNNEL_NAME;
  return data;
}

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

class ConfigStore extends EventEmitter {
  constructor(file = CONFIG_DB_FILE) {
    super();
    this.file = file;
    this.db = null;
    this.data = structuredClone(DEFAULT_CONFIG);
    this.writeQueue = Promise.resolve();
  }

  openDatabase() {
    if (this.db) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.db = new DatabaseSync(this.file);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cloudflare (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at TEXT,
        updated_at TEXT
      );
    `);
  }

  loadFromDatabase() {
    const data = structuredClone(DEFAULT_CONFIG);
    const settings = this.db.prepare('SELECT key, value FROM settings').all();
    const cloudflare = this.db.prepare('SELECT key, value FROM cloudflare').all();
    const projects = this.db.prepare('SELECT data FROM projects ORDER BY created_at ASC').all();

    for (const row of settings) data.settings[row.key] = parseJson(row.value, row.value);
    for (const row of cloudflare) data.cloudflare[row.key] = parseJson(row.value, row.value);
    data.projects = projects.map((row) => parseJson(row.data, null)).filter(Boolean);
    return data;
  }

  async load() {
    this.openDatabase();
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM settings').get();
    const projectRow = this.db.prepare('SELECT COUNT(*) AS count FROM projects').get();
    const empty = Number(row?.count || 0) === 0 && Number(projectRow?.count || 0) === 0;

    if (empty && fs.existsSync(LEGACY_CONFIG_FILE)) {
      const legacy = await readJson(LEGACY_CONFIG_FILE, null);
      if (legacy) {
        this.data = {
          ...structuredClone(DEFAULT_CONFIG),
          ...legacy,
          schemaVersion: 3,
          settings: { ...DEFAULT_CONFIG.settings, ...(legacy.settings || {}) },
          cloudflare: { ...DEFAULT_CONFIG.cloudflare, ...(legacy.cloudflare || {}) },
          projects: Array.isArray(legacy.projects) ? legacy.projects : [],
        };
        this.db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)').run('migratedFrom', LEGACY_CONFIG_FILE);
      }
    } else {
      this.data = this.loadFromDatabase();
    }

    this.data.schemaVersion = 3;
    applyEnvironment(this.data);
    await this.save();
    return this.data;
  }

  get() { return this.data; }

  info() {
    return { driver: 'sqlite', file: this.file, schemaVersion: this.data.schemaVersion };
  }

  async mutate(mutator) {
    mutator(this.data);
    await this.save();
    this.emit('change', this.data);
    return this.data;
  }

  saveNow() {
    this.openDatabase();
    const insertSetting = this.db.prepare('INSERT INTO settings(key, value) VALUES (?, ?)');
    const insertCloudflare = this.db.prepare('INSERT INTO cloudflare(key, value) VALUES (?, ?)');
    const insertProject = this.db.prepare('INSERT INTO projects(id, data, created_at, updated_at) VALUES (?, ?, ?, ?)');

    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.exec('DELETE FROM settings; DELETE FROM cloudflare; DELETE FROM projects;');
      for (const [key, value] of Object.entries(this.data.settings || {})) {
        insertSetting.run(key, JSON.stringify(value));
      }
      for (const [key, value] of Object.entries(this.data.cloudflare || {})) {
        insertCloudflare.run(key, JSON.stringify(value));
      }
      for (const project of this.data.projects || []) {
        insertProject.run(
          project.id,
          JSON.stringify(project),
          project.createdAt || new Date().toISOString(),
          project.updatedAt || new Date().toISOString(),
        );
      }
      this.db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)').run('schemaVersion', String(this.data.schemaVersion || 3));
      this.db.exec('COMMIT');
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }

  async save() {
    this.writeQueue = this.writeQueue.then(() => this.saveNow());
    return this.writeQueue;
  }
}

module.exports = { ConfigStore, DEFAULT_CONFIG, applyEnvironment };
