-- Apply with psql "$DATABASE_URL" -f godcontrol-plugin-schema.sql
CREATE TABLE IF NOT EXISTS users (id text primary key, email text unique not null, password_hash text not null, email_verified boolean not null default true, created_at timestamptz not null default now());
CREATE TABLE IF NOT EXISTS oauth_clients (client_id text primary key, client_secret_hash text, redirect_uris jsonb not null, token_endpoint_auth_method text not null, created_at timestamptz not null default now());
CREATE TABLE IF NOT EXISTS authorization_codes (code_hash text primary key, client_id text not null, user_id text not null, redirect_uri text not null, resource text not null, scope text not null, code_challenge text not null, expires_at timestamptz not null, used_at timestamptz);
CREATE TABLE IF NOT EXISTS access_tokens (token_hash text primary key, user_id text not null, client_id text not null, resource text not null, scope text not null, expires_at timestamptz not null, revoked_at timestamptz);
CREATE TABLE IF NOT EXISTS refresh_tokens (token_hash text primary key, user_id text not null, client_id text not null, resource text not null, scope text not null, expires_at timestamptz not null, revoked_at timestamptz, replaced_by text);
CREATE TABLE IF NOT EXISTS devices (id text primary key, user_id text not null, name text not null, token_hash text unique not null, status jsonb not null default '{}', created_at timestamptz not null default now(), last_seen_at timestamptz);
CREATE TABLE IF NOT EXISTS enrollment_codes (code_hash text primary key, user_id text not null, expires_at timestamptz not null, used_at timestamptz);
CREATE TABLE IF NOT EXISTS remote_calls (id text primary key, user_id text not null, device_id text not null, tool text not null, args jsonb not null, status text not null check(status in ('pending','executing','completed','failed','expired')), idempotency_key text, result jsonb, error text, created_at timestamptz not null, expires_at timestamptz not null, claimed_at timestamptz, completed_at timestamptz);
DROP INDEX IF EXISTS remote_calls_user_idempotency;
CREATE UNIQUE INDEX IF NOT EXISTS remote_calls_user_device_tool_idempotency ON remote_calls(user_id, device_id, tool, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS remote_calls_expiry_status ON remote_calls(status, expires_at);
CREATE INDEX IF NOT EXISTS audit_log_user_created ON audit_log(user_id, created_at);
CREATE TABLE IF NOT EXISTS audit_log (id bigserial primary key, user_id text, device_id text, call_id text, event text not null, metadata jsonb not null default '{}', created_at timestamptz not null default now());
