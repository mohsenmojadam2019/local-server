import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { WebSocket } from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { cleanText, bounded } from "../shared/crypto.js";
import { TOOL_MANIFEST } from "../shared/tools.js";

const baseConfig = { hubUrl: process.env.HUB_URL, deviceToken: process.env.DEVICE_TOKEN, localUrl: process.env.LOCAL_MCP_URL ?? "http://127.0.0.1:8787/mcp", localBearer: process.env.LOCAL_BEARER_TOKEN ?? "", maxOutput: Number(process.env.MAX_RESULT_BYTES ?? 120000), configFile: process.env.AGENT_CONFIG_FILE ?? "", stateFile: process.env.AGENT_STATE_FILE ?? "", completedTtlMs: Number(process.env.AGENT_COMPLETED_TTL_MS ?? 86_400_000), completedCap: Number(process.env.AGENT_COMPLETED_CAP ?? 256), allowedCommands: String(process.env.AGENT_ALLOWED_COMMANDS ?? "pwd,ls,find,git").split(",").map((x) => x.trim()).filter(Boolean) };
if (baseConfig.configFile) try { Object.assign(baseConfig, JSON.parse(fs.readFileSync(baseConfig.configFile, "utf8"))); } catch { /* enrollment may populate it later */ }
if (!baseConfig.stateFile) baseConfig.stateFile = baseConfig.configFile ? `${baseConfig.configFile}.state` : path.join(process.cwd(), ".godcontrol-agent-state.json");
export const config = baseConfig;
export const backoff = (attempt) => Math.min(30_000, 500 * (2 ** Math.min(attempt, 6))) + Math.floor(Math.random() * 500);
export const PUBLISHED_LOCAL_TOOLS = new Set(TOOL_MANIFEST.map((tool) => tool.local).filter(Boolean));

export function validateCommand(command, allowed = config.allowedCommands) {
  const value = String(command ?? "");
  if (!value || value.length > 2000 || /[;|&<>`\n\r]|\$\(|\$\{|\$\{/.test(value)) throw new Error("command contains forbidden shell syntax");
  const executable = value.trim().split(/\s+/, 1)[0];
  const base = path.basename(executable);
  if (["bash", "sh", "zsh", "dash", "node", "python", "python3", "perl", "ruby"].includes(base)) throw new Error("generic shell/interpreter commands are disabled");
  if (!allowed.includes(base) && !allowed.includes(executable)) throw new Error("command is not allowlisted");
  if (base === "git" && value.trim().split(/\s+/)[1] && !["status", "diff", "log", "show", "branch", "rev-parse"].includes(value.trim().split(/\s+/)[1]) && !allowed.includes("git:any")) throw new Error("git write operations are disabled by default");
  if (/^(node|python|python3)\s+-[ec]\b/.test(value)) throw new Error("inline interpreter execution is disabled");
  return value;
}

export async function invokeLocal(tool, args) {
  if (!PUBLISHED_LOCAL_TOOLS.has(tool)) throw new Error("local tool is not published");
  if (tool === "start_process") validateCommand(args?.command);
  const client = new Client({ name: "godcontrol-agent", version: "0.1.0" });
  const headers = config.localBearer ? { Authorization: `Bearer ${config.localBearer}` } : undefined;
  const transport = new StreamableHTTPClientTransport(new URL(config.localUrl), { requestInit: { headers } });
  try { await client.connect(transport); const result = await client.callTool({ name: tool, arguments: args }); return bounded(result, config.maxOutput); } finally { await transport.close?.(); }
}

export function loadState(file = config.stateFile) { try { const value = JSON.parse(fs.readFileSync(file, "utf8")); return value && typeof value === "object" ? value : {}; } catch { return {}; } }
export function saveState(completed, file = config.stateFile) { const now = Date.now(); const entries = Object.entries(completed).filter(([, value]) => value?.completedAt > now - config.completedTtlMs).sort((a, b) => a[1].completedAt - b[1].completedAt).slice(-config.completedCap); const dir = path.dirname(file); fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); const tmp = `${file}.tmp-${process.pid}`; fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(entries)), { mode: 0o600 }); fs.chmodSync(tmp, 0o600); fs.renameSync(tmp, file); }
export function createCallDeduper({ completed = {}, invoke, persist = () => {} }) {
  const inFlight = new Map();
  return async (msg) => {
    if (completed[msg.call_id]) return completed[msg.call_id];
    if (inFlight.has(msg.call_id)) return inFlight.get(msg.call_id);
    const work = Promise.resolve().then(() => invoke(msg.tool, msg.args ?? {})).then((result) => ({ result: cleanText(result) }), () => ({ error: "local call failed" }));
    inFlight.set(msg.call_id, work); const value = await work; inFlight.delete(msg.call_id); completed[msg.call_id] = { ...value, completedAt: Date.now() }; persist(completed); return value;
  };
}

export function connectAgent({ WebSocketImpl = WebSocket, invoke = invokeLocal, sleep = ms => new Promise((r) => setTimeout(r, ms)), logger = console } = {}) {
  let attempt = 0; let stopped = false; let ws; const state = loadState(); const completed = state.completed ?? state;
  saveState(completed);
  const sendResult = (callId, value) => { if (ws?.readyState === 1) ws.send(JSON.stringify({ type: "result", call_id: callId, ...(value.error ? { error: value.error } : { result: value.result }) })); };
  const dedupe = createCallDeduper({ completed, invoke: async (tool, args) => { if (!PUBLISHED_LOCAL_TOOLS.has(tool)) throw new Error("local tool is not published"); if (tool === "start_process") validateCommand(args?.command); return invoke(tool, args); }, persist: saveState });
  const handleCall = async (msg) => sendResult(msg.call_id, await dedupe(msg));
  const loop = async () => { while (!stopped) { try { const url = `${config.hubUrl.replace(/\/$/, "")}/agent/connect`; ws = new WebSocketImpl(url, { headers: { Authorization: `Bearer ${config.deviceToken}` } }); await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); }); attempt = 0; ws.send(JSON.stringify({ type: "status", status: { online: true, capabilities: ["mcp", "filesystem", "git", "process"] } })); const heartbeat = setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ type: "status", status: { online: true } })), 20_000); await new Promise((resolve) => { ws.on("message", async (data) => { try { const msg = JSON.parse(data.toString()); if (msg.type === "call") await handleCall(msg); else if (msg.type === "wake") ws.send(JSON.stringify({ type: "status", status: { online: true } })); } catch { /* never log tokens or command content */ } }); ws.once("close", resolve); ws.once("error", resolve); }); clearInterval(heartbeat); } catch { logger.error?.("agent connection failed"); } if (!stopped) await sleep(backoff(attempt++)); } };
  loop(); return { stop: () => { stopped = true; ws?.close(); } };
}
if (import.meta.url === `file://${process.argv[1]}`) connectAgent();
