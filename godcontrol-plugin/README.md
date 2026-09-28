# GodControl public plugin

This package is a Node 22+ public MCP/OAuth hub plus a local outbound-only agent. ChatGPT connects to the HTTPS hub; the hub queues authenticated calls durably; the agent connects outward and invokes the private MCP at `127.0.0.1:8787`. Port 8787 is never published.

Copy `.env.example` to `.env`, set a real `PUBLIC_BASE_URL`, `OAUTH_RESOURCE`, 32+ byte `SESSION_SECRET`, PostgreSQL URL, and challenge token file. Apply `godcontrol-plugin-schema.sql`, then run `npm ci`, `npm test`, and `npm run smoke`.

See [DEPLOY.md](docs/DEPLOY.md), [OAUTH.md](docs/OAUTH.md), and [THREAT_MODEL.md](docs/THREAT_MODEL.md). The public tool catalog is defined in `shared/tools.js`; it contains no unrestricted exec tool.
