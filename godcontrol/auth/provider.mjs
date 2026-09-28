import { Provider, errors } from 'oidc-provider';
import RedisAdapter, { configureRedisAdapter } from './redis-adapter.mjs';

export const RESOURCE_SCOPES = [
  'profile:read',
  'devices:read',
  'files:read',
  'files:write',
  'git:read',
  'process:run',
  'system:read',
];

export function buildProvider({ issuer, resource, redis, accounts, jwks, cookieKeys }) {
  if (!issuer?.startsWith('https://') && process.env.NODE_ENV === 'production') {
    throw new Error('OIDC issuer must use HTTPS in production');
  }
  if (!resource?.startsWith('https://') && process.env.NODE_ENV === 'production') {
    throw new Error('MCP resource must use HTTPS in production');
  }
  if (!Array.isArray(cookieKeys) || cookieKeys.length < 2) {
    throw new Error('At least two OIDC cookie signing keys are required');
  }
  if (!jwks?.keys?.length) throw new Error('OIDC JWKS with private signing key is required');

  configureRedisAdapter(redis);
  const resourceScopes = RESOURCE_SCOPES.join(' ');

  const provider = new Provider(issuer, {
    adapter: RedisAdapter,
    jwks,
    cookies: {
      keys: cookieKeys,
      long: { httpOnly: true, sameSite: 'lax', secure: true, signed: true },
      short: { httpOnly: true, sameSite: 'lax', secure: true, signed: true },
    },
    claims: {
      openid: ['sub'],
      email: ['email', 'email_verified'],
      profile: ['name'],
    },
    scopes: ['openid', 'email', 'profile', 'offline_access', ...RESOURCE_SCOPES],
    clientAuthMethods: ['none', 'private_key_jwt'],
    clientDefaults: {
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
    responseTypes: ['code'],
    pkce: { required: () => true },
    issueRefreshToken: () => true,
    rotateRefreshToken: true,
    features: {
      devInteractions: { enabled: false },
      registration: {
        enabled: true,
        initialAccessToken: false,
        issueRegistrationAccessToken: true,
      },
      registrationManagement: { enabled: true },
      revocation: { enabled: true },
      resourceIndicators: {
        enabled: true,
        defaultResource(_ctx, _client, oneOf) {
          if (Array.isArray(oneOf) && oneOf.length === 1) return oneOf[0];
          return resource;
        },
        useGrantedResource: () => true,
        getResourceServerInfo(_ctx, indicator) {
          if (String(indicator).replace(/\/$/, '') !== String(resource).replace(/\/$/, '')) {
            throw new errors.InvalidTarget('Unknown resource');
          }
          return {
            audience: resource,
            scope: resourceScopes,
            accessTokenTTL: 3600,
            accessTokenFormat: 'jwt',
            jwt: { sign: { alg: 'RS256' } },
          };
        },
      },
    },
    interactions: {
      url(_ctx, interaction) {
        return '/interaction/' + interaction.uid;
      },
    },
    async findAccount(_ctx, id) {
      const account = await accounts.findById(id);
      if (!account || account.disabled) return undefined;
      return {
        accountId: account.id,
        async claims() {
          return {
            sub: account.id,
            email: account.email,
            email_verified: account.email_verified === true,
            name: account.name,
          };
        },
      };
    },
    discovery: {
      service_documentation: resource + '/support',
      op_policy_uri: resource + '/privacy',
      op_tos_uri: resource + '/terms',
    },
    ttl: {
      AccessToken: 3600,
      AuthorizationCode: 600,
      Interaction: 600,
      Session: 14 * 24 * 60 * 60,
      RefreshToken: 30 * 24 * 60 * 60,
      Grant: 30 * 24 * 60 * 60,
    },
  });

  provider.proxy = true;
  return provider;
}
