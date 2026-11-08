const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const origin=process.env.FRONTIER_URL||'http://127.0.0.1:8792/index.html';
const hook='window.__speed={S,ALL,METRICS,render,openMenu,closeMenu,menuGroups,applySet,snapshot,fixAxes,compareBlock};';
(async()=>{const browser=await chromium.launch();try {
const context=await browser.newContext();
if(process.env.AIMF_DATA_FIXTURE)await context.route('**/data/models.js*',r=>r.fulfill({path:process.env.AIMF_DATA_FIXTURE,contentType:'application/javascript'}));
await context.route('https://api.github.com/gists/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{"files":{}}'}));
await context.route('**/index.html*',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('  // ---------- boot ----------',hook+'\n  // ---------- boot ----------')});});
await context.addInitScript(()=>localStorage.setItem('aa-charts:state:v2',JSON.stringify({x:'e2e',y:'e2e'})));
const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.goto(origin+'?noAutoUpdate&x=e2e&y=e2e');await p.waitForFunction(()=>window.__speed);
assert.deepEqual(await p.evaluate(()=>[__speed.S.x,__speed.S.y]),['e2eMean','e2eMean']);
await p.goto(origin+'?noAutoUpdate');assert.deepEqual(await p.evaluate(()=>[__speed.S.x,__speed.S.y]),['e2eMean','e2eMean']);
await p.evaluate(()=>__speed.applySet({x:'e2e',y:'e2e'}));assert.deepEqual(await p.evaluate(()=>[__speed.snapshot().x,__speed.snapshot().y]),['e2eMean','e2eMean']);
assert.match(await p.evaluate(()=>__speed.METRICS.ttft.desc),/Measured on real requests since 3 Nov 2026 \(Artificial Analysis methodology v3\), so not comparable with earlier values\./);
assert.equal(await p.evaluate(()=>__speed.METRICS.e2eMean.label),'End-to-end time (mean of single requests)');
// The saved pre-migration payload has no e2eMean values; seed two for the UI-only comparison check.
await p.evaluate(()=>{__speed.ALL.filter(m=>!m.deprecated).slice(0,2).forEach((m,i)=>m.e2eMean=100+i*50)});
assert.match(await p.evaluate(()=>{const t=__speed,ms=t.ALL.filter(m=>!m.deprecated&&m.e2eMean>0);return t.compareBlock({m:ms[0],color:'#000'},{m:ms[1]},false).html}),/End-to-end time \(mean of single requests\)/);
for (const axis of ['x','y']) {
 await p.evaluate(axis=>{const t=__speed;t.S.x=axis==='x'?'e2eMean':'intelligence';t.S.y=axis==='y'?'e2eMean':'intelligence';t.render();},axis);
 const caption=await p.locator('#chartDesc').innerText();
 assert.match(caption,/Seconds from sending a request to the final token, across single requests, including any thinking, with no fixed answer length\./);
 assert.match(caption,/Replaces the earlier fixed 500-token measure, so not comparable with earlier values\./);
 assert.ok(!caption.includes(': Mean of single-request workloads:'));
}
async function checkWrappedMessage() {
 const message=await p.locator('#chart').getAttribute('aria-label');
 for (const width of [390,320,390]) {
  await p.setViewportSize({width,height:1000});
  await p.waitForTimeout(200);
  assert.equal(await p.locator('#chart').getAttribute('aria-label'),message);
  const result=await p.locator('#chart').evaluate(svg=>{
   const spans=[...svg.querySelectorAll('text tspan')];
   return {lines:spans.length,text:spans.map(s=>s.textContent.trim()).join(' '),clipped:spans.some(s=>{const b=s.getBBox();return b.x<0||b.x+b.width>svg.viewBox.baseVal.width})};
  });
  assert.ok(result.lines>1);assert.equal(result.text,message);assert.equal(result.clipped,false);
 }
}
await p.evaluate(()=>{const t=__speed;for(const m of t.ALL)m.ttft=null;t.S.y='ttft';t.S.x='intelligence';t.S.yRel='off';t.render();t.openMenu('y',document.querySelector('#ySel'));});
assert.equal(await p.locator('#menuList [data-k="ttft"]').count(),0);
await p.locator('#menuSearch').fill('first answer');assert.equal(await p.locator('#menuList [data-k="ttft"]').count(),0);
await p.evaluate(()=>__speed.closeMenu());
assert.match(await p.locator('#chart').textContent(),/No current model has this measure in the data right now: Time to first answer token\./);
await checkWrappedMessage();
await p.evaluate(()=>{const t=__speed,m=t.ALL.find(m=>!m.deprecated&&m.intelligence!=null);m.ttft=2;t.S.selected=new Set(t.ALL.filter(n=>!n.deprecated&&n!==m&&n.intelligence!=null).map(n=>n.id));t.render();});
assert.match(await p.locator('#chart').textContent(),/None of the selected models have Time to first answer token data — add some that do\./);
await checkWrappedMessage();
await p.evaluate(()=>{const t=__speed;t.S.x='intelligence';t.S.y='intelligence';t.render();});
assert.equal(await p.locator('#chart').getAttribute('aria-label'),await p.locator('#chartTitle').textContent());
assert.deepEqual(errors,[]);console.log('PASS new speed key, URL X/Y, stored views, saved sets, empty menu guard including search/current selection and both empty chart cases');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
