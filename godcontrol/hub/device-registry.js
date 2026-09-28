'use strict';

const crypto = require('crypto');

class DeviceRegistry {
  constructor({ timeoutMs = 30000, completedTtlMs = 5 * 60 * 1000, audit = () => {} } = {}) {
    this.timeoutMs = timeoutMs;
    this.completedTtlMs = completedTtlMs;
    this.audit = audit;
    this.devices = new Map();
    this.pending = new Map();
    this.completed = new Map();
  }

  key(userId, deviceId) { return userId + ':' + deviceId; }

  register({ userId, deviceId, name, socket }) {
    const key = this.key(userId, deviceId);
    const current = this.devices.get(key);
    if (current?.socket && current.socket !== socket) {
      try { current.socket.close(4001, 'superseded'); } catch {}
    }
    this.devices.set(key, { userId, deviceId, name: name || deviceId, socket, connectedAt: new Date().toISOString() });
    this.audit({ event: 'device_connected', userId, deviceId });
    for (const item of this.pending.values()) {
      if (item.userId === userId && item.deviceId === deviceId) this.sendPending(item);
    }
  }

  unregister(socket) {
    for (const [key, device] of this.devices) {
      if (device.socket === socket) {
        this.devices.delete(key);
        this.audit({ event: 'device_disconnected', userId: device.userId, deviceId: device.deviceId });
      }
    }
  }

  list(userId) {
    return [...this.devices.values()].filter((d) => d.userId === userId).map(({ socket, ...d }) => ({ ...d, online: socket.readyState === 1 }));
  }

  sendPending(item) {
    const device = this.devices.get(this.key(item.userId, item.deviceId));
    if (!device || device.socket.readyState !== 1) return false;
    device.socket.send(JSON.stringify({ type: 'call', callId: item.callId, tool: item.tool, args: item.args }));
    item.lastSentAt = Date.now();
    return true;
  }

  call({ userId, deviceId, tool, args }) {
    this.pruneCompleted();
    const callId = crypto.randomUUID();
    const cached = this.completed.get(callId);
    if (cached) return Promise.resolve(cached.result);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(callId);
        reject(new Error('Device call timed out'));
      }, this.timeoutMs);
      const item = { callId, userId, deviceId, tool, args, resolve, reject, timer, createdAt: Date.now() };
      this.pending.set(callId, item);
      this.audit({ event: 'tool_queued', callId, userId, deviceId, tool });
      this.sendPending(item);
    });
  }

  handleMessage(socket, message) {
    let data;
    try { data = JSON.parse(String(message)); } catch { return; }
    if (!data || typeof data !== 'object') return;
    if (data.type === 'ack') {
      const item = this.pending.get(data.callId);
      if (item) this.audit({ event: 'tool_ack', callId: data.callId, userId: item.userId, deviceId: item.deviceId, tool: item.tool });
      return;
    }
    if (data.type === 'result') {
      const item = this.pending.get(data.callId);
      if (!item) return;
      clearTimeout(item.timer);
      this.pending.delete(data.callId);
      const record = { at: Date.now(), result: data.ok ? data.result : undefined, error: data.ok ? undefined : String(data.error || 'Remote error') };
      this.completed.set(data.callId, record);
      this.audit({ event: 'tool_completed', callId: data.callId, userId: item.userId, deviceId: item.deviceId, tool: item.tool, ok: Boolean(data.ok) });
      if (data.ok) item.resolve(data.result);
      else item.reject(new Error(record.error));
    }
  }

  pruneCompleted() {
    const cutoff = Date.now() - this.completedTtlMs;
    for (const [id, value] of this.completed) if (value.at < cutoff) this.completed.delete(id);
  }
}

module.exports = { DeviceRegistry };
