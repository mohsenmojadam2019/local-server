# GodControl architecture

GodControl follows the proven remote-device pattern used by published remote MCP products:

```
ChatGPT / Codex
      |
      | MCP over HTTPS + OAuth 2.1
      v
GodControl Hub
      |
      | authenticated outbound WebSocket
      v
GodControl Agent
      |
      | loopback-only MCP
      v
127.0.0.1:8787/mcp
```

The local MCP is never exposed to the public internet. The device agent initiates the only device-to-hub connection.

## Components

- **Hub** — public HTTPS MCP resource server, OAuth enforcement, tool catalog, device routing, audit metadata, request dedupe/replay.
- **Agent** — outbound-only WebSocket client. It validates path and command policy before forwarding calls to the local MCP.
- **Local MCP** — the existing GodControl server on loopback, protected by its own bearer token.
- **Identity provider** — an established OAuth/OIDC provider. The hub validates JWT access tokens with issuer, audience, expiry and scopes.

## Reliability

Every remote call has a UUID `callId`. Pending calls remain queued in the hub registry until completion or timeout. When an agent reconnects, pending calls for that user/device are replayed. The agent caches recently completed call results and returns the same result for duplicate `callId` values.

The in-memory registry is appropriate for development and a single hub process. Production multi-instance deployment should replace it with a durable adapter such as Redis/Postgres/Cloudflare Durable Objects while preserving the same call state machine.

## Trust boundaries

1. ChatGPT authenticates the end user with OAuth.
2. The hub authorizes requested tool scopes.
3. The hub routes only to devices owned by the authenticated user.
4. The agent authenticates separately with a signed device token.
5. The agent enforces local path/command policy.
6. The local MCP enforces its own bearer token and server-side policies.
