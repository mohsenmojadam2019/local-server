const path = require('path');
const os = require('os');

const APP_NAME = 'Local Server Pro';
const APP_VERSION = '0.3.0';
const DATA_DIR = process.env.LOCAL_SERVER_DATA_DIR || path.join(os.homedir(), '.local-server-pro');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const CLOUDFLARE_DIR = path.join(DATA_DIR, 'cloudflare');
const RUNTIME_DIR = path.join(DATA_DIR, 'runtime');
const DEFAULT_ADMIN_HOST = '127.0.0.1';
const DEFAULT_ADMIN_PORT = 8788;
const DEFAULT_PROXY_HOST = '127.0.0.1';
const DEFAULT_PROXY_PORT = 8787;

module.exports = {
  APP_NAME,
  APP_VERSION,
  DATA_DIR,
  CONFIG_FILE,
  CLOUDFLARE_DIR,
  RUNTIME_DIR,
  DEFAULT_ADMIN_HOST,
  DEFAULT_ADMIN_PORT,
  DEFAULT_PROXY_HOST,
  DEFAULT_PROXY_PORT,
};
