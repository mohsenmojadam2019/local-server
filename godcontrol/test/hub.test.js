'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');
const { signDeviceToken } = require('../hub/device-auth');

test('hub routes authenticated MCP calls to an enrolled device', async (t) => {
  process.env.GODCONTROL_DEV_AUTH = 'true';
  process.env.NODE_ENV = 'test';
  process.env.GODCONTROL_DEVICE_HMAC_SECRET = 'integration-secret';

  const { server } = require('../hub/server');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const port = server.address().port;
  const token = signDeviceToken({
    userId: 'user-1',
    deviceId: 'device-1',
    name: 'fixture-device',
    exp: Math.floor(Date.now() / 1000) + 60,
  }, process.env.GODCONTROL_DEVICE_HMAC_SECRET);

  const ws = new WebSocket('ws://127.0.0.1:' + port + '/agent', {
    headers: { Authorization: 'Device ' + token },
  });
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

  ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.type !== 'call') return;
    ws.send(JSON.stringify({ type: 'ack', callId: msg.callId }));
    ws.send(JSON.stringify({
      type: 'result',
      callId: msg.callId,
      ok: true,
      result: { echoedTool: msg.tool, args: msg.args },
    }));
  });

  const auth = 'Bearer dev:user-1:profile:read,devices:read,files:read,files:write,git:read,process:run,system:read';
  const post = async (body, withAuth = true) => {
    const headers = { 'content-type': 'application/json', accept: 'application/json' };
    if (withAuth) headers.authorization = auth;
    return fetch('http://127.0.0.1:' + port + '/mcp', {
      method: 'POST', headers, body: JSON.stringify(body),
    });
  };

  const listRes = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, false);
  const listJson = await listRes.json();
  assert.equal(listJson.result.tools.length, 15);

  const devicesRes = await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'devices_list', arguments: {} } });
  const devicesJson = await devicesRes.json();
  assert.equal(devicesJson.result.structuredContent.devices[0].deviceId, 'device-1');

  const pingRes = await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'device_ping', arguments: { deviceId: 'device-1' } } });
  const pingJson = await pingRes.json();
  assert.equal(pingJson.result.structuredContent.echoedTool, 'device_ping');

  const unauthRes = await post({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'devices_list', arguments: {} } }, false);
  assert.equal(unauthRes.status, 401);
  assert.match(unauthRes.headers.get('www-authenticate') || '', /oauth-protected-resource/);
  const unauthJson = await unauthRes.json();
  assert.ok(unauthJson.error.data._meta['mcp/www_authenticate']);
});
