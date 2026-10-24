'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');

async function freePort(){
  const listener=net.createServer();
  await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
  const port=listener.address().port;
  await new Promise(resolve=>listener.close(resolve));
  return port;
}
async function waitForReady(port){
  const started=Date.now();
  while(Date.now()-started<7000){
    try { const res=await fetch('http://127.0.0.1:'+port+'/mcp',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
      if(res.status===401)return;
    }catch {}
    await new Promise(resolve=>setTimeout(resolve,80));
  }
  throw Error('Local MCP did not start');
}
test('loopback MCP requires bearer authentication and obeys approved roots',async(t)=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'gc-local-mcp-'));
  t.after(()=>fs.rm(tmp,{recursive:true,force:true}));
  const port=await freePort();
  const token='test-token-for-local-mcp-safely-randomized-1234567890123';
  const child=spawn(process.execPath,[path.join(__dirname,'..','local-mcp','server.js')],{
    env:{...process.env,GODCONTROL_LOCAL_PORT:String(port),GODCONTROL_LOCAL_TOKEN:token,GODCONTROL_READ_ROOTS:tmp,GODCONTROL_WRITE_ROOTS:tmp,GODCONTROL_ALLOWED_PROGRAMS:'git'},
    stdio:'ignore'
  });
  t.after(()=>child.kill());
  await waitForReady(port);
  const endpoint='http://127.0.0.1:'+port+'/mcp';
  const request=(body,auth)=>fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer '+auth}:{})},body:JSON.stringify(body)});
  assert.equal((await request({jsonrpc:'2.0',id:1,method:'initialize'},'wrong-token')).status,401);
  const init=await (await request({jsonrpc:'2.0',id:1,method:'initialize'},token)).json();
  assert.equal(init.result.serverInfo.name,'GodControl Windows MCP');
  const ping=await (await request({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'ping'}},token)).json();
  assert.equal(ping.result.structuredContent.online,true);
  const deny=await (await request({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'fs_read',arguments:{path:path.join(os.tmpdir(),'outside-root.txt')}}},token)).json();
  assert.equal(deny.result.isError,true);
  assert.match(deny.result.structuredContent.error,/path|root/i);
});
