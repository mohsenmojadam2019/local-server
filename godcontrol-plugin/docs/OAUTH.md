# OAuth

The hub publishes protected-resource metadata and authorization-server metadata. Clients register with DCR, use exact HTTPS redirect URIs (localhost loopback is allowed only for development), send `resource`, and use Authorization Code + PKCE S256. Access tokens are short-lived opaque hashes; refresh tokens rotate and a reused/revoked token is rejected. `openid` and `email` enable userinfo with `sub`, `email`, and `email_verified`.

Authorization-code exchange requires the exact `resource` value issued in the authorization request. Refresh requests may include `resource`, but it must match exactly; access-token authentication verifies the same audience/resource. RFC 9207 issuer response support is advertised as false, so successful redirects contain only `code` and the caller-supplied `state`.
