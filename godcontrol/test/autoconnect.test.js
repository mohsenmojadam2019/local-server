'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { configDirectory, configPaths, consentStatus, validateSettings } = require('../autoconnect/config');

test('Windows consent and token paths live under the current user profile on C:', () => {
  const env = { LOCALAPPDATA: 'C:\\Users\\matin\\AppData\\Local' };
  const dir = configDirectory({ platform: 'win32', home: 'C:\\Users\\matin', env });
  assert.equal(dir, path.join(env.LOCALAPPDATA, 'GodControl'));
  const paths = configPaths({ platform: 'win32', home: 'C:\\Users\\matin', env });
  assert.equal(paths.consent, path.join(dir, 'auto-connect.json'));
});

test('Local consent is an exact opt-in, NOT authentication', () => {
  assert.equal(consentStatus(null, 'matin-windows').ok, false);
  assert.equal(consentStatus({ version:1, enabled:false, deviceId:'matin-windows' }, 'matin-windows').ok,false);
  assert.equal(consentStatus({ version:1, enabled:true, deviceId:'god-local' }, 'matin-windows').ok,false);
  assert.equal(consentStatus({ version:1, enabled:true, deviceId:'matin-windows' }, 'matin-windows').ok,true);
});

test('Settings enforce explicit roots, no dangerous remote URL protocols', () => {
  const settings = {
    deviceId: 'matin-windows', hubUrl:'wss://mcp.redcoweb.ir/agent/connect',
    localMcp:'http://127.0.0.1:8787/mcp', readRoots:[path.resolve('/tmp')],
    writeRoots:[], allowedPrograms:['git']
  };
  assert.equal(validateSettings(settings).deviceId, 'matin-windows');
  assert.throws(() => validateSettings({...settings, readRoots:['.']}), /absolute readRoots/);
  assert.throws(() => validateSettings({...settings, localMcp:'http://evil.example/mcp'}), /localhost/);
  assert.throws(() => validateSettings({...settings, hubUrl:'ws://mcp.redcoweb.ir/agent'}), /wss/);
  assert.throws(() => validateSettings({...settings, allowedPrograms:['/bin/sh']}), /Invalid allowedPrograms/);
});
