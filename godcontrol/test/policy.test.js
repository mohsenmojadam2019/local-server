'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startsWithin, Policy } = require('../agent/policy');

test('startsWithin rejects traversal siblings', () => {
  assert.equal(startsWithin('/tmp/root/a.txt', '/tmp/root'), true);
  assert.equal(startsWithin('/tmp/root2/a.txt', '/tmp/root'), false);
});

test('program allowlist accepts only configured bare executable names', () => {
  const p = new Policy({ GODCONTROL_ALLOWED_PROGRAMS: 'git,node', GODCONTROL_READ_ROOTS: '/tmp', GODCONTROL_WRITE_ROOTS: '/tmp' });
  assert.equal(p.assertProgram('git'), true);
  assert.throws(() => p.assertProgram('bash'), /not allowed/);
  assert.throws(() => p.assertProgram('/usr/bin/git'), /bare executable/);
  assert.throws(() => p.assertProgram('git;rm'), /bare executable/);
});
