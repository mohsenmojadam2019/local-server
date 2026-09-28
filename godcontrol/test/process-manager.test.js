'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SafeProcessManager } = require('../agent/process-manager');
const { Policy } = require('../agent/policy');

test('safe process manager runs an allowlisted executable without a shell and strips agent secrets', async () => {
  process.env.GODCONTROL_LOCAL_TOKEN = 'must-not-leak';
  process.env.TEST_PROCESS_SECRET = 'must-not-leak-either';
  const policy = new Policy({ GODCONTROL_ALLOWED_PROGRAMS: 'node', GODCONTROL_READ_ROOTS: '/tmp', GODCONTROL_WRITE_ROOTS: '/tmp' });
  const manager = new SafeProcessManager({ maxOutputBytes: 4096, timeoutMs: 5000 });
  const started = manager.start({
    program: 'node',
    args: ['-e', 'process.stdout.write("ok:" + String(process.env.GODCONTROL_LOCAL_TOKEN) + ":" + String(process.env.TEST_PROCESS_SECRET))'],
    cwd: '/tmp',
    policy,
  });
  assert.ok(started.session_id);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const read = manager.read({ session_id: started.session_id, tail: true, length: 100 });
  assert.match(read.output, /ok:undefined:undefined/);
  assert.equal(read.status, 'exited');
  delete process.env.GODCONTROL_LOCAL_TOKEN;
  delete process.env.TEST_PROCESS_SECRET;
});

test('safe process manager rejects programs outside policy', () => {
  const policy = new Policy({ GODCONTROL_ALLOWED_PROGRAMS: 'node', GODCONTROL_READ_ROOTS: '/tmp', GODCONTROL_WRITE_ROOTS: '/tmp' });
  const manager = new SafeProcessManager();
  assert.throws(() => manager.start({ program: 'bash', args: [], cwd: '/tmp', policy }), /not allowed/);
});
