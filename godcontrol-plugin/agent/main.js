import fs from "node:fs";
import process from "node:process";
import { WebSocket } from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { cleanText, bounded } from "../shared/crypto.js";

const config = { hubUrl: process.env.HUB_URL, deviceToken: process.env.DEVICE_TOKEN, localUrl: process.env.LOCAL_MCP_URL ?? "http://127.0.0.1:8787/mcp", localBearer: process.env.LOCAL_BEARER_TOKEN ?? "", maxOutput: Number(process.env.MAX_RESULT_BYTES ?? 120000), configFile: process.env.AGENT_CONFIG_FILE ?? "" };
if (config.configFile) try { Object.assign(config, JSON.parse(fs.readFileSync(config.configFile, "utf8"))); } catch (e) { console.error("agent config unavailable"); }
export const backoff = (attempt) => Math.min(30_000, 500 * (2 ** Math.min(attempt, 6))) + Math.floor(Math.random() * 500);

export async function invokeLocal(tool, args) {
  const client = new Client({ name: "godcontrol-agent", version: "0.1.0" });
  const headers = config.localBearer ? { Authorization: `Bearer ${config.localBearer}` } : undefined;
  const transport = new StreamableHTTPClientTransport(new URL(config.localUrl), { requestInit: { headers } });
  await client.connect(transport); const result = await client.callTool({ name: tool, arguments: args }); await transport.close?.(); return bounded(result, config.maxOutput);
}
export function connectAgent({ WebSocketImpl = WebSocket, invoke = invokeLocal, sleep = ms => new Promise(r => setTimeout(r, ms)), logger = console } = {}) {
  let attempt = 0; let stopped = false; let ws;
  const loop = async () => { while (!stopped) { try { const url = `${config.hubUrl.replace(/\/$/, "")}/agent/connect?device_token=${encodeURIComponent(config.deviceToken)}`; ws = new WebSocketImpl(url); await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); }); attempt = 0; ws.send(JSON.stringify({ type: "status", status: { online: true, capabilities: ["mcp", "filesystem", "git", "process"] } })); const heartbeat = setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ type: "status", status: { online: true } })), 20_000); await new Promise(resolve => { ws.on("message", async data => { try { const msg = JSON.parse(data.toString()); if (msg.type !== "call" && msg.type !== "wake") return; if (msg.type === "wake") return; const result = await invoke(msg.tool, msg.args ?? {}); ws.send(JSON.stringify({ type: "result", call_id: msg.call_id, result: cleanText(result) })); } catch (e) { ws.send(JSON.stringify({ type: "result", call_id: (() => { try { return JSON.parse(data.toString()).call_id; } catch { return "unknown"; } })(), error: "local call failed" })); } }); ws.once("close", resolve); ws.once("error", resolve); }); clearInterval(heartbeat); } catch (e) { logger.error?.("agent connection failed"); } if (!stopped) await sleep(backoff(attempt++)); } };
  loop(); return { stop: () => { stopped = true; ws?.close(); } };
}
if (import.meta.url === `file://${process.argv[1]}`) connectAgent();
