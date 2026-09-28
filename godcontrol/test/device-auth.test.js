'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { signDeviceToken, verifyDeviceToken } = require('../hub/device-auth');

test('signed device token round trips', () => {
  const token = signDeviceToken({ userId: 'u1', deviceId: 'd1', exp: Math.floor(Date.now()/1000)+60 }, 'secret');
  const claims = verifyDeviceToken(token, 'secret');
  assert.equal(claims.userId, 'u1');
  assert.equal(claims.deviceId, 'd1');
});

test('tampered device token is rejected', () => {
  const token = signDeviceToken({ userId: 'u1', deviceId: 'd1' }, 'secret');
  assert.throws(() => verifyDeviceToken(token + 'x', 'secret'));
});
