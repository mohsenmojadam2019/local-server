'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const express = require('express');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { Policy } = require('../agent/policy');
const execFileAsync = promisify(execFile);
const HOST = '127.0.0.1';
const PORT = Number(process.env.GODCONTROL_LOCAL_PORT || 8787);
const TOKEN = String(process.env.GODCONTROL_LOCAL_TOKEN || '');
if (!TOKEN) throw new Error('GODCONTROL_LOCAL_TOKEN is required');
const policy = new Policy();
const app = express(); app.disable('x-powered-by'); app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => req.headers.authorization === `Bearer ${TOKEN}` ? next() : res.status(401).json({ error: 'unauthorized' }));
const tools = [
  ['ping','Check local connectivity',{}], ['system_info','Read Windows runtime information',{}],
  ['fs_list','List an approved directory',{path:{type:'string'},depth:{type:'integer'}}],
  ['fs_info','Read approved path metadata',{path:{type:'string'}}], ['fs_read','Read approved text file',{path:{type:'string'},maxBytes:{type:'integer'}}],
  ['git_status','Read git status',{repoPath:{type:'string'}}], ['git_diff','Read git diff',{repoPath:{type:'string'},staged:{type:'boolean'}}],
  ['fs_write','Write an approved file',{path:{type:'string'},content:{type:'string'}}],
  ['edit_block','Edit an approved file',{path:{type:'string'},old_text:{type:'string'},new_text:{type:'string'}}],
  ['remove_path','Remove an approved path',{path:{type:'string'}}],
].map(([name, description, properties]) => ({ name, description, inputSchema: { type:'object', properties, additionalProperties:false } }));
const rpc = (id, value, isError=false) => ({jsonrpc:'2.0',id,result:{content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value,isError}});
async function call(name, a) {
  if (name === 'ping') return {online:true,hostname:os.hostname()};
  if (name === 'system_info') return {hostname:os.hostname(),platform:process.platform,release:os.release(),arch:process.arch,node:process.version};
  if (name === 'fs_list') { const p=await policy.assertPath(a.path); const es=await fs.promises.readdir(p,{withFileTypes:true}); return {path:p,entries:es.map(e=>({name:e.name,type:e.isDirectory()?'directory':'file'}))}; }
  if (name === 'fs_info') { const p=await policy.assertPath(a.path); const s=await fs.promises.stat(p); return {path:p,type:s.isDirectory()?'directory':'file',size:s.size,modified:s.mtime.toISOString()}; }
  if (name === 'fs_read') { const p=await policy.assertPath(a.path); const b=Math.min(Number(a.maxBytes||200000),2000000); return {path:p,content:(await fs.promises.readFile(p)).subarray(0,b).toString('utf8')}; }
  if (name === 'git_status' || name === 'git_diff') { const p=await policy.assertPath(a.repoPath); const args=name==='git_status'?['status','--short']:['diff',...(a.staged?['--cached']:[])]; const o=await execFileAsync('git',args,{cwd:p,windowsHide:true,maxBuffer:1000000}); return {repoPath:p,output:o.stdout}; }
  if (name === 'fs_write') { const p=await policy.assertPath(a.path,true); await fs.promises.mkdir(path.dirname(p),{recursive:true}); await fs.promises.writeFile(p,a.content,'utf8'); return {path:p,written:true}; }
  if (name === 'edit_block') { const p=await policy.assertPath(a.path,true); const t=await fs.promises.readFile(p,'utf8'); if(!t.includes(a.old_text)) throw new Error('old_text not found'); await fs.promises.writeFile(p,t.replace(a.old_text,a.new_text),'utf8'); return {path:p,edited:true}; }
  if (name === 'remove_path') { const p=await policy.assertPath(a.path,true); await fs.promises.rm(p,{recursive:true}); return {path:p,removed:true}; }
  throw new Error('Unknown local tool');
}
app.post('/mcp', async (req,res) => { const {id=null,method,params={}}=req.body||{}; try {
  if(method==='initialize') return res.json({jsonrpc:'2.0',id,result:{protocolVersion:'2025-03-26',capabilities:{tools:{listChanged:false}},serverInfo:{name:'GodControl Local MCP',version:'0.1.0'}}});
  if(method==='notifications/initialized') return res.status(204).end();
  if(method==='tools/list') return res.json({jsonrpc:'2.0',id,result:{tools}});
  if(method==='tools/call') return res.json(rpc(id,await call(params.name,params.arguments||{})));
  return res.status(200).json({jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found'}});
 } catch(e) { return res.status(200).json(rpc(id,{error:e.message},true)); } });
http.createServer(app).listen(PORT,HOST,()=>console.log(`GodControl Local MCP listening on http://${HOST}:${PORT}/mcp`));
