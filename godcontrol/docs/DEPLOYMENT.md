# Deployment

Use a dedicated production hostname such as `mcp.example.com`.

Run the Node hub on a private loopback port such as `127.0.0.1:8790`, terminate TLS at a production reverse proxy or cloud edge, and route `/mcp`, `/agent/connect`, and the well-known paths to the hub.

A VPS is optional. Any always-on platform that supports the MCP HTTP endpoint and long-lived WebSocket connections can host the hub. A serverless implementation with a durable WebSocket primitive is also possible.

The agent requires:
- the public hub WebSocket URL (recommended `wss://<host>/agent/connect`),
- an enrolled device token,
- the loopback local MCP URL/token,
- explicit read/write roots,
- an explicit executable allowlist.

When OpenAI provides the domain-verification token, set `OPENAI_APPS_CHALLENGE`. The hub serves exactly that value from `/.well-known/openai-apps-challenge`.


## Reverse-proxy hardening

Keep the hub bound to loopback and let the TLS reverse proxy own the public socket. Reject direct probes for dotfiles such as `.env` and `.git`, preserve `/.well-known/` for OAuth/domain verification, disable proxy buffering on MCP/WebSocket routes, and keep WebSocket read timeouts long enough for idle enrolled devices.
