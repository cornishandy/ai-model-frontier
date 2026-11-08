import assert from 'node:assert/strict';
import {fingerprint,parseLive,readLive,publicationState,readFailurePolicy} from '../publication-state.mjs';
import {missingSetChanged} from '../speed-health.mjs';
const data={models:[{id:'a',outputSpeed:10}],index:{evals:[]},scrapedAt:'2026-11-08T10:00:00Z'};
const state=publicationState(data,null,['ttft']);
assert.deepEqual(publicationState({...data,scrapedAt:'new'}, {publication:state},['ttft']),state);
assert.equal(fingerprint({...data,publication:{foo:1}}),fingerprint(data));
assert.notEqual(fingerprint({...data,models:[{id:'a',outputSpeed:20}]}),fingerprint(data));
assert.deepEqual(parseLive('window.AA_DATA = '+JSON.stringify(data)+';\n'),data);
assert.throws(()=>parseLive('window.AA_DATA = {};'));
assert.equal(publicationState(data,{publication:{status:'unknown'}},[]).status,'known');
const changed=publicationState({...data,models:[{id:'a'}]},{publication:{...state,currentBoard:{score:1}}},[]);
assert.deepEqual(changed.priorBoard,{score:1});assert.ok(missingSetChanged(state.missingSpeedFields,changed.missingSpeedFields));
let tries=0; assert.equal(await readLive('https://example.test/data',{fetcher:async()=>{tries++;throw Error('offline')},pause:async()=>{}}),null);assert.equal(tries,3);
const now=Date.parse('2026-11-08T18:00:00Z');
const policy=async(hours,deploy=true)=>readFailurePolicy('schedule',{repo:'owner/repo',token:'test',now,fetcher:async url=>({ok:true,json:async()=>url.endsWith('/jobs')?{jobs:[{steps:[{name:'Run actions/deploy-pages@v4',conclusion:deploy?'success':'skipped'}]}]}:{workflow_runs:[{url:'https://api.github.com/runs/1',run_started_at:new Date(now-hours*3600000).toISOString()}]}})});
assert.equal(await policy(5),'skip');assert.equal(await policy(6),'fail');assert.equal(await policy(9,false),'skip');
assert.equal(await readFailurePolicy('push'),'unknown');
assert.equal(await readFailurePolicy('workflow_dispatch',{repo:'o/r',token:'t',fetcher:async()=>{throw Error('API down')}}),'skip');
console.log('PASS state carry/changed/first/unknown, bounded reads, scheduled skip/six-hour failure, quiet-skip exclusion, push unknown and API failure');

// A successful deployment is a good read even if the later notification fails the run.
const runs=[{url:'https://api.github.com/runs/new',conclusion:'failure',run_started_at:new Date(now-3600000).toISOString()},
 {url:'https://api.github.com/runs/old',conclusion:'success',run_started_at:new Date(now-8*3600000).toISOString()}];
assert.equal(await readFailurePolicy('schedule',{repo:'o/r',token:'test',now,fetcher:async url=>({ok:true,json:async()=>url.endsWith('/jobs')?
 {jobs:[{steps:[{name:'Run actions/deploy-pages@v4',conclusion:'success'}]}]}:
 {workflow_runs:new URL(url).searchParams.get('status')==='success'?runs.filter(r=>r.conclusion==='success'):runs}})}),'skip');
