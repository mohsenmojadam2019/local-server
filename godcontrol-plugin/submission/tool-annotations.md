# Tool annotations

Every public tool declares OAuth security schemes and MCP annotations. Read operations set `readOnlyHint: true`, all tools set `openWorldHint: false`, and writes/process starts set `destructiveHint: true`. Write and process tools require `idempotency_key`.
