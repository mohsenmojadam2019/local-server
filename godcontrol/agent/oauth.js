'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function defaultConfigPath() {
  return process.env.GODCONTROL_DEVICE_OAUTH_CONFIG
    || path.join(os.homedir(), '.config', 'godcontrol', 'device-oauth.json');
}

function readConfig(configPath = defaultConfigPath()) {
  const raw = fs.readFileSync(configPath, 'utf8');
  const data = JSON.parse(raw);
  if (!data.access_token || !data.token_endpoint || !data.client_id) {
    throw new Error('GodControl device OAuth config is incomplete');
  }
  return data;
}

function writeConfig(data, configPath = defaultConfigPath()) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });
  const temp = configPath + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(temp, 0o600);
  fs.renameSync(temp, configPath);
  fs.chmodSync(configPath, 0o600);
}

function tokenExpired(data, skewSeconds = 60) {
  if (!data.expires_at) return false;
  return Number(data.expires_at) <= Math.floor(Date.now() / 1000) + skewSeconds;
}

async function refreshAccessToken(data, configPath = defaultConfigPath()) {
  if (!data.refresh_token) throw new Error('Device OAuth access expired and no refresh token is available');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: data.refresh_token,
    client_id: data.client_id,
  });
  if (data.resource) body.set('resource', data.resource);

  const response = await fetch(data.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) throw new Error('Device OAuth refresh failed with HTTP ' + response.status);
  const token = await response.json();
  if (!token.access_token) throw new Error('Device OAuth refresh response is missing access_token');

  const next = {
    ...data,
    access_token: token.access_token,
    refresh_token: token.refresh_token || data.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + Number(token.expires_in || 3600),
  };
  writeConfig(next, configPath);
  return next;
}

async function getBearerToken(configPath = defaultConfigPath()) {
  let data = readConfig(configPath);
  if (tokenExpired(data)) data = await refreshAccessToken(data, configPath);
  return data.access_token;
}

module.exports = {
  defaultConfigPath,
  readConfig,
  writeConfig,
  tokenExpired,
  refreshAccessToken,
  getBearerToken,
};
