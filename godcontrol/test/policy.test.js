'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startsWithin, Policy } = require('../agent/policy');

test('startsWithin rejects traversal siblings', () => {
  assert.equal(startsWithin('/tmp/root/a.txt', '/tmp/root'), true);
  assert.equal(startsWithin('/tmp/root2/a.txt', '/tmp/root'), false);
});

test('command allowlist is exact on executable token', () => {
  const p = new Policy({ GODCONTROL_ALLOWED_COMMANDS: 'git,node', GODCONTROL_READ_ROOTS: '/tmp', GODCONTROL_WRITE_ROOTS: '/tmp' });
  assert.equal(p.assertCommand('git status'), true);
  assert.throws(() => p.assertCommand('bash -lc whoami'), /not allowed/);
});
