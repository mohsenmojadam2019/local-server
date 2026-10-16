'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

class FakeRedis {
  constructor() { this.values = new Map(); this.sets = new Map(); }
  async set(key, value) { this.values.set(key, String(value)); return 'OK'; }
  async get(key) { return this.values.get(key) ?? null; }
  async del(keys) { for (const key of Array.isArray(keys) ? keys : [...arguments]) this.values.delete(key); }
  async sAdd(key, value) { const set = this.sets.get(key) || new Set(); set.add(value); this.sets.set(key, set); }
  async sRem(key, value) { this.sets.get(key)?.delete(value); }
  async sMembers(key) { return [...(this.sets.get(key) || new Set())]; }
  async expire() {}
  async ttl() { return -1; }
}

test('OAuth consent persists a resource grant through the Redis adapter', async () => {
  const { generateKeyPair, exportJWK } = await import('jose');
  const { buildProvider } = await import('../auth/provider.mjs');
  const { saveConsentGrant } = await import('../auth/consent.mjs');
  const { privateKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk = await exportJWK(privateKey);
  Object.assign(jwk, { alg: 'RS256', use: 'sig', kid: 'consent-test' });
  const provider = buildProvider({
    issuer: 'https://auth.example.test',
    resource: 'https://mcp.example.test',
    redis: new FakeRedis(),
    accounts: { async findById() { return null; } },
    jwks: { keys: [jwk] },
    cookieKeys: ['consent-cookie-key-one-1234567890', 'consent-cookie-key-two-1234567890'],
  });

  const grantId = await saveConsentGrant(provider, {
    grantId: undefined,
    params: { client_id: 'chatgpt-test-client' },
    session: { accountId: 'owner-test-account' },
    prompt: { details: {
      missingOIDCScope: ['openid', 'email'],
      missingOIDCClaims: [],
      missingResourceScopes: { 'https://mcp.example.test': ['devices:read', 'system:read'] },
    } },
  });
  const saved = await provider.Grant.find(grantId);
  assert.equal(saved.accountId, 'owner-test-account');
  assert.equal(saved.clientId, 'chatgpt-test-client');
  assert.match(saved.getOIDCScope(), /openid/);
  assert.match(saved.getResourceScope('https://mcp.example.test'), /devices:read/);
  assert.match(saved.getResourceScope('https://mcp.example.test'), /system:read/);
});

test('replayed consent is classified as an expired authorization request', async () => {
  const { authorizationErrorResponse } = await import('../auth/error-response.mjs');
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    type() { return this; },
    send(body) { this.body = body; return this; },
  };
  authorizationErrorResponse({ name: 'SessionNotFound' }, response, (title, body) => title + ':' + body);
  assert.equal(response.statusCode, 400);
  assert.match(response.body, /expired/i);
  assert.doesNotMatch(response.body, /session|cookie|token/i);
});
