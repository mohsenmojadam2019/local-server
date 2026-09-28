# Submission test cases

## Positive cases (exactly five)

1. OAuth PKCE login lists an enrolled device.
2. Read `system_info` returns bounded data without exposing local port 8787.
3. Read `fs_read` and `search` operate only through an enrolled device.
4. `git_status` and `git_diff` return bounded repository data.
5. `write_file` with an idempotency key completes once and safely retries.

## Negative cases (exactly three)

1. Missing/expired OAuth access token is rejected with 401.
2. A token missing a required scope is rejected with 403.
3. A user cannot address another user's device or reuse an enrollment/code/refresh credential.
