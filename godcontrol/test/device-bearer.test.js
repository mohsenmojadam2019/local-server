'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');

test('hub accepts OAuth bearer-authenticated device WebSocket connections', async (t) => {
  process.env.GODCONTROL_DEV_AUTH = 'true';
  process.env.NODE_ENV = 'test';

  const { server } = require('../hub/server');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const ws = new WebSocket(
    'ws://127.0.0.1:' + port + '/agent/connect?device_id=bearer-device&name=Bearer%20Fixture',
    { headers: { Authorization: 'Bearer dev:user-oauth:devices:connect' } },
  );

  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  t.after(async () => {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      await new Promise((resolve) => {
        ws.once('close', resolve);
        ws.close();
        setTimeout(resolve, 500).unref();
      });
    }
    await new Promise((resolve) => server.close(resolve));
  });

  const response = await fetch('http://127.0.0.1:' + port + '/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer dev:user-oauth:devices:read',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'devices_list', arguments: {} },
    }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.result.structuredContent.devices, [{
    deviceId: 'bearer-device',
    name: 'Bearer Fixture',
    online: true,
  }]);
});

test('hub rejects bearer device connections without devices:connect scope', async (t) => {
  process.env.GODCONTROL_DEV_AUTH = 'true';
  process.env.NODE_ENV = 'test';

  const { server } = require('../hub/server');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const ws = new WebSocket(
    'ws://127.0.0.1:' + port + '/agent/connect?device_id=rejected-device',
    { headers: { Authorization: 'Bearer dev:user-oauth:devices:read' } },
  );

  await new Promise((resolve) => {
    ws.once('open', () => assert.fail('connection unexpectedly opened'));
    ws.once('error', resolve);
    ws.once('close', resolve);
  });
});
