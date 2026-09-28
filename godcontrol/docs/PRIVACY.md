# Privacy policy draft

GodControl processes only the information required to route authorized tool calls to devices that a user has explicitly enrolled.

## Data processed

- Account identifier and, when supplied by the identity provider, email address.
- Device identifier, display name, connection state and timestamps.
- Tool routing metadata: tool name, call ID, target device and success/failure.
- Tool inputs and outputs only in transit as needed to perform the requested action.

## Secrets

OAuth access tokens, device credentials and local MCP bearer tokens are not intentionally stored in application logs or returned through MCP tool results.

## Retention

Production deployment must publish concrete retention periods. Recommended defaults are short operational audit retention and immediate expiry of completed-call payload caches.

## User control

Users can disconnect a device by stopping or removing its agent credentials. Production enrollment should provide a revocation mechanism for device credentials and OAuth grants.
