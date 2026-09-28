import fs from "node:fs";

const bool = (value, fallback = false) => value === undefined ? fallback : value === "true";
const positive = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;

export function loadConfig(env = process.env) {
  const base = env.PUBLIC_BASE_URL ?? "http://127.0.0.1:8788";
  const issuer = env.OAUTH_ISSUER ?? base;
  const config = {
    nodeEnv: env.NODE_ENV ?? "development",
    port: positive(env.PORT, 8788),
    publicBaseUrl: base.replace(/\/$/, ""),
    issuer: issuer.replace(/\/$/, ""),
    resource: env.OAUTH_RESOURCE ?? `${base.replace(/\/$/, "")}/mcp`,
    databaseUrl: env.DATABASE_URL ?? "",
    sessionSecret: env.SESSION_SECRET ?? "development-only-change-me",
    allowSignup: bool(env.ALLOW_SIGNUP, false),
    challengeTokenFile: env.CHALLENGE_TOKEN_FILE ?? "",
    enrollmentTtlMs: positive(env.AGENT_ENROLLMENT_TTL_SECONDS, 600) * 1000,
    accessTtlMs: positive(env.ACCESS_TOKEN_TTL_SECONDS, 900) * 1000,
    refreshTtlMs: positive(env.REFRESH_TOKEN_TTL_SECONDS, 2_592_000) * 1000,
    maxResultBytes: positive(env.MAX_RESULT_BYTES, 120_000),
    trustProxy: env.TRUST_PROXY === "loopback",
    supportEmail: env.SUPPORT_EMAIL ?? "",
    publisherName: env.PUBLISHER_NAME ?? "GodControl operator",
    websiteUrl: env.WEBSITE_URL ?? base.replace(/\/mcp$/, ""),
    secureCookies: (env.NODE_ENV ?? "development") === "production",
  };
  if (config.nodeEnv === "production") {
    if (!config.databaseUrl || !config.publicBaseUrl.startsWith("https://") || config.sessionSecret.length < 32) throw new Error("production requires DATABASE_URL, HTTPS PUBLIC_BASE_URL, and a 32+ byte SESSION_SECRET");
  }
  return config;
}

export function challengeToken(config) {
  if (!config.challengeTokenFile) return "";
  try { return fs.readFileSync(config.challengeTokenFile, "utf8").trim(); } catch { return ""; }
}
