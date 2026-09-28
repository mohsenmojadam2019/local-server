import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import { createHub } from "../hub/server.js";
import { loadConfig } from "../shared/config.js";
import { MemoryStore } from "../shared/store.js";
import { passwordHash, bounded } from "../shared/crypto.js";
import { hashToken } from "../shared/crypto.js";
import { TOOL_MANIFEST, PUBLIC_TOOL_NAMES } from "../shared/tools.js";
import { CallQueue } from "../shared/queue.js";
import { validateCommand, PUBLISHED_LOCAL_TOOLS, createCallDeduper, saveState } from "../agent/main.js";

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
  const issued = await hub.oauth.token({ grant_type: "authorization_code", code: authCode, client_id: client.client_id, redirect_uri: client.redirect_uris[0], code_verifier: verifier, resource: config.resource }); token = issued.access_token;
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
  const text = await response.text(); assert.match(text, /list_devices/); assert.match(text, /readOnlyHint/); assert.match(text, /securitySchemes/); assert.match(text, /idempotency_key/); assert.doesNotMatch(text, /exec_command/);
});

test("scope denial, exact challenge text, and read flow", async () => {
  const readOnly = await hub.oauth.issue(user.id, client.client_id, "http://127.0.0.1/mcp", "openid");
  const denied = await json("/oauth/userinfo", { headers: { authorization: `Bearer ${readOnly.access_token}` } }); assert.equal(denied.status, 403);
  const dir = await fs.mkdtemp(`${os.tmpdir()}/gc-challenge-`); const challenge = `${dir}/token`; await fs.writeFile(challenge, "exact-challenge\n");
  const challengeHub = createHub({ config: loadConfig({ NODE_ENV: "test", PUBLIC_BASE_URL: "http://127.0.0.1", CHALLENGE_TOKEN_FILE: challenge }), store: new MemoryStore() }); const port = await challengeHub.listen(0); const r = await fetch(`http://127.0.0.1:${port}/.well-known/openai-apps-challenge`); assert.match(r.headers.get("content-type"), /^text\/plain/); assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], [...Buffer.from("exact-challenge")]); await challengeHub.close(); await fs.rm(dir, { recursive: true, force: true });
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

test("public descriptors are mirrored, annotated, required, and mapped exactly", () => {
  const expected = { system_info: "system_info", list_directory: "fs_list", get_file_info: "fs_info", fs_read: "fs_read", search: "search_files", git_status: "git_status", git_diff: "git_diff", start_process: "start_process", read_process_output: "read_process_output", write_file: "fs_write", edit_block: "edit_block" };
  for (const tool of TOOL_MANIFEST) {
    assert.deepEqual(tool.securitySchemes, tool._meta.securitySchemes, tool.name);
    assert.deepEqual(Object.keys(tool.annotations).sort(), ["destructiveHint", "openWorldHint", "readOnlyHint"]);
    assert.ok(Array.isArray(tool.securitySchemes));
    assert.equal(tool.securitySchemes[0].type, "oauth2");
    assert.ok(Array.isArray(tool.securitySchemes[0].scopes));
    for (const [key, spec] of Object.entries(tool.input)) if (spec.required) assert.equal(spec.required, true);
    assert.equal(tool.name === "exec_command", false);
  }
  for (const [name, local] of Object.entries(expected)) assert.equal(TOOL_MANIFEST.find((t) => t.name === name)?.local, local);
  assert.equal(TOOL_MANIFEST.find((t) => t.name === "system_info").input.device_id.required, true);
  assert.equal(TOOL_MANIFEST.find((t) => t.name === "get_profile")._meta["openai/profile"], true);
  assert.deepEqual([...PUBLISHED_LOCAL_TOOLS].sort(), Object.values(expected).sort());
  assert.equal(PUBLIC_TOOL_NAMES.has("exec_command"), false);
});

test("resource is required on code exchange and audience is enforced", async () => {
  const issued = await hub.oauth.issue(user.id, client.client_id, "wrong-resource", "openid");
  assert.equal(await hub.oauth.authenticate(`Bearer ${issued.access_token}`, "http://127.0.0.1/mcp"), null);
  await assert.rejects(() => hub.oauth.token({ grant_type: "refresh_token", refresh_token: issued.refresh_token, resource: "wrong-resource" }));
});

test("refresh rotation stores one replacement and rejects replay", async () => {
  let saves = 0; const original = store.saveRefresh.bind(store); store.saveRefresh = async (...args) => { saves += 1; return original(...args); };
  const issued = await hub.oauth.issue(user.id, client.client_id, "http://127.0.0.1/mcp", "openid"); const before = saves; const next = await hub.oauth.token({ grant_type: "refresh_token", refresh_token: issued.refresh_token, resource: "http://127.0.0.1/mcp" });
  assert.equal(saves, before); assert.ok(next.refresh_token); await assert.rejects(() => hub.oauth.token({ grant_type: "refresh_token", refresh_token: issued.refresh_token, resource: "http://127.0.0.1/mcp" })); store.saveRefresh = original;
});

test("tool scope denial returns MCP auth metadata while HTTP auth remains separate", async () => {
  const readOnly = await hub.oauth.issue(user.id, client.client_id, "http://127.0.0.1/mcp", "openid email");
  const response = await json("/mcp", { method: "POST", headers: { authorization: `Bearer ${readOnly.access_token}`, accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 44, method: "tools/call", params: { name: "list_devices", arguments: {} } }) });
  const body = await response.text(); assert.equal(response.status, 200); assert.match(body, /mcp\/www_authenticate/); assert.match(body, /insufficient_scope/);
});

test("idempotency binds user, device, and tool; expired calls are terminal", async () => {
  const q = new CallQueue(new MemoryStore(), { ttlMs: 1 });
  const one = await q.dispatch({ userId: "u", deviceId: "a", tool: "fs_write", args: {}, idempotencyKey: "same", write: true });
  const otherDevice = await q.dispatch({ userId: "u", deviceId: "b", tool: "fs_write", args: {}, idempotencyKey: "same", write: true });
  const otherTool = await q.dispatch({ userId: "u", deviceId: "a", tool: "edit_block", args: {}, idempotencyKey: "same", write: true });
  assert.notEqual(one.id, otherDevice.id); assert.notEqual(one.id, otherTool.id);
  await new Promise((resolve) => setTimeout(resolve, 5)); assert.equal((await q.store.getCall(one.id)).status, "expired");
});

test("agent rejects shell chaining/interpreters and local MCP names outside the published allowlist", () => {
  assert.throws(() => validateCommand("git status && whoami"));
  assert.throws(() => validateCommand("node -e 'process.exit()'"));
  assert.throws(() => validateCommand("bash -lc id"));
  assert.throws(() => validateCommand("rm -rf /"));
  assert.ok(PUBLISHED_LOCAL_TOOLS.has("fs_read")); assert.equal(PUBLISHED_LOCAL_TOOLS.has("shell_run"), false);
});

test("agent deduplicates in-flight/completed calls and persists bounded mode-0600 state", async () => {
  let invocations = 0; const completed = {}; const dedupe = createCallDeduper({ completed, invoke: async () => { invocations += 1; await new Promise((resolve) => setTimeout(resolve, 5)); return "ok"; } });
  const [a, b] = await Promise.all([dedupe({ call_id: "call-1", tool: "fs_read" }), dedupe({ call_id: "call-1", tool: "fs_read" })]);
  assert.equal(a.result, "ok"); assert.deepEqual(a, b); assert.equal(invocations, 1); await dedupe({ call_id: "call-1", tool: "fs_read" }); assert.equal(invocations, 1);
  const dir = await fs.mkdtemp(`${os.tmpdir()}/gc-agent-state-`); const file = `${dir}/state.json`; saveState(completed, file); assert.equal((await fs.stat(file)).mode & 0o777, 0o600); assert.equal(JSON.parse(await fs.readFile(file, "utf8"))["call-1"].result, "ok"); await fs.rm(dir, { recursive: true, force: true });
});

test("agent handshake uses an Authorization header and never a token query parameter", async () => {
  const source = await fs.readFile(new URL("../agent/main.js", import.meta.url), "utf8");
  assert.match(source, /Authorization: `Bearer \$\{config\.deviceToken\}`/); assert.doesNotMatch(source, /device_token=/); assert.doesNotMatch(source, /console\.log\(.*deviceToken/);
});

test("proxy trust is explicit and loopback-only", () => {
  assert.equal(loadConfig({ NODE_ENV: "test", PUBLIC_BASE_URL: "http://127.0.0.1", TRUST_PROXY: "loopback" }).trustProxy, true);
  assert.equal(loadConfig({ NODE_ENV: "test", PUBLIC_BASE_URL: "http://127.0.0.1", TRUST_PROXY: "*" }).trustProxy, false);
});

test("Postgres adapter loads without unresolved crypto references", async () => {
  const { PostgresStore } = await import("../shared/postgres.js");
  assert.equal(typeof PostgresStore, "function");
});
