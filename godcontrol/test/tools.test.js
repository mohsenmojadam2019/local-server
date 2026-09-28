'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TOOLS } = require('../shared/tools');

test('all tools have OpenAI review annotations and security schemes', () => {
  assert.equal(TOOLS.length, 15);
  for (const t of TOOLS) {
    assert.equal(typeof t.title, 'string', t.name);
    assert.ok(t.title.trim().length > 0, t.name);
    assert.equal(typeof t.annotations?.readOnlyHint, 'boolean', t.name);
    assert.equal(typeof t.annotations?.openWorldHint, 'boolean', t.name);
    assert.equal(typeof t.annotations?.destructiveHint, 'boolean', t.name);
    assert.ok(Array.isArray(t.securitySchemes) && t.securitySchemes.length > 0, t.name);
    assert.deepEqual(t._meta.securitySchemes, t.securitySchemes, t.name);
    assert.equal(t.outputSchema?.type, 'object', t.name);
  }
  assert.equal(TOOLS.find((t) => t.name === 'file_remove').annotations.destructiveHint, true);
  const profile = TOOLS.find((t) => t.name === 'whoami');
  assert.equal(profile._meta['openai/profile'], true);
  assert.deepEqual(profile.outputSchema.required, ['id']);
  const execute = TOOLS.find((t) => t.name === 'process_start');
  assert.equal(execute.annotations.readOnlyHint, false);
  assert.equal(execute.annotations.openWorldHint, true);
  assert.equal(execute.annotations.destructiveHint, true);
});
