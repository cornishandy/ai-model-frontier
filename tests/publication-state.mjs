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
await import('../aa-data.js');await import('../scoring.js');
const board={v:1,identity:'a',scrapedAt:data.scrapedAt,keys:['x'],rows:[{slug:'a',score:70,model:{id:'a',name:'a'},raw:{x:.7},contributions:[]},{slug:'b',score:60,model:{id:'b',name:'b'},raw:{x:.6},contributions:[]}]};
const external={sources:[{key:'x',rows:[{value:.2}]}]};
const first=publicationState(data,null,[],undefined,external,board);
assert.deepEqual(publicationState({...data,scrapedAt:'2026-11-09'}, {publication:first},[],undefined,external,{...board,scrapedAt:'2026-11-09'}),first,'unchanged meaningful data reuses frozen context');
const extChanged={sources:[{key:'x',rows:[{value:.3}]}]};
const next=publicationState(data,{publication:first},[],undefined,extChanged,{...board,identity:'b'});
assert.deepEqual(next.priorBoard,board,'external-only change promotes frozen prior board');
assert.notEqual(next.fingerprint,first.fingerprint);

for (const rows of ['bad',[null,null],[{},{}]]) assert.equal(FrontierScoring.validBoard({...board,rows}),false,'malformed saved state is ignored without crashing');

const pack=(t,extra={})=>({fetchedAt:t,sources:[{key:'x',fetchedAt:t,updated:'2026-10-01',rows:[{fam:'a',value:1}],...extra}]});
const oldExt=pack('2026-11-08T00:00:00Z'),refreshedExt=pack('2026-11-08T00:30:00Z'),staleExt=pack(oldExt.fetchedAt,{stale:true});
const baseline=publicationState(data,null,[],undefined,oldExt,board);
for(const ext of [refreshedExt,staleExt]){
 assert.equal(fingerprint(data,oldExt),fingerprint(data,ext));
 assert.equal(FrontierScoring.identity(data,oldExt),FrontierScoring.identity(data,ext));
 assert.equal(publicationState({...data,scrapedAt:'2026-11-09'}, {publication:baseline},[],undefined,ext,board),baseline);
}
assert.notEqual(fingerprint(data,oldExt),fingerprint(data,pack(oldExt.fetchedAt,{updated:'2026-10-02'})),'source update dates remain meaningful');
console.log('PASS refresh timestamps and stale flags preserve publisher and visitor identity; real changes still advance');
