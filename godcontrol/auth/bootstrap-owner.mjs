import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createClient } from 'redis';
import { AccountStore, hashPassword, normalizeEmail } from './account-store.mjs';

const require = createRequire(import.meta.url);
const { signDeviceToken } = require('../hub/device-auth');

const redisUrl = process.env.GODCONTROL_REDIS_URL;
const deviceSecret = process.env.GODCONTROL_DEVICE_HMAC_SECRET;
const email = normalizeEmail(process.env.GODCONTROL_BOOTSTRAP_EMAIL || 'owner@redcoweb.ir');
const name = String(process.env.GODCONTROL_BOOTSTRAP_NAME || 'GodControl Owner').trim().slice(0, 120);
const outputDir = process.env.GODCONTROL_BOOTSTRAP_OUTPUT_DIR || '/etc/godcontrol';
const deviceId = process.env.GODCONTROL_BOOTSTRAP_DEVICE_ID || 'god-local';
const deviceName = process.env.GODCONTROL_BOOTSTRAP_DEVICE_NAME || 'god workstation';

if (!redisUrl) throw new Error('GODCONTROL_REDIS_URL is required');
if (!deviceSecret) throw new Error('GODCONTROL_DEVICE_HMAC_SECRET is required');

const redis = createClient({ url: redisUrl });
await redis.connect();

try {
  const store = new AccountStore(redis);
  let account = await store.findByEmail(email);
  const password = crypto.randomBytes(24).toString('base64url');

  if (!account) {
    const created = await store.create({ email, password, name });
    account = await store.findById(created.id);
  } else {
    account.password = await hashPassword(password);
    account.disabled = false;
    account.name = name || account.name;
    await redis.set(store.idKey(account.id), JSON.stringify(account));
  }

  const deviceToken = signDeviceToken({
    userId: account.id,
    deviceId,
    name: deviceName,
    exp: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
  }, deviceSecret);

  fs.mkdirSync(outputDir, { recursive: true, mode: 0o750 });
  const loginPath = outputDir + '/owner-login.env';
  const devicePath = outputDir + '/owner-device.token';

  fs.writeFileSync(loginPath,
    'GODCONTROL_LOGIN_EMAIL=' + email + '\n'
    + 'GODCONTROL_LOGIN_PASSWORD=' + password + '\n'
    + 'GODCONTROL_ACCOUNT_ID=' + account.id + '\n',
    { mode: 0o600 },
  );
  fs.writeFileSync(devicePath, deviceToken + '\n', { mode: 0o600 });

  console.log(JSON.stringify({
    ok: true,
    email,
    account_id: account.id,
    device_id: deviceId,
    login_file: loginPath,
    device_token_file: devicePath,
  }));
} finally {
  await redis.quit();
}
