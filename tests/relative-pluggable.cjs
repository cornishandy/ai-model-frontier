const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/tmp/pw/node_modules/playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({headless:true});
  const context = await browser.newContext({viewport:{width:1280,height:900}});
  await context.route('https://api.github.com/gists/**', route => route.fulfill({status:200,contentType:'application/json',body:'{"files":{}}'}));
  await context.route('**/index.html*', async route => {
    const response=await route.fetch(),html=(await response.text()).replace('  // ---------- boot ----------','window.__bundleC={S,REF_DEFS,render,fixAxes,get geom(){return lastGeom},get points(){return lastPoints}};\n  // ---------- boot ----------');
    await route.fulfill({response,body:html});
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto((process.env.FRONTIER_URL || 'http://localhost:8773/index.html')+'?xRel=sweet');
  await page.waitForFunction(()=>window.__bundleC?.geom);
  const result=await page.evaluate(()=>{
    const t=window.__bundleC;
    t.S.zone='knee';
    t.REF_DEFS.sweet={...t.REF_DEFS.sweet,detail:'a replacement definition',pick:(points,axis)=>({point:points[2],value:points[2][axis+'v']})};
    t.render();
    const same=document.querySelector('#legend').textContent.includes(t.geom.X.ref.point.m.label);
    t.REF_DEFS.average={label:'Average',title:'The arithmetic mean of shown values',pick:(points,axis)=>({value:points.reduce((n,p)=>n+p[axis+'v'],0)/points.length})};
    t.S.xRel='average';t.S.zone='off';t.fixAxes();t.render();
    return {same,ref:t.geom.X.ref.key,note:document.querySelector('#relativeNote').textContent,title:t.geom.X.label};
  });
  assert.equal(result.same,true,'Replacing the sweet picker also changes the zone');
  assert.equal(result.ref,'average');assert.match(result.note,/\(average\)/);assert.match(result.note,/arithmetic mean/);assert.match(result.title,/× average/);
  assert.deepEqual(errors,[]);
  await browser.close();console.log('PASS one-entry sweet replacement and new average reference; 0 errors');
})().catch(e=>{console.error(e);process.exit(1);});
