---
name: godcontrol-auto-connect
description: Resolve and operate the owner's Windows (matin-windows) and Linux (god-local) devices using the installed GodControl connector, without repeatedly requesting terminal commands.
---

# GodControl automatic routing — matin & god

## Trigger
Use when the owner refers to their Windows machine `matin`, Linux workstation `god`, or asks to inspect, build, run, or update their local projects.

## Device routing
1. Call the connected GodControl `devices_list`. Choose exact enrolled ID `matin-windows` for Windows or `god-local` for Linux. Display names alone are not proof.
2. Call `device_ping`, then read-only tools (`system_info`, `git_status`, `list_directory`) to verify state before editing or running commands.
3. Use the selected device only within its locally configured read/write roots and approved executable allowlist. Do not attempt to bypass consent or local policy.
4. Use GitHub for repository branches, PRs, remote checks and CI. For an offline `god`, SentinelX can be a fallback only if the **actual god workstation** is online. A VPS is not the local workstation.
5. If `devices_list` is empty or a device is offline, report that no live connection exists. Do not claim that remote commands ran.
6. After legitimate first-time device enrollment, the installed startup service automatically reconnects on device login/network recovery. Don't prompt the owner for repetitive manual reconnect commands.

## Revocable per-device local consent
- **matin**: `%LOCALAPPDATA%\GodControl\auto-connect.json` (typically `C:\Users\matin\AppData\Local\GodControl\auto-connect.json`)
- **god**: `~/.config/godcontrol/auto-connect.json`
- A consent document has `version:1`, `enabled:true`, and the enrolled `deviceId`.
- Disabling/removing the marker stops the supervisor and agent; the marker is **not** an authentication credential.
- Server-verified OAuth/device identity, existing local MCP token, loopback-only MCP, and command/path restrictions are mandatory. Never write a bearer token to the consent file or Git.
- The skill is instructions, **not** a remote installer or a background daemon. It does not grant access to an offline machine.

## Setup / recovery
Consult `godcontrol/docs/AUTOCONNECT.md`. A one-time explicit installation and authorized enrollment are necessary. After that, machine startup and reconnection do not require user commands.
