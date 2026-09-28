'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Policy } = require('../agent/policy');
const { sanitizeArgs } = require('../agent/index');

test('agent forwards canonical policy-approved paths and rejects symlink escapes', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'godcontrol-policy-'));
  const root = path.join(tmp, 'root');
  const real = path.join(root, 'real');
  const outside = path.join(tmp, 'outside');
  fs.mkdirSync(real, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  const target = path.join(real, 'fixture.txt');
  fs.writeFileSync(target, 'ok');
  fs.symlinkSync(real, path.join(root, 'link'));
  fs.symlinkSync(outside, path.join(root, 'escape'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const policy = new Policy({
    GODCONTROL_READ_ROOTS: root,
    GODCONTROL_WRITE_ROOTS: root,
    GODCONTROL_ALLOWED_PROGRAMS: 'node',
  });

  const read = await sanitizeArgs('fs_read', { path: path.join(root, 'link', 'fixture.txt') }, policy);
  assert.equal(read.path, target);

  const write = await sanitizeArgs('file_write', { path: path.join(root, 'link', 'new.txt'), content: 'x' }, policy);
  assert.equal(write.path, path.join(real, 'new.txt'));

  const search = await sanitizeArgs('search', { root: path.join(root, 'link'), pattern: 'fixture' }, policy);
  assert.equal(search.root, real);

  await assert.rejects(
    sanitizeArgs('fs_read', { path: path.join(root, 'escape', 'secret.txt') }, policy),
    /outside the configured policy roots/,
  );
});
