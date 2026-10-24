'use strict';

/* Loopback-only MCP for the owner-controlled Windows workstation.
 * No public listeners; bearer token and read/write roots are mandatory.
 */
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const express = require('express');
const { Policy } = require('../agent/policy');
const execFileAsync = promisify(execFile);
const policy = new Policy();
const HOST = '127.0.0.1';
const PORT = Number(process.env.GODCONTROL_LOCAL_PORT || 8787);
const TOKEN = process.env.GODCONTROL_LOCAL_TOKEN || process.env.GODCONTROL_TOKEN || '';
if (!TOKEN || TOKEN.length < 32) throw new Error('Local MCP requires a cryptographically strong 32+ character token');
if (!policy.readRoots.length && !policy.writeRoots.length) throw new Error('Local MCP requires explicitly approved filesystem roots');
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) throw new Error('Invalid local MCP port');

const app = express();
app.disable('x-powered-by');
app.use(express.json({limit:'2mb'}));
app.use((req,res,next) => {
  const supplied = req.headers.authorization;
  const expected = 'Bearer ' + TOKEN;
  const left = Buffer.from(typeof supplied === 'string' ? supplied : '');
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left,right)) {
    return res.status(401).json({error:'unauthorized'});
  }
  return next();
});
const operations = [
  'ping', 'system_info', 'fs_list', 'fs_info', 'fs_read', 'search_files',
  'search_content', 'git_status', 'git_diff', 'fs_write', 'edit_block', 'remove_path',
];
function response(id,result,isError=false){
  return {jsonrpc:'2.0',id,result:{content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result,isError}};
}
async function search(root,pattern,mode,maxResults) {
  const start = await policy.assertPath(root);
  const needle = String(pattern || '').toLowerCase();
  if (!needle) throw new Error('Search pattern must not be empty');
  const limit = Math.min(Math.max(1,Number(maxResults)||100),100);
  const matches=[];
  const pending=[{dir:start,depth:0}];
  let visited=0;
  while(pending.length && matches.length<limit && visited<2000){
    const current=pending.shift();
    for(const ent of await fs.readdir(current.dir,{withFileTypes:true})){
      if (++visited>2000 || matches.length>=limit) break;
      if (ent.isSymbolicLink()) continue;
      const full=path.join(current.dir,ent.name);
      if(ent.isDirectory()) {
        if(current.depth<8 && ent.name!=='node_modules' && ent.name!=='.git') pending.push({dir:full,depth:current.depth+1});
        continue;
      }
      if(!ent.isFile()) continue;
      if(mode==='files'){
        if(ent.name.toLowerCase().includes(needle)) matches.push({path:full});
      }else {
        const stat=await fs.stat(full);
        if(stat.size>262144) continue;
        const txt=await fs.readFile(full,'utf8').catch(()=>null);
        if(!txt) continue;
        const i=txt.toLowerCase().indexOf(needle);
        if(i!==-1) matches.push({path:full,excerpt:txt.slice(Math.max(0,i-80),Math.min(txt.length,i+160))});
      }
    }
  }
  return {matches,limited:matches.length>=limit||visited>=2000};
}
async function handleTool(name,a) {
  if(name==='ping') return {online:true,hostname:os.hostname()};
  if(name==='system_info') return {hostname:os.hostname(),platform:process.platform,release:os.release(),arch:process.arch,node:process.version};
  if(name==='fs_list') {
    const p=await policy.assertPath(a.path);
    const entries=await fs.readdir(p,{withFileTypes:true});
    return {path:p,entries:entries.slice(0,500).map(e=>({name:e.name,type:e.isDirectory()?'directory':e.isFile()?'file':'other'})),truncated:entries.length>500};
  }
  if(name==='fs_info') {
    const p=await policy.assertPath(a.path);const s=await fs.stat(p);
    return {path:p,type:s.isDirectory()?'directory':'file',size:s.size,modified:s.mtime.toISOString()};
  }
  if(name==='fs_read') {
    const p=await policy.assertPath(a.path);
    const max=Math.min(Math.max(1,Number(a.maxBytes)||200000),2000000);
    const handle=await fs.open(p,'r');
    try { const bytes=Buffer.alloc(max); const {bytesRead}=await handle.read(bytes,0,max,0); return {path:p,content:bytes.subarray(0,bytesRead).toString('utf8')}; }
    finally { await handle.close(); }
  }
  if(name==='search_files'||name==='search_content') return search(a.root,a.pattern,name==='search_files'?'files':'content',a.maxResults);
  if(name==='git_status'||name==='git_diff'){
    const cwd=await policy.assertPath(a.repoPath);
    const args=name==='git_status'?['status','--short']:['diff',...(a.staged?['--cached']:[])];
    const result=await execFileAsync('git',args,{cwd,windowsHide:true,maxBuffer:1000000,timeout:15000});
    return {repoPath:cwd,output:result.stdout};
  }
  if(name==='fs_write'){
    const p=await policy.assertPath(a.path,true);
    if(typeof a.content!=='string'||Buffer.byteLength(a.content)>1000000) throw new Error('Invalid file content');
    await fs.writeFile(p,a.content,{encoding:'utf8',flag:'w'});
    return {path:p,written:true};
  }
  if(name==='edit_block'){
    const p=await policy.assertPath(a.path,true);
    if(!a.old_text||typeof a.new_text!=='string') throw new Error('Invalid edit');
    const old=await fs.readFile(p,'utf8');
    if(old.indexOf(a.old_text)<0) throw new Error('old_text not found');
    if(old.indexOf(a.old_text)!==old.lastIndexOf(a.old_text)) throw new Error('old_text must be unique');
    await fs.writeFile(p,old.replace(a.old_text,a.new_text),'utf8');
    return {path:p,edited:true};
  }
  if(name==='remove_path'){
    const p=await policy.assertPath(a.path,true);
    const s=await fs.lstat(p);
    if(!s.isFile()) throw new Error('Removal is restricted to regular files');
    await fs.unlink(p);return {path:p,removed:true};
  }
  throw new Error('Unknown local tool');
}
app.post('/mcp',async(req,res)=>{
  const {id=null,method,params={}}=req.body||{};
  try{
    if(method==='initialize') return res.json({jsonrpc:'2.0',id,result:{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'GodControl Windows MCP',version:'0.1.0'}}});
    if(method==='notifications/initialized') return res.status(204).end();
    if(method==='tools/list') return res.json({jsonrpc:'2.0',id,result:{tools:operations.map(n=>({name:n,description:'Approved local operation '+n,inputSchema:{type:'object',additionalProperties:true}}))}});
    if(method==='tools/call') return res.json(response(id,await handleTool(params.name,params.arguments||{})));
    return res.json({jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found'}});
  }catch(error){return res.json(response(id,{error:error.message},true));}
});
if(require.main===module){
  http.createServer(app).listen(PORT,HOST,()=>console.log('GodControl local MCP ready on loopback port '+PORT));
}
module.exports={app,handleTool};
