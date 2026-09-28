let redis;

export function configureRedisAdapter(client) {
  redis = client;
}

function client() {
  if (!redis) throw new Error('Redis adapter is not configured');
  return redis;
}

export default class RedisAdapter {
  constructor(name) {
    this.name = name;
  }

  key(id) { return `godcontrol:oidc:${this.name}:${id}`; }
  uidKey(uid) { return `godcontrol:oidc:index:${this.name}:uid:${uid}`; }
  userCodeKey(code) { return `godcontrol:oidc:index:${this.name}:usercode:${code}`; }
  grantKey(grantId) { return `godcontrol:oidc:index:${this.name}:grant:${grantId}`; }

  async write(key, value, expiresIn) {
    if (expiresIn && expiresIn > 0) await client().set(key, value, { EX: Math.ceil(expiresIn) });
    else await client().set(key, value);
  }

  async upsert(id, payload, expiresIn) {
    const key = this.key(id);
    await this.write(key, JSON.stringify(payload), expiresIn);
    if (payload.uid) await this.write(this.uidKey(payload.uid), id, expiresIn);
    if (payload.userCode) await this.write(this.userCodeKey(payload.userCode), id, expiresIn);
    if (payload.grantId) {
      const gk = this.grantKey(payload.grantId);
      await client().sAdd(gk, key);
      if (expiresIn && expiresIn > 0) await client().expire(gk, Math.ceil(expiresIn));
    }
  }

  async find(id) {
    const raw = await client().get(this.key(id));
    return raw ? JSON.parse(raw) : undefined;
  }

  async findByUid(uid) {
    const id = await client().get(this.uidKey(uid));
    return id ? this.find(id) : undefined;
  }

  async findByUserCode(userCode) {
    const id = await client().get(this.userCodeKey(userCode));
    return id ? this.find(id) : undefined;
  }

  async consume(id) {
    const key = this.key(id);
    const payload = await this.find(id);
    if (!payload) return;
    payload.consumed = Math.floor(Date.now() / 1000);
    const ttl = await client().ttl(key);
    await this.write(key, JSON.stringify(payload), ttl > 0 ? ttl : undefined);
  }

  async destroy(id) {
    const payload = await this.find(id);
    const keys = [this.key(id)];
    if (payload?.uid) keys.push(this.uidKey(payload.uid));
    if (payload?.userCode) keys.push(this.userCodeKey(payload.userCode));
    if (payload?.grantId) await client().sRem(this.grantKey(payload.grantId), this.key(id));
    await client().del(keys);
  }

  async revokeByGrantId(grantId) {
    const gk = this.grantKey(grantId);
    const keys = await client().sMembers(gk);
    if (keys.length) await client().del(keys);
    await client().del(gk);
  }
}
