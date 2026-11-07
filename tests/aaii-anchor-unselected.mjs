// Grok review 7 Nov 2026: only High selected and XHigh still ticked: no hollow XHigh; the row joins High and says so.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
if (!process.env.AIMF_DATA_FIXTURE) { console.log('SKIP: needs AIMF_DATA_FIXTURE (a saved live payload with GPT-6.1 Terra)'); process.exit(0); }
const require = createRequire(pathToFileURL(process.cwd() + '/').href);
const { chromium } = require(process.env.PLAYWRIGHT_PATH);
const hook = `window.__aaii = {S,ALL,BY_ID,METRICS,render,applyBasis,EFFORTS,valFmt,openMenu,get anchors(){return lastAnchors},get points(){return lastPoints}};`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
await context.route('https://api.github.com/gists/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"files":{}}' }));
await context.route('**/index.html*', async (r) => {
  const response = await r.fetch();
  await r.fulfill({ response, body: (await response.text()).replace('  // ---------- boot ----------', hook + '\n  // ---------- boot ----------') });
});
if (process.env.AIMF_DATA_FIXTURE) await context.route('**/data/models.js*', (r) => r.fulfill({ path: process.env.AIMF_DATA_FIXTURE, contentType: 'application/javascript' }));
const page = await context.newPage();
await page.goto(process.env.FRONTIER_URL + '?noAutoUpdate');
await page.waitForFunction(() => window.__aaii?.BY_ID);
const out = await page.evaluate(() => {
  const { S, ALL, BY_ID, render, EFFORTS, valFmt, METRICS } = window.__aaii;
  const high = BY_ID.get('ea3e1f50-f62d-41d2-849a-9af0413e4d37');
  const xh = BY_ID.get('e8d443ba-8aca-4830-a186-ae869bb9c6fe');
  S.labels = 'ladder'; S.ladderAt = 'xhigh'; S.shape = 'standard';
  S.x = 'costPerTask'; S.y = 'intelligence'; S.xRel = 'off'; S.yRel = 'off'; S.basis = 'aa';
  S.selected = new Set([high.id]); S.efforts = new Set(EFFORTS);
  render();
  const tip = document.querySelector('#chartFoot').textContent.includes('effort filter hides');
  // hover the hollow dot
  const p = window.__aaii.anchors[0];
  const svg = document.querySelector('#chart');
  const r = svg.getBoundingClientRect();
  if (p) svg.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', clientX: r.left + p.px, clientY: r.top + p.py, bubbles: true }));
  return {
    high: { id: high.id, effort: high.effort, label: high.label, y: valFmt(METRICS.intelligence, high.intelligence) },
    xh: { id: xh.id, effort: xh.effort, label: xh.label, y: valFmt(METRICS.intelligence, xh.intelligence) },
    effortsHasXHigh: S.efforts.has('xhigh'),
    row: document.querySelector('.ladder-btn')?.dataset.value,
    anchor: document.querySelector('.ladder-btn')?.dataset.anchor,
    hollowCount: document.querySelectorAll('.ladder-anchor').length,
    tip: document.querySelector('#tooltip')?.innerText?.slice(0, 240),
    foot: /hollow dot/.test(document.querySelector('#chartFoot').textContent),
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
if (!/^(high|H) /.test(out.row || '') || !out.row.endsWith(out.high.y) || out.hollowCount !== 0 || /effort filter hides/.test(out.tip || '')) {
  console.error(`FAIL: only High is selected and XHigh is still ticked, so the ladder should join High (${out.high.y}), not draw a hollow XHigh (${out.row}). Tooltip: ${out.tip?.split('\n')[1]}`);
  process.exitCode = 1;
}
