'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyDeviceToolError } = require('../hub/tool-errors');

test('recognizes policy and file-size failures without returning agent text', () => {
  for (const raw of [
    'Path is outside the configured policy roots',
    'Program is not allowed by device policy',
    'File exceeds maxBytes limit: /home/private/secret',
  ]) {
    const result = classifyDeviceToolError(new Error(raw));
    assert.equal(result.status, 400);
    assert.doesNotMatch(JSON.stringify(result), /home\/private|secret/);
  }
});

test('unexpected failures remain internal and redact full messages', () => {
  assert.equal(classifyDeviceToolError(new Error('ECONNREFUSED to private address')), null);
  assert.equal(classifyDeviceToolError(new Error('some random user data')), null);
  assert.equal(classifyDeviceToolError(null), null);
});

test('explicit device limits get stable actionable codes', () => {
  assert.equal(classifyDeviceToolError(new Error('maxBytes exceeds device policy')).code, -32014);
  assert.equal(classifyDeviceToolError(new Error('Device call timed out')).code, -32015);
  assert.equal(classifyDeviceToolError(new Error('Program is not allowed by device policy')).code, -32013);
});
