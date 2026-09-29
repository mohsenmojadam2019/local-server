import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export async function hashPassword(password) {
  const value = String(password || '');
  if (value.length < 12) throw new Error('Password must be at least 12 characters');
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(value, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return {
    salt: salt.toString('base64url'),
    hash: Buffer.from(derived).toString('base64url'),
  };
}

export async function verifyPassword(password, stored) {
  if (!stored?.salt || !stored?.hash) return false;
  const salt = Buffer.from(stored.salt, 'base64url');
  const expected = Buffer.from(stored.hash, 'base64url');
  const derived = Buffer.from(await scrypt(String(password || ''), salt, expected.length, {
    N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024,
  }));
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}

export class AccountStore {
  constructor(redis, { prefix = 'godcontrol:account:' } = {}) {
    this.redis = redis;
    this.prefix = prefix;
  }

  emailKey(email) { return this.prefix + 'email:' + normalizeEmail(email); }
  idKey(id) { return this.prefix + 'id:' + id; }

  async create({ email, password, name }) {
    const normalized = normalizeEmail(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error('Valid email is required');
    const cleanName = String(name || '').trim().slice(0, 120);
    const id = crypto.randomUUID();
    const passwordRecord = await hashPassword(password);
    const reserved = await this.redis.set(this.emailKey(normalized), id, { NX: true });
    if (reserved !== 'OK') throw new Error('Account already exists');

    const account = {
      id,
      email: normalized,
      email_verified: false,
      name: cleanName || normalized.split('@')[0],
      password: passwordRecord,
      created_at: new Date().toISOString(),
      disabled: false,
    };
    try {
      await this.redis.set(this.idKey(id), JSON.stringify(account));
      return this.publicAccount(account);
    } catch (error) {
      await this.redis.del(this.emailKey(normalized));
      throw error;
    }
  }

  publicAccount(account) {
    if (!account) return null;
    return {
      id: account.id,
      email: account.email,
      email_verified: account.email_verified === true,
      name: account.name,
    };
  }

  async findById(id) {
    const raw = await this.redis.get(this.idKey(id));
    return raw ? JSON.parse(raw) : null;
  }

  async findByEmail(email) {
    const id = await this.redis.get(this.emailKey(email));
    return id ? this.findById(id) : null;
  }

  async count() {
    const keys = await this.redis.keys(this.prefix + 'id:*');
    return keys.length;
  }

  async authenticate(email, password) {
    const account = await this.findByEmail(email);
    if (!account || account.disabled) return null;
    if (!await verifyPassword(password, account.password)) return null;
    return this.publicAccount(account);
  }
}
