import { randomToken, hashToken } from "./crypto.js";
export class CallQueue {
  constructor(store, { ttlMs = 120_000 } = {}) { this.store = store; this.ttlMs = ttlMs; }
  async dispatch({ userId, deviceId, tool, args, idempotencyKey, write = false }) {
    if (write && !idempotencyKey) throw new Error("idempotency_key is required for write/process calls");
    const id = idempotencyKey ? `idem:${hashToken(`${userId}\0${deviceId}\0${tool}\0${idempotencyKey}`)}` : `call:${randomToken(16)}`;
    const existing = await this.store.getCall(id);
    if (existing) {
      if (existing.userId !== userId || existing.deviceId !== deviceId || existing.tool !== tool || existing.idempotencyKey !== (idempotencyKey ? hashToken(idempotencyKey) : null)) throw new Error("idempotency context mismatch");
      return existing;
    }
    return this.store.enqueueCall({ id, userId, deviceId, tool, args, status: "pending", createdAt: Date.now(), expiresAt: Date.now() + this.ttlMs, idempotencyKey: idempotencyKey ? hashToken(idempotencyKey) : null });
  }
  async recover(deviceId) { return this.store.claimPending(deviceId); }
}
