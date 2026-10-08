// Run with node tests/relative-axes.cjs while this worktree is served on port 8773.
// FRONTIER_URL and PLAYWRIGHT_PATH can override the local server and Playwright installation.
const { chromium, webkit, devices } = require(process.env.PLAYWRIGHT_PATH || '/tmp/pw/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path').join(__dirname, 'relative-artifacts/');
fs.mkdirSync(path, {recursive:true});
const origin = process.env.FRONTIER_URL || 'http://localhost:8773/index.html';
const cardStyle = '.toolbar.axes, header, #sidebar, #scrim { visibility: hidden !important; } main { overflow: visible !important; } html, body { height: auto !important; }';
const results = [], errors = [];
const hook = `window.__bundleC = {S, REF_DEFS, METRICS, ALL, render, fixAxes, kneeOf, paretoFront, makeScale, ratio, get points(){return lastPoints}, get ghosts(){return lastGhosts}, get geom(){return lastGeom}};`;

async function scenario(browser, name, options, query, state, run) {
  const context = await browser.newContext(options);
  // The existing saved-set sync is outside this feature; keep remote API throttling out of local UI checks.
  await context.route('https://api.github.com/gists/**', route => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({files:{'aa-charts-sync.json':{content:'{"sets":{}}'}}})}));
  if (state) await context.addInitScript((state) => localStorage.setItem('aa-charts:state:v2', JSON.stringify(state)), state);
  // Grid, Axis text, Glow and Shape start folded on a first visit; these checks click their options directly.
  await context.addInitScript(() => { if (!localStorage.getItem('aa-charts:collapsed-groups')) localStorage.setItem('aa-charts:collapsed-groups', '{}'); });
  await context.route('**/index.html*', async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replace('  // ---------- boot ----------', hook + '\n  // ---------- boot ----------');
    await route.fulfill({response, body: html});
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  await page.goto(origin + query);
  await page.waitForFunction(() => window.__bundleC?.geom || document.querySelector('#chart').textContent.includes('Select models'));
  await run(page);
  assert.deepEqual(errors, [], 'No page or console errors');
  results.push(name);
  console.log('PASS', name);
  await context.close();
}

async function snapshot(page, name, card = true) {
  await page.mouse.move(0, 0);
  await page.screenshot({path: path + name + '-overview.png'});
  if (card) await page.locator('#chartCard').screenshot({path: path + name + '-chart.png',style:cardStyle});
}

async function checkGeometry(page) {
  const check = await page.evaluate(() => {
    const {points, ghosts, geom, S} = window.__bundleC, failures = [];
    for (const p of [...points, ...ghosts]) {
      if (![p.xv,p.yv,p.vx,p.vy,p.px,p.py].every(Number.isFinite)) failures.push('non-finite geometry');
      for (const [axis, metric, raw, value] of [['X',geom.X,p.rawX,p.xv],['Y',geom.Y,p.rawY,p.yv]]) {
        if (Math.abs(value - raw / (metric.ref?.value || 1)) > 1e-10) failures.push(axis + ' ratio mismatch');
      }
    }
    for (const [axis,metric,sc] of [['x',geom.X,geom.sx],['y',geom.Y,geom.sy]]) if (metric.ref) {
      if (!sc.ticks.includes(1)) failures.push('missing 1× tick');
      if (S[axis+'Scale']==='log') {
        const middle = axis==='x' ? geom.M.left+geom.PW/2 : geom.M.top+geom.PH/2;
        const vs=[...points,...ghosts].map(p=>p[axis+'v']),both=Math.min(...vs)<0.95&&Math.max(...vs)>1.05;
        if (both) {
          if (Math.abs(sc.f(1)-middle)>1e-9) failures.push('two-sided log reference not centered');
          if (Math.abs(sc.lo*sc.hi-1)>1e-9) failures.push('two-sided log endpoints not reciprocal');
        } else {
          if (Math.min(...vs)>=1 && sc.lo!==1) failures.push('one-sided log min not anchored at 1');
          if (Math.max(...vs)<=1 && Math.min(...vs)<1 && sc.hi!==1) failures.push('one-sided log max not anchored at 1');
        }
      }
    }
    if (document.documentElement.scrollWidth > innerWidth) failures.push('page overflow');
    const axes = document.querySelector('.axes').getBoundingClientRect();
    for (const el of document.querySelectorAll('.axes .picker, .axes .seg, .axes .axis-relative')) {
      const r=el.getBoundingClientRect(); if(r.width && (r.left<axes.left-1 || r.right>axes.right+1)) failures.push('axis control overflow');
    }
    return failures;
  });
  assert.deepEqual(check, []);
}

async function setSynthetic(page, xs, ys, extra = {}) {
  await page.evaluate(({xs,ys,extra}) => {
    const t=window.__bundleC;
    const models=t.ALL.filter(m=>m.effort!=='non-reasoning').slice(0,xs.length);
    models.forEach((m,i)=>{m.costPerTask=xs[i];m.intelligence=ys[i];m.label='Synthetic '+String.fromCharCode(65+i);});
    Object.assign(t.S,{selected:new Set(models.map(m=>m.id)),efforts:new Set(models.map(m=>m.effort)),pinned:new Set(),x:'costPerTask',y:'intelligence',xScale:'linear',yScale:'linear',xRel:'sweet',yRel:'off',hideOlder:false,fullFrontier:false,zone:'knee',...extra});
    t.fixAxes(); t.render();
  },{xs,ys,extra});
}

async function currentCatalog(page) {
  await page.evaluate(()=>{
    const t=window.__bundleC;
    t.S.selected=new Set(t.ALL.filter(m=>!m.deprecated).map(m=>m.id));
    t.render();
  });
}

async function checkTags(page) {
  const failures=await page.evaluate(()=>{
    const tags=[...document.querySelectorAll('.zone-tag,.reference-tag')], failures=[];
    const overlap=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
    for(const tag of tags) {
      const a=tag.getBoundingClientRect();
      for(const el of document.querySelectorAll('#chart text')) if(el!==tag&&overlap(a,el.getBoundingClientRect())) failures.push(tag.textContent+' overlaps '+el.textContent);
      const b=tag.getBBox(),g=window.__bundleC.geom;
      if(b.x<g.M.left||b.x+b.width>g.M.left+g.PW||b.y<g.M.top||b.y+b.height>g.M.top+g.PH)failures.push('tag outside plot');
    }
    return failures;
  });
  assert.deepEqual(failures,[],'Chart tags avoid all rendered text');
}

async function assertReference(page,id,x,y) {
  const ref=await page.evaluate(()=>{
    const {geom,points,kneeOf,paretoFront}=window.__bundleC;
    const knee=kneeOf(paretoFront(points.map(p=>({...p,xv:p.rawX,yv:p.rawY}))));
    return {id:geom.X.ref?.point.m.id,key:geom.X.ref?.point.m.family+':'+geom.X.ref?.point.m.effort,x:geom.X.ref?.value,y:geom.X.ref?.point.rawY,gap:knee?.gap};
  });
  assert.equal(ref.key,id);
  assert.ok(ref.gap>0,'Sweet spot bends toward better on both');
  if(x!==undefined)assert.ok(Math.abs(ref.x-x)<0.005,'Expected raw X value');
  if(y!==undefined)assert.ok(Math.abs(ref.y-y)<0.1,'Expected raw Y value');
  await page.locator('#zoneSeg [data-v="knee"]').click();
  assert.match(await page.locator('#legend').innerText(),new RegExp(id.startsWith('gpt')?'sweet spot at GPT':'sweet spot at'));
  assert.equal(await page.locator('.zone-tag').getAttribute('data-id'),ref.id,'Zone and relative axis share the pick');
  await checkGeometry(page);await checkTags(page);
}

async function round2(c,w,desktop) {
  await scenario(c,'round2-default-linear-values',desktop,'?xRel=sweet',null,async p=>{
    await assertReference(p,'claude-opus-5-5:medium',1.34,51.2);
    assert.match(await p.locator('#relativeNote').innerText(),/\$1\.34, Intelligence Index 51\.2/);
    assert.doesNotMatch(await p.locator('#relativeNote').innerText(),/bend is slight/);
    assert.match(await p.locator('#zoneSeg [data-v="knee"]').getAttribute('title'),/returns diminish/);
    await snapshot(p,'round2-default-linear-zone');
  });
  await scenario(c,'round2-default-log-values',desktop,'?xRel=sweet&xScale=log&theme=dark',null,async p=>{
    await assertReference(p,'gpt-6-luna:max',0.068,38.1);
    assert.match(await p.locator('#relativeNote').innerText(),/The bend is slight on this scale/);
    await snapshot(p,'round2-default-log-zone');
  });
  await scenario(c,'round2-current-linear-values',desktop,'?xRel=sweet',null,async p=>{
    await currentCatalog(p);await assertReference(p,'gpt-6-1-sol:xhigh',0.39,51.0);
  });
  await scenario(c,'round2-grok-gpqa-cost-log',desktop,'?x=costPerTask&y=gpqa&xScale=log&xRel=sweet',null,async p=>{
    await assertReference(p,'gpt-5-6-sol:medium',0.505,0.926);
    await snapshot(p,'round2-gpqa-cost-log');
    await p.locator('#xRel').selectOption('off');
    assert.match(await p.locator('#legend').innerText(),/sweet spot at GPT-5.6 Sol \(medium\)/,'Zone alone also rejects the dent');
  });
  await scenario(c,'round2-grok-time-current-log',desktop,'?x=timePerTask&xScale=log&y=intelligence&xRel=sweet',null,async p=>{
    await currentCatalog(p);await assertReference(p,'gpt-6-astra:low',undefined,45.8);
    assert.doesNotMatch(await p.locator('#relativeNote').innerText(),/cost vs score|dollar/);
    await snapshot(p,'round2-time-current-log');
  });
  await scenario(c,'round2-grok-speed-current-log',desktop,'?x=outputSpeed&xScale=log&y=intelligence&xRel=sweet',null,async p=>{
    await currentCatalog(p);await assertReference(p,'muse-spark-1-3:xhigh',undefined,45.1);
    assert.match(await p.locator('#relativeNote').innerText(),/The bend is slight/);
    await snapshot(p,'round2-speed-current-log');
  });
  for(const [name,query,all] of [
    ['hallucination-default','?x=hallucination&y=intelligence&xRel=sweet',false],
    ['speed-current-linear','?x=outputSpeed&y=intelligence&xRel=sweet',true],
  ])await scenario(c,'round2-no-positive-bend-'+name,desktop,query,null,async p=>{
    if(all)await currentCatalog(p);
    assert.match(await p.locator('#relativeNote').innerText(),/No sweet spot on this scale/);
    assert.ok(!(await p.evaluate(()=>window.__bundleC.geom.X.ref)));
    await p.locator('#zoneSeg [data-v="knee"]').click();
    assert.match(await p.locator('#chartNote').innerText(),/does not bend toward better on both/);
    assert.equal(await p.locator('.zone-tag').count(),0);
    await checkGeometry(p);
  });
  await scenario(c,'round2-signed-gap-and-endpoints',desktop,'',null,async p=>{
    await setSynthetic(p,[1,2,5,10],[10,20,21,80]);
    assert.equal(await p.evaluate(()=>window.__bundleC.geom.X.ref.point.m.label),'Synthetic B','Positive bend wins over a deeper negative dent');
    await setSynthetic(p,[1,2,5,10],[10,12,15,80]);
    assert.match(await p.locator('#relativeNote').innerText(),/No sweet spot/);
    await setSynthetic(p,[1,2,10],[1,8,10]);
    const before=await p.evaluate(()=>{const t=window.__bundleC;return t.kneeOf(t.paretoFront(t.points.map(p=>({...p,xv:p.rawX,yv:p.rawY})))).gap;});
    await setSynthetic(p,[1,2,10,80,5],[1,8,10,4,-20]);
    const after=await p.evaluate(()=>{const t=window.__bundleC;return t.kneeOf(t.paretoFront(t.points.map(p=>({...p,xv:p.rawX,yv:p.rawY})))).gap;});
    assert.equal(after,before,'Dominated outliers do not change the normalized gap');
    const edgeCases=await p.evaluate(()=>{
      const t=window.__bundleC;
      const front=[{xv:1,yv:1},{xv:2,yv:2},{xv:3,yv:3}];
      const straight=t.kneeOf(front)===null;
      t.S.xScale='log';front[0].xv=0;const invalid=t.kneeOf(front)===null;
      t.S.xScale='linear';front.forEach(p=>p.xv=1);const flat=t.kneeOf(front)===null;
      const short=t.kneeOf(front.slice(0,2))===null;
      return {straight,invalid,flat,short};
    });
    assert.deepEqual(edgeCases,{straight:true,invalid:true,flat:true,short:true});
  });
  await scenario(c,'round2-first-visible-pin',desktop,'?xRel=pinned&pin=claude-opus-5-5:high,gpt-6-luna:low',null,async p=>{
    await p.evaluate(()=>{const t=window.__bundleC;t.S.efforts.delete('high');t.render();});
    assert.equal(await p.evaluate(()=>window.__bundleC.geom.X.ref.point.m.family+':'+window.__bundleC.geom.X.ref.point.m.effort),'gpt-6-luna:low');
    await checkGeometry(p);
  });
  await scenario(c,'round2-one-sided-log-best',desktop,'?xRel=best&xScale=log&yRel=best&yScale=log',null,async p=>{
    await checkGeometry(p);
    const domain=await p.evaluate(()=>{const g=window.__bundleC.geom;return {x:g.sx.lo,y:g.sy.hi,xSpan:g.sx.f(Math.max(...window.__bundleC.points.map(p=>p.xv)))-g.sx.f(1),width:g.PW};});
    assert.equal(domain.x,1);assert.equal(domain.y,1);assert.ok(domain.xSpan>domain.width*0.9);
    assert.deepEqual((await p.locator('.reference-tag').allTextContents()).sort(),['X 1.0','Y 1.0']);
    await checkTags(p);await snapshot(p,'round2-one-sided-log-best');
    const single=await p.evaluate(()=>window.__bundleC.makeScale([1,1],'log',[0,100],true));
    assert.equal(single.lo,1);assert.ok(single.hi>1);
  });
  await scenario(c,'round2-zero-reference-axis-formatter',desktop,'?xRel=best',null,async p=>{
    await currentCatalog(p);assert.match(await p.locator('#relativeNote').innerText(),/reference is \$0/);
    await setSynthetic(p,[1,2,3],[10,20,30],{x:'timePerTask',xRel:'best'});
    await p.evaluate(()=>{const t=window.__bundleC;t.ALL.filter(m=>t.S.selected.has(m.id)).forEach((m,i)=>m.timePerTask=i);t.render();});
    assert.match(await p.locator('#relativeNote').innerText(),/reference is 0\.0s/);
    assert.doesNotMatch(await p.locator('#relativeNote').innerText(),/\$/);
  });
  await scenario(c,'round2-combined-sweet-and-ring',desktop,'?xRel=sweet&yRel=sweet',null,async p=>{
    const note=await p.locator('#relativeNote').innerText();
    assert.match(note,/1\.0 on both axes/);assert.equal((note.match(/frontier’s knee/g)||[]).length,1);
    assert.equal(await p.locator('.reference-dot').count(),1);
    assert.equal(await p.locator('.reference-tag').textContent(),'X/Y 1.0');
    await checkTags(p);
    await p.locator('#zoneSeg [data-v="knee"]').click();
    assert.equal(await p.locator('.zone-tag.reference-tag').textContent(),'Sweet spot · X/Y 1.0');
    await checkTags(p);await snapshot(p,'round2-both-sweet');
    await p.locator('#shapeSeg [data-v="diamond"]').click();
    await checkTags(p);await checkGeometry(p);await snapshot(p,'round2-diamond-both-sweet');
  });
  await scenario(w,'round2-iphone-note-and-best-log',{...devices['iPhone 12 Pro'],colorScheme:'light'},'?theme=dark&xRel=sweet&yRel=sweet',null,async p=>{
    await checkGeometry(p);await checkTags(p);
    assert.ok(await p.locator('#relativeNote').evaluate(el=>el.getBoundingClientRect().height)<122,'Combined phone note is shorter than the old two paragraphs');
    await snapshot(p,'round2-iphone-both-sweet');
    await p.locator('#toggleOpts').click();await p.locator('#xRel').selectOption('best');
    await p.locator('#xScale [data-v="log"]').click();await p.locator('#yRel').selectOption('best');
    await p.locator('#yScale [data-v="log"]').click();await p.locator('#toggleOpts').click();
    await checkGeometry(p);await checkTags(p);
    assert.deepEqual((await p.locator('.reference-tag').allTextContents()).sort(),['X 1.0','Y 1.0'],'Both phone reference rings are named');
    await snapshot(p,'round2-iphone-best-log');
  });
}

(async()=>{
  const c=await chromium.launch({headless:true}), w=await webkit.launch({headless:true});
  const desktop={viewport:{width:1280,height:900},colorScheme:'light'};
  await scenario(c,'sweet-linear-light',desktop,'?xRel=sweet',null,async p=>{
    await checkGeometry(p);
    assert.match(await p.locator('#relativeNote').innerText(),/frontier’s knee/);
    await p.locator('#zoneSeg [data-v="knee"]').click();
    const match=await p.evaluate(()=>{const t=window.__bundleC;return document.querySelector('#legend').textContent.includes(t.geom.X.ref.point.m.label);});
    assert.equal(match,true,'Sweet spot zone and relative reference use the same model');
    await snapshot(p,'sweet-linear-light');
  });
  await scenario(c,'sweet-log-dark',desktop,'?theme=dark&xRel=sweet&xScale=log',null,async p=>{
    await checkGeometry(p);
    await snapshot(p,'sweet-log-dark');
  });
  await scenario(c,'y-best-1100',{...desktop,viewport:{width:1100,height:800}},'?yRel=best',null,async p=>{
    await checkGeometry(p);
    assert.equal(await p.evaluate(()=>Math.max(...window.__bundleC.points.map(p=>p.yv))),1);
    await snapshot(p,'y-best-1100');
  });
  await scenario(c,'both-relative-mocha',desktop,'?theme=mocha&xRel=sweet&yRel=best&xScale=log',null,async p=>{
    await checkGeometry(p);await snapshot(p,'both-relative-mocha');
    const rowText=await p.locator('#rows').textContent(), planText=await p.locator('#planTable').textContent();
    await p.locator('#xRel').selectOption('off');await p.locator('#yRel').selectOption('off');
    assert.equal(await p.locator('#rows').textContent(),rowText,'Effort rows remain raw');
    assert.equal(await p.locator('#planTable').textContent(),planText,'Subscription calculations remain raw');
  });
  await scenario(c,'pinned-and-tooltip',desktop,'?xRel=pinned&yRel=pinned&pin=claude-opus-5-5:high',null,async p=>{
    await checkGeometry(p);await snapshot(p,'pinned');
    const hover=await p.evaluate(()=>{const t=window.__bundleC, q=t.points.find(q=>q.m.id===t.geom.X.ref.point.m.id),r=document.querySelector('#chart').getBoundingClientRect();return {x:r.left+q.px,y:r.top+q.py};});
    await p.mouse.move(hover.x,hover.y);
    await p.waitForFunction(()=>document.querySelector('#tooltip').style.display==='block');
    const text=await p.locator('#tooltip').innerText();
    assert.match(text,/X: 1× of pinned/);assert.match(text,/Y: 1× of pinned/);assert.match(text,/\$/);
    const chips=await p.locator('#hoverLayer text').allTextContents();assert.ok(chips.filter(t=>t==='1×').length>=2);
    await p.screenshot({path:path+'pinned-tooltip.png'});
  });
  await scenario(c,'median-and-best-cost',desktop,'?xRel=best&yRel=median',null,async p=>{
    await checkGeometry(p);
    const values=await p.evaluate(()=>{const t=window.__bundleC,sorted=t.points.map(p=>p.rawY).sort((a,b)=>a-b),n=sorted.length;return {best:t.geom.X.ref.value,min:Math.min(...t.points.map(p=>p.rawX)),median:t.geom.Y.ref.value,expected:n%2?sorted[(n-1)/2]:(sorted[n/2-1]+sorted[n/2])/2,table:document.querySelector('#dataTable').textContent};});
    assert.equal(values.best,values.min);assert.equal(values.median,values.expected);assert.match(values.table,/×/);
    assert.deepEqual(await p.evaluate(()=>[0.25,0.8,1,1.6,12,140].map(window.__bundleC.ratio)),['0.25×','0.8×','1×','1.6×','12×','140×']);
  });
  await scenario(c,'reload-and-saved-set',desktop,'',null,async p=>{
    await p.locator('#xRel').selectOption('median');await p.locator('#yRel').selectOption('best');
    await p.reload();await p.waitForFunction(()=>window.__bundleC?.geom);
    assert.equal(await p.locator('#xRel').inputValue(),'median');assert.equal(await p.locator('#yRel').inputValue(),'best');
    p.once('dialog',d=>d.accept('Bundle C round trip'));await p.locator('#setSave').click();
    await p.locator('#xRel').selectOption('off');await p.locator('#yRel').selectOption('off');
    await p.locator('#setSelect').selectOption('');await p.locator('#setSelect').selectOption('Bundle C round trip');
    assert.equal(await p.locator('#xRel').inputValue(),'median');assert.equal(await p.locator('#yRel').inputValue(),'best');
    await checkGeometry(p);
  });
  await scenario(c,'logit-fallback',desktop,'?y=gpqa&yScale=logit&yRel=best',null,async p=>{
    assert.equal(await p.locator('#yScale [data-v="logit"]').isDisabled(),true);
    assert.equal(await p.locator('#yScale [data-v="linear"]').getAttribute('aria-pressed'),'true');
    await p.locator('#yRel').selectOption('off');assert.equal(await p.locator('#yScale [data-v="logit"]').isDisabled(),false);
    await p.locator('#yScale [data-v="logit"]').click();await p.locator('#yRel').selectOption('median');
    assert.equal(await p.evaluate(()=>window.__bundleC.S.yScale),'linear');await checkGeometry(p);
  });
  await scenario(c,'diamond-full-frontier',desktop,'?theme=dark&xRel=sweet&yRel=best&fullFrontier=1',null,async p=>{
    const ref=await p.evaluate(()=>window.__bundleC.geom.X.ref.point.m.id);
    await p.locator('#shapeSeg [data-v="diamond"]').click();await checkGeometry(p);
    assert.ok(await p.evaluate(()=>window.__bundleC.ghosts.length>0),'Full frontier contains ghosts');
    await snapshot(p,'diamond-full-frontier');
    await p.locator('#fullFrontier').uncheck();assert.equal(await p.evaluate(()=>window.__bundleC.geom.X.ref.point.m.id),ref,'Ghosts never choose references');
    await p.locator('#paretoSeg [data-v="off"]').click();assert.equal(await p.evaluate(()=>window.__bundleC.geom.X.ref.point.m.id),ref,'Sweet spot works with Pareto display off');
  });
  await scenario(c,'reference-fallbacks',desktop,'?xRel=pinned',null,async p=>{
    assert.match(await p.locator('#relativeNote').innerText(),/Pin a dot on the chart/);assert.ok(!(await p.evaluate(()=>window.__bundleC.geom.X.ref)));
    await setSynthetic(p,[1,2],[10,20]);assert.match(await p.locator('#relativeNote').innerText(),/at least 3/);assert.ok(!(await p.evaluate(()=>window.__bundleC.geom.X.ref)));
    await setSynthetic(p,[0,1,2],[10,20,30],{xRel:'best'});assert.match(await p.locator('#relativeNote').innerText(),/reference is \$0/);
    await setSynthetic(p,[-1,1,2],[10,20,30],{xRel:'best'});assert.match(await p.locator('#relativeNote').innerText(),/positive value is needed/);
    await setSynthetic(p,[1,2,3],[10,20,30],{xRel:'pinned'});
    await p.evaluate(()=>{const t=window.__bundleC;t.S.pinned=new Set([t.points[0].m.id,t.points[1].m.id]);t.S.selected.delete(t.points[0].m.id);t.render();});
    assert.equal(await p.evaluate(()=>window.__bundleC.geom.X.ref.point.m.label),'Synthetic B','Use the first pin still drawn');
    await p.locator('#selNone').click();assert.match(await p.locator('#chart').textContent(),/Select models/);assert.equal(await p.locator('#dataTable tbody tr').count(),0);
  });
  await scenario(c,'known-knee-and-recompute',desktop,'',null,async p=>{
    await setSynthetic(p,[1,2,10],[1,8,10]);
    assert.equal(await p.evaluate(()=>window.__bundleC.geom.X.ref.point.m.label),'Synthetic B');
    await checkGeometry(p);
    await p.evaluate(()=>{const t=window.__bundleC;t.S.xRel='off';t.S.yRel='sweet';t.render();});
    assert.equal(await p.evaluate(()=>window.__bundleC.geom.Y.ref.point.m.label),'Synthetic B');
    await p.evaluate(()=>{const t=window.__bundleC;t.S.selected.delete(t.geom.Y.ref.point.m.id);t.render();});
    assert.match(await p.locator('#relativeNote').innerText(),/at least 3/);assert.ok(!(await p.evaluate(()=>window.__bundleC.geom.Y.ref)));
    await setSynthetic(p,[1,2,3,10],[1,8,9,10]);
    const before=await p.evaluate(()=>window.__bundleC.geom.X.ref.point.m.id);
    await p.evaluate(()=>{const t=window.__bundleC;t.S.selected.delete(t.geom.X.ref.point.m.id);t.render();});
    assert.notEqual(await p.evaluate(()=>window.__bundleC.geom.X.ref.point.m.id),before);
    await checkGeometry(p);
  });
  await scenario(c,'missing-reference-and-duplicate-axis',desktop,'',null,async p=>{
    await setSynthetic(p,[1,2,3],[10,20,30],{xRel:'pinned'});
    await p.evaluate(()=>{const t=window.__bundleC;const id=t.points[0].m.id;t.S.pinned=new Set([id]);t.points[0].m.costPerTask=null;t.render();});
    assert.match(await p.locator('#relativeNote').innerText(),/Pin a dot on the chart/);await checkGeometry(p);
    await p.evaluate(()=>{const t=window.__bundleC;t.S.y='costPerTask';t.S.yRel='median';t.S.xRel='best';t.render();});
    await checkGeometry(p);
    const dot=p.locator('#chart circle[data-fam][data-id]').first();await dot.scrollIntoViewIfNeeded();
    const box=await dot.boundingBox();await p.mouse.move(box.x+box.width/2,box.y+box.height/2);
    await p.waitForFunction(()=>document.querySelector('#tooltip').style.display==='block');
    assert.match(await p.locator('#tooltip').innerText(),/X: .* of best/);assert.match(await p.locator('#tooltip').innerText(),/Y: .* of median/);
  });
  for (const theme of ['light','dark']) await scenario(w,'iphone-'+theme,{...devices['iPhone 12 Pro'],colorScheme:'light'},'?theme='+theme+'&xRel=sweet&yRel=best',null,async p=>{
    await checkGeometry(p);
    assert.equal(await p.locator('#xRel').isVisible(),false);
    await p.locator('#toggleOpts').click();assert.equal(await p.locator('#xRel').isVisible(),true);
    await p.screenshot({path:path+'iphone-'+theme+'-options.png'});
    await p.locator('#xRel').selectOption('sweet');await p.locator('#toggleOpts').click();
    await p.locator('#chartCard').screenshot({path:path+'iphone-'+theme+'-chart.png',style:cardStyle});
    await p.locator('#openSheet').click();assert.equal(await p.locator('#sidebar').isVisible(),true);await p.locator('#closeSheet').click();
    await p.reload();await p.waitForFunction(()=>window.__bundleC?.geom);await checkGeometry(p);
    assert.equal(await p.locator('#xRel').inputValue(),'sweet');
  });
  await scenario(c,'breakpoint-controls',desktop,'?xRel=median&yRel=best',null,async p=>{
    await p.setViewportSize({width:390,height:844});await p.locator('#toggleOpts').click();
    assert.equal(await p.evaluate(()=>document.querySelector('#xRel').closest('.group').id),'relativeMobile');
    await p.setViewportSize({width:1100,height:800});
    await p.waitForFunction(()=>document.querySelector('#xRel').closest('.group').classList.contains('axis-group'));
    assert.equal(await p.evaluate(()=>document.querySelector('#xRel').closest('.group').classList.contains('axis-group')),true);
    await checkGeometry(p);
  });
  await scenario(c,'sqrt-and-relative-y-log',desktop,'?xRel=median&yRel=best&xScale=sqrt&yScale=log',null,async p=>{
    await checkGeometry(p);
    await p.locator('#guideSeg [data-v="all"]').click();
    assert.ok((await p.locator('#chart text').allTextContents()).filter(t=>t.endsWith('×')).length>5);
    await p.locator('#gridSeg [data-v="off"]').click();
    assert.equal(await p.locator('.reference-line').count(),2,'Reference lines survive grid off');
  });
  await round2(c,w,desktop);
  await c.close();await w.close();
  fs.writeFileSync(path + 'results.json',JSON.stringify({passed:results,errors},null,2));
  console.log(`${results.length} scenarios passed; ${errors.length} errors.`);
})().catch(e=>{console.error(e);process.exit(1);});
