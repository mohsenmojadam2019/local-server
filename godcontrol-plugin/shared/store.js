import { randomToken, hashToken } from "./crypto.js";

export class MemoryStore {
  constructor() { this.users = new Map(); this.clients = new Map(); this.codes = new Map(); this.access = new Map(); this.refresh = new Map(); this.devices = new Map(); this.enrollments = new Map(); this.calls = new Map(); this.audit = []; }
  async createUser({ email, passwordHash: password_hash, emailVerified = true }) { const id = randomToken(12); const user = { id, email: email.toLowerCase(), passwordHash: password_hash, emailVerified, createdAt: Date.now() }; this.users.set(id, user); return user; }
  async getUserByEmail(email) { return [...this.users.values()].find(u => u.email === email.toLowerCase()); }
  async getUser(id) { return this.users.get(id); }
  async saveClient(client) { this.clients.set(client.client_id, client); return client; }
  async getClient(id) { return this.clients.get(id); }
  async saveAuthCode(code) { this.codes.set(code.codeHash, code); }
  async consumeAuthCode(codeHash) { const code = this.codes.get(codeHash); if (!code || code.usedAt || code.expiresAt < Date.now()) return null; code.usedAt = Date.now(); return code; }
  async saveAccess(token) { this.access.set(token.tokenHash, token); }
  async getAccess(token) { const v = this.access.get(hashToken(token)); return v && v.expiresAt > Date.now() && !v.revokedAt ? v : null; }
  async saveRefresh(token) { this.refresh.set(token.tokenHash, token); }
  async rotateRefresh(raw, next) { const old = this.refresh.get(hashToken(raw)); if (!old || old.revokedAt || old.expiresAt < Date.now()) return null; old.revokedAt = Date.now(); old.replacedBy = next.tokenHash; this.refresh.set(next.tokenHash, next); return old; }
  async getRefresh(raw) { return this.refresh.get(hashToken(raw)) ?? null; }
  async revokeRefreshFamily(tokenHash) { const t = this.refresh.get(tokenHash); if (t) t.revokedAt = Date.now(); }
  async createEnrollment(record) { this.enrollments.set(record.codeHash, record); }
  async consumeEnrollment(raw) { const record = this.enrollments.get(hashToken(raw)); if (!record || record.usedAt || record.expiresAt < Date.now()) return null; record.usedAt = Date.now(); return record; }
  async saveDevice(device) { this.devices.set(device.id, device); return device; }
  async listDevices(userId) { return [...this.devices.values()].filter(d => d.userId === userId).map(({ tokenHash, ...safe }) => safe); }
  async getDevice(userId, id) { const d = this.devices.get(id); return d?.userId === userId ? d : null; }
  async enqueueCall(call) { if (this.calls.has(call.id)) return this.calls.get(call.id); this.calls.set(call.id, call); return call; }
  async getCall(id) { const c = this.calls.get(id); if (c && c.expiresAt <= Date.now() && (c.status === "pending" || c.status === "executing")) { c.status = "expired"; c.error = "call expired"; c.completedAt = Date.now(); } return c; }
  async claimPending(deviceId) { const now = Date.now(); const result = []; for (const c of this.calls.values()) { if (c.expiresAt <= now && (c.status === "pending" || c.status === "executing")) { c.status = "expired"; c.error = "call expired"; c.completedAt = now; continue; } if (c.deviceId === deviceId && (c.status === "pending" || (c.status === "executing" && c.claimedAt < now - 120_000))) { c.status = "executing"; c.claimedAt = now; result.push(c); } } return result; }
  async completeCall(id, status, result, error) { const c = this.calls.get(id); if (!c || (c.status !== "executing" && c.status !== "pending")) return c; if (c.expiresAt <= Date.now()) { c.status = "expired"; c.error = "call expired"; c.completedAt = Date.now(); return c; } c.status = status; c.result = result; c.error = error; c.completedAt = Date.now(); return c; }
  async auditEvent(event) { this.audit.push({ ...event, at: Date.now() }); }
}

export function normalizeCallResult(value, maxBytes) { return typeof value === "string" && Buffer.byteLength(value) <= maxBytes ? value : JSON.stringify(value).slice(0, maxBytes); }
