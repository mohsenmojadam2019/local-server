'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SafeProcessManager } = require('../agent/process-manager');
const { Policy } = require('../agent/policy');

test('safe process manager runs an allowlisted executable without a shell', async () => {
  const policy = new Policy({ GODCONTROL_ALLOWED_PROGRAMS: 'node', GODCONTROL_READ_ROOTS: '/tmp', GODCONTROL_WRITE_ROOTS: '/tmp' });
  const manager = new SafeProcessManager({ maxOutputBytes: 4096, timeoutMs: 5000 });
  const started = manager.start({
    program: 'node',
    args: ['-e', 'process.stdout.write("ok")'],
    cwd: '/tmp',
    policy,
  });
  assert.ok(started.session_id);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const read = manager.read({ session_id: started.session_id, tail: true, length: 100 });
  assert.match(read.output, /ok/);
  assert.equal(read.status, 'exited');
});

test('safe process manager rejects programs outside policy', () => {
  const policy = new Policy({ GODCONTROL_ALLOWED_PROGRAMS: 'node', GODCONTROL_READ_ROOTS: '/tmp', GODCONTROL_WRITE_ROOTS: '/tmp' });
  const manager = new SafeProcessManager();
  assert.throws(() => manager.start({ program: 'bash', args: [], cwd: '/tmp', policy }), /not allowed/);
});
