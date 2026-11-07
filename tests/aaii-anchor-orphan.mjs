// Grok review 7 Nov 2026: a hollow XHigh whose reasoning line shows no dot (only the non-reasoning dot) still gets its own ladder row.
// Re-check: selected XHigh hidden by the filter, only the non-reasoning dot shown.
// The hollow XHigh must still anchor its own ladder row (spec C3c). The NR row stays N.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
if (!process.env.AIMF_DATA_FIXTURE) { console.log('SKIP: needs AIMF_DATA_FIXTURE (a saved live payload with GPT-6.1 Terra)'); process.exit(0); }
const require = createRequire(pathToFileURL(process.cwd() + '/').href);
const { chromium } = require(process.env.PLAYWRIGHT_PATH);
const origin = process.env.FRONTIER_URL;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const hook = `window.__aaii = {S,ALL,BY_ID,render,EFFORTS,superseded,get points(){return lastPoints},get anchors(){return lastAnchors}};`;
await context.route('https://api.github.com/gists/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"files":{}}' }));
await context.route('**/index.html*', async (r) => {
  const response = await r.fetch();
  const body = (await response.text()).replace('  // ---------- boot ----------', hook + '\n  // ---------- boot ----------');
  await r.fulfill({ response, body });
});
await context.route('**/data/models.js*', (r) => r.fulfill({ path: process.env.AIMF_DATA_FIXTURE, contentType: 'application/javascript' }));
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(origin + '?noAutoUpdate');
await page.waitForFunction(() => window.__aaii?.S && document.querySelector('#chart'));
await page.waitForTimeout(300);
const out = await page.evaluate(() => {
  const { S, ALL, BY_ID, render, EFFORTS, superseded } = window.__aaii;
  const terra = ALL.filter((m) => m.family === 'gpt-6-1-terra' && !m.deprecated && !superseded(m));
  const xh = terra.find((m) => m.effort === 'xhigh');
  const nr = terra.find((m) => m.effort === 'non-reasoning');
  S.labels = 'ladder'; S.ladderAt = 'xhigh'; S.shape = 'standard';
  S.x = 'costPerTask'; S.y = 'intelligence'; S.xRel = 'off'; S.yRel = 'off'; S.basis = 'aa';
  S.selected = new Set([xh.id, nr.id]);
  S.efforts = new Set(EFFORTS); S.efforts.delete('xhigh');
  render();
  const rows = [...document.querySelectorAll('.ladder-btn')].map((el) => ({
    anchor: el.dataset.anchor, value: el.dataset.value, title: el.querySelector('title')?.textContent || '',
  }));
  const hollow = window.__aaii.anchors.map((p) => p.m.id);
  return { xh: xh.id, nr: nr.id, hollow, rows, points: window.__aaii.points.map((p) => p.m.effort) };
});
await browser.close();
const xhRow = out.rows.find((r) => r.anchor === out.xh);
const nrRow = out.rows.find((r) => r.anchor === out.nr);
console.log(JSON.stringify({ pageErrors: errors, out, xhRow: xhRow || null, nrRow: nrRow || null }, null, 2));
if (!out.hollow.includes(out.xh) || !xhRow || !nrRow || !String(nrRow.value).includes('31') || xhRow.value !== '45') {
  console.error('FAIL: hidden selected XHigh must anchor its own row (45) while the non-reasoning row stays N 31. rows=' + JSON.stringify(out.rows));
  process.exit(1);
}
console.log('PASS');
