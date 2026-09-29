import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from 'redis';
import { AccountStore, normalizeEmail } from './account-store.mjs';

const redisUrl = process.env.GODCONTROL_REDIS_URL;
const email = normalizeEmail(process.env.GODCONTROL_BOOTSTRAP_EMAIL || 'owner@redcoweb.ir');
const name = String(process.env.GODCONTROL_BOOTSTRAP_NAME || 'GodControl Owner').trim().slice(0, 120);
const outputFile = process.env.GODCONTROL_BOOTSTRAP_ID_FILE || '/etc/godcontrol/owner-id';

if (!redisUrl) throw new Error('GODCONTROL_REDIS_URL is required');

const redis = createClient({ url: redisUrl });
await redis.connect();

try {
  const store = new AccountStore(redis);
  let account = await store.findByEmail(email);
  if (!account) {
    const password = crypto.randomBytes(32).toString('base64url');
    const created = await store.create({ email, password, name });
    account = await store.findById(created.id);
  } else {
    account.disabled = false;
    account.name = name || account.name;
    await redis.set(store.idKey(account.id), JSON.stringify(account));
  }

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, account.id + '\n', { mode: 0o640 });
  console.log(JSON.stringify({ ok: true, email, account_id: account.id, id_file: outputFile }));
} finally {
  await redis.quit();
}
