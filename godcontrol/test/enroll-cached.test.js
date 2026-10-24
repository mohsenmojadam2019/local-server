'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

test('already enrolled machine skips browser and password prompts',async (t)=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'gc-cached-oauth-'));
  t.after(()=>fs.rm(home,{recursive:true,force:true}));
  const configDir=path.join(home,'.config','godcontrol');
  await fs.mkdir(configDir,{recursive:true});
  const config={
    access_token:'test-access-token',
    client_id:'test-client',
    token_endpoint:'https://example.invalid/token',
    expires_at:Math.floor(Date.now()/1000)+3600,
  };
  await fs.writeFile(path.join(configDir,'device-oauth.json'),JSON.stringify(config));
  const r=spawnSync(process.execPath,[path.join(__dirname,'..','agent','enroll.js')],{
    env:{...process.env,HOME:home,GODCONTROL_DEVICE_OAUTH_CONFIG:path.join(configDir,'device-oauth.json')},
    encoding:'utf8',timeout:5000,windowsHide:true,
  });
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/already authorized; no browser login needed/i);
  assert.doesNotMatch(r.stdout,/Open this URL/);
});
