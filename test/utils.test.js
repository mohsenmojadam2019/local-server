const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeHost, slugify } = require('../src/utils');

test('normalizeHost removes protocol, path and port', () => {
  assert.equal(normalizeHost('https://APP.Example.com:443/path'), 'app.example.com');
});

test('slugify creates stable local slug', () => {
  assert.equal(slugify('My Cool App'), 'my-cool-app');
});
