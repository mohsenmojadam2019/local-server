'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const agentPath = path.join(__dirname, '..', 'agent', 'index.js');

function run(env) {
  return spawnSync(process.execPath, ['-e', `
    const { resolveAuthorization } = require(${JSON.stringify(agentPath)});
    resolveAuthorization().then((value) => {
      process.stdout.write(JSON.stringify(value));
    }).catch((error) => {
      process.stderr.write(error.message);
      process.exit(2);
    });
  `], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

test('trusted tunnel auth is allowed only for loopback ws URLs', () => {
  const ok = run({
    GODCONTROL_TRUSTED_TUNNEL: 'true',
    GODCONTROL_HUB_WS: 'ws://127.0.0.1:19093/agent/internal',
    GODCONTROL_TOKEN: 'fixture-local-token',
  });
  assert.equal(ok.status, 0, ok.stderr);
  const parsed = JSON.parse(ok.stdout);
  assert.equal(parsed.value, null);
  assert.equal(parsed.trustedTunnel, true);

  const bad = run({
    GODCONTROL_TRUSTED_TUNNEL: 'true',
    GODCONTROL_HUB_WS: 'wss://mcp.example.test/agent/internal',
    GODCONTROL_TOKEN: 'fixture-local-token',
  });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /loopback ws:\/\//);
});
