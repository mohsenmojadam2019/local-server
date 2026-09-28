'use strict';

const crypto = require('crypto');

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signDeviceToken(payload, secret) {
  if (!secret) throw new Error('Device signing secret required');
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return body + '.' + sig;
}

function verifyDeviceToken(token, secret) {
  if (!secret) throw new Error('GODCONTROL_DEVICE_HMAC_SECRET is required');
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) throw new Error('Malformed device token');
  const expected = crypto.createHmac('sha256', secret).update(body).digest();
  const actual = Buffer.from(sig, 'base64url');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw new Error('Invalid device token');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (!payload.userId || !payload.deviceId) throw new Error('Invalid device token payload');
  if (payload.exp && Date.now() / 1000 >= payload.exp) throw new Error('Device token expired');
  return payload;
}

module.exports = { signDeviceToken, verifyDeviceToken };
