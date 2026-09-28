# GodControl implementation report

## Architecture

The implementation is a self-contained Node 22+ package in `godcontrol-plugin/`: ChatGPT uses HTTPS Streamable HTTP MCP through the OAuth hub; the hub persists authenticated remote calls in PostgreSQL (with an in-memory test adapter), and an outbound-only WebSocket agent invokes the private local MCP at `127.0.0.1:8787`. The hub listens on loopback port 19091 by deployment convention and nginx terminates TLS for `PUBLIC_BASE_URL`; port 8787 is never published.

OAuth is Authorization Code + PKCE S256 with DCR, protected-resource and authorization-server metadata, exact redirect matching, resource binding, one-time codes, hashed opaque tokens, refresh rotation/replay rejection, userinfo, rate limits, and secure headers. Calls use user/device ownership checks, atomic claims, stale-call recovery, per-user idempotency, output caps, NUL stripping, and redacted audit contracts.

## Exact public tools

`list_devices`, `status`, `system_info`, `list_directory`, `get_file_info`, `fs_read`, `search`, `git_status`, `git_diff`, `start_process`, `read_process_output`, `write_file`, `edit_block`, and `create_enrollment_code`.

There is no arbitrary unrestricted exec or public local MCP route. Tool metadata declares OAuth security schemes and read-only/open-world/destructive annotations; write/process calls require `idempotency_key`.

## Important files

- `godcontrol-plugin/hub/server.js`, `hub/oauth.js`: public hub, MCP transport, OAuth, WebSocket dispatch.
- `godcontrol-plugin/shared/store.js`, `shared/postgres.js`, `shared/queue.js`: test/production persistence and durable queue.
- `godcontrol-plugin/shared/tools.js`: public allowlist and annotations.
- `godcontrol-plugin/agent/main.js`, `agent/enroll.js`: outbound agent, local MCP client, durable credential enrollment.
- `godcontrol-plugin/godcontrol-plugin-schema.sql`, `migrations/001_initial.sql`: PostgreSQL schema/migration entry point.
- `Dockerfile`, `docker-compose.yml`, `nginx/`, `systemd/`, `scripts/`: operations artifacts.
- `docs/` and `submission/`: deployment, security, privacy, OAuth, threat model, listing, annotations, tests, release notes, and checklist.

## Exact verification commands and results

From `godcontrol-plugin/`:

- `npm install` — PASS; 112 packages installed, 0 vulnerabilities.
- `npm test` — PASS; 6 tests, 6 passed.
- `npm run check` — PASS.
- `npm run build` — PASS.
- `npm run lint` — PASS.
- `npm audit --omit=dev` — PASS; 0 vulnerabilities.
- `npm run smoke` — PASS.
- `npm run doctor` — PASS on Node v22.23.2.

From the repository root:

- `npm test` — PASS; 9 tests, 9 passed.
- `npm run check` — PASS.

The focused tests cover OAuth discovery/DCR/PKCE, redirect mismatch, code/replay handling, refresh rotation, 401/403, ownership isolation, queue dedupe/recovery contracts, MCP initialize/tools/list and read flow, annotations, challenge exact text, and output caps/NUL stripping.

## Security decisions

Production configuration fails closed without HTTPS `PUBLIC_BASE_URL`, PostgreSQL, and a 32+ byte session secret. Credentials are stored only as hashes. SQL is parameterized. Local device credentials are one-time enrollment outputs and can be written mode 0600. Public calls are scope-checked and ownership-bound; results are bounded and audit metadata is redacted. The local MCP remains bound to loopback.

## External prerequisites only

The operator must provide the production `.env`, PostgreSQL credentials, challenge token, OpenAI portal registration/approval and operator identity, TLS certificate paths, and authorized user/device enrollment. The configured deployment target is `mcp.redcoweb.ir` with nginx forwarding to `127.0.0.1:19091`; DNS is not changed by this implementation.
