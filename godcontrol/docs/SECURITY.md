# Security

## Security model

GodControl uses defense in depth. The public hub never receives the local MCP bearer token. The device agent reads that token from its environment and uses it only against `127.0.0.1`.

### End-user OAuth

Production uses an established OAuth 2.1/OIDC provider. Configure:

- `OIDC_ISSUER`
- `OIDC_JWKS_URI`
- `OIDC_AUDIENCE`

The hub verifies every protected tool request. Tokens must be short lived and scoped. OpenAI's MCP client uses Authorization Code + PKCE; the authorization server must advertise S256 and support the current MCP authorization contract.

### Device authentication

The agent uses `GODCONTROL_DEVICE_TOKEN`, a signed token identifying the owning user and device. In production it should be minted by an enrollment flow after the user authenticates. Do not commit it.

### Local policy

The agent requires explicit:

- `GODCONTROL_READ_ROOTS`
- `GODCONTROL_WRITE_ROOTS`
- `GODCONTROL_ALLOWED_COMMANDS`

Paths are canonicalized and must remain inside configured roots. Process execution is denied unless the executable is explicitly allowlisted.

### Secrets

Secrets belong in environment variables or 0600 service environment files. They must not be written to Git, tool output, audit logs or error responses.

### Audit

The hub audit stream records correlation metadata such as user ID, device ID, tool name, call ID, success/failure and timestamps. It deliberately does not record raw OAuth tokens, device tokens, local bearer tokens or file contents.

### Production hardening

- HTTPS only.
- Reverse proxy request-size and rate limits.
- Persist remote-call state in a durable store for multi-instance deployment.
- Rotate signing and OAuth credentials.
- Keep `GODCONTROL_DEV_AUTH` disabled. The hub refuses development auth when `NODE_ENV=production`.
- Keep local port 8787 bound to loopback.

## Process environment

The process tool uses `spawn(..., { shell: false })` and does not inherit the agent's full environment. By default only basic non-secret variables such as PATH, HOME, LANG, TERM, USER and TMPDIR are passed. Additional variables require an explicit `GODCONTROL_PROCESS_ENV_ALLOWLIST`; never allowlist GodControl/OAuth/device credential variables.


## Authorization server

The public authorization server uses Authorization Code with mandatory PKCE, DCR, short-lived JWT access tokens, rotating refresh tokens, persistent Redis state, signed secure cookies, and an explicit MCP resource audience. Passwords are stored with randomized scrypt hashes; plaintext passwords are never persisted. Login and registration attempts are rate-limited in Redis.

The authorization service and MCP resource server are separate trust boundaries. The MCP hub still validates issuer, audience, expiry, signature, and requested tool scope on every protected tool call.
