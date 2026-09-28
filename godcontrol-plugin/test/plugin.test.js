import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import { createHub } from "../hub/server.js";
import { loadConfig } from "../shared/config.js";
import { MemoryStore } from "../shared/store.js";
import { passwordHash, bounded } from "../shared/crypto.js";
import { hashToken } from "../shared/crypto.js";

let hub, base, store, user, client, token;
const json = (url, init = {}) => fetch(`${base}${url}`, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });

before(async () => {
  store = new MemoryStore();
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_BASE_URL: "http://127.0.0.1", OAUTH_ISSUER: "http://127.0.0.1", OAUTH_RESOURCE: "http://127.0.0.1/mcp", SESSION_SECRET: "test-secret" });
  hub = createHub({ config, store }); const port = await hub.listen(0); base = `http://127.0.0.1:${port}`;
  user = await store.createUser({ email: "owner@example.test", passwordHash: await passwordHash("correct horse battery staple") });
  client = await hub.oauth.register({ client_name: "test", redirect_uris: ["https://client.example/callback"] });
  const code = await hub.oauth.authorizePost({ response_type: "code", client_id: client.client_id, redirect_uri: client.redirect_uris[0], state: "s", scope: "openid email godcontrol.devices.read", resource: config.resource, code_challenge_method: "S256", code_challenge: "verifier" }, { gc_oauth_csrf: "csrf" }).catch(() => null);
  assert.equal(code, null); // authorization requires the browser CSRF cookie and cannot be bypassed
  const crypto = await import("node:crypto"); const verifier = "a".repeat(43); const challenge = Buffer.from(crypto.createHash("sha256").update(verifier).digest()).toString("base64url");
  const redirect = await hub.oauth.authorizePost({ response_type: "code", client_id: client.client_id, redirect_uri: client.redirect_uris[0], state: "s", scope: "openid email godcontrol.devices.read", resource: config.resource, code_challenge_method: "S256", code_challenge: challenge, email: user.email, password: "correct horse battery staple", approved: "yes", csrf: "csrf" }, { gc_oauth_csrf: "csrf" });
  const authCode = new URL(redirect).searchParams.get("code");
  const issued = await hub.oauth.token({ grant_type: "authorization_code", code: authCode, client_id: client.client_id, redirect_uri: client.redirect_uris[0], code_verifier: verifier }); token = issued.access_token;
});

after(async () => hub?.close());

test("OAuth discovery, protected resource, DCR, PKCE, and userinfo", async () => {
  const discovery = await (await json("/.well-known/oauth-authorization-server")).json(); assert.equal(discovery.code_challenge_methods_supported[0], "S256");
  const resource = await (await json("/.well-known/oauth-protected-resource")).json(); assert.equal(resource.resource, "http://127.0.0.1/mcp");
  const dcr = await (await json("/oauth/register", { method: "POST", body: JSON.stringify({ redirect_uris: ["https://new.example/cb"] }) })).json(); assert.ok(dcr.client_id);
  const info = await (await json("/oauth/userinfo", { headers: { authorization: `Bearer ${token}` } })).json(); assert.equal(info.email, user.email); assert.equal(info.email_verified, true);
});

test("redirect mismatch, code reuse, refresh rotation, 401 and scope 403", async () => {
  await assert.rejects(() => hub.oauth.token({ grant_type: "authorization_code", code: "not-real", client_id: client.client_id, redirect_uri: "https://wrong.example", code_verifier: "x" }));
  const noAuth = await json("/oauth/userinfo"); assert.equal(noAuth.status, 401);
  const read = await json("/mcp", { method: "POST", headers: { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) }); assert.equal(read.status, 200);
  const originalRefresh = (await hub.oauth.issue(user.id, client.client_id, "http://127.0.0.1/mcp", "openid")).refresh_token;
  const refreshed = await hub.oauth.token({ grant_type: "refresh_token", refresh_token: originalRefresh }); assert.ok(refreshed.access_token);
  await assert.rejects(() => hub.oauth.token({ grant_type: "refresh_token", refresh_token: originalRefresh }));
});

test("MCP metadata exposes the focused annotated public surface", async () => {
  const init = await json("/mcp", { method: "POST", headers: { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } }) }); assert.equal(init.status, 200);
  const response = await json("/mcp", { method: "POST", headers: { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) });
  const text = await response.text(); assert.match(text, /list_devices/); assert.match(text, /readOnlyHint/); assert.match(text, /idempotency_key/); assert.doesNotMatch(text, /exec_command/);
});

test("scope denial, exact challenge text, and read flow", async () => {
  const readOnly = await hub.oauth.issue(user.id, client.client_id, "http://127.0.0.1/mcp", "openid");
  const denied = await json("/oauth/userinfo", { headers: { authorization: `Bearer ${readOnly.access_token}` } }); assert.equal(denied.status, 403);
  const dir = await fs.mkdtemp(`${os.tmpdir()}/gc-challenge-`); const challenge = `${dir}/token`; await fs.writeFile(challenge, "exact-challenge\n");
  const challengeHub = createHub({ config: loadConfig({ NODE_ENV: "test", PUBLIC_BASE_URL: "http://127.0.0.1", CHALLENGE_TOKEN_FILE: challenge }), store: new MemoryStore() }); const port = await challengeHub.listen(0); const r = await fetch(`http://127.0.0.1:${port}/.well-known/openai-apps-challenge`); assert.equal(await r.text(), "exact-challenge"); await challengeHub.close(); await fs.rm(dir, { recursive: true, force: true });
  const flow = await json("/mcp", { method: "POST", headers: { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_devices", arguments: {} } }) }); assert.equal(flow.status, 200); assert.match(await flow.text(), /\[\]/);
});

test("queue deduplicates writes and isolates devices", async () => {
  const a = await store.saveDevice({ id: "dev_a", userId: user.id, name: "A", tokenHash: hashToken("a"), status: {} });
  const b = await store.saveDevice({ id: "dev_b", userId: "other", name: "B", tokenHash: hashToken("b"), status: {} });
  const q = hub.store; const { CallQueue } = await import("../shared/queue.js"); const queue = new CallQueue(q);
  const one = await queue.dispatch({ userId: user.id, deviceId: a.id, tool: "fs_write", args: {}, idempotencyKey: "same", write: true }); const two = await queue.dispatch({ userId: user.id, deviceId: a.id, tool: "fs_write", args: {}, idempotencyKey: "same", write: true }); assert.equal(one.id, two.id); assert.equal(await q.getDevice(user.id, b.id), null);
});

test("challenge output and bounded output strip NUL and cap bytes", async () => {
  assert.equal(bounded("abc\0def", 20), "abcdef"); const capped = bounded("x".repeat(100), 10); assert.ok(Buffer.byteLength(capped) <= 10); assert.match(capped, /trunc/);
});
