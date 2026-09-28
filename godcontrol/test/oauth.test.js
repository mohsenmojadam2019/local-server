'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

class FakeRedis {
  constructor() { this.values = new Map(); this.sets = new Map(); }
  async set(key, value, options = {}) {
    if (options.NX && this.values.has(key)) return null;
    this.values.set(key, String(value));
    return 'OK';
  }
  async get(key) { return this.values.get(key) ?? null; }
  async del(keys) {
    if (!Array.isArray(keys)) keys = [...arguments];
    let n = 0;
    for (const key of keys) { if (this.values.delete(key)) n++; this.sets.delete(key); }
    return n;
  }
  async sAdd(key, value) {
    const set = this.sets.get(key) || new Set();
    set.add(value); this.sets.set(key, set); return 1;
  }
  async sRem(key, value) { return this.sets.get(key)?.delete(value) ? 1 : 0; }
  async sMembers(key) { return [...(this.sets.get(key) || new Set())]; }
  async expire() { return 1; }
  async ttl() { return -1; }
}

test('OAuth password hashing verifies correct passwords only', async () => {
  const { hashPassword, verifyPassword } = await import('../auth/account-store.mjs');
  const stored = await hashPassword('correct-horse-battery-staple');
  assert.equal(await verifyPassword('correct-horse-battery-staple', stored), true);
  assert.equal(await verifyPassword('incorrect-password', stored), false);
});

test('OAuth provider advertises OpenAI-compatible PKCE and DCR metadata', async (t) => {
  const { generateKeyPair, exportJWK } = await import('jose');
  const { buildProvider } = await import('../auth/provider.mjs');
  const { privateKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk = await exportJWK(privateKey);
  Object.assign(jwk, { alg: 'RS256', use: 'sig', kid: 'test-key' });

  const redis = new FakeRedis();
  const accounts = { async findById() { return null; } };
  const issuer = 'https://auth.example.test';
  const resource = 'https://mcp.example.test';
  const provider = buildProvider({
    issuer, resource, redis, accounts,
    jwks: { keys: [jwk] },
    cookieKeys: ['test-cookie-key-one-1234567890', 'test-cookie-key-two-1234567890'],
  });

  const server = provider.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;

  const discovery = await fetch('http://127.0.0.1:' + port + '/.well-known/openid-configuration').then((r) => r.json());
  assert.equal(discovery.issuer, issuer);
  assert.equal(discovery.authorization_response_iss_parameter_supported, true);
  assert.ok(discovery.code_challenge_methods_supported.includes('S256'));
  assert.ok(discovery.token_endpoint_auth_methods_supported.includes('none'));
  assert.ok(discovery.registration_endpoint);

  const registration = await fetch('http://127.0.0.1:' + port + new URL(discovery.registration_endpoint).pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'OpenAI test client',
      redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  });
  assert.equal(registration.status, 201);
  const registered = await registration.json();
  assert.ok(registered.client_id);
  assert.equal(registered.token_endpoint_auth_method, 'none');
});
