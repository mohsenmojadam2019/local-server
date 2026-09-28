# Security

OAuth uses Authorization Code + PKCE S256, exact redirect URI matching, resource binding, one-time authorization codes, hashed opaque access/refresh/device/enrollment credentials, refresh rotation, replay rejection, userinfo, rate limits, secure headers, bounded input/output, and redacted audit events. Production requires HTTPS and PostgreSQL. Local MCP remains loopback-only.

The public catalog is an allowlist of existing local MCP capabilities. There is no arbitrary command tool and no public route to local port 8787. Operators must restrict filesystem roots and local MCP bearer credentials independently.
