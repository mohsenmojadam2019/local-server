import { createHub } from "../hub/server.js";
const hub = createHub(); const port = await hub.listen(0); const base = `http://127.0.0.1:${port}`;
for (const path of ["/healthz", "/.well-known/oauth-protected-resource", "/.well-known/oauth-authorization-server"]) { const r = await fetch(base + path); if (!r.ok) throw new Error(`${path}: ${r.status}`); }
await hub.close(); console.log("smoke: PASS");
