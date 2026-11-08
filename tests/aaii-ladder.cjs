const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/tmp/pw/node_modules/playwright');
const origin = process.env.FRONTIER_URL || 'http://127.0.0.1:8791/index.html';
const fixture = process.env.AIMF_DATA_FIXTURE;
const shots = process.env.AIMF_SHOTS || require('os').tmpdir(); // where the 1280/390 screenshots go
const hook = `window.__aaii = {S,ALL,METRICS,DATA,applyBasis,render,fixMarks,save,snapshot,applySet,iiMembers,iiVersion,iiFormer,svgString,pickerLists,menuGroups,openMenu,closeMenu,filtersChanged,weightRows,ladderValue,valFmt,registerDynamicBenchmarks, get points(){return lastPoints},get anchors(){return lastAnchors},get geom(){return lastGeom}};`;
// These are Andy's 23 saved picks, including the obsolete, contaminated metric.
const picks = ['hleDiamond','critptHard','omniscience','endToEndTime','frontierCode20','frontierCode','code2video','aa3d','automationBench','itBench','cyberIndex','cweBench','deepsecBench','briefcase','mlcr','harvey','capFinance','capStrategy','capLegal','capMedical','capEngineering','capEconomics','ext:weirdml'];
const sandbox = {}; vm.createContext(sandbox); vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../aa-data.js'),'utf8'),sandbox);
assert.deepEqual(Array.from(sandbox.AAData.discoverNumericFields([{outputSpeed:42,endToEndTime:1000,vialsScore:0.5}]),b=>b.key),['vialsScore']);
assert.equal(sandbox.AAData.isNonBenchKey('newLatency'),true);
assert.equal(sandbox.AAData.isNonBenchKey('timeSeriesBench'),false);
console.log('PASS discovery suffix and numeric fixture');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
 const context=await browser.newContext({viewport:{width:1280,height:1000}}), errors=[];
 await context.route('https://api.github.com/gists/**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({files:{'aa-charts-sync.json':{content:'{"sets":{}}'}}})}));
 if(fixture)await context.route('**/data/models.js*',r=>r.fulfill({path:fixture,contentType:'application/javascript'}));
 await context.addInitScript(({picks})=>{
 localStorage.setItem('aa-charts:collapsed-groups','{}');
 if (!localStorage.getItem('aa-charts:state:v2')) localStorage.setItem('aa-charts:state:v2',JSON.stringify({benchPick:{seed:'none',on:picks,off:[]},activeOnly:false,basis:'listed',x:'myCost',y:'myIndex',labels:'ladder',ladderAt:'xhigh',theme:'sage',yRel:'best',markEffort:'xhigh',markStyle:'hash',valueLabels:'y',shortEffort:false,shortEffortTouched:true}));
 },{picks});
 await context.route('**/index.html*',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('  // ---------- boot ----------',hook+'\n  // ---------- boot ----------')});});
 const page=await context.newPage();page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR',e.message)});
 await page.goto(origin+'?noAutoUpdate');await page.waitForFunction(()=>window.__aaii?.geom);
 const catalog=await page.evaluate(()=>Object.entries(__aaii.METRICS).map(([k,v])=>[k,v.label]));
 const missing=picks.filter(k=>k!=='endToEndTime'&&!catalog.some(([key])=>key===k));
 assert.deepEqual(missing,[],'Fixture keys exist; catalog: '+JSON.stringify(catalog));
 const first=await page.evaluate(()=>{const t=__aaii;return {on:t.S.benchPick.on.length,bad:!!t.METRICS.endToEndTime,vials:!!t.METRICS.vialsScore,ver:t.DATA.index.version,N:t.iiMembers().length,rows:t.weightRows().length};});
 assert.equal(first.on,22);assert.equal(first.bad,false);if(fixture)assert.equal(first.vials,true);assert.equal(await page.evaluate(()=>!!__aaii.METRICS.outputSpeed.dynamic),false);
 assert.match(await page.locator('#aaiiBlock .ii-heading').innerText(),/6 of its 9.*70%/);
 assert.equal(await page.locator('#aaiiBlock .ii-chip:not(.left-out)').count(),6);
 assert.deepEqual(await page.locator('#aaiiBlock .ii-chip.left-out').evaluateAll(es=>es.map(e=>e.dataset.k).sort()),['gdpPdf','terminalBench40','terminalBenchScience']);
 assert.match(await page.locator('#aaiiBlock').innerText(),/16 more:/);
 assert.doesNotMatch(await page.locator('#chartDesc').innerText(),/Percentages count as they are|weighted:/);
 assert.match(await page.locator('#chartTitle').innerText(),/from your picker list$/);
 assert.match(await page.locator('#chartSub').innerText(),/^Y: 22 benchmarks averaged, 0–100 \(× best\).*X: cost per task on the 6 of them with an AA cost, USD.*Linear scales\.$/);
 await page.locator('[data-weights]').click();assert.equal(await page.locator('#explainToggle').getAttribute('aria-expanded'),'true');assert.equal(await page.locator('[data-weights]').getAttribute('aria-expanded'),'true');assert.equal(await page.locator('.wrow').count(),22);
 assert.match(await page.locator('#explainPanel').innerText(),/75%/);assert.match(await page.locator('#explainPanel').innerText(),/nearest effort/);
 console.log('PASS Andy fixture, header, weights and contaminated payload');
 await page.evaluate(()=>{__aaii.S.basis='aa';__aaii.applyBasis();__aaii.render();});
 assert.match(await page.locator('#aaiiBlock').innerText(),/6 of its 9.*70%/);assert.match(await page.locator('#aaiiBlock').innerText(),/AA's own: all 9 at AA's weights/);assert.equal(await page.locator('.wrow').count(),9);
 await page.evaluate(()=>{__aaii.S.y='terminalBench40';__aaii.S.x='costPerTask';__aaii.render();});
 assert.match(await page.locator('#aaiiBlock').innerText(),/6 of its 9.*70%.*left out:/s);assert.equal(await page.locator('#aaiiBlock .ii-chip').count(),0);
 await page.locator('#ySel').click();
 assert.match(await page.locator('#menuList .mh').first().innerText(),new RegExp(first.ver.replaceAll('.','\\.')));
 assert.equal(await page.locator('#menuList .mi.ii').count(),10);assert.equal(await page.locator('#menuList .mi.ii .ii-tag').filter({hasText:'not in your list'}).count(),3);
 const versions=await page.evaluate(()=>Object.fromEntries(__aaii.iiMembers().map(k=>[k,__aaii.iiVersion(k)])));
 if(fixture){assert.equal(versions.briefcase,'v1.1');assert.equal(versions.omniscience,'v1.1');assert.equal(versions.terminalBenchScience,'0.1');assert.equal(versions.frontierCode20,'');assert.equal(versions.terminalBench40,'');assert.equal(versions.critptHard,'');}
 await page.locator('#benchEdit').click();
 const noDuplicates=await page.evaluate(()=>__aaii.iiMembers().every(k=>document.querySelectorAll(`#menuList .mi[data-k="${k}"]`).length===1));assert.equal(noDuplicates,true);
 const former=await page.evaluate(()=>Object.fromEntries(['hle','scicode','lcr','critpt','gdpval','gpqa','terminalBench21','tauBanking','terminalbenchHard','tau2','ifbench','mmluPro','livecodebench','math500','aime25'].filter(k=>__aaii.METRICS[k]).map(k=>[k,__aaii.iiFormer(k)])));
 if(fixture){assert.match(former.hle,/in index to v4.3.2/);assert.match(former.gpqa,/in index to v4.1.1/);assert.match(former.critpt,/in index to v4.3.2/);for(const k of ['scicode','lcr','gdpval'])assert.match(former[k],/in index to v4.3.2/);for(const k of ['terminalBench21','tauBanking'])assert.match(former[k],/in index to v4.2/);for(const k of ['terminalbenchHard','tau2'])assert.match(former[k],/in index before v4.1/);assert.match(former.ifbench,/removed in v4.1/);for(const k of ['mmluPro','livecodebench'])assert.match(former[k],/removed in v4.0/);for(const k of ['math500','aime25'])assert.match(former[k],/retired from index/);}
 const before=await page.evaluate(()=>({...__aaii.S.benchPick,on:[...__aaii.S.benchPick.on]}));
 await page.locator('.mh.ii .mh-box').check();
 assert.equal(await page.evaluate(()=>__aaii.iiMembers().filter(__aaii.pickerLists).length),9);
 assert.equal(await page.evaluate(()=>__aaii.S.benchPick.on.includes('intelligence')),false);
 await page.locator('#menuSearch').fill('Briefcase');await page.locator('.mh.ii .mh-box').uncheck();
 assert.equal(await page.evaluate(()=>__aaii.iiMembers().filter(__aaii.pickerLists).length),8);
 await page.evaluate(before=>{__aaii.S.benchPick=before;__aaii.closeMenu();},before);
 console.log('PASS menu grouping, versions, former-member tags and search-scoped Choose');
 await page.evaluate(()=>{const t=__aaii;t.S.basis='listed';t.S.x='myCost';t.S.y='myIndex';t.S.selected=new Set(t.ALL.filter(m=>!m.deprecated&&/^(gemini-4|grok-4-7|gpt-6|claude-opus-5-5|claude-fable-5-1)/.test(m.family)).map(m=>m.id));t.applyBasis();t.render();});
 async function ladderCheck(){return page.evaluate(()=>{const t=__aaii,fail=[];for(const el of document.querySelectorAll('.ladder-btn')){const p=t.points.concat(t.anchors).find(p=>p.m.id===el.dataset.anchor);if(!p){fail.push('missing anchor');continue;}if(el.dataset.value!==t.ladderValue(p,t.geom.Y).text&&el.dataset.value!==t.ladderValue(p,t.geom.Y,true).text)fail.push('wrong value');const line=el.previousElementSibling;if(Math.abs(+line.getAttribute('y1')-p.py)>0.01||Math.abs(+line.getAttribute('x1')-p.px-6)>0.01)fail.push('wrong leader');if(t.S.ladderAt==='xhigh'&&p.m.effort!=='xhigh'&&!el.querySelector('title').textContent.includes('has no XHigh result'))fail.push('missing fallback title');}return fail;});}
 assert.deepEqual(await ladderCheck(),[]);
 assert.match(await page.evaluate(()=>__aaii.svgString().text),/Y at XHigh/);
 const gemini=await page.locator('.ladder-btn').evaluateAll(es=>es.filter(e=>/Gemini 4/.test(e.textContent)).map(e=>e.dataset.value));assert.ok(gemini.length);assert.ok(gemini.every(s=>/^(high|H) /.test(s)));
 const shownAnchors=await page.evaluate(()=>({ref:__aaii.geom.Y.ref.value,values:Object.fromEntries(__aaii.points.filter(p=>p.m.effort==='xhigh').map(p=>[p.m.id,p.yv]))}));
 await page.evaluate(()=>{__aaii.S.efforts.delete('xhigh');__aaii.render();});
 const hidden=await page.evaluate(()=>({ref:__aaii.geom.Y.ref.value,values:Object.fromEntries(__aaii.anchors.map(p=>[p.m.id,p.yv])),count:__aaii.anchors.length}));assert.ok(hidden.count>0);assert.equal(await page.locator('.ladder-anchor').count(),hidden.count);assert.deepEqual(await ladderCheck(),[]);assert.equal(hidden.ref,shownAnchors.ref);for(const [id,v] of Object.entries(shownAnchors.values))assert.equal(hidden.values[id],v);
 await page.evaluate(()=>{const p=__aaii.anchors[0],svg=document.querySelector('#chart'),r=svg.getBoundingClientRect();svg.dispatchEvent(new PointerEvent('pointermove',{pointerType:'mouse',clientX:r.left+p.px,clientY:r.top+p.py,bubbles:true}));});
 assert.match(await page.locator('#tooltip').innerText(),/shown for the ladder; your effort filter hides XHigh/);
 await page.evaluate(()=>{const t=__aaii,efforts=t.S.efforts;try{t.S.efforts=new Set();t.render();if(t.points.length||!t.anchors.length||!t.geom)throw Error('fully hidden efforts lost ladder anchors');}finally{t.S.efforts=efforts;t.render();}});
 // Keeping the shown set fixed, adding anchor-only dots must not change the reference.
 await page.locator('#ladderAtSel').selectOption('top');assert.equal(await page.evaluate(()=>__aaii.geom.Y.ref.value),hidden.ref);
 assert.ok((await page.locator('.ladder-btn').evaluateAll(es=>es.map(e=>e.dataset.value))).every(s=>/^(low|medium|high|xhigh|max|default|non-reasoning|MN|L|M|D|H|X|MX|N) /.test(s)));
 await page.locator('#ladderAtSel').selectOption('xhigh');
 await page.evaluate(()=>{const t=__aaii,snap=t.snapshot();t.S.ladderAt='top';t.applySet(snap);if(t.S.ladderAt!=='xhigh')throw Error('saved set lost ladderAt');});
 assert.deepEqual(await page.evaluate(()=>Object.fromEntries(__aaii.anchors.map(p=>[p.m.id,p.yv]))),hidden.values);
 await page.evaluate(()=>{__aaii.S.labels='auto';__aaii.render();});assert.equal(await page.locator('#ladderAtWrap').isVisible(),false);
 await page.evaluate(()=>{__aaii.S.labels='ladder';__aaii.S.shape='diamond';__aaii.render();});assert.equal(await page.locator('#ladderAtWrap').isVisible(),false);
 await page.evaluate(()=>{__aaii.S.shape='standard';__aaii.save();});await page.reload();await page.waitForFunction(()=>window.__aaii?.geom);assert.equal(await page.locator('#ladderAtSel').inputValue(),'xhigh');
 await page.goto(origin+'?noAutoUpdate&ladderAt=max');await page.waitForFunction(()=>window.__aaii?.geom);assert.equal(await page.locator('#ladderAtSel').inputValue(),'max');
 await page.goto(origin+'?noAutoUpdate&ladderAt=bogus');await page.waitForFunction(()=>window.__aaii?.geom);assert.equal(await page.locator('#ladderAtSel').inputValue(),'top');
 console.log('PASS ladder geometry, fallback, hollow anchors, reference isolation, visibility, persistence and URL');
 await page.evaluate(()=>{const t=__aaii;t.S.ladderAt='xhigh';t.S.efforts=new Set(t.ALL.map(m=>m.effort));t.S.theme='sage';document.documentElement.setAttribute('data-theme','sage');t.S.valueLabels='y';t.render();document.querySelector('#explainPanel').hidden=true;document.querySelector('#shiftDismiss').click();});
 for(const width of [1280,390]){
 await page.setViewportSize({width,height:1000});await page.waitForTimeout(150);
 const failures=await page.evaluate(()=>{const rows=[...document.querySelectorAll('.ladder-btn')],fail=[];const rects=rows.map(e=>e.querySelector('rect').getBoundingClientRect());for(let i=1;i<rects.length;i++)if(rects[i].top<rects[i-1].bottom-0.5)fail.push('rows overlap');const svg=document.querySelector('#chart').getBoundingClientRect();for(const e of document.querySelectorAll('.ladder-value')){const b=e.getBoundingClientRect();if(b.right>svg.right+0.5||b.left<svg.left)fail.push('value clipped');}if(document.documentElement.scrollWidth>innerWidth)fail.push('page overflow');return fail;});assert.deepEqual(failures,[]);
 await page.locator('#chartCard').screenshot({path:`${shots}/build-${width}.png`,style:'.toolbar.axes, header, #sidebar, #scrim { visibility: hidden !important; } main { overflow: visible !important; } html, body { height: auto !important; }'});
 }
 assert.deepEqual(errors,[]);console.log('PASS 1280/390 geometry, screenshots and no page errors');await context.close();
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
