import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import express from 'express';
import { createClient } from 'redis';
import { buildProvider, RESOURCE_SCOPES } from './provider.mjs';
import { AccountStore } from './account-store.mjs';

const ISSUER = String(process.env.OIDC_ISSUER || 'https://auth.redcoweb.ir').replace(/\/$/, '');
const RESOURCE = String(process.env.GODCONTROL_MCP_RESOURCE || 'https://mcp.redcoweb.ir').replace(/\/$/, '');
const HOST = process.env.OIDC_HOST || '127.0.0.1';
const PORT = Number(process.env.OIDC_PORT || 19092);
const REDIS_URL = process.env.GODCONTROL_REDIS_URL;
const JWKS_PATH = process.env.OIDC_JWKS_PATH;
const COOKIE_KEYS = String(process.env.OIDC_COOKIE_KEYS || '').split(',').map((v) => v.trim()).filter(Boolean);
const FORM_SECRET = process.env.OIDC_FORM_SECRET;

if (!REDIS_URL) throw new Error('GODCONTROL_REDIS_URL is required');
if (!JWKS_PATH) throw new Error('OIDC_JWKS_PATH is required');
if (!FORM_SECRET || FORM_SECRET.length < 32) throw new Error('OIDC_FORM_SECRET must be at least 32 characters');

const jwks = JSON.parse(fs.readFileSync(JWKS_PATH, 'utf8'));
const redis = createClient({ url: REDIS_URL });
redis.on('error', (error) => console.error('Redis error:', error.message));
await redis.connect();

const accounts = new AccountStore(redis);
const provider = buildProvider({
  issuer: ISSUER,
  resource: RESOURCE,
  redis,
  accounts,
  jwks,
  cookieKeys: COOKIE_KEYS,
});

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
const formBody = express.urlencoded({ extended: false, limit: '32kb' });

app.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  next();
});

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[ch]);
}

function tokenFor(value) {
  return crypto.createHmac('sha256', FORM_SECRET).update(String(value)).digest('base64url');
}

function verifyToken(value, token) {
  const expected = Buffer.from(tokenFor(value));
  const actual = Buffer.from(String(token || ''));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function safeReturnTo(value) {
  const v = String(value || '');
  return /^\/interaction\/[A-Za-z0-9_-]+$/.test(v) ? v : '/';
}

function layout(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)}</title><style>
  body{font:16px system-ui;max-width:560px;margin:56px auto;padding:0 20px;color:#172033;background:#f7f8fb}
  main{background:white;border:1px solid #e2e6ee;border-radius:16px;padding:28px;box-shadow:0 10px 30px #17203312}
  h1{margin-top:0}label{display:block;margin:16px 0 6px;font-weight:600}input{width:100%;box-sizing:border-box;padding:11px;border:1px solid #c8cfdb;border-radius:8px}
  button,.button{display:inline-block;margin-top:18px;padding:11px 16px;border:0;border-radius:8px;background:#172033;color:white;text-decoration:none;cursor:pointer}
  .muted{color:#667085;font-size:14px}.error{color:#b42318;background:#fef3f2;padding:10px;border-radius:8px}.scopes{padding-left:22px}
  </style></head><body><main>${body}</main></body></html>`;
}

async function throttleFailure(key, limit = 8, seconds = 300) {
  const full = 'godcontrol:auth:limit:' + key;
  const count = await redis.incr(full);
  if (count === 1) await redis.expire(full, seconds);
  return count <= limit;
}

app.get('/', (_req, res) => {
  res.type('html').send(layout('GodControl Authorization', '<h1>GodControl Authorization</h1><p>This service signs users in to GodControl MCP connections.</p><p class="muted">Only approve access you initiated from ChatGPT or Codex.</p>'));
});

app.get('/health', async (_req, res) => {
  try {
    await redis.ping();
    res.json({ ok: true, service: 'godcontrol-auth' });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.get('/interaction/:uid', async (req, res, next) => {
  try {
    const details = await provider.interactionDetails(req, res);
    const { uid, prompt, params } = details;
    const client = await provider.Client.find(params.client_id);
    const csrf = tokenFor(uid);

    if (prompt.name === 'login') {
      const register = '/register?return_to=' + encodeURIComponent('/interaction/' + uid);
      return res.type('html').send(layout('Sign in to GodControl', `
        <h1>Sign in to GodControl</h1>
        <p class="muted">Connecting: ${esc(client?.clientName || 'OpenAI client')}</p>
        <form method="post" action="/interaction/${esc(uid)}/login">
          <input type="hidden" name="csrf" value="${esc(csrf)}">
          <label>Email</label><input name="email" type="email" autocomplete="username" required>
          <label>Password</label><input name="password" type="password" autocomplete="current-password" required minlength="12">
          <button type="submit">Sign in</button>
        </form>
        <p><a href="${esc(register)}">Create an account</a></p>
        <p><a href="/interaction/${esc(uid)}/abort">Cancel</a></p>`));
    }

    if (prompt.name === 'consent') {
      const scopes = [
        ...(prompt.details.missingOIDCScope || []),
        ...Object.values(prompt.details.missingResourceScopes || {}).flat(),
      ];
      const items = scopes.map((s) => '<li>' + esc(s) + '</li>').join('');
      return res.type('html').send(layout('Authorize GodControl', `
        <h1>Authorize GodControl</h1>
        <p>Allow ${esc(client?.clientName || 'this OpenAI client')} to use these permissions:</p>
        <ul class="scopes">${items || '<li>Continue existing authorization</li>'}</ul>
        <form method="post" action="/interaction/${esc(uid)}/confirm">
          <input type="hidden" name="csrf" value="${esc(csrf)}">
          <button type="submit">Allow</button>
        </form>
        <p><a href="/interaction/${esc(uid)}/abort">Cancel</a></p>`));
    }

    return res.status(400).type('html').send(layout('Unsupported prompt', '<h1>Unsupported authorization prompt</h1>'));
  } catch (error) {
    return next(error);
  }
});

app.post('/interaction/:uid/login', formBody, async (req, res, next) => {
  try {
    const details = await provider.interactionDetails(req, res);
    if (details.prompt.name !== 'login') return res.status(400).send('Invalid interaction');
    if (!verifyToken(details.uid, req.body.csrf)) return res.status(400).send('Invalid form token');

    const key = String(req.ip || 'unknown') + ':' + String(req.body.email || '').toLowerCase();
    const account = await accounts.authenticate(req.body.email, req.body.password);
    if (!account) {
      const allowed = await throttleFailure(key);
      if (!allowed) return res.status(429).type('html').send(layout('Try later', '<h1>Too many attempts</h1><p>Try again in a few minutes.</p>'));
      const csrf = tokenFor(details.uid);
      return res.status(401).type('html').send(layout('Sign in to GodControl', `
        <h1>Sign in to GodControl</h1><p class="error">Email or password is incorrect.</p>
        <form method="post" action="/interaction/${esc(details.uid)}/login">
          <input type="hidden" name="csrf" value="${esc(csrf)}">
          <label>Email</label><input name="email" type="email" required>
          <label>Password</label><input name="password" type="password" required minlength="12">
          <button type="submit">Sign in</button>
        </form>`));
    }

    await redis.del('godcontrol:auth:limit:' + key);
    return provider.interactionFinished(req, res, {
      login: { accountId: account.id, remember: true, amr: ['pwd'] },
    }, { mergeWithLastSubmission: false });
  } catch (error) {
    return next(error);
  }
});

app.post('/interaction/:uid/confirm', formBody, async (req, res, next) => {
  try {
    const details = await provider.interactionDetails(req, res);
    if (details.prompt.name !== 'consent') return res.status(400).send('Invalid interaction');
    if (!verifyToken(details.uid, req.body.csrf)) return res.status(400).send('Invalid form token');

    const { prompt: { details: missing }, params, session } = details;
    let grantId = details.grantId;
    let grant = grantId ? await provider.Grant.find(grantId) : new provider.Grant({
      accountId: session.accountId,
      clientId: params.client_id,
    });

    if (missing.missingOIDCScope) grant.addOIDCScope(missing.missingOIDCScope.join(' '));
    if (missing.missingOIDCClaims) grant.addOIDCClaims(missing.missingOIDCClaims);
    if (missing.missingResourceScopes) {
      for (const [indicator, scopes] of Object.entries(missing.missingResourceScopes)) {
        grant.addResourceScope(indicator, scopes.join(' '));
      }
    }
    grantId = await grant.save();

    return provider.interactionFinished(req, res, {
      consent: details.grantId ? {} : { grantId },
    }, { mergeWithLastSubmission: true });
  } catch (error) {
    return next(error);
  }
});

app.get('/interaction/:uid/abort', async (req, res, next) => {
  try {
    await provider.interactionFinished(req, res, {
      error: 'access_denied',
      error_description: 'Authorization cancelled by user',
    }, { mergeWithLastSubmission: false });
  } catch (error) {
    next(error);
  }
});

app.get('/register', (req, res) => {
  const returnTo = safeReturnTo(req.query.return_to);
  const csrf = tokenFor('register:' + returnTo);
  res.type('html').send(layout('Create GodControl account', `
    <h1>Create GodControl account</h1>
    <form method="post" action="/register">
      <input type="hidden" name="return_to" value="${esc(returnTo)}">
      <input type="hidden" name="csrf" value="${esc(csrf)}">
      <label>Name</label><input name="name" maxlength="120" required>
      <label>Email</label><input name="email" type="email" autocomplete="username" required>
      <label>Password</label><input name="password" type="password" autocomplete="new-password" minlength="12" required>
      <button type="submit">Create account</button>
    </form>
    <p class="muted">Use a unique password of at least 12 characters.</p>`));
});

app.post('/register', formBody, async (req, res) => {
  const returnTo = safeReturnTo(req.body.return_to);
  if (!verifyToken('register:' + returnTo, req.body.csrf)) return res.status(400).send('Invalid form token');
  const ipKey = 'register:' + String(req.ip || 'unknown');
  if (!await throttleFailure(ipKey, 5, 3600)) return res.status(429).send('Too many registrations');

  try {
    await accounts.create({ email: req.body.email, password: req.body.password, name: req.body.name });
    return res.redirect(303, returnTo);
  } catch (error) {
    const message = /already exists/i.test(error.message) ? 'An account with that email already exists.' : 'Could not create account. Check the form and try again.';
    return res.status(400).type('html').send(layout('Create GodControl account', '<h1>Create GodControl account</h1><p class="error">' + esc(message) + '</p><p><a href="/register?return_to=' + encodeURIComponent(returnTo) + '">Try again</a></p>'));
  }
});

app.use(provider.callback());
app.use((error, _req, res, _next) => {
  console.error('Authorization error:', error?.message || 'unknown');
  if (res.headersSent) return;
  res.status(500).type('html').send(layout('Authorization error', '<h1>Authorization could not continue</h1><p>Please return to ChatGPT and try connecting again.</p>'));
});

const server = http.createServer(app);
server.listen(PORT, HOST, () => {
  console.log('GodControl OAuth listening on ' + HOST + ':' + PORT);
});

async function shutdown() {
  server.close(async () => {
    try { await redis.quit(); } finally { process.exit(0); }
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export { app, provider, redis, accounts, RESOURCE_SCOPES };
