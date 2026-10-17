'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { browserLaunch } = require('../agent/enroll');

test('Windows OAuth browser launch preserves ampersands and query parameters', () => {
  const authorizeUrl = 'https://auth.example.test/authorize?client_id=abc&redirect_uri=http%3A%2F%2F127.0.0.1%3A4321%2Fcallback&code_challenge=xyz&state=state';
  const launch = browserLaunch('win32', authorizeUrl);

  assert.equal(launch.command, 'rundll32.exe');
  assert.deepEqual(launch.args, ['url.dll,FileProtocolHandler', authorizeUrl]);
  assert.equal(launch.args[1].match(/&/g).length, 3);
});
