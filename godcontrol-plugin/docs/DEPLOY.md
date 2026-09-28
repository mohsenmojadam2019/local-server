# Deployment

For `mcp.redcoweb.ir`, install the provided nginx configuration, keep the hub on `127.0.0.1:19091`, and use the already-issued certificate paths. Start PostgreSQL, apply the schema with `psql "$DATABASE_URL" -f godcontrol-plugin-schema.sql`, configure `.env`, and start the hub with systemd or Compose. Start the local MCP on loopback 8787 and enroll the agent using `node agent/enroll.js https://mcp.redcoweb.ir CODE`.

The OpenAI portal challenge/approval and operator identity are external prerequisites; this repository intentionally does not invent them. DNS is not changed here.
