# GodControl second production audit report

## Result

The second adversarial audit is implemented on `godcontrol-public-plugin`. No merge with `main` was performed. The public package remains on `@modelcontextprotocol/sdk` 1.30.x: current official OpenAI plugin documentation accepts the v1 SDK contract, and migrating to v2 was not necessary for these correctness and security fixes. The MCP list handler adds the top-level security scheme explicitly because SDK v1 serializes `_meta` but does not serialize that newer extension field itself.

## Audit fixes

- Tool OAuth metadata is now `[ { type: "oauth2", scopes: [...] } ]` at top level and an exact `_meta.securitySchemes` mirror; all public tools include `readOnlyHint`, `openWorldHint`, and `destructiveHint`.
- Required schemas are enforced at the Zod boundary. Every remote operation requires `device_id`, `system_info` is mapped to local `system_info`, and write/process calls require `idempotency_key`.
- Call IDs bind `userId`, `deviceId`, local tool, and idempotency key. Existing calls re-check that context. Pending/executing calls transition deterministically to `expired`.
- Agent WebSocket authentication uses an `Authorization: Bearer` handshake header only. Device tokens are not placed in URLs or logs.
- Agent calls have a fixed published-local-tool allowlist, in-flight dedupe, bounded TTL/cap completed-result/error cache, atomic mode-0600 persistence, and restart-safe replay suppression.
- `start_process` is defense-in-depth restricted by configurable executable allowlist. Shell metacharacters, chaining, substitution, newlines, generic shells/interpreters, and inline `node/python` execution are rejected by default; the public annotation marks it state-changing/destructive and confirmation-required.
- Postgres imports `crypto` correctly, uses JSONB-compatible serialization, expiry/index support, and transactionally rotates refresh tokens exactly once. Memory and Postgres rotation semantics revoke the old token atomically, insert one replacement, save access once, and reject replay.
- OAuth authorization-code exchange requires exact `resource`; refresh resource is validated when supplied; access authentication verifies audience/resource. RFC 9207 issuer-response support is truthfully advertised as `false`, and successful redirects omit `iss`.
- HTTP 401 retains `WWW-Authenticate`; insufficient-scope tool calls return an MCP error with `_meta["mcp/www_authenticate"]`, resource metadata, error, description, and required scope.
- `TRUST_PROXY=loopback` is explicit and trusts only loopback nginx hops. Publisher, support, and website fields are configurable (`SUPPORT_EMAIL`, `PUBLISHER_NAME`, `WEBSITE_URL`). Public support/privacy/terms content is review-ready without hardcoded personal contact details.
- Redacted audit events cover enrollment creation/consumption, device connect/disconnect, remote dispatch/completion/failure, OAuth code/access/refresh issuance, authentication failures, and scope denials. Tokens, passwords, OAuth codes, file contents, and command contents are not written to audit metadata.
- Structured outputs were added for `list_devices`, `status`, `create_enrollment_code`, and `get_profile`; variable local output uses a bounded envelope where practical. `get_profile` is authenticated, advertises `_meta.openai/profile=true`, requires `openid email`, and returns `id`, `name`, `email`, and `nickname`.
- Challenge output is exact plain text bytes with no JSON or newline. Schema indexes cover idempotency context, expiry, and audit lookup. The exact local mappings were verified against `/home/god/godcontrol-mcp`: `system_info`, `fs_list`, `fs_info`, `fs_read`, `search_files`, `git_status`, `git_diff`, `start_process`, `read_process_output`, `fs_write`, and `edit_block`.

## Verification results

From `godcontrol-plugin/`:

- `npm install` — PASS; dependencies up to date, 0 vulnerabilities.
- `npm test` — PASS; 16 tests, 16 passed.
- `npm run check` — PASS.
- `npm run build` — PASS.
- `npm run lint` — PASS.
- `npm audit --omit=dev` — PASS; 0 vulnerabilities.
- `npm run smoke` — PASS.
- `npm run doctor` — PASS on Node v22.23.2.

From the repository root:

- `npm test` — PASS; 19 tests, 19 passed.
- `npm run check` — PASS.

The adversarial tests cover wire-visible security schemes, mirror equality, annotations, required arguments, no arbitrary exec publication, exact local mappings, resource/audience mismatch, refresh replacement/replay, tool-level OAuth metadata, idempotency isolation, deterministic expiry, agent header-only transport, allowlist/shell policy, in-flight and persisted dedupe, mode-0600 state, proxy trust, challenge bytes, and Postgres adapter loading.

## Deployment notes

Apply `godcontrol-plugin/godcontrol-plugin-schema.sql` to PostgreSQL before production use. Set `SUPPORT_EMAIL=hello@redcoweb.ir` in the production environment when the operator is ready; it is intentionally not hardcoded. Set `TRUST_PROXY=loopback` only behind directly connected loopback nginx. Configure `AGENT_STATE_FILE` and review `AGENT_ALLOWED_COMMANDS` before enabling process control.
