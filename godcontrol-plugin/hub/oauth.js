import crypto from "node:crypto";
import { hashToken, passwordVerify, randomToken } from "../shared/crypto.js";
import { parseScopes, SCOPES } from "../shared/scopes.js";

const b64 = (input) => Buffer.from(input).toString("base64url");
const pkce = (verifier) => b64(crypto.createHash("sha256").update(verifier).digest());
const html = (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export class OAuthService {
  constructor(store, config) { this.store = store; this.config = config; }
  metadata() { return { issuer: this.config.issuer, authorization_endpoint: `${this.config.issuer}/oauth/authorize`, token_endpoint: `${this.config.issuer}/oauth/token`, registration_endpoint: `${this.config.issuer}/oauth/register`, userinfo_endpoint: `${this.config.issuer}/oauth/userinfo`, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], scopes_supported: SCOPES, client_id_metadata_document_supported: false, resource_indicators_supported: true, authorization_response_iss_parameter_supported: true }; }
  protectedResource() { return { resource: this.config.resource, authorization_servers: [this.config.issuer], scopes_supported: SCOPES, bearer_methods_supported: ["header"] }; }
  async register(input) {
    const uris = Array.isArray(input.redirect_uris) ? input.redirect_uris : [];
    if (!uris.length || uris.some(uri => { try { const u = new URL(uri); return u.protocol !== "https:" && !(u.hostname === "localhost" || u.hostname === "127.0.0.1"); } catch { return true; } })) throw new Error("redirect_uris must be HTTPS, except localhost loopback development URIs");
    const client = { client_id: `gc_${randomToken(18)}`, client_name: String(input.client_name ?? "GodControl client"), redirect_uris: uris, token_endpoint_auth_method: "none", createdAt: Date.now() };
    await this.store.saveClient(client); return client;
  }
  validateAuthorize(q) {
    const requested = parseScopes(q.scope);
    if (q.response_type !== "code" || !q.client_id || !q.redirect_uri || !q.state || q.code_challenge_method !== "S256" || !q.code_challenge || !requested.includes("openid") || requested.length !== String(q.scope ?? "").split(/\s+/).filter(Boolean).length) throw new Error("invalid authorization request");
    if (q.resource !== this.config.resource) throw new Error("invalid resource");
  }
  async authorizeForm(q, req, res) {
    this.validateAuthorize(q); const client = await this.store.getClient(q.client_id); if (!client || !client.redirect_uris.includes(q.redirect_uri)) throw new Error("invalid client or redirect_uri");
    const csrf = randomToken(16); res.cookie("gc_oauth_csrf", csrf, { httpOnly: true, sameSite: "lax", secure: this.config.secureCookies });
    const hidden = Object.entries({ ...q, csrf }).map(([k, v]) => `<input type="hidden" name="${html(k)}" value="${html(v)}">`).join("");
    res.type("html").send(`<!doctype html><title>GodControl authorization</title><h1>Authorize GodControl</h1><p>${html(client.client_name)}</p><form method="post" action="/oauth/authorize">${hidden}<label>Email <input name="email" type="email" required autocomplete="username"></label><label>Password <input name="password" type="password" required autocomplete="current-password"></label><label><input type="checkbox" name="approved" value="yes" required> Allow requested access (${html(q.scope ?? "")})</label><button>Continue</button></form>`);
  }
  async authorizePost(body, cookies) {
    this.validateAuthorize(body); if (!body.csrf || body.csrf !== cookies.gc_oauth_csrf) throw new Error("invalid CSRF token"); if (body.approved !== "yes") throw new Error("consent required");
    const client = await this.store.getClient(body.client_id); if (!client || !client.redirect_uris.includes(body.redirect_uri)) throw new Error("invalid client or redirect_uri");
    const user = await this.store.getUserByEmail(body.email); if (!user || !(await passwordVerify(body.password, user.passwordHash))) throw new Error("invalid credentials");
    const code = randomToken(32); await this.store.saveAuthCode({ codeHash: hashToken(code), clientId: client.client_id, userId: user.id, redirectUri: body.redirect_uri, resource: body.resource, scope: parseScopes(body.scope).join(" "), codeChallenge: body.code_challenge, expiresAt: Date.now() + 60_000 });
    const url = new URL(body.redirect_uri); url.searchParams.set("code", code); url.searchParams.set("state", body.state); url.searchParams.set("iss", this.config.issuer); return url;
  }
  async token(body) {
    if (body.grant_type === "authorization_code") {
      if (!body.code || !body.client_id || !body.redirect_uri || !body.code_verifier) throw new Error("invalid token request");
      const record = await this.store.consumeAuthCode(hashToken(body.code)); if (!record || record.clientId !== body.client_id || record.redirectUri !== body.redirect_uri || pkce(body.code_verifier) !== record.codeChallenge) throw new Error("invalid authorization code");
      return await this.issue(record.userId, record.clientId, record.resource, record.scope);
    }
    if (body.grant_type === "refresh_token") {
      const old = await this.store.getRefresh(body.refresh_token); if (!old || old.revokedAt || old.expiresAt < Date.now()) throw new Error("invalid refresh token");
      const result = await this.issue(old.userId, old.clientId, old.resource, old.scope); const rotated = await this.store.rotateRefresh(body.refresh_token, { tokenHash: hashToken(result.refresh_token), userId: old.userId, clientId: old.clientId, resource: old.resource, scope: old.scope, expiresAt: Date.now() + this.config.refreshTtlMs }); if (!rotated) throw new Error("invalid refresh token"); return result;
    }
    throw new Error("unsupported grant_type");
  }
  async issue(userId, clientId, resource, scope) { const access_token = randomToken(32); const refresh_token = randomToken(48); await this.store.saveAccess({ tokenHash: hashToken(access_token), userId, clientId, resource, scope, expiresAt: Date.now() + this.config.accessTtlMs }); await this.store.saveRefresh({ tokenHash: hashToken(refresh_token), userId, clientId, resource, scope, expiresAt: Date.now() + this.config.refreshTtlMs }); return { access_token, token_type: "Bearer", expires_in: Math.floor(this.config.accessTtlMs / 1000), refresh_token, scope }; }
  async authenticate(header, resource) { if (!header?.startsWith("Bearer ")) return null; const token = await this.store.getAccess(header.slice(7)); return token?.resource === resource ? token : null; }
  async userinfo(token) { const user = await this.store.getUser(token.userId); return { sub: user.id, email: user.email, email_verified: Boolean(user.emailVerified) }; }
}
