import fs from "node:fs";
const [hub, code, name = "GodControl device"] = process.argv.slice(2);
if (!hub || !code) { console.error("usage: node agent/enroll.js HUB_URL CODE [NAME]"); process.exit(2); }
const res = await fetch(`${hub.replace(/\/$/, "")}/agent/enroll`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name }) });
if (!res.ok) { console.error("enrollment failed"); process.exit(1); }
const value = await res.json();
const target = process.env.AGENT_CONFIG_FILE;
if (target) { fs.mkdirSync(new URL(".", `file://${target}`).pathname, { recursive: true }); fs.writeFileSync(target, JSON.stringify({ hubUrl: value.hub_url, deviceToken: value.device_token, localUrl: process.env.LOCAL_MCP_URL ?? "http://127.0.0.1:8787/mcp", localBearer: process.env.LOCAL_BEARER_TOKEN ?? "" }, null, 2), { mode: 0o600 }); }
console.log(JSON.stringify({ device_id: value.device_id, hub_url: value.hub_url, config_file: target ?? null }, null, 2));
