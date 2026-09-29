# GodControl / `god` Operational Context

This file is the canonical, non-secret operational context for AI assistants and maintainers working with this repository.

## Primary local machine

- Hostname: `god`
- Current SentinelX host ID: `host_f7a9010ed0574a3b`
- If the host ID changes, locate the active SentinelX host by hostname `god`.
- `god` is the primary local workstation. Prefer it for local filesystem, Git, terminal, service, build, and project work.
- A VPS may also appear in SentinelX. Do not treat the VPS as the primary workstation unless the task is specifically about GodControl infrastructure or the VPS.

## Tool routing for ChatGPT

When a user asks to inspect, fix, change, build, test, restart, push, or otherwise act on the local machine:

1. Use **SentinelX** first for the `god` host.
2. Use SentinelX for local files, shell commands, local Git, services, builds, tests, and process inspection.
3. Use the **GitHub connector** for remote repository operations such as branches, pull requests, merges, CI status, and remote repository inspection.
4. Use Remote Desktop Commander only when GUI interaction is specifically required and the tool is available.
5. Do not ask the user to run commands manually when the same action can be performed through SentinelX.
6. Before claiming local access is unavailable, check SentinelX host status.
7. Never print passwords, OAuth tokens, device tokens, SSH private keys, or other secrets in chat.

## GodControl identity

- Project: `GodControl`
- Local device ID: `god-local`
- GitHub repository: `mohsenmojadam2019/local-server`
- Local repository: `/home/god/local-server`
- GodControl source: `/home/god/local-server/godcontrol`
- Local configuration/state: `/home/god/.config/godcontrol/`
- Persistent local state note: `/home/god/.config/godcontrol/STATE.md`

## MCP and OAuth endpoints

- Local MCP: `http://127.0.0.1:8787/mcp`
- Public MCP: `https://mcp.redcoweb.ir/mcp`
- OAuth server: `https://auth.redcoweb.ir`
- Trusted SSH tunnel local endpoint: `127.0.0.1:19093`

The local MCP port must remain loopback-only and must not be exposed directly to the public Internet.

## Expected always-on local services

These systemd user services on `god` are expected to remain enabled and active:

- `godcontrol-mcp.service`
- `godcontrol-ssh-tunnel.service`
- `godcontrol-agent.service`

Expected properties:

- `active`
- `enabled`
- `Restart=always`
- systemd user linger enabled for user `god`

If the user asks whether GodControl is online, verify these services instead of assuming.

## Connection architecture

```text
ChatGPT / Public MCP
        ↓
https://mcp.redcoweb.ir/mcp
        ↓
GodControl Hub
        ↓
private loopback listener
        ↓
SSH Tunnel
        ↓
god-local Agent
        ↓
http://127.0.0.1:8787/mcp
        ↓
Files / Git / System / approved processes
```

The owner workstation currently uses the trusted SSH-tunnel transport to keep `god-local` online without depending on an interactive browser login for the Agent connection.

## VPS infrastructure

- VPS: `188.213.197.195`

Important VPS services:

- `godcontrol-public.service`
- `godcontrol-auth.service`
- `redis-godcontrol.service`
- `nginx`

Use the VPS only for GodControl/public MCP/OAuth infrastructure tasks unless the user explicitly asks for something else.

## Operational language

When the user says phrases such as:

- “برو ببین”
- “بررسی کن”
- “رفعش کن”
- “انجام بده”
- “روی لوکال”
- “پروژه رو درست کن”
- “پوش کن”
- “سرویس رو بالا بیار”
- “فایل رو تغییر بده”

interpret them as requests to take real action on `god` when the required connector/tool is available, not merely to provide theoretical instructions.

## Git workflow

- Use SentinelX for local Git state under `/home/god/local-server`.
- Use the GitHub connector for remote branches, PRs, merge operations, and CI.
- Keep local `main` and remote `main` synchronized after merged changes when appropriate.
- Do not force-push or rewrite shared history unless the user explicitly asks and the consequences are understood.

## Security constraints

- Do not expose `127.0.0.1:8787` publicly.
- Do not paste secrets into source files, documentation, chat responses, commits, or CI logs.
- Preserve path and executable allowlists on the GodControl Agent.
- Keep the internal trusted-agent listener loopback-only.
- Keep SSH host-key verification enabled.

## Quick health check

For a routine GodControl health check on `god`, verify:

```text
godcontrol-mcp.service         active + enabled
godcontrol-ssh-tunnel.service  active + enabled
godcontrol-agent.service       active + enabled
user god linger                yes
```

Then verify the public endpoints:

```text
https://mcp.redcoweb.ir/health
https://auth.redcoweb.ir/health
```

For deeper verification, test `devices_list`, `device_ping`, `fs_read`, and `git_status` through the public MCP path.

## Important note for AI assistants

If GodControl later appears as a directly installed ChatGPT tool/plugin in the current chat, prefer that direct tool for local GodControl tasks. Until then, use SentinelX as the practical control path to the `god` machine.
