'use strict';

class AuthError extends Error {
  constructor(message, scopes = []) {
    super(message);
    this.name = 'AuthError';
    this.scopes = scopes;
  }
}

let josePromise;
function jose() {
  josePromise ||= import('jose');
  return josePromise;
}

function scopeSet(value) {
  if (Array.isArray(value)) return new Set(value);
  return new Set(String(value || '').split(/\s+/).filter(Boolean));
}

async function authenticate(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) throw new AuthError('Missing bearer token');
  const token = header.slice(7);

  if (process.env.GODCONTROL_DEV_AUTH === 'true') {
    if (process.env.NODE_ENV === 'production') throw new Error('GODCONTROL_DEV_AUTH cannot run in production');
    if (!token.startsWith('dev:')) throw new AuthError('Invalid development token');
    const separator = token.indexOf(':', 4);
    if (separator < 0) throw new AuthError('Malformed development token');
    const sub = token.slice(4, separator) || 'dev-user';
    const scopes = token.slice(separator + 1);
    return { sub, email: process.env.GODCONTROL_DEV_EMAIL || 'developer@example.invalid', email_verified: true, scopes: scopeSet(scopes.replace(/,/g, ' ')) };
  }

  const issuer = process.env.OIDC_ISSUER;
  const jwksUri = process.env.OIDC_JWKS_URI;
  const audience = process.env.OIDC_AUDIENCE;
  if (!issuer || !jwksUri || !audience) throw new Error('OIDC_ISSUER, OIDC_JWKS_URI and OIDC_AUDIENCE are required');

  const { createRemoteJWKSet, jwtVerify } = await jose();
  const JWKS = createRemoteJWKSet(new URL(jwksUri));
  const { payload } = await jwtVerify(token, JWKS, { issuer, audience });
  return {
    sub: String(payload.sub),
    email: payload.email ? String(payload.email) : undefined,
    email_verified: payload.email_verified === true,
    scopes: scopeSet(payload.scope || payload.scp),
    claims: payload,
  };
}

function requireScopes(identity, required) {
  const missing = required.filter((scope) => !identity.scopes.has(scope));
  if (missing.length) throw new AuthError('Missing required scope', required);
}

function resourceMetadata(origin) {
  const authz = process.env.OIDC_ISSUER;
  const scopes = ['profile:read','devices:read','files:read','files:write','git:read','process:run','system:read','openid','email'];
  return {
    resource: origin,
    authorization_servers: authz ? [authz] : [],
    scopes_supported: scopes,
    resource_documentation: origin + '/support',
    resource_policy_uri: origin + '/privacy',
    resource_tos_uri: origin + '/terms',
  };
}

function challenge(origin, scopes = []) {
  const metadata = origin + '/.well-known/oauth-protected-resource';
  const scope = scopes.length ? ', scope="' + scopes.join(' ') + '"' : '';
  return 'Bearer resource_metadata="' + metadata + '"' + scope;
}

module.exports = { AuthError, authenticate, requireScopes, resourceMetadata, challenge };
