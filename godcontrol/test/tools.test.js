'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TOOLS } = require('../shared/tools');

test('all tools have OpenAI review annotations and security schemes', () => {
  assert.equal(TOOLS.length, 15);
  for (const t of TOOLS) {
    assert.equal(typeof t.annotations?.readOnlyHint, 'boolean', t.name);
    assert.equal(typeof t.annotations?.openWorldHint, 'boolean', t.name);
    assert.equal(typeof t.annotations?.destructiveHint, 'boolean', t.name);
    assert.ok(Array.isArray(t.securitySchemes) && t.securitySchemes.length > 0, t.name);
    assert.deepEqual(t._meta.securitySchemes, t.securitySchemes, t.name);
  }
  assert.equal(TOOLS.find((t) => t.name === 'file_remove').annotations.destructiveHint, true);
});
