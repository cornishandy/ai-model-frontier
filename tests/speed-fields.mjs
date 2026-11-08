import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {checkSpeedFields,missingSpeedFields,missingSetChanged} from '../speed-health.mjs';
const sandbox={};vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(new URL('../aa-data.js',import.meta.url),'utf8').replace('globalThis.AAData = {','globalThis.AAData = { buildModels,'),sandbox);
const raw={id:'test',name:'Test',slug:'test',creator:{name:'Test'},intelligenceIndex:30,headline:{timeToFirstAnswerToken:4,timeToFirstToken:1},endToEndTime:820};
const model=sandbox.AAData.buildModels([[raw]]).models[0];
assert.equal(model.ttft,4);assert.equal(model.e2eMean,820);assert.equal(model.e2e,undefined);
const missing=sandbox.AAData.buildModels([[{...raw,headline:{timeToFirstToken:1},endToEndTime:null}]]).models[0];
assert.equal(missing.ttft,null,'first token is not first answer token');assert.equal(missing.e2eMean,null);
assert.equal(missingSetChanged(['ttft'],['ttft']),false);
assert.equal(missingSetChanged(['ttft','outputSpeed'],['outputSpeed','ttft']),false);
assert.equal(missingSetChanged(['ttft'],[]),true);
assert.equal(missingSetChanged([],['ttft']),true);
assert.deepEqual(missingSpeedFields([{deprecated:true,ttft:1},{outputSpeed:1,e2eMean:20}]),['ttft']);
assert.deepEqual(await checkSpeedFields([model],async()=>['outputSpeed']),{current:['outputSpeed'],pending:false,changed:false});
assert.equal((await checkSpeedFields([model],async()=>[])).changed,true);
assert.equal((await checkSpeedFields([model])).pending,true);
// Execute the scraper's real blocking checks without fetching or writing data.
const scrape=fs.readFileSync(new URL('../scrape.mjs',import.meta.url),'utf8');
const checks=scrape.slice(scrape.indexOf('const scored ='),scrape.indexOf('if (out.index) console.log'));
function check(out){vm.runInNewContext(checks,{out,console:{log(){},error(){}},process:{exit(){throw Error('BLOCKED')}}});}
const valid={models:Array.from({length:20},()=>({intelligence:40,costPerTask:1})),indexWeights:{gpqa:1},index:{evals:[]}};
assert.doesNotThrow(()=>check(valid),'missing speed does not block deploy');
assert.throws(()=>check({...valid,models:[]}),/BLOCKED/);assert.throws(()=>check({...valid,index:null}),/BLOCKED/);
const workflow=fs.readFileSync(new URL('../.github/workflows/deploy.yml',import.meta.url),'utf8');
assert.ok(workflow.indexOf('run: node speed-health.mjs')>workflow.indexOf('uses: actions/deploy-pages@'));
console.log('PASS speed source mapping, missing/recovery transitions, storage seam, blocking catastrophe checks and post-deploy ordering');
