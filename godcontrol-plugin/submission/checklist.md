# Release checklist

- [ ] Configure `PUBLIC_BASE_URL`, `OAUTH_RESOURCE`, database, session secret, and challenge token.
- [ ] Apply schema and verify nginx TLS proxy to loopback 19091.
- [ ] Keep local GodControl bound to 127.0.0.1:8787.
- [ ] Enroll a device with a one-time code and store its credential with mode 0600.
- [ ] Run `npm test`, `npm run check`, `npm run build`, `npm run lint`, `npm audit` and `npm run smoke`.
- [ ] Complete the OpenAI submission portal only with operator-controlled identity and approval values.
