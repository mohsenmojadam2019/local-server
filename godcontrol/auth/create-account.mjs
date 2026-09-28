import { createClient } from 'redis';
import { AccountStore } from './account-store.mjs';

const url = process.env.GODCONTROL_REDIS_URL;
const email = process.env.GODCONTROL_ACCOUNT_EMAIL;
const password = process.env.GODCONTROL_ACCOUNT_PASSWORD;
const name = process.env.GODCONTROL_ACCOUNT_NAME || 'GodControl Reviewer';

if (!url || !email || !password) {
  throw new Error('GODCONTROL_REDIS_URL, GODCONTROL_ACCOUNT_EMAIL and GODCONTROL_ACCOUNT_PASSWORD are required');
}

const redis = createClient({ url });
await redis.connect();
try {
  const store = new AccountStore(redis);
  const account = await store.create({ email, password, name });
  console.log(JSON.stringify({ id: account.id, email: account.email, created: true }));
} finally {
  await redis.quit();
}
