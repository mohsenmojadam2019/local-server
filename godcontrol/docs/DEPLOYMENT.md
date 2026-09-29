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


## OAuth authorization server

For a public plugin, deploy the included standards-based authorization service on a separate HTTPS origin such as `https://auth.example.com`.

The service uses `oidc-provider` with Authorization Code + mandatory PKCE S256, Dynamic Client Registration, refresh-token rotation, RFC 8707 resource indicators, JWT access tokens, and persistent Redis-backed OAuth state. The hub validates those JWTs independently using the authorization server's JWKS.

Production requires:
- a dedicated Redis instance reachable only from localhost/private networking;
- persistent Redis storage;
- a durable private JWKS file;
- at least two cookie signing keys;
- a form-signing secret;
- TLS on the authorization hostname.

Configure the MCP hub with the same `OIDC_ISSUER`, the authorization server's `jwks_uri`, and `OIDC_AUDIENCE` equal to the MCP resource URL. Never expose Redis publicly.


## Trusted SSH tunnel mode

For an owner-controlled workstation that already has authenticated SSH access to the hub host, GodControl can avoid copying a device bearer token onto the workstation.

On the hub, configure:

```ini
GODCONTROL_INTERNAL_AGENT_PORT=19093
GODCONTROL_INTERNAL_AGENT_USER_FILE=/etc/godcontrol/owner-id
```

The internal listener binds only to `127.0.0.1`. It is not exposed by Nginx and is not reachable from the public Internet.

On the workstation, forward the hub's loopback listener over authenticated SSH:

```bash
ssh -N -L 127.0.0.1:19093:127.0.0.1:19093 user@mcp-host.example.com
```

Then configure the agent:

```ini
GODCONTROL_HUB_WS=ws://127.0.0.1:19093/agent/internal
GODCONTROL_TRUSTED_TUNNEL=true
GODCONTROL_DEVICE_ID=my-workstation
GODCONTROL_DEVICE_NAME=My Workstation
```

Trusted-tunnel mode is deliberately accepted only when the agent URL is a loopback `ws://` address. The SSH connection authenticates and encrypts the transport; the internal listener maps the connection to the configured owner identity. Public MCP callers still authenticate normally with OAuth.

Use the included `deployment/godcontrol-ssh-tunnel.service` as a systemd user-service template. Keep host-key verification enabled and use a dedicated SSH key/agent identity with the minimum server permissions required for port forwarding.
