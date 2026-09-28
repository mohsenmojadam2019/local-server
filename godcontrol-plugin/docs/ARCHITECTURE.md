# Architecture

`ChatGPT -> HTTPS nginx -> Streamable HTTP MCP/OAuth hub -> PostgreSQL remote_calls -> outbound WebSocket agent -> 127.0.0.1:8787 local MCP`.

The hub binds loopback (19091 in deployment). Nginx terminates TLS and forwards HTTP and WebSocket traffic. A remote call is claimed atomically, sent to only the enrolled device selected by ownership checks, and completed once. Reconnect recovery claims pending or stale executing calls. Idempotency hashes are scoped to the user.
