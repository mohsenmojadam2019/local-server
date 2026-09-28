# OpenAI plugin submission checklist

GodControl public submission requires:
- a stable production HTTPS MCP endpoint;
- a verified publisher identity;
- Apps Management write permission for the submitting organization;
- domain verification at `/.well-known/openai-apps-challenge`;
- a successful current Scan Tools result;
- accurate `readOnlyHint`, `openWorldHint`, and `destructiveHint` on every tool;
- OAuth for private data and write capabilities;
- public website, support, privacy, and terms URLs;
- exactly five positive and three negative review test cases;
- release notes and the required demo recording.

Use an established OAuth 2.1/OIDC provider rather than a custom production authorization server. The provider must support Authorization Code with PKCE S256 and the current MCP authorization contract.

Use a Universal MCP URL when one production endpoint serves all users, with OAuth identity mapping each user to only their own enrolled devices.


## Included authorization service

The repository includes a production authorization-service implementation based on the OpenID-certified `oidc-provider` project. It supports DCR, Authorization Code + mandatory PKCE S256, RFC 9207 issuer identification, RFC 8707 resource indicators, JWT access tokens, refresh-token rotation, and Redis persistence.

For production, deploy it on a stable HTTPS issuer (for example `https://auth.example.com`) and configure the MCP hub's protected-resource metadata to list that exact issuer.
