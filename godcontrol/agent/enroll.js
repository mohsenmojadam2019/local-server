'use strict';

const crypto = require('crypto');
const http = require('http');
const os = require('os');
const { spawn } = require('child_process');
const { writeConfig } = require('./oauth');

const ISSUER = (process.env.GODCONTROL_OAUTH_ISSUER || 'https://auth.redcoweb.ir').replace(/\/$/, '');
const RESOURCE = (process.env.GODCONTROL_MCP_RESOURCE || 'https://mcp.redcoweb.ir').replace(/\/$/, '');

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function openBrowser(url) {
  const platform = process.platform;
  let child;
  try {
    if (platform === 'darwin') child = spawn('open', [url], { detached: true, stdio: 'ignore' });
    else if (platform === 'win32') child = spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true });
    else child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function discover() {
  const response = await fetch(ISSUER + '/.well-known/openid-configuration');
  if (!response.ok) throw new Error('OAuth discovery failed with HTTP ' + response.status);
  const metadata = await response.json();
  if (!metadata.authorization_endpoint || !metadata.token_endpoint || !metadata.registration_endpoint) {
    throw new Error('OAuth discovery metadata is incomplete');
  }
  if (!metadata.code_challenge_methods_supported?.includes('S256')) {
    throw new Error('OAuth server does not advertise PKCE S256');
  }
  return metadata;
}

async function main() {
  const metadata = await discover();
  let resolveCode;
  let rejectCode;
  const codePromise = new Promise((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  const state = base64url(crypto.randomBytes(24));
  const verifier = base64url(crypto.randomBytes(48));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());

  const callbackServer = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        res.writeHead(404).end('Not found');
        return;
      }
      if (url.searchParams.get('state') !== state) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Invalid state');
        rejectCode(new Error('OAuth callback state did not match'));
        return;
      }
      const error = url.searchParams.get('error');
      if (error) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Authorization was not completed');
        rejectCode(new Error('OAuth authorization failed: ' + error));
        return;
      }
      const code = url.searchParams.get('code');
      if (!code) {
        res.writeHead(400).end('Missing code');
        rejectCode(new Error('OAuth callback did not contain an authorization code'));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><meta charset="utf-8"><title>GodControl connected</title><h1>GodControl device connected</h1><p>You can close this window.</p>');
      resolveCode(code);
    } catch (error) {
      rejectCode(error);
    }
  });

  await new Promise((resolve, reject) => {
    callbackServer.once('error', reject);
    callbackServer.listen(0, '127.0.0.1', resolve);
  });

  const port = callbackServer.address().port;
  const redirectUri = 'http://127.0.0.1:' + port + '/callback';

  const registration = await fetch(metadata.registration_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'GodControl Device Agent (' + os.hostname() + ')',
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  });
  if (!registration.ok) {
    callbackServer.close();
    throw new Error('OAuth client registration failed with HTTP ' + registration.status);
  }
  const client = await registration.json();
  if (!client.client_id) {
    callbackServer.close();
    throw new Error('OAuth client registration response is missing client_id');
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: redirectUri,
    scope: 'openid profile devices:connect offline_access',
    resource: RESOURCE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    prompt: 'consent',
  });
  const authorizeUrl = metadata.authorization_endpoint + '?' + params.toString();

  console.log('Open this URL to enroll the device:');
  console.log(authorizeUrl);
  openBrowser(authorizeUrl);

  let code;
  try {
    code = await Promise.race([
      codePromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('OAuth enrollment timed out')), 10 * 60 * 1000)),
    ]);
  } finally {
    callbackServer.close();
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: client.client_id,
    code_verifier: verifier,
    resource: RESOURCE,
  });
  const tokenResponse = await fetch(metadata.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!tokenResponse.ok) throw new Error('OAuth token exchange failed with HTTP ' + tokenResponse.status);
  const token = await tokenResponse.json();
  if (!token.access_token) throw new Error('OAuth token exchange returned no access_token');

  writeConfig({
    issuer: ISSUER,
    resource: RESOURCE,
    token_endpoint: metadata.token_endpoint,
    client_id: client.client_id,
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + Number(token.expires_in || 3600),
  });

  console.log('GodControl device enrollment complete.');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
