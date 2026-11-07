// Grok review 7 Nov 2026: with XHigh unticked, a non-reasoning line must not join its reasoning line's hollow XHigh dot.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
if (!process.env.AIMF_DATA_FIXTURE) { console.log('SKIP: needs AIMF_DATA_FIXTURE (a saved live payload with GPT-6.1 Terra)'); process.exit(0); }
const require = createRequire(pathToFileURL(process.cwd() + '/').href);
const { chromium } = require(process.env.PLAYWRIGHT_PATH);
const origin = process.env.FRONTIER_URL;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const hook = `window.__aaii = {S,ALL,METRICS,DATA,BY_ID,applyBasis,render,snapshot,applySet,openMenu,closeMenu,valFmt,EFFORTS,superseded,pickerLists,get points(){return lastPoints},get anchors(){return lastAnchors}};`;
await context.route('https://api.github.com/gists/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"files":{}}' }));
await context.route('**/index.html*', async (r) => {
  const response = await r.fetch();
  const body = (await response.text()).replace('  // ---------- boot ----------', hook + '\n  // ---------- boot ----------');
  await r.fulfill({ response, body });
});
if (process.env.AIMF_DATA_FIXTURE) {
  await context.route('**/data/models.js*', (r) => r.fulfill({ path: process.env.AIMF_DATA_FIXTURE, contentType: 'application/javascript' }));
}
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(origin + '?noAutoUpdate');
await page.waitForFunction(() => window.__aaii?.S && document.querySelector('#chart'));
await page.waitForTimeout(400);

const report = await page.evaluate(() => {
  const { S, ALL, METRICS, DATA, BY_ID, applyBasis, render, snapshot, applySet, openMenu, closeMenu, valFmt, EFFORTS, superseded } = window.__aaii;
  const lastAnchors = () => window.__aaii.anchors;
  const lastPoints = () => window.__aaii.points;
  const out = { errors: [] };
  const fams = {};
  for (const m of ALL) {
    if (m.deprecated || superseded(m)) continue;
    const f = fams[m.family] ||= { name: m.familyName, efforts: {} };
    if (m.myIndex != null && m.costPerTask != null && !f.efforts[m.effort]) f.efforts[m.effort] = m.id;
  }
  const both = Object.entries(fams).filter(([, f]) => f.efforts['non-reasoning'] && f.efforts.xhigh).slice(0, 3);
  out.sample = both.map(([fam, f]) => ({ fam, name: f.name, nr: f.efforts['non-reasoning'], xh: f.efforts.xhigh }));

  function setup(ids, hideXHigh) {
    S.labels = 'ladder';
    S.ladderAt = 'xhigh';
    S.shape = 'standard';
    S.x = 'costPerTask';
    S.y = 'intelligence';
    S.xRel = 'off';
    S.yRel = 'off';
    S.basis = 'aa';
    S.selected = new Set(ids);
    S.efforts = new Set(EFFORTS);
    if (hideXHigh) S.efforts.delete('xhigh');
    applyBasis();
    render();
  }
  function rows() {
    return [...document.querySelectorAll('.ladder-btn')].map((el) => ({
      fam: el.dataset.fam,
      anchor: el.dataset.anchor,
      value: el.dataset.value,
      title: el.querySelector('title')?.textContent || '',
      y1: el.previousElementSibling?.getAttribute('y1'),
      x1: el.previousElementSibling?.getAttribute('x1'),
    }));
  }
  if (!both.length) { out.noSample = true; return out; }
  const ids = both.flatMap(([, f]) => Object.values(f.efforts));
  setup(ids, false);
  const shown = rows();
  const nrShown = shown.filter((r) => both.some(([, f]) => f.efforts['non-reasoning'] === r.anchor));
  out.whenXHighShown = { nrRows: nrShown, all: shown.map((r) => ({ fam: r.fam, anchor: r.anchor, value: r.value })) };

  setup(ids, true);
  const hidden = rows();
  const anchors = lastAnchors().map((p) => ({ id: p.m.id, fam: p.m.family, effort: p.m.effort, yv: p.yv, py: p.py }));
  out.whenXHighHidden = {
    anchors,
    rows: hidden.map((r) => {
      const m = BY_ID.get(r.anchor);
      const nrId = both.find(([fam]) => fam === r.fam)?.[1].efforts['non-reasoning'];
      const nr = BY_ID.get(nrId);
      return {
        fam: r.fam, anchor: r.anchor, anchorEffort: m?.effort, value: r.value, title: r.title,
        nrId, nrY: nr ? valFmt(METRICS.intelligence, nr.intelligence) : null,
        joinedNr: r.anchor === nrId,
      };
    }),
  };

  // Relative mode: ladder text vs an independent format of the plotted Y.
  setup(ids, false);
  S.yRel = 'best';
  render();
  const rel = [...document.querySelectorAll('.ladder-btn')].map((el) => {
    const p = lastPoints().concat(lastAnchors()).find((q) => q.m.id === el.dataset.anchor);
    const independent = p ? (p.yv >= 10 ? String(Math.round(p.yv)) : p.yv.toFixed(2)) + '×' : null;
    return { value: el.dataset.value, plotted: independent, raw: p ? METRICS.intelligence.fmt(p.m.intelligence) : null, match: el.dataset.value.endsWith(independent) };
  });
  out.relative = rel.slice(0, 6);

  // Unselected XHigh, filter still includes it.
  const one = both[0][1];
  S.yRel = 'off';
  S.selected = new Set([one.efforts.high || one.efforts.medium || one.efforts.low]);
  S.efforts = new Set(EFFORTS);
  S.ladderAt = 'xhigh';
  render();
  out.unselected = {
    family: both[0][0],
    selected: [...S.selected],
    hollow: lastAnchors().map((p) => p.m.id),
    xh: one.efforts.xhigh,
    rows: rows(),
  };

  // Crashes
  const crashes = [];
  function tryRender(name, fn) {
    try { fn(); render(); } catch (e) { crashes.push(name + ': ' + e.message); }
  }
  const saved = snapshot();
  tryRender('empty', () => { S.selected = new Set(); S.ladderAt = 'xhigh'; S.labels = 'ladder'; });
  tryRender('diamond', () => { applySet(saved); S.shape = 'diamond'; S.labels = 'ladder'; S.ladderAt = 'max'; });
  tryRender('auto labels', () => { S.shape = 'standard'; S.labels = 'auto'; });
  tryRender('no index fields', () => {
    const i = DATA.index, w = DATA.indexWeights;
    DATA.index = undefined; DATA.indexWeights = undefined;
    render();
    DATA.index = i; DATA.indexWeights = w;
  });
  tryRender('missing xy', () => {
    S.labels = 'ladder'; S.ladderAt = 'high'; S.shape = 'standard';
    const m = ALL.find((m) => m.effort === 'high' && m.intelligence != null);
    const prev = m.intelligence; m.intelligence = null;
    S.selected = new Set([m.id]); S.efforts = new Set(EFFORTS); S.y = 'intelligence'; S.x = 'costPerTask';
    render();
    m.intelligence = prev;
  });
  out.crashes = crashes;
  out.diamondHidden = document.querySelector('#ladderAtWrap').hidden;
  applySet(saved);

  // Choose-mode composite
  S.basis = 'listed';
  applyBasis();
  openMenu('y', document.querySelector('#ySel'));
  document.querySelector('#benchEdit').click();
  const before = S.benchPick.on.includes('intelligence');
  const row = document.querySelector('#menuList .mi.composite');
  row?.click();
  out.composite = {
    hadCheckbox: !!document.querySelector('#menuList .mi.composite .mi-box'),
    before, after: S.benchPick.on.includes('intelligence') || S.benchPick.off.includes('intelligence'),
    on: S.benchPick.on.includes('intelligence'),
    off: S.benchPick.off.includes('intelligence'),
  };
  closeMenu();
  return out;
});

console.log(JSON.stringify({ pageErrors: errors, report }, null, 2));
await browser.close();
const terra = report.whenXHighHidden.rows.filter((r) => r.fam === 'gpt-6-1-terra');
const nrOk = terra.some((r) => r.joinedNr && r.value.includes(r.nrY));
if (!nrOk) {
  console.error('FAIL: with XHigh filtered out, the non-reasoning ladder row must keep its own Y (N 31), not the hollow XHigh Y (45). Both Terra rows joined ' + terra.map((r) => r.anchor).join(', '));
  process.exitCode = 1;
}
