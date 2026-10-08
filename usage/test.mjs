import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { collect, validatePayload, encryptPayload, decryptEnvelope, localBucket, loadConfig, publishPayload, payloadHash, main, serializePayload, prepareLog, withConfigLock, fetchDatabaseRows, writePrivate, ghHttpOutcome } from './collect.mjs';

import { makeScratch } from './test-fixture.mjs';
const { dir, cleanup } = makeScratch();
process.on('exit', cleanup); // Also covers fixture setup failures before tests run.
const home = path.join(dir,'fixture-owner'), aaFile = path.join(dir,'models.js');
function put(file,value) { fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value),{mode:0o600}); }
const iso='2026-10-07T03:59:00.000Z', ts=Date.parse(iso), day2=ts+120000;
const roots=[['claude','.claude/projects','claudeAgent'],['codex','.codex/sessions','codex'],['codex','.codex-t3-api/sessions','codex_openai_api'],['grok','.grok/sessions','grok']];
const cache={version:5,sources:{},models:['claude-opus-5-5','gpt-6.1-sol','grok-4.7-build','<synthetic>'],sessions:['private-session-marker','s2','s3','s4'],files:{}};
for(const [p,r] of roots){const d=path.join(home,r);cache.sources[p+'\0'+d]={dir:d};}
const cf=path.join(home,'.claude/projects/-work-ai-model-frontier/session.jsonl');
const claude={timestamp:iso,cwd:'/Users/fixture-owner/ai-model-frontier',prompt:'private-prompt-marker',path:'/Users/fixture-owner/private-file',requestId:'req1',sessionId:'private-session-marker',message:{id:'msg1',model:cache.models[0],content:'private-message-marker',title:'private-title-marker',usage:{input_tokens:2,cache_read_input_tokens:90,cache_creation_input_tokens:10,output_tokens:8}}};
put(cf,[claude,claude].map(x=>JSON.stringify(x)).join('\n')+'\n');
cache.files[cf]={p:'claude',r:[[ts,0,0,2,90,10,8,0,'msg1:req1',null,0],[ts,0,0,2,90,10,8,0,'msg1:req1',null,0],[ts,3,0,0,0,0,0,0,null,null,0]]};
const codexRaw=(file,session,time,input,read,write,output)=>{const meta={type:'session_meta',payload:{id:session,cwd:'/work/ai-model-frontier'}},context={type:'turn_context',payload:{model:cache.models[1]}},event={timestamp:new Date(time).toISOString(),payload:{type:'token_count',info:{last_token_usage:{input_tokens:input,cached_input_tokens:read,cache_write_input_tokens:write,output_tokens:output,reasoning_output_tokens:1}}}};put(file,[meta,context,event].map(x=>JSON.stringify(x)).join('\n')+'\n');};
const xf=path.join(home,'.codex/sessions/first.jsonl');codexRaw(xf,'s2',ts,120,100,10,5);cache.files[xf]={p:'codex',r:[[ts,1,1,10,100,10,5,1,null,null,0]]};
const fork=path.join(home,'.codex/sessions/fork.jsonl');codexRaw(fork,'s2',ts,120,100,10,5);cache.files[fork]={p:'codex',r:[[ts,1,1,10,100,10,5,1,null,null,0]]};
const af=path.join(home,'.codex-t3-api/sessions/api.jsonl');codexRaw(af,'s4',ts,130,100,10,6);cache.files[af]={p:'codex',r:[[ts,1,3,20,100,10,6,1,null,null,1]]};
const gf=path.join(home,'.grok/sessions/%2Fwork%2Fai-model-frontier/session/events.jsonl');
const gu={inputTokens:120,cachedReadTokens:100,cacheCreationTokens:10,outputTokens:5,reasoningTokens:1,modelCalls:5,costUsdTicks:10000000000};
put(gf,JSON.stringify({timestamp:ts/1000,params:{update:{sessionUpdate:'turn_completed',usage:{modelUsage:{'grok-4.7-build':gu}}},_meta:{agentTimestampMs:ts}}})+'\n');cache.files[gf]={p:'grok',r:[[ts,2,3,10,100,10,5,1,'g1',1,0]]};
const cacheFile=path.join(home,'.t3/userdata/usage-scan-cache-v5.json');put(cacheFile,cache);
put(path.join(home,'.t3/userdata/settings.json'),{providerInstances:{claudeAgent:{driver:'claudeAgent',displayName:'Claude',config:{}}},usageModelAliases:{'gemini-3.8-flash-high':'gemini-3.8-flash'}});
put(path.join(home,'.t3/userdata/usage-model-rates.json'),{document:{'claude-opus-5-5':{input_cost_per_token:4e-6,output_cost_per_token:20e-6,cache_read_input_token_cost:.2e-6,cache_creation_input_token_cost:5e-6},'gpt-6.1-sol':{input_cost_per_token:2e-6,output_cost_per_token:10e-6},'gemini-3.8-flash':{input_cost_per_token:1e-6,output_cost_per_token:2e-6}}});
put(aaFile,'window.AA_DATA={models:'+JSON.stringify([{family:'claude-opus-5-5',familyName:'Claude Opus 5.5',creatorSlug:'anthropic',priceInput:4,priceOutput:20},{family:'gpt-6-1-sol',familyName:'GPT-6.1 Sol',creatorSlug:'openai',priceInput:2,priceOutput:10},{family:'grok-4-7',familyName:'Grok 4.7',creatorSlug:'xai',priceInput:2,priceOutput:6},{family:'gemini-3-8-flash',familyName:'Gemini 3.8 Flash',creatorSlug:'google',priceInput:1,priceOutput:2}])+ '};');
const ocFile=path.join(home,'.local/share/opencode/opencode.db');fs.mkdirSync(path.dirname(ocFile),{recursive:true});
const oc=new DatabaseSync(ocFile);
oc.exec('PRAGMA journal_mode=WAL; CREATE TABLE message(id TEXT,session_id TEXT,time_created INTEGER,data TEXT); CREATE TABLE session(id TEXT,directory TEXT); CREATE TABLE session_message(id TEXT,session_id TEXT,time_created INTEGER,type TEXT,data TEXT); CREATE TABLE session_v2(id TEXT,directory TEXT)');
oc.prepare('INSERT INTO session VALUES(?,?)').run('o1','/work/ai-model-frontier');oc.prepare('INSERT INTO session_v2 VALUES(?,?)').run('o1','/work/ai-model-frontier');
const ot={input:10,output:3,reasoning:7,cache:{read:90,write:0}},om={tokens:ot,cost:.125,time:{completed:day2},model:{providerID:'opencode',id:'glm-5.3-flash'}};
oc.prepare('INSERT INTO session_message VALUES(?,?,?,?,?)').run('m1','o1',day2-500,'assistant',JSON.stringify(om));
oc.prepare('INSERT INTO message VALUES(?,?,?,?)').run('m1','o1',day2-500,JSON.stringify({...om,role:'assistant',modelID:'glm-5.3-flash',providerID:'opencode'}));
oc.prepare('INSERT INTO session_message VALUES(?,?,?,?,?)').run('zero','o1',day2,'assistant',JSON.stringify({...om,tokens:{input:0,output:0,reasoning:0,cache:{read:0,write:0}},cost:0}));oc.close();
const t3File=path.join(home,'.t3/userdata/statev2.sqlite'),db=new DatabaseSync(t3File);
db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE orchestration_v2_projection_provider_turns(provider_turn_id TEXT,provider_thread_id TEXT,thread_id TEXT,run_attempt_id TEXT,started_at TEXT,completed_at TEXT,payload_json TEXT); CREATE TABLE orchestration_v2_projection_run_attempts(attempt_id TEXT,run_id TEXT,provider TEXT,provider_instance_id TEXT,payload_json TEXT); CREATE TABLE orchestration_v2_projection_runs(run_id TEXT,provider TEXT,provider_instance_id TEXT,payload_json TEXT); CREATE TABLE orchestration_v2_projection_provider_threads(provider_thread_id TEXT,provider_session_id TEXT,provider TEXT,driver TEXT,provider_instance_id TEXT); CREATE TABLE orchestration_v2_projection_provider_sessions(provider_session_id TEXT,model TEXT,provider TEXT,driver TEXT,provider_instance_id TEXT); CREATE TABLE projection_threads(thread_id TEXT,project_id TEXT); CREATE TABLE projection_projects(project_id TEXT,workspace_root TEXT);`);
db.prepare('INSERT INTO projection_projects VALUES(?,?)').run('p','/work/ai-model-frontier');db.prepare('INSERT INTO projection_threads VALUES(?,?)').run('t','p');
const addTurn=(driver,usage,model,id)=>{db.prepare('INSERT INTO orchestration_v2_projection_provider_threads VALUES(?,?,?,?,?)').run(id,id,driver,driver,driver);db.prepare('INSERT INTO orchestration_v2_projection_provider_sessions VALUES(?,?,?,?,?)').run(id,model,driver,driver,driver);db.prepare('INSERT INTO orchestration_v2_projection_provider_turns VALUES(?,?,?,?,?,?,?)').run(id,id,'t',null,new Date(day2-1000).toISOString(),new Date(day2+1000).toISOString(),JSON.stringify({turnTokenUsage:usage,modelSelection:{model}}));};
const usage={inputTokens:100,cachedInputTokens:90,cacheCreationTokens:0,outputTokens:10,reasoningTokens:7,usageScope:'main_agent',hasSubagents:false,usageStatus:'complete'};
addTurn('opencode',usage,'opencode/glm-5.3-flash','o');addTurn('antigravity',{...usage,inputTokens:150,cachedInputTokens:100,cacheCreationTokens:10,outputTokens:20,reasoningTokens:5},'gemini-3.8-flash-high','a');db.close();
const options={home,aaFile,projects:true,tz:'America/New_York',now:new Date('2026-10-07T12:00:00Z')};
const result=await collect(options),p=result.payload;

test('combined sources normalize tokens, count Grok calls, remove copies and join aliases',()=>{
  assert.equal(validatePayload(p),true);assert.deepEqual(result.checks,{cacheSamples:4,cacheDuplicates:2,syntheticDropped:1,openCodeMigrationDuplicates:1,openCodeZeroUsageDropped:1,t3OverlapExcluded:1,openCodeTurnsReconciled:1,t3MissingTelemetry:0,antigravityFiles:0,antigravityCopiesCollapsed:0,antigravityUnreadable:0});
  assert.deepEqual(p.projects,['ai-model-frontier']);assert.deepEqual(p.range,{first:'2026-10-06',last:'2026-10-07'});
  const all=p.days.flatMap(d=>d.r);assert.equal(all.reduce((n,r)=>n+r[3],0),10);
  const rowFor=id=>all.find(r=>p.models[r[0]].id===id);
  assert.deepEqual(rowFor('opencode/glm-5.3-flash').slice(3),[1,10,90,0,10,7,.125]);
  assert.deepEqual(rowFor('gemini-3.8-flash-high').slice(4,9),[40,100,10,20,5]);
  assert.equal(p.models.find(m=>m.id==='gemini-3.8-flash-high').aa,'gemini-3-8-flash');
  assert.equal(p.instances.find(i=>i.id==='codex_openai_api').billing,'api');
});
test('local midnight and repeated DST hour bucket correctly',()=>{
  assert.deepEqual(localBucket(ts,'America/New_York'),{day:'2026-10-06',weekday:2,hour:23});
  assert.deepEqual(localBucket(day2,'America/New_York'),{day:'2026-10-07',weekday:3,hour:0});
  assert.deepEqual(localBucket(Date.parse('2026-11-01T05:30:00Z'),'America/New_York'),localBucket(Date.parse('2026-11-01T06:30:00Z'),'America/New_York'));
});
test('Node encryption roundtrip and authentication reject wrong keys/tampering',()=>{
  const key=randomBytes(32),e=encryptPayload(p,key);assert.deepEqual(decryptEnvelope(e,key),p);assert.equal(Buffer.from(e.iv,'base64url').length,12);assert.throws(()=>decryptEnvelope(e,randomBytes(32)),/decryption/);
  const ct=Buffer.from(e.ct,'base64url');ct[0]^=1;assert.throws(()=>decryptEnvelope({...e,ct:ct.toString('base64url')},key),/decryption/);
  assert.notEqual(encryptPayload(p,key).iv,e.iv);
});
test('validator rejects raw/private fields, paths, bad groups and inconsistent totals',()=>{
  for(const edit of [x=>x.prompt='forbidden-field',x=>x.projects[0]='/work/private',x=>x.days[0].r.push(x.days[0].r[0]),x=>x.hours[0][2]++,x=>x.days[0].r[0][8]=x.days[0].r[0][7]+1]){const x=structuredClone(p);edit(x);assert.throws(()=>validatePayload(x));}
});
test('omitting projects does not change metered totals or leak basenames',async()=>{
  const {payload:q}=await collect({...options,projects:false});assert.deepEqual(q.projects,[]);assert(q.days.every(d=>d.r.every(r=>r[2]===-1)));assert.equal(q.days.flatMap(d=>d.r).reduce((n,r)=>n+r[3],0),10);
});
test('malformed cache fails before publication; sqlite databases stay unchanged',async()=>{
  const hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex'),before=[hash(ocFile),hash(t3File)];await collect(options);assert.deepEqual([hash(ocFile),hash(t3File)],before);
  const bad=structuredClone(cache);bad.files[cf].r[0].push(0);put(cacheFile,bad);await assert.rejects(collect(options),/row layout/);put(cacheFile,cache);
  const drift=structuredClone(cache);drift.files[cf].r[0][3]++;put(cacheFile,drift);await assert.rejects(collect(options),/sampled rows/);put(cacheFile,cache);
  fs.renameSync(cf,cf+'.backup');fs.symlinkSync(aaFile,cf);
  try{await assert.rejects(collect(options),/escapes its source root/);}finally{fs.unlinkSync(cf);fs.renameSync(cf+'.backup',cf);}
});
test('missing optional OpenCode database uses per-turn fallback with unknown cost intact',async()=>{
  fs.renameSync(ocFile,ocFile+'.backup');
  try{
    const r=await collect(options);assert.equal(r.checks.t3OverlapExcluded,0);
    const m=r.payload.models.findIndex(m=>m.id==='opencode/glm-5.3-flash');
    const row=r.payload.days.flatMap(d=>d.r).find(x=>x[0]===m);
    assert.deepEqual(row.slice(4,9),[10,90,0,10,7]);assert.equal(row[9],null);
    assert(r.warnings.some(x=>x.includes('OpenCode database is missing')));
    assert(r.warnings.some(x=>x.includes('Unpriced models:')));
    assert.equal(r.payload.instances.find(x=>x.id==='opencode').requestUnit,'turns');
    assert(r.payload.coverage.some(c=>c.code==='unpriced_model'&&c.modelIdx===m));
  }finally{fs.renameSync(ocFile+'.backup',ocFile);}
});
test('allowlist serializer and source fixtures omit prompts, paths, titles, session IDs and secrets',async()=>{
  const q=(await collect({...options,projects:false})).payload;
  const enriched=structuredClone(q);
  enriched.prompt='private-prompt-marker';enriched.path='/Users/fixture-owner/private-file';
  enriched.sources[0].sessionId='private-session-marker';enriched.models[0].secret='private-secret-marker';
  enriched.days[0].title='private-title-marker';enriched.days[0].r[0].message='private-message-marker';
  const clean=serializePayload(enriched,{home}),json=JSON.stringify(clean);
  for(const forbidden of ['private-prompt-marker','private-session-marker','private-secret-marker','private-title-marker','private-message-marker','/Users/','fixture-owner','/Users/fixture-owner/private-file']) assert(!json.includes(forbidden));
  assert.deepEqual(clean,q);
  const walk=(x,field='')=>{
    if(typeof x==='string') {
      assert(!x.includes('/Users/'));assert(!x.toLowerCase().includes(path.basename(home)));
      // Exact schema/IANA/route syntax is protocol metadata, not a filesystem path.
      if(field==='schema')assert.equal(x,'aimf-usage/1');
      else if(field==='tz')assert.equal(x,'America/New_York');
      else if(/^models\.\d+\.id$/.test(field)&&x.includes('/'))assert.match(x,/^[a-z0-9._-]+\/[a-zA-Z0-9][a-zA-Z0-9._:@+-]*$/);
      else assert(!/[\\/]/.test(x));
    } else if(x&&typeof x==='object') for(const [k,v] of Object.entries(x))walk(v,field?`${field}.${k}`:k);
  };
  walk(q);
  for(const value of ['/Users/fixture-owner/private','fixture-owner','relative/private','relative\\private']){
    const bad=structuredClone(q);bad.instances[0].label=value;assert.throws(()=>validatePayload(bad,{home}),/path|home/);
  }
});
test('projects require opt-in, denylist omits sensitive folders and single-day names fold',async()=>{
  const defaultPayload=(await collect({home,aaFile,tz:options.tz,now:options.now})).payload;
  assert.deepEqual(defaultPayload.projects,[]);assert(defaultPayload.days.every(d=>d.r.every(r=>r[2]===-1)));
  const original=fs.readFileSync(cf,'utf8');
  const withProject=name=>original.replaceAll('/Users/fixture-owner/ai-model-frontier',`/Users/fixture-owner/${name}`);
  try {
    put(cf,withProject('one-day-folder'));
    const q=(await collect(options)).payload;assert.deepEqual(q.projects,['(other)','ai-model-frontier']);assert(!JSON.stringify(q).includes('one-day-folder'));
    for(const name of ['taxes-client','medical-notes','secret-plan','interview-prep','fixture-owner-project']) {
      put(cf,withProject(name));const q=(await collect(options)).payload;assert(!JSON.stringify(q).includes(name));
      const model=q.models.findIndex(m=>m.id==='claude-opus-5-5');assert.equal(q.days.flatMap(d=>d.r).find(r=>r[0]===model)[2],-1);
    }
    put(cf,withProject('custom-sensitive'));
    const custom=(await collect({...options,projectDenylist:['custom-sensitive']})).payload;assert(!JSON.stringify(custom).includes('custom-sensitive'));
  } finally {put(cf,original);}
});
function rawEnvelope(text,key,aad='aimf-usage-enc/1|A256GCM|gzip') {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);if(aad!==null)cipher.setAAD(Buffer.from(aad));
  const ct=Buffer.concat([cipher.update(gzipSync(Buffer.from(text))),cipher.final(),cipher.getAuthTag()]);
  return {schema:'aimf-usage-enc/1',alg:'A256GCM',zip:'gzip',iv:iv.toString('base64url'),ct:ct.toString('base64url')};
}
test('AAD is mandatory, alg/zip are pinned, and decompression stops at 8 MiB',()=>{
  const key=randomBytes(32),e=encryptPayload(p,key),ct=Buffer.from(e.ct,'base64url');
  const d=createDecipheriv('aes-256-gcm',key,Buffer.from(e.iv,'base64url'));d.setAAD(Buffer.from('aimf-usage-enc/1|A256GCM|gzip'));d.setAuthTag(ct.subarray(-16));assert(Buffer.concat([d.update(ct.subarray(0,-16)),d.final()]).length>0);
  for(const aad of [null,'wrong-associated-data'])assert.throws(()=>decryptEnvelope(rawEnvelope(JSON.stringify(p),key,aad),key),/decryption/);
  for(const edit of [{alg:'none'},{alg:'A128GCM'},{zip:'none'}])assert.throws(()=>decryptEnvelope({...e,...edit},key),/invalid format/);
  const json=JSON.stringify(p),atLimit=json+' '.repeat(8*1024*1024-Buffer.byteLength(json));
  assert.deepEqual(decryptEnvelope(rawEnvelope(atLimit,key),key),p);
  assert.throws(()=>decryptEnvelope(rawEnvelope(atLimit+' ',key),key),/decryption/);
});
test('config and log are 0600; old config migrates without rotating the key',()=>{
  const a=loadConfig(home),old=a.config.key;assert.equal(fs.statSync(a.file).mode&0o777,0o600);assert.equal(a.config.gistId,null);
  assert.deepEqual(a.config.projectDenylist,['taxes','medical','secret','interview']);
  put(a.file,{key:old,gistId:null});const b=loadConfig(home);assert.equal(b.config.key,old);assert.deepEqual(b.config.projectDenylist,a.config.projectDenylist);
  const log=prepareLog(home);fs.chmodSync(log,0o644);assert.equal(fs.statSync(prepareLog(home)).mode&0o777,0o600);
  const link=path.join(dir,'log-target');put(link,'keep');fs.unlinkSync(log);fs.symlinkSync(link,log);assert.throws(()=>prepareLog(home));fs.unlinkSync(log);prepareLog(home);
});
function ghHarness() {
  const fixture=fs.mkdtempSync(path.join(dir,'gh-')),store=path.join(fixture,'mock.json'),fake=path.join(fixture,'gh');
  put(store,{gists:{},calls:[],next:0,mode:'normal'});
  put(fake,`#!${process.execPath}
const fs=require('node:fs'),a=process.argv.slice(2),f=process.env.AIMF_TEST_GH_STORE,gate=f+'.lock';
for(;;){try{fs.mkdirSync(gate,{mode:448});break;}catch(e){if(e.code!=='EEXIST')throw e;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5);}}
const s=JSON.parse(fs.readFileSync(f));
const method=a.includes('--method')?a[a.indexOf('--method')+1]:'GET',endpoint=a.find(x=>x==='user'||x==='gists'||x.startsWith('gists/')||x.startsWith('users/'));
const body=a.includes('--input')?JSON.parse(fs.readFileSync(0,'utf8')):null;
s.calls.push({method,endpoint,args:a,body});let out,status=0,http=200;
if(s.delayMs) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,s.delayMs);
if(method==='POST'){
  if(s.mode==='post-failure'){status=1;}else{
    const id=(++s.next).toString(16).padStart(32,'a');out={...body,id,owner:{login:'fixture-owner'},public:s.mode.startsWith('public')?true:body.public};s.gists[id]=out;
  }
}else if(method==='PATCH'){const id=endpoint.split('/')[1];out={...s.gists[id],...body};s.gists[id]=out;}
else if(method==='DELETE'){const id=endpoint.split('/')[1];if(s.mode==='delete-false-404'||s.mode==='changed-account'||s.mode==='reduced-scope'){status=1;http=404;}else if(s.mode.includes('delete-failure')){status=1;http=503;}else if(s.mode==='delete-auth-failure'){status=1;http=401;}else if(s.mode==='delete-network-failure'){status=1;http=null;}else if(!s.gists[id]){status=1;http=404;}else{delete s.gists[id];out=null;http=204;if(s.mode==='lost-delete-reply'){status=1;http=null;}}}
else if(endpoint.startsWith('users/')){if(s.mode.startsWith('list-failure')){status=1;}else{out=[[],Object.values(s.gists).map(g=>({id:g.id,public:g.public===true||s.mode.startsWith('listed')}))];if(s.mode==='list-unflagged')out=[[{id:'f'.repeat(32)}]];}}
else if(endpoint==='gists'){out=[Object.values(s.gists)];}
else if(endpoint==='user'){out={login:s.mode==='changed-account'?'different-account':'fixture-owner'};if(s.mode==='auth-failure'){status=1;http=401;}}
else {out=s.gists[endpoint.split('/')[1]];if(!out||s.mode==='changed-account'||s.mode==='reduced-scope'){status=1;http=404;}}
fs.writeFileSync(f,JSON.stringify(s),{mode:384});fs.rmdirSync(gate);if(s.mode==='kill-after-delete'&&method==='DELETE'&&http===204)process.kill(process.ppid,'SIGKILL');if(a.includes('--include')&&http!==null)process.stdout.write('HTTP/2.0 '+http+' Fixture\\r\\nX-OAuth-Scopes: '+(s.mode==='reduced-scope'?'read:user':'gist, read:user')+'\\r\\n\\r\\n');if(status){process.stderr.write('sensitive diagnostic deliberately suppressed');process.exit(status);}if(out!==null)process.stdout.write(JSON.stringify(out));
`);fs.chmodSync(fake,0o700);
  const state=()=>JSON.parse(fs.readFileSync(store)),mode=x=>{const s=state();s.mode=x;put(store,s);};
  const runner=(cmd,args,o)=>{
    assert.equal(cmd,fake);
    const config=loadConfig(home).config;
    assert(!JSON.stringify(args).includes(config.key));
    if(o.input){const body=JSON.parse(o.input),content=body.files?.['aimf-usage.json']?.content; if(content){assert(!JSON.stringify(args).includes(content));assert(!JSON.stringify(args).includes(JSON.parse(content).ct));assert(!o.input.includes(config.key));}}
    return spawnSync(cmd,args,{...o,env:{...process.env,AIMF_TEST_GH_STORE:store}});
  };
  return {state,mode,runner,ghPath:fake,store};
}
function resetConfig(){const a=loadConfig(home);a.config.gistId=null;delete a.config.pendingDeleteGistId;delete a.config.publication;delete a.config.gistOwner;put(a.file,a.config);return a;}
async function capture(fn){const output=[],log=console.log,error=console.error;console.log=(...xs)=>output.push(xs.join(' '));console.error=(...xs)=>output.push(xs.join(' '));try{await fn();return output.join('\n');}finally{console.log=log;console.error=error;}}

test('mocked gh exercises CLI boolean create, public-list verification, skip, PATCH and new-gist rotation',async()=>{
  resetConfig();const h=ghHarness(),deps={home,aaFile,runner:h.runner,ghPath:h.ghPath};
  const output=await capture(()=>main(['--publish'],deps));
  let cfg=loadConfig(home),remote=h.state().gists[cfg.config.gistId];
  assert.equal(remote.public,false);assert.equal(remote.description,'note');assert.deepEqual(Object.keys(remote.files),['aimf-usage.json']);
  assert(!output.includes(cfg.config.key));assert(!output.includes(cfg.config.gistId));assert(!output.includes('#usage='));
  const e=JSON.parse(remote.files['aimf-usage.json'].content),q=(await collect({home,aaFile})).payload;
  assert.equal(payloadHash(decryptEnvelope(e,Buffer.from(cfg.config.key,'base64url'))),payloadHash(q));assert.deepEqual(decryptEnvelope(e,Buffer.from(cfg.config.key,'base64url')).projects,[]);
  assert.deepEqual(h.state().calls.map(c=>[c.method,c.endpoint]),[['GET','user'],['POST','gists'],['GET','users/fixture-owner/gists']]);
  assert.deepEqual(h.state().calls[1].args,['api','--method','POST','gists','--input','-']);assert.equal(typeof h.state().calls[1].body.public,'boolean');
  await main(['--publish','--quiet'],deps);assert.equal(h.state().calls.at(-1).method,'GET');assert.equal(h.state().calls.filter(c=>c.method==='POST'||c.method==='PATCH').length,1);
  const changed=structuredClone(q);changed.models[0].label+=' updated';await publishPayload(changed,cfg.config,cfg.file,h);assert.equal(h.state().calls.at(-1).method,'PATCH');
  const patched=JSON.parse(h.state().gists[cfg.config.gistId].files['aimf-usage.json'].content);assert.notEqual(patched.iv,e.iv);
  const oldKey=cfg.config.key,oldId=cfg.config.gistId;
  await main(['--rotate','--quiet'],deps);cfg=loadConfig(home);assert.notEqual(cfg.config.key,oldKey);assert.notEqual(cfg.config.gistId,oldId);assert(!h.state().gists[oldId]);
  assert.deepEqual(h.state().calls.slice(-3).map(c=>c.method),['POST','GET','DELETE']);assert.equal(h.state().calls.at(-1).endpoint,`gists/${oldId}`);
  const re=JSON.parse(h.state().gists[cfg.config.gistId].files['aimf-usage.json'].content);assert.throws(()=>decryptEnvelope(re,Buffer.from(oldKey,'base64url')));assert.equal(decryptEnvelope(re,Buffer.from(cfg.config.key,'base64url')).schema,'aimf-usage/1');
  const before=h.state().calls.length;await assert.rejects(main(['--publish','--link'],deps),/separately/);await assert.rejects(main(['--rotate','--link'],deps),/separately/);assert.equal(h.state().calls.length,before);
  const link=await capture(()=>main(['--link'],deps));assert(link.includes(`#usage=${cfg.config.gistId}.${cfg.config.key}`));
  await assert.rejects(()=>publishPayload(q,cfg.config,cfg.file,{runner:()=>({status:1,stderr:'sensitive output'})}),/authentication locally/);
});
test('public or listed new gists are deleted, unverified lists abort, config remains unchanged',async()=>{
  // Signed in, GitHub lists the owner's secret gists too (public: false): 'listed' means listed as public.
  for(const mode of ['public','listed','list-failure','list-unflagged']) {
    const cfg=resetConfig(),before=fs.readFileSync(cfg.file,'utf8'),h=ghHarness();h.mode(mode);
    await assert.rejects(()=>publishPayload(p,cfg.config,cfg.file,h),/secret|public list|gist list|authentication/);
    assert.deepEqual(JSON.parse(fs.readFileSync(cfg.file)),JSON.parse(before));assert.deepEqual(h.state().gists,{});assert.equal(h.state().calls.at(-1).method,'DELETE');
  }
});
test('rotation failure retains the old key/id; deletion failure is persisted and retried',async()=>{
  const cfg=resetConfig(),h=ghHarness();await publishPayload(p,cfg.config,cfg.file,h);
  const oldKey=cfg.config.key,oldId=cfg.config.gistId,before=fs.readFileSync(cfg.file,'utf8');h.mode('post-failure');
  await assert.rejects(()=>publishPayload(p,cfg.config,cfg.file,{...h,rotate:true}),/authentication/);assert.equal(loadConfig(home).config.key,oldKey);assert.equal(loadConfig(home).config.gistId,oldId);assert.equal(loadConfig(home).config.publication.state,'creating');assert(h.state().gists[oldId]);
  // A failed POST without an identifiable response is fail closed. This mock
  // positively knows it never created anything; reset its test-only intent.
  put(cfg.file,JSON.parse(before));
  h.mode('delete-failure');await assert.rejects(()=>publishPayload(p,cfg.config,cfg.file,{...h,rotate:true}),/retry --publish/);
  const stored=loadConfig(home);assert.notEqual(stored.config.key,oldKey);assert.notEqual(stored.config.gistId,oldId);assert.equal(stored.config.pendingDeleteGistId,oldId);assert(h.state().gists[oldId]);
  h.mode('normal');assert.deepEqual(await publishPayload(p,stored.config,stored.file,h),{uploaded:false});assert(!h.state().gists[oldId]);assert(!loadConfig(home).config.pendingDeleteGistId);
});
test('existing public gists or envelopes with unauthenticated metadata are refused without PATCH',async()=>{
  const cfg=resetConfig(),h=ghHarness();await publishPayload(p,cfg.config,cfg.file,h);
  let s=h.state();s.gists[cfg.config.gistId].public=true;put(path.join(path.dirname(h.ghPath),'mock.json'),s);
  await assert.rejects(()=>publishPayload(p,cfg.config,cfg.file,h),/must be secret/);
  s=h.state();s.gists[cfg.config.gistId].public=false;s.gists[cfg.config.gistId].files['aimf-usage.json'].content=JSON.stringify(rawEnvelope(JSON.stringify(p),Buffer.from(cfg.config.key,'base64url'),null));put(path.join(path.dirname(h.ghPath),'mock.json'),s);
  await assert.rejects(()=>publishPayload(p,cfg.config,cfg.file,h),/cannot be authenticated/);assert(!h.state().calls.some(c=>c.method==='PATCH'));
});
test('CLI project opt-in reads the private config denylist, writes private output and stays local',async()=>{
  const cfg=resetConfig(),h=ghHarness(),deps={home,aaFile,runner:h.runner,ghPath:h.ghPath},out=path.join(dir,'cli.local.json');
  await capture(()=>main(['--projects','--out',out],deps));assert.deepEqual(JSON.parse(fs.readFileSync(out)).projects,['ai-model-frontier']);
  cfg.config.projectDenylist.push('ai-model-frontier');put(cfg.file,cfg.config);
  try {
    const output=await capture(()=>main(['--projects','--out',out],deps));const q=JSON.parse(fs.readFileSync(out));assert.deepEqual(q.projects,[]);assert(q.days.every(d=>d.r.every(r=>r[2]===-1)));
    assert(!output.includes(cfg.config.key));assert.equal(fs.statSync(out).mode&0o777,0o600);assert.equal(fs.statSync(prepareLog(home)).mode&0o777,0o600);assert.equal(h.state().calls.length,0);
  } finally {cfg.config.projectDenylist.pop();put(cfg.file,cfg.config);fs.rmSync(out,{force:true});}
});
test('LaunchAgent template pins absolute node/gh, only publishes quietly and never writes plaintext',()=>{
  const plist=fs.readFileSync(new URL('./com.cornishandy.aimf-usage.plist',import.meta.url),'utf8');
  assert(plist.includes('<string>/opt/homebrew/bin/node</string>'));assert(plist.includes('<key>AIMF_USAGE_GH</key><string>/opt/homebrew/bin/gh</string>'));
  const flags=[...plist.matchAll(/<string>(--[^<]+)<\/string>/g)].map(m=>m[1]);assert.deepEqual(flags,['--publish','--quiet']);
  assert(!plist.includes('--out'));assert(!plist.includes('--link'));
  assert(plist.includes('<key>Umask</key><integer>63</integer>'));
});
test.after(cleanup);

function childCLI(fixtureHome, h, args, modelsFile=aaFile) {
  const script = `import { main } from ${JSON.stringify(new URL('./collect.mjs',import.meta.url).href)}; main(process.argv.slice(1),{home:process.env.AIMF_TEST_HOME,aaFile:process.env.AIMF_TEST_AA}).catch(error=>{console.error(error.message);process.exitCode=1;});`;
  const child=spawn(process.execPath,['--input-type=module','-e',script,'--',...args],{env:{...process.env,AIMF_TEST_HOME:fixtureHome,AIMF_TEST_AA:modelsFile,AIMF_USAGE_GH:h.ghPath,AIMF_TEST_GH_STORE:h.store},stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
  const done=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Fixture child timed out'));},20000);
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.on('exit',(code,signal)=>{clearTimeout(timer);resolve({code,signal,stdout,stderr});});
  });
  return {child,done};
}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitUntil(predicate){for(let i=0;i<400;i++){if(predicate())return;await delay(10);}throw Error('Fixture synchronization timed out');}
function cloneHome() {
  const destination=path.join(fs.mkdtempSync(path.join(dir,'concurrent-')),'fixture-owner');
  fs.cpSync(home,destination,{recursive:true});
  put(path.join(destination,'.t3/userdata/usage-scan-cache-v5.json'),fs.readFileSync(cacheFile,'utf8').replaceAll(home,destination));
  fs.rmSync(path.join(destination,'.config'),{recursive:true,force:true});
  return destination;
}
function trackedRemote(fixtureHome,h) {
  const cfg=loadConfig(fixtureHome),ids=Object.keys(h.state().gists);
  assert.equal(ids.length,1);assert.equal(ids[0],cfg.config.gistId);assert(!cfg.config.pendingDeleteGistId);
  assert(!fs.existsSync(cfg.file+'.lock'));
  return decryptEnvelope(JSON.parse(h.state().gists[ids[0]].files['aimf-usage.json'].content),Buffer.from(cfg.config.key,'base64url'));
}
async function overlap(fixtureHome,h,args,firstAA=aaFile,secondAA=aaFile) {
  const first=childCLI(fixtureHome,h,args,firstAA);
  const lockFile=path.join(fixtureHome,'.config/ai-model-frontier/usage.json.lock');
  await waitUntil(()=>fs.existsSync(lockFile)&&JSON.parse(fs.readFileSync(lockFile)).nonce);
  const second=childCLI(fixtureHome,h,args,secondAA);
  // The second really exists while the first owns the lifecycle lock.
  assert.equal(first.child.exitCode,null);assert.equal(second.child.exitCode,null);
  const results=await Promise.all([first.done,second.done]);
  for(const r of results){assert.equal(r.code,0,'Concurrent fixture collector failed');assert(!r.stdout.includes('#usage='));}
  return results;
}

test('two real processes serialize first publish, changed updates and rotations',async()=>{
  const fixtureHome=cloneHome(),h=ghHarness();let s=h.state();s.delayMs=90;put(h.store,s);
  await overlap(fixtureHome,h,['--publish','--quiet']);trackedRemote(fixtureHome,h);
  assert.equal(h.state().calls.filter(c=>c.method==='POST').length,1);
  const firstAA=path.join(dir,'models-first.js'),secondAA=path.join(dir,'models-second.js');
  put(firstAA,fs.readFileSync(aaFile,'utf8').replace('GPT-6.1 Sol','First captured update'));
  put(secondAA,fs.readFileSync(aaFile,'utf8').replace('GPT-6.1 Sol','Second captured update'));
  await overlap(fixtureHome,h,['--publish','--quiet'],firstAA,secondAA);
  assert.equal(h.state().calls.filter(c=>c.method==='PATCH').length,2);
  assert.equal(trackedRemote(fixtureHome,h).models.find(m=>m.id==='gpt-6.1-sol').label,'Second captured update');
  await overlap(fixtureHome,h,['--rotate','--quiet']);trackedRemote(fixtureHome,h);
  assert.equal(h.state().calls.filter(c=>c.method==='POST').length,3);
  const created=h.state().calls.filter(c=>c.method==='POST'),deleted=h.state().calls.filter(c=>c.method==='DELETE');
  assert.equal(deleted.length,created.length-1);
});

test('overlapping failed rotations retain cleanup and block another creation until recovery',async()=>{
  const fixtureHome=cloneHome(),h=ghHarness();assert.equal((await childCLI(fixtureHome,h,['--publish','--quiet']).done).code,0);
  h.mode('delete-failure');let s=h.state();s.delayMs=60;put(h.store,s);
  const first=childCLI(fixtureHome,h,['--rotate','--quiet']);
  await waitUntil(()=>fs.existsSync(path.join(fixtureHome,'.config/ai-model-frontier/usage.json.lock')));
  const second=childCLI(fixtureHome,h,['--rotate','--quiet']);
  const results=await Promise.all([first.done,second.done]);assert(results.every(r=>r.code===1));
  const cfg=loadConfig(fixtureHome);assert.equal(Object.keys(h.state().gists).length,2);
  assert.deepEqual(new Set(Object.keys(h.state().gists)),new Set([cfg.config.gistId,cfg.config.pendingDeleteGistId]));
  assert.equal(h.state().calls.filter(c=>c.method==='POST').length,2);
  h.mode('normal');await overlap(fixtureHome,h,['--rotate','--quiet']);trackedRemote(fixtureHome,h);
});

function lockWorker(file, options={}) {
  const marker=path.join(dir,randomBytes(8).toString('hex'));
  const script=`import fs from 'node:fs'; import {withConfigLock} from ${JSON.stringify(new URL('./collect.mjs',import.meta.url).href)};
    const file=process.argv[1], marker=process.argv[2], mode=process.argv[3];
    const link=fs.linkSync;
    if(mode==='initializer') fs.linkSync=function(a,b){if(b===file+'.lock'&&!fs.existsSync(marker+'.paused')){fs.writeFileSync(marker+'.paused','');process.kill(process.pid,'SIGSTOP');}return link(a,b);};
    if(mode==='reaper') fs.linkSync=function(a,b){if(b.endsWith('.reaping')&&!fs.existsSync(marker+'.paused')){fs.writeFileSync(marker+'.paused','');process.kill(process.pid,'SIGSTOP');}return link(a,b);};
    try {await withConfigLock(file,async()=>{fs.writeFileSync(marker+'.entered','');process.stdout.write('entered');if(mode==='holder'||mode==='initializer'||mode==='reaper')await new Promise(r=>setTimeout(r,30000));},{timeoutMs:mode==='contender'?200:5000});}
    catch(e){console.error(e.message);process.exitCode=1;}`;
  const child=spawn(process.execPath,['--input-type=module','-e',script,file,marker,options.mode??'holder'],{env:{...process.env,...options.env},stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr.on('data',x=>stderr+=x);
  const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal,stderr}));});
  return {child,marker,done};
}
async function stopWorker(worker) {if(worker.child.exitCode===null && worker.child.signalCode===null)worker.child.kill('SIGKILL');await worker.done;}

test('atomic lock publication survives a paused initializer with real overlapping processes',async()=>{
  const cfg=loadConfig(cloneHome()),initializer=lockWorker(cfg.file,{mode:'initializer'});let holder;
  try {
    await waitUntil(()=>fs.existsSync(initializer.marker+'.paused'));
    assert(!fs.existsSync(cfg.file+'.lock'));
    holder=lockWorker(cfg.file);await waitUntil(()=>fs.existsSync(holder.marker+'.entered'));
    const owner=JSON.parse(fs.readFileSync(cfg.file+'.lock'));assert.equal(owner.pid,holder.child.pid);
    assert.equal(fs.statSync(cfg.file+'.lock').mode&0o777,0o600);
    initializer.child.kill('SIGCONT');await delay(2200);
    assert(!fs.existsSync(initializer.marker+'.entered'));assert.equal(JSON.parse(fs.readFileSync(cfg.file+'.lock')).nonce,owner.nonce);
    await stopWorker(holder);await waitUntil(()=>fs.existsSync(initializer.marker+'.entered'));
  } finally {await stopWorker(initializer);if(holder)await stopWorker(holder);}
  await withConfigLock(cfg.file,()=>{});assert(!fs.existsSync(cfg.file+'.lock'));
});

test('killed lock owner recovers; live PID reuse and timezone/locale changes never steal ownership',async()=>{
  const cfg=loadConfig(cloneHome()),lockFile=cfg.file+'.lock';
  // A stale-looking record for a live PID must remain held, regardless of age.
  put(lockFile,{pid:process.pid,nonce:'0'.repeat(32),createdAt:1});
  const reused=lockWorker(cfg.file,{mode:'contender'});
  assert.equal((await reused.done).code,1);assert(!fs.existsSync(reused.marker+'.entered'));fs.unlinkSync(lockFile);
  const holder=lockWorker(cfg.file,{env:{TZ:'UTC',LC_ALL:'C',LANG:'C'}});
  try {
    await waitUntil(()=>fs.existsSync(holder.marker+'.entered'));
    const contender=lockWorker(cfg.file,{mode:'contender',env:{TZ:'America/New_York',LC_ALL:'fr_FR.UTF-8',LANG:'fr_FR.UTF-8'}});
    const result=await contender.done;assert.equal(result.code,1);assert.match(result.stderr,/another collector/);
    assert(!fs.existsSync(contender.marker+'.entered'));process.kill(holder.child.pid,0);
  } finally {await stopWorker(holder);}
  await withConfigLock(cfg.file,()=>assert.equal(JSON.parse(fs.readFileSync(lockFile)).pid,process.pid));assert(!fs.existsSync(lockFile));
  assert.equal(fs.statSync(path.dirname(cfg.file)).mode&0o777,0o700);
});

test('a delayed stale reaper cannot rename the replacement owner generation',async()=>{
  const cfg=loadConfig(cloneHome()),holder=lockWorker(cfg.file);let reaper,replacement;
  try {
    await waitUntil(()=>fs.existsSync(holder.marker+'.entered'));await stopWorker(holder);
    reaper=lockWorker(cfg.file,{mode:'reaper'});await waitUntil(()=>fs.existsSync(reaper.marker+'.paused'));
    replacement=lockWorker(cfg.file);await waitUntil(()=>fs.existsSync(replacement.marker+'.entered'));
    const nonce=JSON.parse(fs.readFileSync(cfg.file+'.lock')).nonce;
    reaper.child.kill('SIGCONT');await delay(200);
    assert(!fs.existsSync(reaper.marker+'.entered'));assert.equal(JSON.parse(fs.readFileSync(cfg.file+'.lock')).nonce,nonce);
    await stopWorker(replacement);await waitUntil(()=>fs.existsSync(reaper.marker+'.entered'));
  } finally {await stopWorker(holder);if(reaper)await stopWorker(reaper);if(replacement)await stopWorker(replacement);}
  await withConfigLock(cfg.file,()=>{});
});

test('lost DELETE reply and interrupted cleanup are idempotent, before even broken telemetry',async()=>{
  for(const mode of ['lost-delete-reply','kill-after-delete']) {
    const fixtureHome=cloneHome(),h=ghHarness();assert.equal((await childCLI(fixtureHome,h,['--publish','--quiet']).done).code,0);
    const old=loadConfig(fixtureHome).config.gistId;h.mode(mode);
    const result=await childCLI(fixtureHome,h,['--rotate','--quiet']).done;
    assert(mode==='kill-after-delete'?result.signal==='SIGKILL':result.code===1);
    assert(!h.state().gists[old]);assert.equal(loadConfig(fixtureHome).config.pendingDeleteGistId,old);
    h.mode('normal');put(path.join(fixtureHome,'.t3/userdata/usage-scan-cache-v5.json'),'broken telemetry');
    const calls=h.state().calls.length;
    const failed=await childCLI(fixtureHome,h,['--publish','--quiet']).done;assert.equal(failed.code,1);
    assert(!loadConfig(fixtureHome).config.pendingDeleteGistId);
    assert.deepEqual(h.state().calls.slice(calls).map(c=>c.endpoint),[`gists/${old}`,'user',`gists/${old}`]);
    assert.equal((await childCLI(fixtureHome,h,['--recover','--quiet']).done).code,0);
  }
});

test('structured deletion outcomes never treat auth, network or diagnostic 404 text as success',async()=>{
  const cfg=resetConfig(),h=ghHarness();await publishPayload(p,cfg.config,cfg.file,h);
  h.mode('delete-failure');await assert.rejects(publishPayload(p,cfg.config,cfg.file,{...h,rotate:true}));
  const pending=loadConfig(home).config.pendingDeleteGistId;
  for(const mode of ['delete-auth-failure','delete-network-failure']) {
    h.mode(mode);await assert.rejects(main(['--recover','--quiet'],{home,aaFile,...h}),/deletion failed/);
    assert.equal(loadConfig(home).config.pendingDeleteGistId,pending);
  }
  const state=h.state();delete state.gists[pending];put(h.store,state);h.mode('auth-failure');
  await assert.rejects(main(['--recover','--quiet'],{home,aaFile,...h}),/deletion failed/);
  assert.equal(loadConfig(home).config.pendingDeleteGistId,pending);
  assert.deepEqual(ghHttpOutcome(['--method','DELETE','gists/fixture'],()=>({status:1,stdout:'',stderr:'HTTP/2.0 404 Not Found'})),{status:null,ok:false});
  h.mode('normal');await main(['--recover','--quiet'],{home,aaFile,...h});assert(!loadConfig(home).config.pendingDeleteGistId);
});

test('every unsafe new-gist cleanup failure is journaled before checks and preserves active key/gist',async()=>{
  for(const rotate of [false,true]) for(const mode of ['public-delete-failure','listed-delete-failure','list-failure-delete-failure']) {
    const cfg=resetConfig(),h=ghHarness();if(rotate)await publishPayload(p,cfg.config,cfg.file,h);
    const {key,gistId:old}=cfg.config;h.mode(mode);
    const runner=(cmd,args,o)=>{
      if(args.some(x=>x.startsWith('users/'))) assert(loadConfig(home).config.pendingDeleteGistId);
      return h.runner(cmd,args,o);
    };
    await assert.rejects(publishPayload(p,cfg.config,cfg.file,{...h,runner,rotate}),/deletion failed/);
    const stored=loadConfig(home).config;assert.equal(stored.key,key);assert.equal(stored.gistId,old);assert(stored.pendingDeleteGistId);
    assert(h.state().gists[stored.pendingDeleteGistId]);const postCount=h.state().calls.filter(c=>c.method==='POST').length;
    await assert.rejects(main(['--publish','--quiet'],{home,aaFile,...h}),/deletion failed/);
    assert.equal(h.state().calls.filter(c=>c.method==='POST').length,postCount);
    h.mode('normal');await main(['--recover','--quiet'],{home,aaFile,...h});assert(!h.state().gists[stored.pendingDeleteGistId]);
    assert.equal(loadConfig(home).config.key,key);assert.equal(loadConfig(home).config.gistId,old);
  }
});

test('DELETE 404 retains readable, changed-account and reduced-scope obligations; only confirmed absence clears',async()=>{
  const cfg=resetConfig(),h=ghHarness();await publishPayload(p,cfg.config,cfg.file,h);
  h.mode('delete-failure');await assert.rejects(publishPayload(p,cfg.config,cfg.file,{...h,rotate:true}));
  const pending=loadConfig(home).config.pendingDeleteGistId;
  for(const mode of ['delete-false-404','changed-account','reduced-scope']) {
    h.mode(mode);await assert.rejects(main(['--recover','--quiet'],{home,aaFile,...h}),/deletion failed/);
    assert.equal(loadConfig(home).config.pendingDeleteGistId,pending);assert(h.state().gists[pending]);
  }
  // If the on-disk obligation changed while gh was running, do not clear it.
  h.mode('normal');let changed=false;
  const another='b'.repeat(32),runner=(cmd,args,o)=>{
    const result=h.runner(cmd,args,o);
    if(args.includes('DELETE')&&!changed){changed=true;const c=loadConfig(home).config;c.pendingDeleteGistId=another;put(cfg.file,c);}
    return result;
  };
  await assert.rejects(main(['--recover','--quiet'],{home,aaFile,...h,runner}),/obligation changed/);
  assert.equal(loadConfig(home).config.pendingDeleteGistId,another);
  await main(['--recover','--quiet'],{home,aaFile,...h});assert(!loadConfig(home).config.pendingDeleteGistId);
});

test('HTTP outcomes read a complete header block only, never body status lines or diagnostic text',()=>{
  const outcome=(stdout,status=1,error)=>ghHttpOutcome(['gists/fixture'],()=>({stdout,status,error,stderr:'HTTP/2.0 404 Not Found'}));
  assert.deepEqual(outcome('HTTP/2.0 503 Unavailable\r\nContent-Type: text/plain\r\n\r\nHTTP/2.0 404 Not Found\r\n'),{status:503,ok:false});
  assert.deepEqual(outcome('HTTP/2.0 204 No Content\nX-Test: yes\n\nHTTP/2.0 503 Body',0),{status:204,ok:true});
  for(const text of ['HTTP/2.0 404 Not Found','prose\nHTTP/2.0 404 Not Found\n\n','HTTP/2.0 404 Not Found\nnot-a-header\n\n','\n\nHTTP/2.0 404 Not Found'])assert.deepEqual(outcome(text),{status:null,ok:false});
  assert.deepEqual(outcome('HTTP/2.0 404 Not Found\n\n',1,Error('transport')),{status:null,ok:false});
});

// Faults touch only private synthetic config replacements, never gh's file store.
async function transitionFault(file, target, boundary, operation, persistent=false) {
  const names=['openSync','closeSync','writeFileSync','fsyncSync','renameSync'];
  const original=Object.fromEntries(names.map(k=>[k,fs[k]])),fdPaths=new Map(),states=new Map();
  let renamedState,hit=0;
  const fault=phase=>{if(phase===boundary&&(persistent||!hit)){hit++;throw Object.assign(Error('Injected config I/O failure'),{code:'EIO'});}};
  fs.openSync=function(file,...args){const fd=original.openSync(file,...args);fdPaths.set(fd,String(file));return fd;};
  fs.closeSync=function(fd){fdPaths.delete(fd);return original.closeSync(fd);};
  fs.writeFileSync=function(fd,data,...args){
    const destination=fdPaths.get(fd);let state;
    if(destination&&path.dirname(destination)===path.dirname(file)&&path.basename(destination).startsWith('.aimf-')&&!path.basename(destination).startsWith('.aimf-lock-')) {
      try {const c=JSON.parse(String(data));if(c.key&&Object.hasOwn(c,'gistId'))state=c.publication?.state??'idle';} catch {}
      states.set(destination,state);if(state===target)fault('write');
    }
    return original.writeFileSync(fd,data,...args);
  };
  fs.fsyncSync=function(fd){
    const destination=fdPaths.get(fd),isDirectory=destination===path.dirname(file);
    if(states.get(destination)===target)fault('file-fsync');
    if(isDirectory&&renamedState===target)fault('dir-fsync');
    const result=original.fsyncSync(fd);
    if(isDirectory&&renamedState===target)fault('after-dir-fsync');
    return result;
  };
  fs.renameSync=function(from,to){
    const state=states.get(String(from));
    if(String(to)===file&&state===target)fault('rename');
    const result=original.renameSync(from,to);
    if(String(to)===file){renamedState=state;if(state===target)fault('after-rename');}
    return result;
  };
  try {await operation();} finally {for(const name of names)fs[name]=original[name];}
  assert(hit>0,`Fault not reached: ${target}/${boundary}`);
}
function assertTracked(cfg,h) {
  const c=loadConfig(home).config,live=Object.keys(h.state().gists);
  if(c.gistId){assert(h.state().gists[c.gistId],'Active gist must still exist');decryptEnvelope(JSON.parse(h.state().gists[c.gistId].files['aimf-usage.json'].content),Buffer.from(c.key,'base64url'));}
  for(const id of live)assert(id===c.gistId||id===c.pendingDeleteGistId||(c.publication?.state==='creating'&&h.state().gists[id].files['aimf-usage.json'].content===c.publication.content),'Every live candidate is recoverable');
  return c;
}

test('each atomic state transition survives write, fsync, rename and post-rename failures',async()=>{
  for(const target of ['creating','verifying','promoted','cleanup-pending','idle'])for(const boundary of ['write','file-fsync','rename','after-rename','dir-fsync','after-dir-fsync']) {
    const cfg=resetConfig(),h=ghHarness();await publishPayload(p,cfg.config,cfg.file,h);const old=cfg.config.gistId;
    if(target==='cleanup-pending')h.mode('public');
    await transitionFault(cfg.file,target,boundary,async()=>{
      await assert.rejects(publishPayload(p,cfg.config,cfg.file,{...h,rotate:true}));
    });
    const c=assertTracked(cfg,h);
    if(target==='creating'){assert.equal(h.state().calls.filter(x=>x.method==='POST').length,1);assert.equal(c.gistId,old);}
    if(target==='promoted'&&['after-rename','dir-fsync','after-dir-fsync'].includes(boundary)){assert.notEqual(c.gistId,old);assert.equal(c.publication.state,'promoted');}
    h.mode('normal');await main(['--recover','--quiet'],{home,aaFile,...h});
    const recovered=assertTracked(cfg,h);assert(!recovered.publication);assert(!recovered.pendingDeleteGistId);assert.equal(Object.keys(h.state().gists).length,1);
  }
});

test('recovery re-establishes promotion durability before deleting the previous gist',async()=>{
  const cfg=resetConfig(),h=ghHarness();await publishPayload(p,cfg.config,cfg.file,h);const old=cfg.config.gistId;
  await transitionFault(cfg.file,'promoted','dir-fsync',()=>assert.rejects(publishPayload(p,cfg.config,cfg.file,{...h,rotate:true})));
  const promoted=loadConfig(home).config;assert.notEqual(promoted.gistId,old);assert.equal(promoted.pendingDeleteGistId,old);
  assert.equal(h.state().calls.filter(x=>x.method==='DELETE').length,0);
  await transitionFault(cfg.file,'promoted','file-fsync',()=>assert.rejects(main(['--recover','--quiet'],{home,aaFile,...h})));
  assert.equal(h.state().calls.filter(x=>x.method==='DELETE').length,0);assert(h.state().gists[old]);assert(h.state().gists[promoted.gistId]);
  await main(['--recover','--quiet'],{home,aaFile,...h});assert(!h.state().gists[old]);assert(h.state().gists[promoted.gistId]);assert(!loadConfig(home).config.pendingDeleteGistId);
});

test('failed ID journal still attempts cleanup; a persisted creation intent recovers an unsafe candidate',async()=>{
  for(const rotate of [false,true]) {
    const cfg=resetConfig(),h=ghHarness();if(rotate)await publishPayload(p,cfg.config,cfg.file,h);
    const old=cfg.config.gistId,key=cfg.config.key;h.mode('public-delete-failure');
    // Both writes of the known ID fail; the older creating intent remains.
    await transitionFault(cfg.file,'verifying','rename',async()=>{
      const rename=fs.renameSync;
      fs.renameSync=function(from,to){if(String(to)===cfg.file&&JSON.parse(fs.readFileSync(from)).publication?.state==='cleanup-pending')throw Object.assign(Error('Injected cleanup journal failure'),{code:'EIO'});return rename(from,to);};
      await assert.rejects(publishPayload(p,cfg.config,cfg.file,{...h,rotate}));
    },true);
    const c=assertTracked(cfg,h);assert.equal(c.publication.state,'creating');assert.equal(c.gistId,old);assert.equal(c.key,key);
    assert(h.state().calls.some(x=>x.method==='DELETE'));
    const posts=h.state().calls.filter(x=>x.method==='POST').length;
    await assert.rejects(publishPayload(p,cfg.config,cfg.file,{...h,rotate}),/deletion failed/);
    assert.equal(h.state().calls.filter(x=>x.method==='POST').length,posts);
    h.mode('normal');await main(['--recover','--quiet'],{home,aaFile,...h});
    assert.equal(loadConfig(home).config.gistId,old);assert.equal(Object.keys(h.state().gists).length,rotate?1:0);
  }
});

test('ambiguous creation replies recover by unique ciphertext and never repeat POST',async()=>{
  const cfg=resetConfig(),h=ghHarness();let lost=false;
  const runner=(cmd,args,o)=>{const r=h.runner(cmd,args,o);if(args.includes('POST')&&!lost){lost=true;return {status:1,stdout:'',stderr:'lost reply'};}return r;};
  await assert.rejects(publishPayload(p,cfg.config,cfg.file,{...h,runner}),/authentication/);
  assert.equal(assertTracked(cfg,h).publication.state,'creating');
  h.mode('delete-failure');await assert.rejects(publishPayload(p,cfg.config,cfg.file,h),/deletion failed/);
  assert.equal(h.state().calls.filter(x=>x.method==='POST').length,1);
  h.mode('normal');await main(['--recover','--quiet'],{home,aaFile,...h});assert.equal(Object.keys(h.state().gists).length,0);assert(!loadConfig(home).config.publication);
});

test('unknown or ambiguous creation history remains blocked instead of creating another gist',async()=>{
  for(const duplicate of [false,true]) {
    const cfg=resetConfig(),h=ghHarness();
    if(duplicate) {
      const runner=(cmd,args,o)=>{const r=h.runner(cmd,args,o);return args.includes('POST')?{status:1,stdout:''}:r;};
      await assert.rejects(publishPayload(p,cfg.config,cfg.file,{...h,runner}));
      const state=h.state(),source=Object.values(state.gists)[0],id='c'.repeat(32);state.gists[id]={...source,id};put(h.store,state);
    } else {h.mode('post-failure');await assert.rejects(publishPayload(p,cfg.config,cfg.file,h));}
    h.mode('normal');
    for(let i=0;i<2;i++)await assert.rejects(publishPayload(p,cfg.config,cfg.file,h),/exactly one ciphertext match/);
    assert.equal(h.state().calls.filter(x=>x.method==='POST').length,1);assert.equal(loadConfig(home).config.publication.state,'creating');
    assert.equal(h.state().calls.filter(x=>x.method==='DELETE').length,0);
  }
});

test('SIGKILL before and after transition rename recovers from disk without deleting the active gist',async()=>{
  for(const target of ['creating','verifying','promoted','cleanup-pending','idle'])for(const when of ['before','after']) {
    const fixtureHome=cloneHome(),h=ghHarness();assert.equal((await childCLI(fixtureHome,h,['--publish','--quiet']).done).code,0);
    const cfg=loadConfig(fixtureHome),old=cfg.config.gistId;
    if(target==='cleanup-pending')h.mode('public');
    const script=`import fs from 'node:fs';import {main} from ${JSON.stringify(new URL('./collect.mjs',import.meta.url).href)};
      const rename=fs.renameSync,file=process.env.AIMF_TEST_CONFIG,target=process.env.AIMF_TEST_STATE,when=process.env.AIMF_TEST_WHEN;
      fs.renameSync=function(from,to){let state;if(String(to)===file)state=JSON.parse(fs.readFileSync(from)).publication?.state??'idle';if(state===target&&when==='before')process.kill(process.pid,'SIGKILL');const r=rename(from,to);if(state===target&&when==='after')process.kill(process.pid,'SIGKILL');return r;};
      await main(['--rotate','--quiet'],{home:process.env.AIMF_TEST_HOME,aaFile:process.env.AIMF_TEST_AA});`;
    const child=spawn(process.execPath,['--input-type=module','-e',script],{env:{...process.env,AIMF_TEST_HOME:fixtureHome,AIMF_TEST_AA:aaFile,AIMF_TEST_CONFIG:cfg.file,AIMF_TEST_STATE:target,AIMF_TEST_WHEN:when,AIMF_USAGE_GH:h.ghPath,AIMF_TEST_GH_STORE:h.store},stdio:['ignore','ignore','pipe']});
    const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Transition interruption fixture timed out'));},15000);child.once('error',reject);child.once('exit',(code,signal)=>{clearTimeout(timer);resolve({code,signal});});});
    assert.equal(result.signal,'SIGKILL');h.mode('normal');
    const stored=loadConfig(fixtureHome).config;
    if(target==='creating'&&when==='after') {
      // A process death after durable intent but before POST is indistinguishable
      // from an unacknowledged remote request. Do not blindly create again.
      assert.equal(stored.publication.state,'creating');
      assert.equal((await childCLI(fixtureHome,h,['--recover','--quiet']).done).code,1);
      assert.equal(h.state().calls.filter(x=>x.method==='POST').length,1);assert(h.state().gists[old]);continue;
    }
    assert.equal((await childCLI(fixtureHome,h,['--recover','--quiet']).done).code,0);
    const recovered=loadConfig(fixtureHome).config;
    assert.equal(Object.keys(h.state().gists).length,1);assert(h.state().gists[recovered.gistId]);
    decryptEnvelope(JSON.parse(h.state().gists[recovered.gistId].files['aimf-usage.json'].content),Buffer.from(recovered.key,'base64url'));
    assert(!recovered.publication);assert(!recovered.pendingDeleteGistId);
    if(target==='promoted'&&when==='after')assert.notEqual(recovered.gistId,old);
  }
});

test('EPERM liveness is held and release removes only the current nonce',async()=>{
  const cfg=resetConfig(),kill=process.kill;
  put(cfg.file+'.lock',{pid:process.pid,nonce:'0'.repeat(32),createdAt:1});
  process.kill=()=>{throw Object.assign(Error('Permission denied'),{code:'EPERM'});};
  try {await assert.rejects(withConfigLock(cfg.file,()=>assert.fail('EPERM owner must stay alive'),{timeoutMs:30}),/another collector/);}finally{process.kill=kill;fs.unlinkSync(cfg.file+'.lock');}
  await withConfigLock(cfg.file,()=>put(cfg.file+'.lock',{pid:process.pid,nonce:'1'.repeat(32),createdAt:1}));
  assert.equal(JSON.parse(fs.readFileSync(cfg.file+'.lock')).nonce,'1'.repeat(32));fs.unlinkSync(cfg.file+'.lock');
});

test('coverage notes enforce code-specific sources, scope counts and model references',()=>{
  const note={code:'unpriced_model',source:'pricing',modelIdx:null,count:1};
  for(const c of [note,{...note,source:'t3-usage-cache'},{code:'cache_snapshot',source:'t3-usage-cache',modelIdx:null,count:2},{code:'missing_source',source:'pricing',modelIdx:null,count:1},{code:'current_standard_prices',source:'pricing',modelIdx:0,count:1},{code:'partial_history',source:'t3-turns',modelIdx:null,count:1},{code:'missing_counters',source:'opencode-db',modelIdx:null,count:1},{code:'unreadable_history',source:'opencode-db',modelIdx:null,count:1},{code:'missing_source',source:'antigravity-db',modelIdx:null,count:2},{code:'unpriced_model',source:'t3-usage-cache',modelIdx:0,count:1}]) {
    const q=structuredClone(p);q.coverage=[c];assert.throws(()=>validatePayload(q),/Coverage/);
  }
});

test('canonical destinations reject config ancestors and repository aliases before creating files',async()=>{
  const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const alias=path.join(dir,'repository-alias');fs.symlinkSync(repo,alias,'dir');
  const h=ghHarness(),externalHome=path.join(dir,'symlink-config-owner');fs.mkdirSync(externalHome);
  fs.symlinkSync(path.join(alias,'usage'),path.join(externalHome,'.config'),'dir');
  assert.throws(()=>loadConfig(externalHome),/ancestor symlinks/);
  assert.throws(()=>loadConfig(alias),/outside the repository/);
  const tracked=path.join(alias,'tracked.local.json');
  assert.throws(()=>writePrivate(tracked,'private'),/ignored usage/);assert(!fs.existsSync(path.join(repo,'tracked.local.json')));
  const calls=h.state().calls.length;
  await assert.rejects(main(['--out',tracked],{home,aaFile,...h}),/ignored usage/);assert.equal(h.state().calls.length,calls);
  const safeTarget=path.join(dir,'canonical-output');fs.mkdirSync(safeTarget);
  const safeAlias=path.join(dir,'safe-alias');fs.symlinkSync(safeTarget,safeAlias,'dir');
  const safe=path.join(safeAlias,'nested','safe.local.json');writePrivate(safe,'private');
  assert.equal(fs.readFileSync(path.join(safeTarget,'nested','safe.local.json'),'utf8'),'private');
  assert.equal(fs.statSync(safe).mode&0o777,0o600);
  const finalLink=path.join(dir,'final.local.json');fs.symlinkSync(safe,finalLink);assert.throws(()=>writePrivate(finalLink,'private'),/regular file/);
});

test('hostile source metadata under publish quiet cannot reach stdout/stderr, even on failure',async()=>{
  const h=ghHarness(),original=fs.readFileSync(cf,'utf8');
  for(const hostile of ['vendor/Users/fixture-owner/private-metadata','vendor/fixture-owner','relative/nested/private-metadata']) {
    const bad=structuredClone(cache);bad.models[0]=hostile;put(cacheFile,bad);put(cf,original.replaceAll(cache.models[0],hostile));
    try {
      const child=await childCLI(home,h,['--publish','--quiet']).done;
      assert.equal(child.code,1);assert(!child.stdout.includes(hostile));assert(!child.stderr.includes(hostile));
      for(const sensitive of ['/Users/','fixture-owner','private-metadata']){assert(!child.stdout.includes(sensitive));assert(!child.stderr.includes(sensitive));}
      assert.equal(h.state().calls.length,0);
    } finally {put(cacheFile,cache);put(cf,original);}
  }
  const warnings=[];const badSettings=path.join(home,'.t3/userdata/settings.json'),settings=fs.readFileSync(badSettings,'utf8');
  try {
    const x=JSON.parse(settings);x.providerInstances.claudeAgent.displayName='/Users/fixture-owner/private-label';put(badSettings,x);
    await assert.rejects(collect({...options,warn:s=>warnings.push(s)}),/private path/);assert.deepEqual(warnings,[]);
  } finally {put(badSettings,settings);}
});

test('historical fallback uses captured run/turn selections; session changes and aliases cannot price unknowns',async()=>{
  const database=new DatabaseSync(t3File);
  database.prepare('INSERT INTO orchestration_v2_projection_runs VALUES(?,?,?,?)').run('captured-run','antigravity','antigravity',JSON.stringify({modelSelection:{model:'gpt-6.1-sol'}}));
  database.prepare('INSERT INTO orchestration_v2_projection_run_attempts VALUES(?,?,?,?,?)').run('captured-attempt','captured-run','antigravity','antigravity','{}');
  const insert=database.prepare('INSERT INTO orchestration_v2_projection_provider_turns VALUES(?,?,?,?,?,?,?)');
  insert.run('captured-history','a','t','captured-attempt',iso,new Date(day2).toISOString(),JSON.stringify({turnTokenUsage:usage}));
  insert.run('unknown-history','a','t',null,iso,new Date(day2).toISOString(),JSON.stringify({turnTokenUsage:usage}));
  database.close();
  try {
    const before=(await collect(options)).payload;
    const change=new DatabaseSync(t3File);change.exec("UPDATE orchestration_v2_projection_provider_sessions SET model='claude-opus-5-5' WHERE provider='antigravity'");change.close();
    const after=(await collect(options)).payload;assert.deepEqual(after,before);
    const idx=before.instances.findIndex(i=>i.id==='antigravity');assert.equal(before.instances[idx].requestUnit,'turns');
    const models=before.days.flatMap(d=>d.r).filter(r=>r[1]===idx).map(r=>before.models[r[0]].id);
    assert.deepEqual(new Set(models),new Set(['gemini-3.8-flash-high','gpt-6.1-sol','unattributed']));
    const unknown=before.models.findIndex(m=>m.id==='unattributed');assert.equal(before.days.flatMap(d=>d.r).find(r=>r[0]===unknown)[9],null);
    const settingsFile=path.join(home,'.t3/userdata/settings.json'),original=fs.readFileSync(settingsFile,'utf8');
    try {const settings=JSON.parse(original);settings.usageModelAliases.unattributed='gpt-6.1-sol';put(settingsFile,settings);assert.equal((await collect(options)).payload.models.find(m=>m.id==='unattributed').price.src,'none');} finally {put(settingsFile,original);}
  } finally {
    const restore=new DatabaseSync(t3File);restore.exec("DELETE FROM orchestration_v2_projection_provider_turns WHERE provider_turn_id IN ('captured-history','unknown-history'); DELETE FROM orchestration_v2_projection_run_attempts; DELETE FROM orchestration_v2_projection_runs; UPDATE orchestration_v2_projection_provider_sessions SET model='gemini-3.8-flash-high' WHERE provider='antigravity'");restore.close();
  }
});

test('multi-call turn fixture stays turns and machine-readable coverage survives encryption',async()=>{
  // Grok's known modelCalls=5 and the fallback's whole-turn count are distinct units.
  const q=(await collect(options)).payload;
  assert.equal(q.instances.find(i=>i.id==='grok').requestUnit,'calls');assert.equal(q.instances.find(i=>i.id==='antigravity').requestUnit,'turns');
  const gr=q.days.flatMap(d=>d.r).find(r=>q.instances[r[1]].id==='grok');assert.equal(gr[3],5);
  const key=randomBytes(32);assert.deepEqual(decryptEnvelope(encryptPayload(q,key),key).coverage,q.coverage);
  const edit=new DatabaseSync(t3File);
  edit.prepare('INSERT INTO orchestration_v2_projection_provider_turns VALUES(?,?,?,?,?,?,?)').run('no-counters','a','t',null,iso,iso,'{}');
  edit.prepare("UPDATE orchestration_v2_projection_provider_turns SET started_at=?,completed_at=? WHERE provider_turn_id='o'").run('2026-10-08T12:00:00Z','2026-10-08T12:02:00Z');edit.close();
  try {
    const r=(await collect(options)).payload;
    assert(r.coverage.some(c=>c.code==='partial_history'&&c.source==='opencode-db'));
    assert(r.coverage.some(c=>c.code==='antigravity_without_counters'&&c.count===1));
    const old=structuredClone(q);delete old.coverage;old.instances.forEach(i=>delete i.requestUnit);assert.equal(validatePayload(old),true);
    for(const mutate of [x=>x.coverage[0].secret='forbidden',x=>x.coverage[0].count=-1,x=>x.instances[0].requestUnit='requests']){const bad=structuredClone(q);mutate(bad);assert.throws(()=>validatePayload(bad));}
  } finally {
    const restore=new DatabaseSync(t3File);restore.exec("DELETE FROM orchestration_v2_projection_provider_turns WHERE provider_turn_id='no-counters'");restore.prepare("UPDATE orchestration_v2_projection_provider_turns SET started_at=?,completed_at=? WHERE provider_turn_id='o'").run(new Date(day2-1000).toISOString(),new Date(day2+1000).toISOString());restore.close();
  }
});

test('WAL snapshot is released before processing; concurrent writer commits and checkpoint are unobstructed',async()=>{
  const writerScript=`import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1],{timeout:100});try{db.exec("CREATE TABLE IF NOT EXISTS writer_probe(value INTEGER); BEGIN IMMEDIATE; INSERT INTO writer_probe VALUES(1); COMMIT");console.log('committed');}finally{db.close();}`;
  const runWriter=()=>spawnSync(process.execPath,['--input-type=module','-e',writerScript,t3File],{encoding:'utf8'});
  let connection;
  const rows=fetchDatabaseRows(t3File,'Fixture',db=>{
    connection=db;const rows=db.prepare('SELECT provider_turn_id FROM orchestration_v2_projection_provider_turns').all();
    // Deliberately retain this synthetic read snapshot during a writer commit.
    assert.equal(runWriter().status,0,'WAL reader must not block writer commit');
    return rows;
  });
  assert(rows.length>0);assert.throws(()=>connection.prepare('SELECT 1'),/not open|closed/);
  assert.equal(runWriter().status,0);
  for(let n=0;n<3;n++) {
    const child=spawn(process.execPath,['--input-type=module','-e',writerScript,t3File],{stdio:'ignore'});
    const exited=new Promise(resolve=>child.on('exit',resolve));await collect(options);assert.equal(await exited,0);
  }
  const check=new DatabaseSync(t3File);assert.equal(check.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get().busy,0);check.close();
  const rollback=path.join(dir,'rollback.sqlite'),dbRollback=new DatabaseSync(rollback);dbRollback.exec('CREATE TABLE fixture(value INTEGER)');dbRollback.close();
  assert.throws(()=>fetchDatabaseRows(rollback,'Fixture',db=>db.prepare('SELECT * FROM fixture').all()),/WAL journal mode/);
});

test('test scratch is private, configurable, cleaned and failures do not touch the checkout',()=>{
  assert.equal(fs.statSync(dir).mode&0o777,0o700);
  const previous=process.env.AIMF_TEST_SCRATCH,root=path.join(dir,'scratch-override');process.env.AIMF_TEST_SCRATCH=root;
  try {
    const fixture=makeScratch();assert.equal(path.dirname(fixture.dir),root);assert.equal(fs.statSync(fixture.dir).mode&0o777,0o700);
    fixture.cleanup();assert(!fs.existsSync(fixture.dir));
    const invalid=path.join(dir,'not-directory');put(invalid,'private');process.env.AIMF_TEST_SCRATCH=invalid;assert.throws(()=>makeScratch());
  } finally {if(previous===undefined)delete process.env.AIMF_TEST_SCRATCH;else process.env.AIMF_TEST_SCRATCH=previous;}
});


test('independently known two-call OpenCode turn remains one labelled fallback turn',async()=>{
  const db=new DatabaseSync(ocFile);
  const first={...om,tokens:{input:5,output:2,reasoning:3,cache:{read:45,write:0}}};
  const second={...om,tokens:{input:5,output:1,reasoning:4,cache:{read:45,write:0}}};
  db.prepare("UPDATE session_message SET data=? WHERE id='m1'").run(JSON.stringify(first));
  db.prepare("UPDATE message SET data=? WHERE id='m1'").run(JSON.stringify({...first,role:'assistant',modelID:'glm-5.3-flash',providerID:'opencode'}));
  db.prepare('INSERT INTO session_message VALUES(?,?,?,?,?)').run('m2','o1',day2-400,'assistant',JSON.stringify(second));db.close();
  try {
    const native=(await collect(options)).payload;
    const rowsFor=(payload,id)=>payload.days.flatMap(d=>d.r).filter(r=>payload.instances[r[1]].id===id);
    assert.equal(rowsFor(native,'opencode').reduce((n,r)=>n+r[3],0),2);
    assert.equal(native.instances.find(i=>i.id==='opencode').requestUnit,'calls');
    fs.renameSync(ocFile,ocFile+'.two-call-backup');
    try {
      const fallback=(await collect(options)).payload;
      assert.equal(rowsFor(fallback,'opencode').reduce((n,r)=>n+r[3],0),1);
      assert.equal(fallback.instances.find(i=>i.id==='opencode').requestUnit,'turns');
      assert.deepEqual(rowsFor(fallback,'opencode')[0].slice(4,9),rowsFor(native,'opencode')[0].slice(4,9));
    } finally {fs.renameSync(ocFile+'.two-call-backup',ocFile);}
  } finally {
    const restore=new DatabaseSync(ocFile);
    restore.exec("DELETE FROM session_message WHERE id='m2'");
    restore.prepare("UPDATE session_message SET data=? WHERE id='m1'").run(JSON.stringify(om));
    restore.prepare("UPDATE message SET data=? WHERE id='m1'").run(JSON.stringify({...om,role:'assistant',modelID:'glm-5.3-flash',providerID:'opencode'}));restore.close();
  }
});

// Antigravity fixtures: protobuf usage metadata in WAL SQLite files, laid out the way Antigravity writes them.
const pbv=n=>{const o=[];let v=BigInt(n);do{let b=Number(v&127n);v>>=7n;if(v)b|=128;o.push(b);}while(v);return o;};
const pb=(...fields)=>Buffer.from(fields.flatMap(([no,v])=>typeof v==='number'?[...pbv(no*8),...pbv(v)]:(b=>[...pbv(no*8+2),...pbv(b.length),...b])(Buffer.isBuffer(v)?v:Buffer.from(v))));
const agUsage=(input,cached,output,reasoning)=>pb([2,input],[5,cached],[3,output],[9,reasoning]);
const agTime=ms=>pb([1,Math.floor(ms/1000)],[2,(ms%1000)*1e6]);
const agStep=(model,usage,ms,retry=true)=>pb([3,'private-step-marker'],[8,agTime(ms)],[9,usage],...(model?[[24,pb([8,model])]]:[]),...(retry?[[28,pb([2,usage])]]:[]));
const agGen=(model,usage,ms)=>pb([1,pb([3,326],[4,usage],[9,pb([4,agTime(ms)])],[17,pb([2,usage])],[19,model])]);
function agDb(file,{steps=[],gens=[],wal=true}={}){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const d=new DatabaseSync(file);if(wal)d.exec('PRAGMA journal_mode=WAL');
  d.exec('CREATE TABLE steps(idx INTEGER,metadata BLOB,content TEXT); CREATE TABLE gen_metadata(idx INTEGER,data BLOB); CREATE TABLE trajectory_metadata_blob(data BLOB)');
  steps.forEach((s,i)=>d.prepare('INSERT INTO steps VALUES(?,?,?)').run(i,s,'private-ag-content-marker'));
  gens.forEach((g,i)=>d.prepare('INSERT INTO gen_metadata VALUES(?,?)').run(i,g));d.close();
}
test('Antigravity: a call stored as step, generation and retry counts once; copies, symlinks and bad files never double count',async()=>{
  const h=cloneHome(),u1=agUsage(1000,9000,300,120),u2=agUsage(200,800,40,10),u3=agUsage(50,0,5,0),u4=agUsage(70,30,9,0),u5=agUsage(400,600,60,20);
  put(path.join(h,'.t3/userdata/settings.json'),{providerInstances:{claudeAgent:{driver:'claudeAgent',displayName:'Claude',config:{}},antigravity:{driver:'antigravity',displayName:'Antigravity · Google AI Pro',config:{apiKey:'private-secret-marker'}}},usageModelAliases:{'gemini-3.8-flash-high':'gemini-3.8-flash'}});
  const rates=JSON.parse(fs.readFileSync(path.join(h,'.t3/userdata/usage-model-rates.json'),'utf8'));rates.document['gemini-3.1-pro-preview']={input_cost_per_token:2e-6,output_cost_per_token:12e-6,cache_read_input_token_cost:.2e-6};put(path.join(h,'.t3/userdata/usage-model-rates.json'),rates);
  const profile=path.join(h,'.t3/userdata/providers/antigravity',createHash('sha256').update('antigravity').digest('hex'),'antigravity-acp'),own=path.join(h,'.gemini/antigravity/conversations');
  put(path.join(profile,'acp_token.json'),{refresh_token:'private-secret-marker'});
  const convA={steps:[agStep('gemini-pro-agent',u1,day2),agStep('gemini-3.8-flash-high',u2,day2,false),agStep('',u4,day2,false),agStep('gemini-3.8-flash-high',agUsage(0,0,0,0),day2)],gens:[agGen('gemini-pro-default',u1,day2),agGen('gemini-3.8-flash',u3,day2)]};
  agDb(path.join(profile,'conversations/private-conversation-a.db'),convA);
  agDb(path.join(own,'private-conversation-a.db'),convA); // the same conversation again (a copy)
  agDb(path.join(own,'conv-b.db'),{steps:[agStep('gemini-3.8-flash-high',u5,ts)],gens:[agGen('gemini-3.8-flash',u5,ts)]});
  fs.symlinkSync(path.join(own,'conv-b.db'),path.join(own,'linked.db'));
  put(path.join(own,'broken.db'),'not a database');agDb(path.join(own,'rollback.db'),{steps:[agStep('gemini-3.8-flash-high',u5,ts)],wal:false});
  const r=await collect({...options,home:h}),q=r.payload,rows=q.days.flatMap(d=>d.r),ag=q.instances.findIndex(i=>i.id==='antigravity');
  const byModel=id=>rows.filter(x=>q.models[x[0]].id===id&&x[1]===ag);
  assert.deepEqual({files:r.checks.antigravityFiles,collapsed:r.checks.antigravityCopiesCollapsed,unreadable:r.checks.antigravityUnreadable},{files:3,collapsed:15,unreadable:2});
  assert.equal(rows.filter(x=>x[1]===ag).reduce((n,x)=>n+x[3],0),5);
  assert.deepEqual(q.instances[ag],{id:'antigravity',label:'Antigravity · Google AI Pro',driver:'antigravity',billing:'subscription',requestUnit:'calls'});
  assert.deepEqual(byModel('gemini-pro-agent').map(x=>x.slice(3,9)),[[1,1000,9000,0,300,120]]);
  const pro=q.models.find(m=>m.id==='gemini-pro-agent');assert.equal(pro.price.src,'litellm');assert.equal(pro.price.in,2);assert.equal(pro.price.out,12);
  assert.equal(byModel('gemini-3.8-flash-high').reduce((n,x)=>n+x[3],0),2);assert.equal(q.models.find(m=>m.id==='gemini-3.8-flash-high').aa,'gemini-3-8-flash');
  assert.deepEqual(byModel('gemini-3.8-flash').map(x=>x.slice(3,9)),[[1,50,0,0,5,0]]);
  const unknown=q.models.findIndex(m=>m.id==='antigravity-unknown');assert.equal(q.models[unknown].label,'Antigravity (model not recorded)');
  assert(q.coverage.some(c=>c.code==='unpriced_model'&&c.source==='antigravity-db'&&c.modelIdx===unknown));
  assert(q.coverage.some(c=>c.code==='unreadable_history'&&c.source==='antigravity-db'&&c.count===2));
  assert(!q.coverage.some(c=>c.code==='antigravity_without_counters'));
  assert.equal(r.checks.t3OverlapExcluded,2); // the T3 turn would count Antigravity use again
  assert.equal(q.sources.find(s=>s.id==='antigravity-db').rows,5);
  assert(r.warnings.some(x=>x.includes('Antigravity conversation files')));
  const json=JSON.stringify(q);for(const forbidden of ['private-ag-content-marker','private-step-marker','private-conversation','private-secret-marker','conv-b'])assert(!json.includes(forbidden));
  const key=randomBytes(32);assert.deepEqual(decryptEnvelope(encryptPayload(q,key),key),q);
  // Antigravity configured but its folders gone: the T3 turn fallback returns and the gap is noted.
  fs.rmSync(path.join(h,'.gemini'),{recursive:true});fs.rmSync(path.join(h,'.t3/userdata/providers'),{recursive:true});
  const gone=(await collect({...options,home:h})).payload;
  assert.equal(gone.instances.find(i=>i.id==='antigravity').requestUnit,'turns');
  assert(gone.coverage.some(c=>c.code==='missing_source'&&c.source==='antigravity-db'));
});
test('Antigravity: response ids, identical calls, per-instance fallback, bad times and oversized counters',async()=>{
  const h=cloneHome(),dayMs=864e5,earlier=day2-2*dayMs,same=agUsage(100,0,10,0);
  put(path.join(h,'.t3/userdata/settings.json'),{providerInstances:{antigravity:{driver:'antigravity',config:{}},ag2:{driver:'antigravity',displayName:'Antigravity 2',config:{}}},usageModelAliases:{}});
  const own=path.join(h,'.gemini/antigravity/conversations'),ids=(u,...xs)=>Buffer.concat([u,...xs.map(([k,v])=>pb([k,v]))]);
  // Two genuinely separate calls with identical counters keep their own day and model.
  agDb(path.join(own,'twins.db'),{steps:[agStep('gemini-pro-agent',same,earlier,false),agStep('claude-sonnet-4-6',same,day2,false)],gens:[agGen('gemini-pro-default',same,earlier),agGen('claude-sonnet-4-6',same,day2)]});
  // A retry with a different response id is another attempt; one id seen with two counter readings is one call.
  const a=ids(agUsage(300,0,30,0),[11,'response-a']),b=ids(agUsage(300,0,30,0),[11,'response-b']);
  agDb(path.join(own,'ids.db'),{steps:[pb([8,agTime(day2)],[9,a],[24,pb([8,'gemini-3.8-flash-high'])],[28,pb([2,b])]),pb([8,agTime(day2)],[9,ids(agUsage(100,0,10,0),[11,'response-c'])],[24,pb([8,'gemini-3.8-flash-high'])])],gens:[agGen('gemini-3.8-flash',ids(agUsage(110,0,10,0),[11,'response-c']),day2)]});
  // A timestamp outside 2015..now+2 days falls back to the file's time instead of failing the run.
  agDb(path.join(own,'far-future.db'),{steps:[pb([8,pb([1,253402300800])],[9,agUsage(7,0,1,0)],[24,pb([8,'gemini-3.8-flash-high'])])]});
  // A counter beyond 2^53 fails only its own file.
  agDb(path.join(own,'oversized.db'),{steps:[pb([8,agTime(day2)],[9,pb([2,2**53],[3,10])],[24,pb([8,'gemini-3.8-flash-high'])])]});
  // ag2 has no files of its own, so its T3 turn stays as the fallback (as turns) while antigravity's is excluded.
  const t=new DatabaseSync(path.join(h,'.t3/userdata/statev2.sqlite'));
  t.prepare('INSERT INTO orchestration_v2_projection_provider_threads VALUES(?,?,?,?,?)').run('b','b','antigravity','antigravity','ag2');
  t.prepare('INSERT INTO orchestration_v2_projection_provider_sessions VALUES(?,?,?,?,?)').run('b','gemini-3.8-flash-high','antigravity','antigravity','ag2');
  t.prepare('INSERT INTO orchestration_v2_projection_provider_turns VALUES(?,?,?,?,?,?,?)').run('b','b','t',null,new Date(day2-1000).toISOString(),new Date(day2+1000).toISOString(),JSON.stringify({turnTokenUsage:{...usage,inputTokens:250,cachedInputTokens:0,outputTokens:25},modelSelection:{model:'gemini-3.8-flash-high'}}));t.close();
  const r=await collect({...options,home:h}),q=r.payload,rows=q.days.flatMap(d=>d.r),inst=id=>q.instances.findIndex(i=>i.id===id);
  const calls=(model,day)=>rows.filter(x=>q.models[x[0]].id===model&&x[1]===inst('antigravity')&&(!day||q.days.find(d=>d.r.includes(x)).d===day));
  assert.deepEqual(calls('gemini-pro-agent','2026-10-05').map(x=>x.slice(3,5)),[[1,100]]);
  assert.deepEqual(calls('claude-sonnet-4-6','2026-10-07').map(x=>x.slice(3,5)),[[1,100]]);
  const flash=calls('gemini-3.8-flash-high');
  assert.equal(flash.reduce((n,x)=>n+x[3],0),4); // response-a, response-b, response-c (merged) and the far-future call
  assert.equal(flash.reduce((n,x)=>n+x[4],0),300+300+110+7); // 817 if response-c counted twice, 417 if response-b were dropped
  assert.equal(r.checks.antigravityUnreadable,1);assert(q.coverage.some(c=>c.code==='unreadable_history'&&c.count===1));
  assert.equal(q.instances[inst('ag2')].requestUnit,'turns');assert.equal(rows.filter(x=>x[1]===inst('ag2')).reduce((n,x)=>n+x[4],0),250);
  assert.equal(q.instances[inst('antigravity')].requestUnit,'calls');assert.equal(r.checks.t3OverlapExcluded,2);
});
test('Antigravity: mixed-id mirrors keep their day, ids join across copies, copies cover their instance, fixed-width counters fail',async()=>{
  const h=cloneHome(),dayMs=864e5,earlier=day2-2*dayMs,same=agUsage(100,0,10,0),withIds=(u,...xs)=>Buffer.concat([u,...xs.map(([k,v])=>pb([k,v]))]);
  put(path.join(h,'.t3/userdata/settings.json'),{providerInstances:{antigravity:{driver:'antigravity',config:{}},ag2:{driver:'antigravity',config:{}}},usageModelAliases:{}});
  const own=path.join(h,'.gemini/antigravity/conversations'),ag2=path.join(h,'.t3/userdata/providers/antigravity',createHash('sha256').update('ag2').digest('hex'),'antigravity-acp/conversations');
  // Two identical-counter calls; only the later step has a response id. Each keeps its own day and model.
  agDb(path.join(own,'mirror.db'),{steps:[agStep('gemini-pro-agent',same,earlier,false),pb([8,agTime(day2)],[9,withIds(same,[11,'response-x'])],[24,pb([8,'claude-sonnet-4-6'])])],gens:[agGen('gemini-pro-default',same,earlier),agGen('claude-sonnet-4-6',same,day2)]});
  // Copies of one conversation: ids arrive later (subset, then a bridge), and an id-less copy meets an id-bearing one.
  agDb(path.join(own,'copies.db'),{steps:[pb([8,agTime(day2)],[9,withIds(agUsage(500,0,50,0),[11,'response-b'])],[24,pb([8,'gemini-3.8-flash-high'])]),agStep('gemini-3.8-flash-high',agUsage(600,0,60,0),day2,false)]});
  agDb(path.join(ag2,'copies.db'),{steps:[pb([8,agTime(day2)],[9,withIds(agUsage(510,0,50,0),[11,'response-b'],[12,'response-a'])],[24,pb([8,'gemini-3.8-flash-high'])]),pb([8,agTime(day2)],[9,withIds(agUsage(600,0,60,0),[11,'response-d'])],[24,pb([8,'gemini-3.8-flash-high'])])]});
  // A counter sent as fixed32 fails its file instead of reading as 0.
  agDb(path.join(own,'fixed.db'),{steps:[pb([8,agTime(day2)],[9,Buffer.concat([Buffer.from([2*8+5,100,0,0,0]),pb([3,10])])],[24,pb([8,'gemini-3.8-flash-high'])])]});
  // ag2's store holds only copies, yet its T3 turn for the same use must not count again.
  const t=new DatabaseSync(path.join(h,'.t3/userdata/statev2.sqlite'));
  t.prepare('INSERT INTO orchestration_v2_projection_provider_threads VALUES(?,?,?,?,?)').run('b','b','antigravity','antigravity','ag2');
  t.prepare('INSERT INTO orchestration_v2_projection_provider_sessions VALUES(?,?,?,?,?)').run('b','gemini-3.8-flash-high','antigravity','antigravity','ag2');
  t.prepare('INSERT INTO orchestration_v2_projection_provider_turns VALUES(?,?,?,?,?,?,?)').run('b','b','t',null,new Date(day2-1000).toISOString(),new Date(day2+1000).toISOString(),JSON.stringify({turnTokenUsage:{...usage,inputTokens:600,cachedInputTokens:0,outputTokens:60},modelSelection:{model:'gemini-3.8-flash-high'}}));t.close();
  const r=await collect({...options,home:h}),q=r.payload,rows=q.days.flatMap(d=>d.r),inst=id=>q.instances.findIndex(i=>i.id===id);
  const dayOf=x=>q.days.find(d=>d.r.includes(x)).d,by=(model)=>rows.filter(x=>q.models[x[0]].id===model);
  assert.deepEqual(by('gemini-pro-agent').map(x=>[dayOf(x),x[3],x[4]]),[['2026-10-05',1,100]]);
  assert.deepEqual(by('claude-sonnet-4-6').map(x=>[dayOf(x),x[3],x[4]]),[['2026-10-07',1,100]]);
  // response-b (max 510) and the 600 call, once each: 1,110 input over 2 calls
  assert.deepEqual(by('gemini-3.8-flash-high').map(x=>[x[1],x[3],x[4]]),[[inst('antigravity'),2,1110]]);
  assert.equal(r.checks.antigravityUnreadable,1);assert.equal(r.checks.antigravityFiles,3);
  assert.equal(inst('ag2'),-1); // its only use is the copies (counted under antigravity) and the excluded T3 turn
  assert.equal(r.checks.t3OverlapExcluded,3);
  const json=JSON.stringify(q);for(const id of ['response-a','response-b','response-d','response-x'])assert(!json.includes(id));
});
