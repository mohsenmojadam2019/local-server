const EventEmitter = require('events');
const { CONFIG_FILE, DEFAULT_ADMIN_HOST, DEFAULT_ADMIN_PORT, DEFAULT_PROXY_HOST, DEFAULT_PROXY_PORT } = require('./constants');
const { readJson, writeJsonAtomic } = require('./utils');

const DEFAULT_CONFIG = {
  schemaVersion: 1,
  settings: {
    adminHost: DEFAULT_ADMIN_HOST,
    adminPort: DEFAULT_ADMIN_PORT,
    proxyHost: DEFAULT_PROXY_HOST,
    proxyPort: DEFAULT_PROXY_PORT,
    autoOpenBrowser: true,
    allowLanProxy: false,
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

class ConfigStore extends EventEmitter {
  constructor(file = CONFIG_FILE) {
    super();
    this.file = file;
    this.data = structuredClone(DEFAULT_CONFIG);
    this.writeQueue = Promise.resolve();
  }

  async load() {
    const loaded = await readJson(this.file, null);
    if (loaded) {
      this.data = {
        ...structuredClone(DEFAULT_CONFIG),
        ...loaded,
        settings: { ...DEFAULT_CONFIG.settings, ...(loaded.settings || {}) },
        cloudflare: { ...DEFAULT_CONFIG.cloudflare, ...(loaded.cloudflare || {}) },
        projects: Array.isArray(loaded.projects) ? loaded.projects : [],
      };
    } else {
      await this.save();
    }
    return this.data;
  }

  get() {
    return this.data;
  }

  async mutate(mutator) {
    mutator(this.data);
    await this.save();
    this.emit('change', this.data);
    return this.data;
  }

  async save() {
    this.writeQueue = this.writeQueue.then(() => writeJsonAtomic(this.file, this.data));
    return this.writeQueue;
  }
}

module.exports = { ConfigStore, DEFAULT_CONFIG };
