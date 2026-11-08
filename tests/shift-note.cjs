const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
// A valid sparse-data board must not crash when fewer than two models cover today's list.
const fs = require('node:fs'), vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const take = (a,b) => html.slice(html.indexOf('  function '+a+'('), html.indexOf('  function '+b+'('));
const models = ['x','y'].map((s,i)=>({family:s,effort:'max',creatorSlug:s,creator:s,shortName:s,a:.8-i*.1}));
const prior = {scrapedAt:'2026-10-20',keys:['a'],raws:Object.fromEntries(models.map(m=>[m.creatorSlug,{family:m.family,effort:m.effort,raw:{a:m.a}}]))};
const sandbox = {ALL:models,COVER:.75,FILL:false,SHIFT_SEED:{},METRICS:{a:{label:'A'},b:{label:'B'}},shiftDetails:false,priorShift:()=>prior,keyed:n=>n.map(k=>[k,1]),keysFor:()=>[['a',1],['b',1]],norm:(_,v)=>v,fmtDay:s=>s,fmtScore:n=>n.toFixed(1),esc:String};
vm.createContext(sandbox); vm.runInContext(take('scoreRaw','readSnap')+take('shiftStory','weightRows'),sandbox);
assert.doesNotThrow(()=>vm.runInContext('shiftStory()',sandbox));
(async () => {
 const browser = await chromium.launch();
 try {
 const page = await browser.newPage();
 if (process.env.AIMF_DATA_FIXTURE) await page.route('**/data/models.js*', r => r.fulfill({path: process.env.AIMF_DATA_FIXTURE, contentType: 'application/javascript'}));
 await page.goto((process.env.FRONTIER_URL || 'http://127.0.0.1:8792/index.html') + '?noAutoUpdate');
 const note = page.locator('#shiftText');
 await note.waitFor({state:'visible'});
 for (const width of [1280,390,320,1280]) {
  await page.setViewportSize({width,height:1100}); await page.waitForTimeout(150);
  assert.match(await note.innerText(), /What changed since this page’s Oct 18 snapshot/);
  for (const text of ['Leads now','The move','Today’s list','AA’s index']) assert.ok((await note.innerText()).includes(text));
  const toggle = note.locator('[data-shift-details]');
  assert.equal(await toggle.innerText(),'The regrade and how the list changed');
  await toggle.click(); assert.equal(await toggle.getAttribute('aria-expanded'),'true');
  assert.match(await note.innerText(), /17 added, 1 left \(Terminal-Bench-Science\), so 7 became 23:/);
  // Inline-block separators stay with their item, so cannot end the previous line.
  // Any item on a new line must suppress its leading separator.
  assert.deepEqual(await note.locator('.shift-item.sep').evaluateAll(items => items.flatMap(it => {
    const prev = it.previousElementSibling, r = it.getClientRects()[0], rs = prev?.getClientRects();
    const newLine = rs?.length && r.top > rs[rs.length-1].top + 2;
    return newLine && getComputedStyle(it,'::before').content !== 'none' ? [it.textContent] : [];
  })), []);
  await toggle.click(); assert.equal(await toggle.getAttribute('aria-expanded'),'false');
 }
 console.log('PASS note C rows, arithmetic, expander and separator wrapping at 1280/390/320 and resize');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
