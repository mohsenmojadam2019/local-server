# Threat model

Trust boundaries are the public HTTPS request, OAuth browser form, PostgreSQL, WebSocket agent, and local MCP. Assets are credentials, account/device ownership, file/process access, and queued output. Spoofing is addressed by OAuth/device credentials; tampering by TLS, parameterized SQL, and ownership checks; disclosure by hashing, redaction, bounded outputs, and loopback local MCP; denial of service by body caps/rate limits/timeouts; elevation by scopes and a fixed tool allowlist.

Residual risks: a compromised enrolled host can perform the local policy's actions, PostgreSQL backups contain sensitive metadata, and operators must secure deployment secrets and TLS keys.
