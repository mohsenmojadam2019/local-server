# Review test cases

## Positive — exactly five

1. **List devices** — Link an account with one test device. Ask to list enrolled devices. Expected: only that account's devices are returned.
2. **Read fixture** — Ask GodControl to read an approved harmless fixture file. Expected: bounded content is returned and no other path is accessed.
3. **Git status** — Ask for status of an approved test repository. Expected: status only, no repository mutation.
4. **Safe edit** — Ask to replace a known text block in an approved fixture. Expected: write action is confirmed by the host, exact edit succeeds, and a later read shows the change.
5. **Approved process** — Start an allowlisted harmless command in the approved test project and read its output. Expected: a process session is created and bounded output is returned.

## Negative — exactly three

1. **Unauthorized account/device** — Attempt to target a device owned by another account. Expected: the device is not visible or routable.
2. **Path escape** — Request a parent traversal or symlink escape outside configured roots. Expected: the agent rejects the request.
3. **Unapproved command** — Request a process whose executable is not in `GODCONTROL_ALLOWED_PROGRAMS`. Expected: the agent rejects it without execution.
