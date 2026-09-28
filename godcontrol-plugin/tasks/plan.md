# Implementation Plan: GodControl Public ChatGPT Plugin

## Overview

Build an isolated Node 22+ public MCP/OAuth hub and outbound-only local agent companion for GodControl. The hub exposes a least-privilege tool set over Streamable HTTP, persists calls and credentials safely, and never exposes the local MCP port.

## Architecture Decisions

- Use the current official `@modelcontextprotocol/sdk` package available from npm; its v1 API is the stable package shape in this environment.
- Keep the hub transport, OAuth, persistence contracts, queue, and agent adapters dependency-light and testable with an in-memory store; provide PostgreSQL schema/adapter hooks for production deployment.
- Use an outbound WebSocket from the agent to the hub. The hub persists every remote call and treats WebSocket messages as wake-up/status signals.
- Expose only local MCP tools that exist and are policy-controlled: no arbitrary shell, browser, network, or unrestricted delete surface.
- Default to fail-closed production configuration, HTTPS public URLs, hashed opaque credentials, bounded output, and redacted audit records.

## Task List

### Phase 1: Contracts and foundation
- [x] Create package metadata, configuration, shared security/validation contracts, and tool manifest.
- [x] Implement in-memory persistence, PostgreSQL schema/adapter boundary, queue lifecycle, and audit redaction.
- [x] Implement OAuth discovery, DCR, authorization code + PKCE, token rotation, userinfo, and public pages.

### Checkpoint: Foundation
- [x] OAuth discovery/DCR/PKCE/rotation tests pass.
- [x] No secrets are committed; production defaults fail closed.

### Phase 2: MCP hub and device path
- [x] Implement Streamable HTTP MCP endpoint with OAuth/scope/audience enforcement.
- [x] Implement enrollment, outbound WebSocket device protocol, dispatch/recovery/dedupe, and local MCP client.
- [x] Add health/readiness, challenge, secure headers, rate limiting, and bounded responses.

### Checkpoint: Core features
- [x] MCP initialize/tools/list and safe read/write flows pass with a mock agent/local MCP.
- [x] Device ownership and scope isolation pass.

### Phase 3: Operations, docs, and release evidence
- [x] Add Docker, Compose, systemd, nginx, doctor/smoke scripts, and user creation CLI.
- [x] Add architecture/security/privacy/terms/support/deployment/OAuth/threat model docs.
- [x] Add exactly five positive and three negative submission cases, listing/checklist/release notes.
- [x] Integrate a concise optional root README section and write the implementation report.

### Checkpoint: Complete
- [x] Plugin install, test, check/build/lint, audit, smoke, and root test/check pass.
- [x] Changes committed and pushed to `origin/godcontrol-public-plugin` without merging main.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| MCP SDK API drift | High | Inspect installed/current package types and isolate transport construction behind one module. |
| OAuth audience confusion | High | Require exact configured resource on authorization, token, and MCP requests. |
| Duplicate/replayed writes | High | Durable call IDs, idempotency keys, atomic claim, and refresh-token rotation. |
| Local policy bypass | High | Fixed mapping to existing local tool names and no public arbitrary command tool. |
| Public deployment misconfiguration | Medium | Fail-closed env validation, deployment examples, and doctor checks. |

## Open Questions

- Production operator must supply the public HTTPS domain, OpenAI portal challenge token, and deployment credentials; these are intentionally not invented or committed.
