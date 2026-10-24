# Auto-Connect for owner workstations `matin` and `god`

Once **legitimate initial enrollment and local MCP configuration** exist, the GodControl agent starts automatically at Windows user logon / Linux systemd boot and reconnects after network interruption. No new PowerShell command is needed for every ChatGPT session.

## Security model
- `auto-connect.json` is a **local on/off consent switch, not a key**. Possessing this file is NOT remote authorization. Copying it cannot connect to another machine.
- Server-validated OAuth/device identity, a valid **local MCP bearer token**, a loopback-only MCP server and locally enforced path/executable allowlists are **all still required**.
- Changing `enabled` to `false` stops the supervised agent within about three seconds. For permanent credential revocation, additionally revoke the enrolled device/authorization at the identity provider.
- Nothing can connect to a powered-off device, bypass missing enrollment or install an agent on an unreachable workstation.
- The Windows workstation now includes a **loopback-only local MCP** managed by the autoconnect launcher on port **18787** to avoid the Local Server Pro reverse proxy on **8787**. The existing Linux god local MCP remains separately managed on 8787.
- Only the device owner should run the once-only installer.

## Windows `matin`

Prerequisites: Node.js 22+, `npm ci` inside `local-server\godcontrol`, and the existing GodControl local MCP listening on `127.0.0.1:8787`. Perform `npm run agent:enroll` **once** and authorize it with the matching GodControl account. If enrollment is already done, do not repeat it.

From `C:\Users\matin\local-server\godcontrol`, the once-only installer is:

```powershell
powershell -NoProfile -File .\autoconnect\install-windows.ps1 -DeviceId matin-windows -ProjectRoot C:\xampp\htdocs\digizargar_front
```

The installer generates a cryptographically random local token **without any prompt**, protecting it using Windows **user-scoped DPAPI**. It writes a non-secret project-scoped policy and opt-in marker to `%LOCALAPPDATA%\GodControl`, then registers a **non-elevated per-user Windows Task Scheduler** logon task. It starts the task immediately if approved OAuth/SSH credentials exist; the supervised launcher also starts/restores the private Windows MCP server.

The file that allows/revokes *automatic startup*, as requested, is:

```text
C:\Users\matin\AppData\Local\GodControl\auto-connect.json
```

Check:

```powershell
node .\autoconnect\launcher.js --check
Get-ScheduledTask -TaskName 'GodControl-AutoConnect-matin-windows'
```

Disable and unregister the scheduled task:

```powershell
powershell -NoProfile -File .\autoconnect\install-windows.ps1 -DeviceId matin-windows -Disable
```

The Windows task runs at **user logon**, not before the user logs in, because DPAPI requires the same user identity.

## Linux workstation `god`

The actual host must be named `god`. On that host, keep its existing local MCP and its authenticated OAuth or trusted SSH tunnel configured. From `/home/god/local-server/godcontrol`, install once:

```bash
bash ./autoconnect/install-god.sh
```

It creates `~/.config/systemd/user/godcontrol-autoconnect.service`, retaining the existing owner-defined environment files, and enables `Restart=always`. It replaces an enabled legacy agent to avoid duplicate sessions; if the new service fails to start, it attempts to restore the legacy service. The consent file is `~/.config/godcontrol/auto-connect.json`.

Default access roots are **only** `/home/god/local-server`; expanding them requires changing the operator-controlled settings file and restarting the service. It does not authorize the entire `/home/god` or any VPS.

```bash
systemctl --user status godcontrol-autoconnect.service
node ./autoconnect/launcher.js --check
bash ./autoconnect/install-god.sh --disable
```

## From ChatGPT

1. Installed GodControl plugin `devices_list` must report `matin-windows` or `god-local`.
2. Check `device_ping`; then inspect the approved working tree and perform only the user's requested actions.
3. If a device is offline, report it clearly rather than claiming that it was reached.
4. Follow repository skill `skills/godcontrol-auto-connect/SKILL.md` for routing. A skill document **cannot silently install itself or control an offline device**.

## Common issues

- `invalid_request: client_id missing`: legacy Windows `cmd.exe start` can truncate an OAuth URL containing `&`; use the complete authorized enrollment URL or a fixed browser launcher.
- `consent_missing`: the local operator has not opted into persistent connection.
- `enrollment: missing`: the device needs a **one-time** authorized OAuth enrollment or its existing trusted SSH tunnel.
- `localMcpSecret: missing`: the local MCP token has not been configured; re-run the once-only installer (it generates a token automatically). Do not copy secrets into chat or Git.
- Hub `/health` returning 200 proves only hub health; `devices_list` plus `device_ping` are needed to confirm a workstation is actually reachable.

### Reconnection with no repeat browser login

**Do not run `npm run agent:enroll` every time.** With an enrolled, approved device, Task Scheduler automatically starts the launcher, private local MCP and agent on Windows user logon. The agent uses the saved OAuth refresh token (rotated automatically) to authenticate and reconnect if the network drops. Existing authorization is also silently reused if `npm run agent:enroll` is accidentally rerun. If the refresh credential is revoked or expires, a fresh **one-time** approval is required; security is never bypassed.

The **first enrollment cannot occur on an offline workstation from ChatGPT**: the owner must either already have a valid saved authorization or approve a one-time initial pairing. This change removes repeated prompts, not the security requirement for initial authorization.
