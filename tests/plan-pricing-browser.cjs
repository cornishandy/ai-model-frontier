#!/usr/bin/env node
// Comprehensive Chromium + WebKit browser acceptance suite for Approach B subscription pricing.
// Supports --at01, --at03, --at04, or default full run (all three).
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PM = require(path.join(ROOT, 'plan-math.js'));
const CLOCK = '2026-11-23T05:00:00Z';

const TEST_HOOK = `
  subClockOverride = ${JSON.stringify(CLOCK)};
  window.__AIMF_TEST = {
    getState: () => ({ x: S.x, y: S.y, price: S.price, basis: BASIS, activeSet: S.activeSet, selected: [...S.selected] }),
    getProfile: () => JSON.parse(JSON.stringify(subProfile)),
    setProfile: (next) => { subProfile = PM.sanitizeProfile(next, PLAN_CAT, PM.PUBLIC_DEFAULT_ESTIMATES); saveSubProfile(); render(); },
    setSelection: (ids) => { S.selected = new Set(ids.filter((id) => BY_ID.has(id))); save(); renderList(); render(); },
    setStatePatch: (patch) => { Object.assign(S, patch); fixAxes(); fixMarks(); syncControls(); save(); renderList(); render(); },
    setPrice: (mode) => { const sw = PM.switchFromLegacyAxes({ x: S.x, y: S.y, targetPrice: mode }); S.x = sw.x; S.y = sw.y; S.price = sw.price; subLegacyNotice = sw.switched ? sw.notice : null; syncControls(); save(); render(); },
    setPublicDefaultEst: (v) => { subPubDefaultEstOverride = v === null ? null : !!v; },
    getLastRender: () => lastSubRender,
    getLastLabelAudit: () => lastLabelAudit,
    getPoints: () => lastPoints.map(p => ({ id: p.m.id, family: p.m.family, effort: p.m.effort, px: p.px, py: p.py, rawX: p.rawX, rawY: p.rawY, isEnd: !!p.isEnd, isLane2: !!p.isLane2, pinned: S.pinned.has(p.m.id) })),
    getFrontIds: () => {
      const f = lastSubRender?.evalRes?.frontierSteps || [];
      return f.map(s => s.id);
    },
    getSetsRaw: () => ({ local: JSON.parse(JSON.stringify(sets)), wire: publicSets(sets), unsynced: unsynced() }),
    mergeTest: (remote) => merge(remote),
    svgString: (opts) => svgString(opts),
    applySet: (snap, isBuiltin = false) => applySet(snap, isBuiltin),
    getLegacyDerived: () => ALL.filter(m => m.planCost != null || m.planTasks != null).map(m => [m.id, m.planCost, m.planTasks]),
  };
`;

// Canonical 15-row current-frontier replay models (matches tests/plan-pricing.mjs; 100% self-contained)
const CANONICAL_15 = [
  { id: 'c15-fable-max',    slug: 'claude-fable-5-2',        name: 'Claude Fable 5.2 (Max)',   family: 'claude-fable-5-2',  familyName: 'Claude Fable 5.2',  creator: 'Anthropic', creatorSlug: 'anthropic', effort: 'max',   effortLevel: 60, intelligence: 64.563595756626,  costPerTask: 26.53855780398091 },
  { id: 'c15-fable-high',   slug: 'claude-fable-5-2-high',   name: 'Claude Fable 5.2 (High)',  family: 'claude-fable-5-2',  familyName: 'Claude Fable 5.2',  creator: 'Anthropic', creatorSlug: 'anthropic', effort: 'high',  effortLevel: 40, intelligence: 61.8218785440284, costPerTask: 9.078414777860381 },
  { id: 'c15-astra-max',    slug: 'gpt-6-2-astra',           name: 'GPT-6.2 Astra (Max)',      family: 'gpt-6-2-astra',     familyName: 'GPT-6.2 Astra',     creator: 'OpenAI',    creatorSlug: 'openai',    effort: 'max',   effortLevel: 60, intelligence: 62.1387990593969, costPerTask: 3.9979061566801852 },
  { id: 'c15-astra-xhigh',  slug: 'gpt-6-2-astra-xhigh',     name: 'GPT-6.2 Astra (XHigh)',    family: 'gpt-6-2-astra',     familyName: 'GPT-6.2 Astra',     creator: 'OpenAI',    creatorSlug: 'openai',    effort: 'xhigh', effortLevel: 50, intelligence: 61.5602325371388, costPerTask: 2.5211433764120375 },
  { id: 'c15-neon-xhigh',   slug: 'gemini-4-neon',           name: 'Gemini 4 Neon (XHigh)',    family: 'gemini-4-neon',     familyName: 'Gemini 4 Neon',     creator: 'Google',    creatorSlug: 'google',    effort: 'xhigh', effortLevel: 50, intelligence: 61.3982491392674, costPerTask: 6.444838101104699 },
  { id: 'c15-carbon-high',  slug: 'gemini-4-carbon',         name: 'Gemini 4 Carbon (High)',   family: 'gemini-4-carbon',   familyName: 'Gemini 4 Carbon',   creator: 'Google',    creatorSlug: 'google',    effort: 'high',  effortLevel: 40, intelligence: 60.025738829526,  costPerTask: 7.755545745286556 },
  { id: 'c15-neon-high',    slug: 'gemini-4-neon-high',      name: 'Gemini 4 Neon (High)',     family: 'gemini-4-neon',     familyName: 'Gemini 4 Neon',     creator: 'Google',    creatorSlug: 'google',    effort: 'high',  effortLevel: 40, intelligence: 59.6189441875232, costPerTask: 3.7427499092845027 },
  { id: 'c15-opus-max',     slug: 'claude-opus-5-5',         name: 'Claude Opus 5.5 (Max)',    family: 'claude-opus-5-5',   familyName: 'Claude Opus 5.5',   creator: 'Anthropic', creatorSlug: 'anthropic', effort: 'max',   effortLevel: 60, intelligence: 59.1060336078904, costPerTask: 10.036409719512749 },
  { id: 'c15-opus-xhigh',   slug: 'claude-opus-5-5-xhigh',   name: 'Claude Opus 5.5 (XHigh)',  family: 'claude-opus-5-5',   familyName: 'Claude Opus 5.5',   creator: 'Anthropic', creatorSlug: 'anthropic', effort: 'xhigh', effortLevel: 50, intelligence: 57.4447060170507, costPerTask: 6.047194490848774 },
  { id: 'c15-sol-max',      slug: 'gpt-6-2-sol',             name: 'GPT-6.2 Sol (Max)',        family: 'gpt-6-2-sol',       familyName: 'GPT-6.2 Sol',       creator: 'OpenAI',    creatorSlug: 'openai',    effort: 'max',   effortLevel: 60, intelligence: 57.2576209885477, costPerTask: 1.014379970300768 },
  { id: 'c15-sol-xhigh',    slug: 'gpt-6-2-sol-xhigh',       name: 'GPT-6.2 Sol (XHigh)',      family: 'gpt-6-2-sol',       familyName: 'GPT-6.2 Sol',       creator: 'OpenAI',    creatorSlug: 'openai',    effort: 'xhigh', effortLevel: 50, intelligence: 55.7351067246438, costPerTask: 0.6479676730055945 },
  { id: 'c15-hydro-xhigh',  slug: 'gemini-4-hydrogen',       name: 'Gemini 4 Hydrogen (XHigh)',family: 'gemini-4-hydrogen', familyName: 'Gemini 4 Hydrogen', creator: 'Google',    creatorSlug: 'google',    effort: 'xhigh', effortLevel: 50, intelligence: 53.9192287317542, costPerTask: 3.1601590757006157 },
  { id: 'c15-sonnet-xhigh', slug: 'claude-sonnet-5-5-xhigh', name: 'Claude Sonnet 5.5 (XHigh)',family: 'claude-sonnet-5-5', familyName: 'Claude Sonnet 5.5', creator: 'Anthropic', creatorSlug: 'anthropic', effort: 'xhigh', effortLevel: 50, intelligence: 49.9240327787242, costPerTask: 4.091984916321919 },
  { id: 'c15-grok-xhigh',   slug: 'grok-4-7',                name: 'Grok 4.7 (XHigh)',         family: 'grok-4-7',          familyName: 'Grok 4.7',          creator: 'xAI',       creatorSlug: 'xai',       effort: 'xhigh', effortLevel: 50, intelligence: 35.4850117067196, costPerTask: 7.771539401587139 },
  { id: 'c15-grok-high',    slug: 'grok-4-7-high',           name: 'Grok 4.7 (High)',          family: 'grok-4-7',          familyName: 'Grok 4.7',          creator: 'xAI',       creatorSlug: 'xai',       effort: 'high',  effortLevel: 40, intelligence: 35.2122962959703, costPerTask: 6.18359556537658 },
];

function resolvePlaywright() {
  const candidates = [];
  if (process.env.PLAYWRIGHT_PATH) candidates.push(process.env.PLAYWRIGHT_PATH);
  candidates.push('playwright');
  const home = os.homedir();
  candidates.push(path.join(home, 'Library/Caches/aaii-ladder/pw/node_modules/playwright'));
  const npxRoot = path.join(home, '.npm/_npx');
  if (fs.existsSync(npxRoot)) {
    for (const dir of fs.readdirSync(npxRoot)) {
      candidates.push(path.join(npxRoot, dir, 'node_modules/playwright'));
    }
  }
  for (const cand of candidates) {
    try { return require(cand); } catch {}
  }
  throw new Error('Playwright not found; set PLAYWRIGHT_PATH or install playwright.');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};
function startServer(rootDir) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
      const full = path.resolve(rootDir, rel);
      if (!full.startsWith(rootDir) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
        res.writeHead(404); res.end('Not found'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
      fs.createReadStream(full).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, url: `http://127.0.0.1:${srv.address().port}` }));
  });
}

async function attachTestRoutes(target, { blockGists = true, injectCanonical15 = false } = {}) {
  if (blockGists) await target.route('https://api.github.com/gists/**', (r) => r.abort());
  await target.route('**/index.html*', async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace('  // ---------- boot ----------', TEST_HOOK + '\n  // ---------- boot ----------');
    await route.fulfill({ response, body });
  });
  if (injectCanonical15) {
    await target.route('**/data/models.js*', async (route) => {
      const response = await route.fetch();
      const raw = await response.text();
      const data = JSON.parse(raw.replace(/^\s*window\.AA_DATA\s*=\s*/, '').replace(/;\s*$/, ''));
      const existing = new Set(data.models.map((m) => `${m.family}::${m.effort}`));
      for (const cm of CANONICAL_15) {
        if (!existing.has(`${cm.family}::${cm.effort}`)) {
          data.models.push({
            ...cm, shortName: cm.name.toLowerCase(), isReasoning: true, openWeights: false, deprecated: false,
            estimated: false, defaultSelected: false, releaseDate: '2026-11-20',
          });
        }
      }
      await route.fulfill({ response, body: `window.AA_DATA = ${JSON.stringify(data)};\n` });
    });
  }
}

const REPLAY_SPECS = [
  [['claude-fable-5-2'], 'max'], [['claude-fable-5-2'], 'high'],
  [['gpt-6-2-astra', 'gpt-6-astra'], 'max'], [['gpt-6-2-astra', 'gpt-6-astra'], 'xhigh'],
  [['gemini-4-neon', 'gemini-3-8-flash'], 'xhigh'], [['gemini-4-neon', 'gemini-3-8-flash'], 'high'],
  [['gemini-4-carbon'], 'high'],
  [['claude-opus-5-5'], 'max'], [['claude-opus-5-5'], 'xhigh'],
  [['gpt-6-2-sol', 'gpt-6-1-sol'], 'max'], [['gpt-6-2-sol', 'gpt-6-1-sol'], 'xhigh'],
  [['gemini-4-hydrogen'], 'xhigh'],
  [['claude-sonnet-5-5'], 'xhigh'],
  [['grok-4-7'], 'xhigh'], [['grok-4-7'], 'high'],
];

async function selectReplay15(page, strictCanonical = false) {
  return page.evaluate(({ specs, strictCanonical }) => {
    const all = window.AA_DATA?.models || [];
    const ids = [];
    for (const [fams, eff] of specs) {
      let picked = null;
      const list = strictCanonical ? [fams[0]] : fams;
      for (const fam of list) {
        picked = all.find((x) => x.family === fam && x.effort === eff && !x.deprecated && x.intelligence != null && x.costPerTask > 0)
          || all.find((x) => x.family === fam && x.effort === eff && x.intelligence != null && x.costPerTask > 0);
        if (picked) break;
      }
      if (picked && !ids.includes(picked.id)) ids.push(picked.id);
    }
    window.__AIMF_TEST.setSelection(ids);
    return ids.length;
  }, { specs: REPLAY_SPECS, strictCanonical });
}

// Independent DOM-derived geometry verifier (verifies actual rendered SVG boxes, marks, quadrant hint, and leaders)
async function independentDomAudit(page, selector = '#chart') {
  return page.evaluate((sel) => {
    const svg = document.querySelector(sel);
    if (!svg) return { ok: false, reason: 'missing svg' };
    const sr = svg.getBoundingClientRect();
    const w = sr.width, h = sr.height;
    const clipped = [];
    for (const t of svg.querySelectorAll('text')) {
      const tr = t.getBoundingClientRect();
      if (tr.width > 0 && tr.height > 0 && (tr.left < sr.left - 0.8 || tr.right > sr.right + 0.8 || tr.top < sr.top - 0.8 || tr.bottom > sr.bottom + 0.8)) {
        clipped.push({ text: t.textContent, left: +(tr.left - sr.left).toFixed(1), right: +(tr.right - sr.left).toFixed(1), top: +(tr.top - sr.top).toFixed(1), bottom: +(tr.bottom - sr.top).toFixed(1), w: +w.toFixed(1), h: +h.toFixed(1) });
      }
    }
    const pts = window.__AIMF_TEST ? window.__AIMF_TEST.getPoints() : [];
    const ptById = new Map(pts.map((p) => [p.id, p]));
    const lbls = [...svg.querySelectorAll('text.lbl-lane1, text.lbl-lane2')].map((el) => {
      const bb = el.getBBox();
      const id = el.getAttribute('data-id');
      return { id, text: el.textContent, isLane2: el.classList.contains('lbl-lane2'), box: { x1: bb.x, y1: bb.y, x2: bb.x + bb.width, y2: bb.y + bb.height } };
    });
    const leaders = [...svg.querySelectorAll('line.sub-leader')].map((el) => ({
      id: el.getAttribute('data-id'),
      x1: +el.getAttribute('x1'), y1: +el.getAttribute('y1'), x2: +el.getAttribute('x2'), y2: +el.getAttribute('y2'),
    }));
    const leaderById = new Map(leaders.map((l) => [l.id, l]));
    const qhEl = svg.querySelector('text.quad-hint');
    const qhBox = qhEl ? (() => { const b = qhEl.getBBox(); return { x1: b.x, y1: b.y, x2: b.x + b.width, y2: b.y + b.height }; })() : null;
    const hit = (a, b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
    const distPtBox = (px, py, b) => Math.hypot(px < b.x1 ? b.x1 - px : px > b.x2 ? px - b.x2 : 0, py < b.y1 ? b.y1 - py : py > b.y2 ? py - b.y2 : 0);

    let overlaps = 0, quadHintOverlaps = 0, misattached = 0, maxLeader = 0;
    for (let i = 0; i < lbls.length; i++) {
      const a = lbls[i], pa = ptById.get(a.id);
      if (qhBox && hit(a.box, qhBox)) quadHintOverlaps++;
      for (let j = i + 1; j < lbls.length; j++) if (hit(a.box, lbls[j].box)) overlaps++;
      const l = leaderById.get(a.id);
      if (l) {
        maxLeader = Math.max(maxLeader, Math.hypot(l.x2 - l.x1, l.y2 - l.y1));
      } else if (pa) {
        const ownD = distPtBox(pa.px, pa.py, a.box);
        if (pts.some((o) => o.id !== a.id && distPtBox(o.px, o.py, a.box) < ownD + 4)) misattached++;
      }
    }
    return { clipped, overlaps, quadHintOverlaps, misattached, maxLeader: +maxLeader.toFixed(1), labelCount: lbls.length };
  }, selector);
}

// =========================================================================
// AT-01: Public outputs parity, live-settings export fidelity, contrast,
//        zero-clip, modal focus trap, canonical 15-model label matrix
//        (Chromium + WebKit), phone editor, & Tasks / week compact table
// =========================================================================
async function runAt01(chromium, webkit, baseUrl) {
  const bChrom = await chromium.launch({ headless: true });
  const bWeb = await webkit.launch({ headless: true });
  try {
    // 1. Two deliberately different local profiles -> byte-identical public SVG exports + non-coordinate fee sentinel (4321.77)!
    const ctx1 = await bChrom.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2, acceptDownloads: true });
    const ctx2 = await bChrom.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2, acceptDownloads: true });
    await attachTestRoutes(ctx1, { injectCanonical15: true });
    await attachTestRoutes(ctx2, { injectCanonical15: true });
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();
    const errors = [];
    p1.on('pageerror', e => errors.push(`p1:${e.message}`));
    p2.on('pageerror', e => errors.push(`p2:${e.message}`));

    await p1.addInitScript(() => {
      localStorage.setItem('aa-charts:plans-v1', JSON.stringify({
        plans: {
          anthropic: { id: 'claude_max_20x', fee: 4321.77 },
          openai: { id: 'chatgpt_pro_20x', fee: 199 },
          google: { id: 'google_ai_ultra_20x_us', fee: 0 },
          xai: { id: 'none', fee: null },
        },
        use: 0.25, fableCap: 'own', estimate: false,
      }));
    });
    await p2.addInitScript(() => {
      localStorage.setItem('aa-charts:plans-v1', JSON.stringify({
        plans: {
          anthropic: { id: 'claude_pro', fee: 18 },
          openai: { id: 'chatgpt_plus', fee: 22.25 },
          google: { id: 'google_ai_pro_us', fee: 19.99 },
          xai: { id: 'supergrok', fee: 30 },
        },
        use: 1, fableCap: 'shared', estimate: true,
      }));
    });
    const url = `${baseUrl}/index.html?noAutoUpdate=1`;
    await Promise.all([p1.goto(url, { waitUntil: 'networkidle' }), p2.goto(url, { waitUntil: 'networkidle' })]);
    assert.equal(await selectReplay15(p1, true), 15);
    assert.equal(await selectReplay15(p2, true), 15);

    // Real #downloadSvg click on both profiles -> byte-identical files, zero fee sentinel in <text> nodes!
    const [dl1, dl2] = await Promise.all([
      Promise.all([p1.waitForEvent('download'), p1.click('#downloadSvg')]).then(([d]) => d),
      Promise.all([p2.waitForEvent('download'), p2.click('#downloadSvg')]).then(([d]) => d),
    ]);
    const svgFile1 = fs.readFileSync(await dl1.path(), 'utf8');
    const svgFile2 = fs.readFileSync(await dl2.path(), 'utf8');
    assert.equal(svgFile1, svgFile2, 'Real #downloadSvg click across distinct local profiles must be byte-identical');
    const textContents1 = [...svgFile1.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map(m => m[1]).join(' ');
    assert.equal(textContents1.includes('4321.77'), false, 'Personal fee sentinel leaked into downloaded SVG <text>');
    assert.ok(svgFile1.includes('effort-hash'), 'Downloaded SVG must preserve live effort-hash marks');
    assert.ok(svgFile1.includes('Intelligence Index'), 'Downloaded SVG must include Y-axis title');

    // Real #downloadPng click produces valid PNG header
    const [pngDl] = await Promise.all([p1.waitForEvent('download'), p1.click('#downloadPng')]);
    const pngBuf = fs.readFileSync(await pngDl.path());
    assert.equal(pngBuf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Real #downloadPng must produce valid PNG');

    // Live public settings fidelity in public SVG exports (grid=off, xRel=best, labels=none, pareto=off, zone=knee, live width)
    await p1.evaluate(() => window.__AIMF_TEST.setStatePatch({ grid: 'off', xRel: 'best', labels: 'none', pareto: 'off', zone: 'knee' }));
    const customExp = await p1.evaluate(() => window.__AIMF_TEST.svgString());
    assert.equal(customExp.text.includes('class="lbl-lane1"'), false, 'Export must obey labels=none');
    assert.equal(customExp.text.includes('class="lbl-lane2"'), false, 'Export must obey labels=none');
    assert.ok(customExp.text.includes('reference-line'), 'Export must obey xRel=best reference line');
    assert.ok(customExp.text.includes('(× best)') && /\b1(\.0)?×/.test(customExp.text), 'Export must obey xRel=best title and ticks');
    assert.equal(customExp.text.includes('Pareto frontier'), false, 'Export must obey pareto=off');
    assert.ok(customExp.text.includes('class="zone-layer"'), 'Export must preserve zone layer');
    assert.equal(customExp.text.includes('stroke="#e5e7eb"') || customExp.text.includes('stroke-opacity="0.4"'), false, 'Export must obey grid=off');
    assert.equal(customExp.labelAudit.clippedTexts.length, 0, `Custom settings export clipped text: ${JSON.stringify(customExp.labelAudit.clippedTexts)}`);

    // Restore default settings & check live phone width preservation (282px on 320px viewport, not inflated to 320!)
    await p1.evaluate(() => window.__AIMF_TEST.setStatePatch({ grid: 'normal', xRel: 'off', labels: 'auto', pareto: 'step', zone: 'off' }));
    await p1.setViewportSize({ width: 320, height: 640 });
    await p1.waitForTimeout(80);
    const phoneLiveW = await p1.evaluate(() => ({ liveW: +document.getElementById('chart').getAttribute('width'), exp: window.__AIMF_TEST.svgString() }));
    assert.equal(phoneLiveW.exp.width, phoneLiveW.liveW, `Export width (${phoneLiveW.exp.width}) must match live phone SVG width (${phoneLiveW.liveW})`);
    assert.equal(phoneLiveW.exp.labelAudit.clippedTexts.length, 0, 'Live-width phone export clipped text');

    // 2. Untouched first-visit defaults, #chartDesc honesty, ?price=pct sweet spot, ?price=pct&fullFrontier=1 suppression,
    //    dual-cost-axis tooltip (x=costPerTask&y=myCost), $0 log note, pre-feature saved set, & modal focus trap!
    const pFirst = await bChrom.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
    await attachTestRoutes(pFirst);
    await pFirst.goto(url, { waitUntil: 'networkidle' });
    const firstInfo = await pFirst.evaluate(() => ({
      state: window.__AIMF_TEST.getState(),
      render: window.__AIMF_TEST.getLastRender(),
      downloadText: document.getElementById('subDownloadNote')?.textContent || '',
      fourWeeksText: document.getElementById('subFourWeeksNote')?.textContent || '',
      chartDesc: document.getElementById('chartDesc')?.textContent || '',
      planPressed: document.querySelector('#priceSeg button[data-price="plan"]')?.getAttribute('aria-pressed'),
      hasProdHook: 'object' === typeof window.__AIMF_SUB,
    }));
    assert.equal(firstInfo.hasProdHook, false, 'Production window.__AIMF_SUB must not exist');
    assert.equal(firstInfo.state.price, 'plan');
    assert.equal(firstInfo.planPressed, 'true');
    assert.equal(firstInfo.render.evalRes.lane1.length, 16);
    assert.equal(firstInfo.render.evalRes.lane2.length, 0);
    assert.equal(firstInfo.render.evalRes.omitted.length, 5);
    assert.equal(firstInfo.downloadText, PM.DISCLOSURES.download);
    assert.ok(firstInfo.fourWeeksText.includes(PM.DISCLOSURES.fourWeeks));
    assert.equal(/at list prices/i.test(firstInfo.chartDesc), false, `#chartDesc contradicts Plan $ lens: ${firstInfo.chartDesc}`);

    // Untouched first visit for opposite estimate=false matches identical lane counts
    const firstEstOff = await pFirst.evaluate(() => {
      window.__AIMF_TEST.setProfile(window.PlanMath.getExampleProfile(window.PLAN_ALLOWANCES, 'entry', false));
      const r = window.__AIMF_TEST.getLastRender();
      return { lane1: r.evalRes.lane1.length, lane2: r.evalRes.lane2.length, omitted: r.evalRes.omitted.length };
    });
    assert.deepEqual(firstEstOff, { lane1: 16, lane2: 0, omitted: 5 });

    // Modal focus trap + inert on #plansPop + active preset highlight + keyboard guard
    await pFirst.click('#plansBtn');
    const modalTrap = await pFirst.evaluate(() => ({
      mainInert: document.querySelector('main').inert,
      asideInert: document.querySelector('aside').inert,
      popInert: document.getElementById('plansPop').inert,
      entryPressed: document.getElementById('presetEntryBtn').getAttribute('aria-pressed'),
      heavyPressed: document.getElementById('presetHeavyBtn').getAttribute('aria-pressed'),
    }));
    assert.equal(modalTrap.mainInert, true, 'main must be inert while #plansPop is open');
    assert.equal(modalTrap.asideInert, true, 'aside must be inert while #plansPop is open');
    assert.equal(modalTrap.popInert, false, '#plansPop itself must not be inert');
    assert.equal(modalTrap.entryPressed, 'true', 'Active Example entry preset must be aria-pressed="true"');
    assert.equal(modalTrap.heavyPressed, 'false');
    // Shift+Tab from first focusable wraps to last inside #plansPop; Tab from last wraps to first
    await pFirst.evaluate(() => document.getElementById('popClose').focus());
    await pFirst.keyboard.press('Shift+Tab');
    const wrappedBack = await pFirst.evaluate(() => document.getElementById('plansPop').contains(document.activeElement) && document.activeElement.id !== 'popClose');
    assert.equal(wrappedBack, true, 'Shift+Tab must wrap inside #plansPop');
    await pFirst.keyboard.press('Tab');
    const wrappedFwd = await pFirst.evaluate(() => document.activeElement?.id === 'popClose');
    assert.equal(wrappedFwd, true, 'Tab from last control must wrap back to #popClose');
    // '/' and 'f' must NOT fire while modal is open
    await pFirst.keyboard.press('/');
    const stayedInPop = await pFirst.evaluate(() => document.getElementById('plansPop').contains(document.activeElement));
    assert.equal(stayedInPop, true, '"/" shortcut must not steal focus out of #plansPop');
    await pFirst.keyboard.press('Escape');
    const afterEsc = await pFirst.evaluate(() => ({ open: document.getElementById('plansPop').classList.contains('open'), mainInert: document.querySelector('main').inert, activeId: document.activeElement?.id }));
    assert.equal(afterEsc.open, false);
    assert.equal(afterEsc.mainInert, false, 'main must not remain inert after closing #plansPop');
    assert.equal(afterEsc.activeId, 'plansBtn', 'Escape must restore focus to #plansBtn');

    // ?price=pct&xRel=sweet formats sweet spot as % (NOT $!), AND #chartDesc has no "at list prices"
    await pFirst.goto(`${baseUrl}/index.html?noAutoUpdate=1&price=pct&xRel=sweet`, { waitUntil: 'networkidle' });
    const pctSweet = await pFirst.evaluate(() => {
      // Pick single Anthropic pool so % of week frontier & sweet spot are comparable
      const anth = window.AA_DATA.models.filter(m => m.creatorSlug === 'anthropic' && m.family === 'claude-opus-5-5' && m.costPerTask > 0 && m.intelligence != null).map(m => m.id);
      const son = window.AA_DATA.models.filter(m => m.creatorSlug === 'anthropic' && m.family === 'claude-sonnet-5-5' && m.costPerTask > 0 && m.intelligence != null).map(m => m.id);
      window.__AIMF_TEST.setSelection([...anth, ...son]);
      return {
        note: document.getElementById('relativeNote').textContent,
        desc: document.getElementById('chartDesc').textContent,
        noticeHidden: document.getElementById('priceNotice').hidden,
        noticeText: document.getElementById('priceNotice').textContent,
      };
    });
    assert.equal(/at list prices/i.test(pctSweet.desc), false, '% of week #chartDesc must not say at list prices');
    assert.equal(pctSweet.noticeHidden, true);
    assert.equal(pctSweet.noticeText, '', 'Hidden #priceNotice must clear stale textContent');
    if (pctSweet.note.includes('the sweet spot')) {
      assert.match(pctSweet.note, /% of week per task \d+(\.\d+)?%/, `Sweet spot on % of week must format percent, got: ${pctSweet.note}`);
      assert.doesNotMatch(pctSweet.note, /\$\d/, `Sweet spot on % of week must not format dollars: ${pctSweet.note}`);
    }

    // ?price=pct&fullFrontier=1 suppresses cross-pool frontier when ghosts add a second pool!
    const pctFull = await pFirst.evaluate(() => {
      window.__AIMF_TEST.setStatePatch({ fullFrontier: true });
      const r = window.__AIMF_TEST.getLastRender();
      return {
        comparable: r.evalRes.comparable,
        noticeHidden: document.getElementById('priceNotice').hidden,
        frontLines: document.querySelectorAll('#chart polyline').length,
        ghostCircles: document.querySelectorAll('#chart circle[fill-opacity="0.4"]').length,
        legendHasFrontier: document.getElementById('legend').textContent.includes('Pareto frontier'),
      };
    });
    assert.equal(pctFull.comparable, false, 'fullFrontier=1 on % of week with multi-pool ghosts must suppress frontier');
    assert.equal(pctFull.noticeHidden, false, 'Cross-pool suppression notice must be visible');
    assert.equal(pctFull.ghostCircles, 0, 'Incompatible-pool ghosts must not render on % of week');
    assert.equal(pctFull.legendHasFrontier, false, 'Legend must not advertise suppressed frontier');

    // Dual-cost-axis tooltip (x=costPerTask & y=myCost): distinct per-axis values in tooltip!
    await pFirst.goto(`${baseUrl}/index.html?noAutoUpdate=1&x=costPerTask&y=myCost&basis=B&price=plan`, { waitUntil: 'networkidle' });
    const dualTip = await pFirst.evaluate(() => {
      const pts = window.__AIMF_TEST.getPoints();
      const target = pts.find(p => Math.abs(p.rawX - p.rawY) > 1e-4) || pts[0];
      const svgEl = document.getElementById('chart');
      const r = svgEl.getBoundingClientRect();
      svgEl.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', clientX: r.left + target.px, clientY: r.top + target.py }));
      const rows = [...document.querySelectorAll('#tooltip table tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent.trim()));
      return { target, rows };
    });
    const rTask = dualTip.rows.find(([k]) => k === 'Plan $ per task');
    const rMy = dualTip.rows.find(([k]) => k === 'Plan $ per task, your benchmarks');
    assert.ok(rTask && rMy, `Expected both cost rows in dual-cost tooltip, got ${JSON.stringify(dualTip.rows)}`);
    if (Math.abs(dualTip.target.rawX - dualTip.target.rawY) > 0.002) {
      assert.notEqual(rTask[1], rMy[1], `Dual-cost tooltip reused X value for Y: ${rTask[1]} vs ${rMy[1]}`);
    }

    // $0 fee on log scale explains $0.00 clearly; pre-feature saved set without price restores API $
    await pFirst.goto(`${baseUrl}/index.html?noAutoUpdate=1&xScale=log&price=plan`, { waitUntil: 'networkidle' });
    const zeroLogNote = await pFirst.evaluate(() => {
      const prof = window.__AIMF_TEST.getProfile();
      prof.plans.anthropic.fee = 0;
      window.__AIMF_TEST.setProfile(prof);
      return document.getElementById('chartNote').textContent;
    });
    assert.match(zeroLogNote, /\$0\.00/, `$0 fee on log scale must explain $0.00, got: ${zeroLogNote}`);
    const preFeatureRes = await pFirst.evaluate(() => {
      window.__AIMF_TEST.applySet({ x: 'costPerTask', y: 'intelligence', xScale: 'linear', yScale: 'linear' }, false);
      return window.__AIMF_TEST.getState().price;
    });
    assert.equal(preFeatureRes, 'api', 'Pre-feature saved set without price must restore API $');
    await pFirst.close();

    // 3. Full label audit matrix across 320x640, 390x844, 780/960x860, 1280x860 (Entry & Heavy; est OFF & ON; in-app + export)
    //    on BOTH committed data/models.js AND canonical 15-model fixture, across Chromium AND WebKit + independent DOM audit!
    for (const [engineName, br] of [['chromium', bChrom], ['webkit', bWeb]]) {
      const datasets = engineName === 'chromium'
        ? [{ label: 'committed', canonical: false }, { label: 'canonical15', canonical: true }]
        : [{ label: 'canonical15', canonical: true }];
      for (const ds of datasets) {
        const pLbl = await br.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
        await attachTestRoutes(pLbl, { injectCanonical15: ds.canonical });
        await pLbl.goto(url, { waitUntil: 'networkidle' });
        const rCount = await selectReplay15(pLbl, ds.canonical);
        assert.ok(ds.canonical ? rCount === 15 : rCount >= 14, `${engineName}/${ds.label}: expected replay models, got ${rCount}`);
        const viewports = [
          { w: 320, h: 640 },
          { w: 390, h: 844 },
          { w: 960, h: 860 },
          { w: 1280, h: 860 },
        ];
        for (const vp of viewports) {
          await pLbl.setViewportSize({ width: vp.w, height: vp.h });
          await pLbl.waitForTimeout(60);
          for (const preset of ['entry', 'heavy']) {
            const measuredIds = {};
            for (const est of [false, true]) {
              await pLbl.evaluate(({ preset, est }) => {
                window.__AIMF_TEST.setProfile(window.PlanMath.getExampleProfile(window.PLAN_ALLOWANCES, preset, est));
              }, { preset, est });
              await pLbl.waitForTimeout(40);
              const audit = await pLbl.evaluate(() => window.__AIMF_TEST.getLastLabelAudit());
              const dom = await independentDomAudit(pLbl, '#chart');
              const tag = `${engineName}/${ds.label} ${vp.w}x${vp.h} ${preset} est=${est}`;
              assert.ok(audit, `Missing audit ${tag}`);
              assert.equal(dom.clipped.length, 0, `Clipped SVG text ${tag}: ${JSON.stringify(dom.clipped)}`);
              assert.equal(dom.overlaps, 0, `DOM label overlap ${tag}`);
              assert.equal(dom.quadHintOverlaps, 0, `DOM quad-hint overlap ${tag}`);
              assert.equal(dom.misattached, 0, `DOM misattached label ${tag}`);
              assert.ok(dom.maxLeader <= 80, `DOM maxLeader ${dom.maxLeader} > 80 ${tag}`);
              assert.equal(audit.overlaps, 0, `Audit overlap ${tag}`);
              assert.equal(audit.dotOverlaps, 0, `Dot overlap ${tag}`);
              assert.equal(audit.misattached, 0, `Audit misattached ${tag}`);
              assert.equal(audit.sameRowHits, 0, `Same-row hit ${tag}`);
              assert.equal(audit.leaderThroughOtherMark, 0, `Leader through mark ${tag}`);
              assert.equal(audit.leaderThroughOtherLabel, 0, `Leader through label ${tag}`);
              assert.equal(audit.leaderCrossLeader, 0, `Leader cross leader ${tag}`);
              assert.ok(audit.maxLeaderLenRaw <= 80, `Leader > 80px (${audit.maxLeaderLenRaw}) ${tag}`);
              assert.equal(audit.droppedFrontierCount, 0, `Dropped frontier label ${tag}`);
              assert.equal(audit.droppedMeasuredCount, 0, `Dropped measured label ${tag}`);
              measuredIds[String(est)] = new Set(audit.drawnMeasuredIds);
            }
            for (const id of measuredIds.false) {
              assert.ok(measuredIds.true.has(id), `Measured label ${id} dropped when est=ON (${engineName}/${ds.label} ${vp.w}px ${preset})`);
            }
          }
          // Public export at this width (780 when w===960)
          const expW = vp.w === 960 ? 780 : vp.w;
          const expMeasured = {};
          for (const est of [false, true]) {
            const exp = await pLbl.evaluate(({ expW, est }) => window.__AIMF_TEST.svgString({ width: expW, pubEst: est }), { expW, est });
            const a = exp.labelAudit;
            const tag = `${engineName}/${ds.label} export ${expW}px est=${est}`;
            assert.equal(a.clippedTexts.length, 0, `${tag} clipped: ${JSON.stringify(a.clippedTexts)}`);
            assert.equal(a.overlaps, 0, `${tag} overlaps`);
            assert.equal(a.dotOverlaps, 0, `${tag} dotOverlaps`);
            assert.equal(a.misattached, 0, `${tag} misattached`);
            assert.equal(a.sameRowHits, 0, `${tag} sameRowHits`);
            assert.equal(a.leaderThroughOtherMark, 0, `${tag} leaderThroughOtherMark`);
            assert.equal(a.leaderThroughOtherLabel, 0, `${tag} leaderThroughOtherLabel`);
            assert.equal(a.leaderCrossLeader, 0, `${tag} leaderCrossLeader`);
            assert.ok(a.maxLeaderLenRaw <= 80, `${tag} maxLeader=${a.maxLeaderLenRaw}`);
            assert.equal(a.droppedFrontierCount, 0, `${tag} droppedFrontier`);
            assert.equal(a.droppedMeasuredCount, 0, `${tag} droppedMeasured`);
            expMeasured[String(est)] = new Set(a.drawnMeasuredIds);
          }
          for (const id of expMeasured.false) {
            assert.ok(expMeasured.true.has(id), `Export measured label ${id} dropped when est=ON (${engineName}/${ds.label} ${expW}px)`);
          }
        }
        // Also verify labels=all produces zero overlaps & zero dropped frontier labels at 960px
        await pLbl.setViewportSize({ width: 960, height: 860 });
        await pLbl.evaluate(() => {
          window.__AIMF_TEST.setProfile(window.PlanMath.getExampleProfile(window.PLAN_ALLOWANCES, 'entry', true));
          window.__AIMF_TEST.setStatePatch({ labels: 'all' });
        });
        const allAudit = await pLbl.evaluate(() => window.__AIMF_TEST.getLastLabelAudit());
        assert.equal(allAudit.overlaps, 0, `${engineName}/${ds.label} labels=all overlap`);
        assert.equal(allAudit.droppedFrontierCount, 0, `${engineName}/${ds.label} labels=all dropped frontier`);
        await pLbl.close();
      }
    }

    // 4. Phone bottom sheet (390x844, 390x664 Safari, 320x640, 430x932), touch targets >= 44x44,
    //    invalid fee role="alert" + $0 + Tab/Enter focus + direct first-tap + Tasks / week compact table
    //    (before & after Space!) in BOTH Chromium AND WebKit!
    for (const [engineName, br] of [['chromium', bChrom], ['webkit', bWeb]]) {
      const mCtx = await br.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
      await attachTestRoutes(mCtx, { injectCanonical15: true });
      const mp = await mCtx.newPage();
      const mErrs = [];
      mp.on('pageerror', e => mErrs.push(e.message));
      await mp.goto(url, { waitUntil: 'networkidle' });
      assert.equal(await selectReplay15(mp, true), 15);

      await mp.tap('#plansBtn');
      await mp.waitForSelector('#plansPop.open');
      const sheet844 = await mp.evaluate(() => {
        const pop = document.getElementById('plansPop');
        const cs = getComputedStyle(pop);
        const controls = [...pop.querySelectorAll('button, select, input[type="text"], label.toggle-row')];
        const small = controls.map(el => {
          const r = el.getBoundingClientRect();
          return { id: el.id || el.dataset.lab || el.dataset.feeLab || el.textContent.trim().slice(0, 16), w: r.width, h: r.height };
        }).filter(c => c.w < 44 - 0.1 || c.h < 44 - 0.1);
        return { position: cs.position, scrollH: pop.scrollHeight, clientH: pop.clientHeight, padBot: parseFloat(cs.paddingBottom), small };
      });
      assert.equal(sheet844.position, 'fixed', `${engineName} bottom sheet must be position:fixed`);
      assert.ok(sheet844.scrollH <= sheet844.clientH + 1, `${engineName} 390x844 sheet overflow: ${sheet844.scrollH} > ${sheet844.clientH}`);
      assert.ok(sheet844.padBot >= 18, `${engineName} safe-area bottom padding ${sheet844.padBot} < 18`);
      assert.deepEqual(sheet844.small, [], `${engineName} controls under 44x44px: ${JSON.stringify(sheet844.small)}`);

      await mp.setViewportSize({ width: 390, height: 664 });
      await mp.waitForTimeout(40);
      const scrollOk = await mp.evaluate(() => {
        const pop = document.getElementById('plansPop');
        const btn = document.getElementById('openTasksFromPop');
        pop.scrollTop = pop.scrollHeight;
        const pr = pop.getBoundingClientRect(), br = btn.getBoundingClientRect();
        return br.bottom <= pr.bottom + 1 && br.top >= pr.top - 1;
      });
      assert.equal(scrollOk, true, `${engineName} 390x664 sheet failed to scroll to Compare Tasks / week`);
      await mp.setViewportSize({ width: 390, height: 844 });

      const feeInp = mp.locator('input[data-fee-lab="anthropic"]');
      for (const bad of ['-1', 'abc', '100001']) {
        await feeInp.fill(bad);
        await feeInp.press('Enter');
        const errState = await mp.evaluate(() => ({
          hidden: document.getElementById('feeError').hidden,
          text: document.getElementById('feeError').textContent,
          invalid: document.querySelector('input[data-fee-lab="anthropic"]').getAttribute('aria-invalid'),
          activeTag: document.activeElement?.dataset?.feeLab || document.activeElement?.tagName,
          fee: window.__AIMF_TEST.getProfile().plans.anthropic.fee,
        }));
        assert.equal(errState.hidden, false, `${engineName} feeError hidden for ${bad}`);
        assert.match(errState.text, /keeping \$20\./, `${engineName} feeError text: ${errState.text}`);
        assert.equal(errState.invalid, 'true', `${engineName} aria-invalid missing for ${bad}`);
        assert.equal(errState.activeTag, 'anthropic', `${engineName} Enter lost focus to ${errState.activeTag}`);
        assert.equal(errState.fee, null, `${engineName} active fee mutated on invalid ${bad}`);
      }

      await feeInp.fill('-5');
      await mp.waitForSelector('#feeError:not([hidden])');
      await mp.locator('#useChips button[data-use="0.75"]').tap();
      assert.equal(await mp.evaluate(() => window.__AIMF_TEST.getProfile().use), 0.75, `${engineName} direct tap on 75% chip was swallowed`);

      await feeInp.fill('0');
      await feeInp.press('Enter');
      const zeroFeeState = await mp.evaluate(() => ({
        hidden: document.getElementById('feeError').hidden,
        fee: window.__AIMF_TEST.getProfile().plans.anthropic.fee,
        readout: document.getElementById('liveReadout').textContent,
      }));
      assert.equal(zeroFeeState.hidden, true);
      assert.equal(zeroFeeState.fee, 0);
      assert.match(zeroFeeState.readout, /\$0\.00 \/ task/);

      await mp.locator('#openTasksFromPop').tap();
      await mp.waitForSelector('#tasksPanel:not([hidden])');
      const afterCta = await mp.evaluate(() => {
        const popOpen = document.getElementById('plansPop').classList.contains('open');
        const activeId = document.activeElement?.id || document.activeElement?.tagName;
        const btnRect = document.getElementById('toggleTasksChartBtn').getBoundingClientRect();
        const thRect = document.querySelector('#tasksTable thead').getBoundingClientRect();
        const tbodyText = document.getElementById('tasksTbody').textContent;
        return {
          popOpen, activeId, tbodyText,
          rowCount: document.querySelectorAll('#tasksTbody tr').length,
          barCount: document.getElementById('tasksChartWrap').children.length,
          btnInView: btnRect.left >= 0 && btnRect.right <= window.innerWidth + 0.5 && btnRect.top >= 0 && btnRect.bottom <= window.innerHeight + 0.5,
          thInView: thRect.top >= 0 && thRect.bottom <= window.innerHeight + 0.5,
          wrapTabIndex: document.getElementById('tasksTableWrap').getAttribute('tabindex'),
          wrapRole: document.getElementById('tasksTableWrap').getAttribute('role'),
          wrapLabel: document.getElementById('tasksTableWrap').getAttribute('aria-label'),
        };
      });
      assert.equal(afterCta.popOpen, false);
      assert.equal(afterCta.activeId, 'toggleTasksChartBtn');
      assert.equal(afterCta.btnInView, true);
      assert.equal(afterCta.thInView, true);
      assert.equal(afterCta.wrapTabIndex, '0');
      assert.equal(afterCta.wrapRole, 'region');
      assert.equal(afterCta.wrapLabel, 'Tasks per week comparison table');
      assert.ok(afterCta.tbodyText.includes('Estimated from similar model (≈)'), `${engineName} missing exact Decision 5 predecessor label`);
      assert.equal(afterCta.barCount, afterCta.rowCount, `${engineName} weekly chart must render all ${afterCta.rowCount} rows without truncation`);

      const checkCompactCols = async (w, stage) => {
        const st = await mp.evaluate(() => {
          const wrap = document.getElementById('tasksTableWrap');
          const ths = [...document.querySelectorAll('#tasksTable thead th')].filter(el => getComputedStyle(el).display !== 'none');
          const firstRowTds = [...document.querySelectorAll('#tasksTbody tr:first-child td')].filter(el => getComputedStyle(el).display !== 'none');
          const vw = window.innerWidth;
          const allHeadersFit = ths.every(th => { const r = th.getBoundingClientRect(); return r.left >= -0.5 && r.right <= vw + 0.5; });
          const allCellsFit = firstRowTds.every(td => { const r = td.getBoundingClientRect(); return r.left >= -0.5 && r.right <= vw + 0.5; });
          return {
            pageOverflow: document.documentElement.scrollWidth - vw,
            wrapOverflow: wrap.scrollWidth - wrap.clientWidth,
            visCols: ths.length,
            headerTexts: ths.map(t => t.textContent.trim()),
            allHeadersFit, allCellsFit,
            chartBars: document.getElementById('tasksChartWrap').children.length,
          };
        });
        assert.ok(st.pageOverflow <= 0, `${engineName} ${w}px (${stage}) pageOverflow=${st.pageOverflow}`);
        assert.ok(st.wrapOverflow <= 0, `${engineName} ${w}px (${stage}) wrapOverflow=${st.wrapOverflow}`);
        assert.equal(st.visCols, 3, `${engineName} ${w}px (${stage}) expected 3 compact columns`);
        assert.ok(st.headerTexts.includes('Model') && st.headerTexts.some(t => t.includes('Tasks / wk')));
        assert.equal(st.allHeadersFit, true, `${engineName} ${w}px (${stage}) header clipped`);
        assert.equal(st.allCellsFit, true, `${engineName} ${w}px (${stage}) body cell clipped`);
        return st;
      };

      for (const w of [300, 320, 390, 430]) {
        await mp.setViewportSize({ width: w, height: w === 430 ? 932 : 640 });
        await mp.waitForTimeout(30);
        const before = await checkCompactCols(w, 'before-space');
        assert.ok(before.chartBars > 0);
        await mp.locator('#toggleTasksChartBtn').focus();
        await mp.keyboard.press('Space');
        const afterOff = await checkCompactCols(w, 'after-space-off');
        assert.equal(afterOff.chartBars, 0);
        await mp.keyboard.press('Space');
        const afterOn = await checkCompactCols(w, 'after-space-on');
        assert.ok(afterOn.chartBars > 0);
      }

      await mp.setViewportSize({ width: 641, height: 800 });
      await mp.waitForTimeout(30);
      assert.equal(await mp.evaluate(() => [...document.querySelectorAll('#tasksTable thead th')].filter(el => getComputedStyle(el).display !== 'none').length), 6);
      assert.deepEqual(mErrs, [], `${engineName} page errors: ${mErrs.join('; ')}`);
      await mCtx.close();
    }

    assert.deepEqual(errors, [], `AT-01 page errors: ${errors.join('; ')}`);
    await ctx1.close();
    await ctx2.close();
    console.log('PASS AT-01 (Chromium + WebKit: parity, real downloads, live settings fidelity, canonical15+committed 320..1280px labels + DOM audit, modal trap, % sweet spot, fullFrontier suppression, phone sheet & Tasks / week)');
  } finally {
    await bChrom.close();
    await bWeb.close();
  }
}

// =========================================================================
// AT-03: Legacy continuity, exact numerical parity vs origin/main,
//        all 4 legacy URLs & exports (X & Y), failed plan-math.js fail-closed
//        export/sync/503-retry, cross-catalog & 121-char sync preservation
// =========================================================================
async function runAt03(chromium, baseUrl) {
  const baseHtml = execFileSync('git', ['show', 'origin/main:index.html'], { cwd: ROOT, encoding: 'utf8' });
  const baseShares = execFileSync('git', ['show', 'origin/main:data/plan-shares.js'], { cwd: ROOT, encoding: 'utf8' });
  const curShares = fs.readFileSync(path.join(ROOT, 'data/plan-shares.js'), 'utf8');
  assert.equal(curShares, baseShares, 'data/plan-shares.js must remain byte-identical to origin/main');

  const extractDerive = (src) => {
    const m = src.match(/function planShareOf\(m\)[\s\S]*?function derive\(\)[\s\S]*?\n  \}/);
    return m ? m[0] : null;
  };
  assert.equal(extractDerive(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')), extractDerive(baseHtml), 'planShareOf/derive() must remain byte-identical to origin/main');

  const browser = await chromium.launch({ headless: true });
  try {
    // 0. Exact numerical parity of planCost & planTasks against origin/main index.html!
    const pBase = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await pBase.route('https://api.github.com/gists/**', (r) => r.abort());
    await pBase.route('**/index.html*', async (route) => {
      const body = baseHtml.replace('  // ---------- boot ----------', 'window.__BASE_DERIVED = () => ALL.filter(m => m.planCost != null || m.planTasks != null).map(m => [m.id, m.planCost, m.planTasks]);\n  // ---------- boot ----------');
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
    });
    await pBase.goto(`${baseUrl}/index.html?noAutoUpdate=1&x=planCost`, { waitUntil: 'networkidle' });
    const baseDerived = await pBase.evaluate(() => window.__BASE_DERIVED());
    await pBase.close();

    const pCur = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await attachTestRoutes(pCur);
    await pCur.goto(`${baseUrl}/index.html?noAutoUpdate=1&x=planCost`, { waitUntil: 'networkidle' });
    const curDerived = await pCur.evaluate(() => window.__AIMF_TEST.getLegacyDerived());
    assert.ok(baseDerived.length > 20, 'Expected >20 legacy derived models');
    assert.deepEqual(curDerived, baseDerived, 'Legacy planCost/planTasks numbers diverged from origin/main');
    await pCur.close();

    // 1. All 4 legacy URLs open price='api', stay API $ on axis switch, AND export clean Decision 6 titles & X/Y disclosures!
    for (const [param, metric] of [['x', 'planCost'], ['x', 'planTasks'], ['y', 'planCost'], ['y', 'planTasks']]) {
      const p = await browser.newPage({ viewport: { width: 1280, height: 860 } });
      await attachTestRoutes(p);
      await p.addInitScript(() => {
        localStorage.setItem('aa-charts:state:v2', JSON.stringify({ planPrice: 200, subPlans: { anthropic: 'Claude Max 20x' } }));
      });
      await p.goto(`${baseUrl}/index.html?noAutoUpdate=1&${param}=${metric}`, { waitUntil: 'networkidle' });
      const st = await p.evaluate(() => ({
        state: window.__AIMF_TEST.getState(),
        pressedCount: document.querySelectorAll('#priceSeg button[aria-pressed="true"]').length,
        legacySummary: document.querySelector('#planCard summary')?.textContent || '',
        exp: window.__AIMF_TEST.svgString({ width: 780 }),
      }));
      assert.equal(st.state.price, 'api', `?${param}=${metric} must default price to api`);
      assert.equal(st.pressedCount, 0, `?${param}=${metric} must have no active Price pill while legacy axis is active`);
      assert.match(st.legacySummary, /Legacy API-fee math/);
      const wantTitle = metric === 'planTasks' ? PM.DISCLOSURES.legacyExportTitleTasks : PM.DISCLOSURES.legacyExportTitleCost;
      const wantAxis = metric === 'planTasks' ? PM.DISCLOSURES.legacyExportAxisTasks : PM.DISCLOSURES.legacyExportAxisCost;
      assert.equal(st.exp.caption, wantTitle, `Legacy export title mismatch on ?${param}=${metric}`);
      assert.ok(st.exp.text.includes(wantAxis), `Legacy export missing ${param.toUpperCase()}-axis disclosure on ?${param}=${metric}`);
      assert.equal(st.exp.text.includes('lane2-bead-ring'), false, 'Legacy export must have zero bead rings');
      assert.equal(st.exp.text.includes('($59.11)'), false, 'Legacy export must never format Y score as dollars');
      assert.equal(st.exp.labelAudit.clippedTexts.length, 0, `Legacy export clipped text on ?${param}=${metric}: ${JSON.stringify(st.exp.labelAudit.clippedTexts)}`);

      // Switching legacy axis away via real axis picker menu must stay on API $
      const btnId = param === 'x' ? '#xSel' : '#ySel';
      const nextMetric = param === 'x' ? 'costPerTask' : 'intelligence';
      await p.click(btnId);
      await p.locator(`#menuList .mi[data-k="${nextMetric}"]`).click();
      const afterAxisSwitch = await p.evaluate(() => ({
        state: window.__AIMF_TEST.getState(),
        apiPressed: document.querySelector('#priceSeg button[data-price="api"]')?.getAttribute('aria-pressed'),
      }));
      assert.equal(afterAxisSwitch.state.price, 'api');
      assert.equal(afterAxisSwitch.apiPressed, 'true');
      await p.close();
    }

    // 2. Explicit ?price=plan&x=planCost + Tasks empty state + non-collapsing axis switch notice
    const pComb = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await attachTestRoutes(pComb);
    await pComb.goto(`${baseUrl}/index.html?noAutoUpdate=1&price=plan&x=planCost`, { waitUntil: 'networkidle' });
    const combInit = await pComb.evaluate(() => ({
      state: window.__AIMF_TEST.getState(),
      pressedCount: document.querySelectorAll('#priceSeg button[aria-pressed="true"]').length,
    }));
    assert.equal(combInit.state.x, 'planCost');
    assert.equal(combInit.pressedCount, 0);

    await pComb.click('#tasksBtn');
    const legEmpty = await pComb.evaluate(() => ({
      emptyHidden: document.getElementById('tasksEmpty').hidden,
      emptyText: document.getElementById('tasksEmpty').textContent,
      wrapHidden: document.getElementById('tasksTableWrap').hidden,
    }));
    assert.equal(legEmpty.emptyHidden, false);
    assert.equal(legEmpty.wrapHidden, true);
    assert.match(legEmpty.emptyText, /Switch to Plan \$ or % of week/);

    await pComb.goto(`${baseUrl}/index.html?noAutoUpdate=1&x=planTasks&y=costPerTask`, { waitUntil: 'networkidle' });
    await pComb.click('#priceSeg button[data-price="plan"]');
    const afterSw = await pComb.evaluate(() => ({
      state: window.__AIMF_TEST.getState(),
      notice: document.getElementById('priceNotice').textContent,
      noticeHidden: document.getElementById('priceNotice').hidden,
    }));
    assert.equal(afterSw.state.x, 'intelligence');
    assert.equal(afterSw.state.y, 'costPerTask');
    assert.equal(afterSw.noticeHidden, false);
    assert.equal(afterSw.notice, PM.DISCLOSURES.legacySwitchIntel);
    await pComb.close();

    // 3. Cross-catalog sync preservation + 121-char saved-set name + local subPlans isolation!
    const longSetName = 'Cross-Catalog Remote Set ' + 'X'.repeat(96); // 121 chars
    assert.equal(longSetName.length, 121);
    const remoteGistSets = {
      'Legacy Sub Set': { x: 'planCost', y: 'intelligence', price: 'api', xScale: 'log', yScale: 'linear', subPlans: { anthropic: 'HOSTILE_INBOUND' }, evilKey: 'DROP_ME' },
      [longSetName]: { x: 'ext:futureBench2027', y: 'intelligence', price: 'plan', selected: ['future-model-2027-max'], pinned: ['future-model-2027-max'], customWeights: { 'ext:futureBench2027': 4 } },
    };
    const patches = [];
    const pSync = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await attachTestRoutes(pSync, { blockGists: false });
    await pSync.route('https://api.github.com/gists/**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ files: { 'aa-charts-sync.json': { content: JSON.stringify({ version: 2, sets: remoteGistSets }) } } }) });
      } else {
        patches.push(JSON.parse(route.request().postData() || '{}'));
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
    });
    await pSync.addInitScript(() => {
      localStorage.setItem('aa-charts:gh-token', 'test-sync-token-placeholder');
      localStorage.setItem('aa-charts:sets', JSON.stringify({
        'Legacy Sub Set': { x: 'planCost', y: 'intelligence', price: 'api', xScale: 'log', yScale: 'linear', subPlans: { anthropic: 'Claude Max 20x' } },
        'Local New Set': { x: 'costPerTask', y: 'intelligence', price: 'plan', subPlans: { openai: 'ChatGPT Pro' } },
      }));
      localStorage.setItem('aa-charts:synced-sets', JSON.stringify({
        'Legacy Sub Set': { x: 'planCost', y: 'intelligence', price: 'api', xScale: 'log', yScale: 'linear' },
      }));
    });
    await pSync.goto(`${baseUrl}/index.html?noAutoUpdate=1`, { waitUntil: 'networkidle' });
    await pSync.click('#syncBtn');
    await pSync.waitForFunction(() => document.getElementById('syncStatus').textContent.includes('Saved sets match GitHub'));
    assert.equal(patches.length, 1, 'Expected one Gist PATCH');
    const uploadedSets = JSON.parse(patches[0].files['aa-charts-sync.json'].content).sets;
    assert.ok(uploadedSets[longSetName], '121-char remote set was dropped during sync');
    assert.equal(uploadedSets[longSetName].x, 'ext:futureBench2027', 'Newer-catalog benchmark was stripped during sync');
    assert.deepEqual(uploadedSets[longSetName].selected, ['future-model-2027-max'], 'Newer-catalog model ID was stripped during sync');
    assert.deepEqual(uploadedSets[longSetName].pinned, ['future-model-2027-max'], 'Newer-catalog pin was stripped during sync');
    assert.deepEqual(uploadedSets[longSetName].customWeights, { 'ext:futureBench2027': 4 });
    assert.equal('subPlans' in uploadedSets['Legacy Sub Set'], false);
    assert.equal('subPlans' in uploadedSets['Local New Set'], false);
    assert.equal('evilKey' in uploadedSets['Legacy Sub Set'], false);
    const localAfterSync = await pSync.evaluate(() => JSON.parse(localStorage.getItem('aa-charts:sets')));
    assert.deepEqual(localAfterSync['Legacy Sub Set'].subPlans, { anthropic: 'Claude Max 20x' }, 'Local subPlans lost on sync');
    assert.deepEqual(localAfterSync['Local New Set'].subPlans, { openai: 'ChatGPT Pro' }, 'Local new-set subPlans lost on sync');
    await pSync.close();

    // 4. FAIL-CLOSED when plan-math.js fails to load: #setExport AND Gist PATCH (including after 503 retry!) emit ZERO subPlans!
    const failCtx = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
    await failCtx.route('**/plan-math.js*', (r) => r.abort());
    let patchAttempts = 0;
    const failPatches = [];
    await failCtx.route('https://api.github.com/gists/**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ files: { 'aa-charts-sync.json': { content: JSON.stringify({ version: 2, sets: {} }) } } }) });
      } else {
        patchAttempts++;
        failPatches.push(route.request().postData() || '');
        if (patchAttempts === 1) await route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"unavailable"}' });
        else await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
    });
    const pFail = await failCtx.newPage();
    await pFail.addInitScript(() => {
      localStorage.setItem('aa-charts:gh-token', 'test-sync-token-placeholder');
      localStorage.setItem('aa-charts:sets', JSON.stringify({
        'Private Local Set': { x: 'planCost', y: 'intelligence', price: 'api', subPlans: { anthropic: 'SECRET_LOCAL_PICK' }, planPrice: 200, estimate: false, unknownLeak: 'SECRET_UNKNOWN' },
      }));
    });
    await pFail.goto(`${baseUrl}/index.html?noAutoUpdate=1`, { waitUntil: 'networkidle' });
    assert.equal(await pFail.evaluate(() => typeof window.PlanMath), 'undefined', 'plan-math.js should be unavailable in this test');
    const [expDl] = await Promise.all([pFail.waitForEvent('download'), pFail.click('#setExport')]);
    const exportedJson = fs.readFileSync(await expDl.path(), 'utf8');
    assert.equal(exportedJson.includes('subPlans'), false, 'Failed plan-math.js export leaked subPlans');
    assert.equal(exportedJson.includes('SECRET_LOCAL_PICK'), false, 'Failed plan-math.js export leaked private plan value');
    assert.equal(exportedJson.includes('SECRET_UNKNOWN'), false, 'Failed plan-math.js export leaked unknown field');
    // Sync attempt 1 (503) + retry attempt 2 (200)
    await pFail.click('#syncBtn');
    await pFail.waitForFunction(() => document.getElementById('syncStatus').textContent.includes('HTTP 503'));
    await pFail.click('#syncBtn');
    await pFail.waitForFunction(() => document.getElementById('syncStatus').textContent.includes('Saved sets match GitHub'));
    assert.equal(failPatches.length, 2, 'Expected 503 attempt + retry attempt');
    for (const body of failPatches) {
      assert.equal(body.includes('subPlans'), false, 'Failed plan-math.js Gist PATCH leaked subPlans');
      assert.equal(body.includes('SECRET_LOCAL_PICK'), false, 'Failed plan-math.js Gist PATCH leaked private value');
    }
    const survivedLocal = await pFail.evaluate(() => JSON.parse(localStorage.getItem('aa-charts:sets')));
    assert.deepEqual(survivedLocal['Private Local Set'].subPlans, { anthropic: 'SECRET_LOCAL_PICK' }, 'Local subPlans must survive fail-closed sync');
    await failCtx.close();

    console.log('PASS AT-03 (legacy byte & numerical parity, all 4 legacy URLs & X/Y exports, cross-catalog + 121-char sync, fail-closed missing plan-math.js export/sync/503-retry)');
  } finally {
    await browser.close();
  }
}

// =========================================================================
// AT-04: Shipping artifacts parity (_site/index.html + offline standalone AI Model Frontier.html)
//        Zero test hooks — verifies directly from real public DOM & window.PLAN_ALLOWANCES!
// =========================================================================
async function runAt04(chromium, webkit) {
  const siteDir = path.join(ROOT, '_site');
  const siteIndex = path.join(siteDir, 'index.html');
  const standalonePath = path.join(ROOT, 'AI Model Frontier.html');
  assert.equal(fs.existsSync(siteIndex), true, '_site/index.html must exist before --at04');
  assert.equal(fs.existsSync(standalonePath), true, 'AI Model Frontier.html must exist before --at04');

  const repoCatRaw = fs.readFileSync(path.join(ROOT, 'data/plan-allowances.js'), 'utf8');
  const siteCatPath = path.join(siteDir, 'data/plan-allowances.js');
  assert.equal(fs.existsSync(siteCatPath), true, '_site/data/plan-allowances.js must exist');
  const siteCatRaw = fs.readFileSync(siteCatPath, 'utf8');
  const repoCatSha = crypto.createHash('sha256').update(repoCatRaw).digest('hex').slice(0, 8);
  const siteCatSha = crypto.createHash('sha256').update(siteCatRaw).digest('hex').slice(0, 8);
  assert.equal(repoCatSha, '4af5bdbd', `Expected repo catalog SHA 4af5bdbd, got ${repoCatSha}`);
  assert.equal(siteCatSha, '4af5bdbd', `Expected _site catalog SHA 4af5bdbd, got ${siteCatSha}`);
  const standaloneRaw = fs.readFileSync(standalonePath, 'utf8');
  assert.equal(standaloneRaw.includes(repoCatRaw.trim()), true, 'Standalone AI Model Frontier.html must inline exact data/plan-allowances.js');
  assert.equal(/<script\b[^>]*\bsrc\s*=/i.test(standaloneRaw), false, 'Standalone AI Model Frontier.html must contain zero external <script src=> tags');
  assert.equal(/window\.__AIMF_SUB\b/.test(standaloneRaw), false, 'Standalone bundle must not contain production test hooks');

  const { srv, url } = await startServer(siteDir);
  const bChrom = await chromium.launch({ headless: true });
  const bWeb = await webkit.launch({ headless: true });
  try {
    const inspectTarget = async (br, targetUrl, label) => {
      const page = await br.newPage({ viewport: { width: 1280, height: 860 } });
      const pageErrs = [], consoleErrs = [], badReqs = [];
      page.on('pageerror', e => pageErrs.push(e.message));
      page.on('console', msg => { if (msg.type() === 'error') consoleErrs.push(msg.text()); });
      page.on('response', res => {
        if (res.status() >= 400 && res.url().startsWith('http://127.0.0.1')) badReqs.push(`${res.status()} ${res.url()}`);
      });
      // Freeze clock deterministically without any production URL parameter
      await page.addInitScript((fixedIso) => {
        const fixedMs = Date.parse(fixedIso);
        const RealDate = Date;
        class FrozenDate extends RealDate {
          constructor(...args) { super(...(args.length ? args : [fixedMs])); }
          static now() { return fixedMs; }
        }
        window.Date = FrozenDate;
      }, CLOCK);
      await page.route('**/*', (route) => {
        const u = route.request().url();
        if (u.startsWith('http://127.0.0.1') || u.startsWith('file://') || u.startsWith('data:')) route.continue();
        else route.abort();
      });
      await page.goto(targetUrl, { waitUntil: 'load' });
      await page.waitForSelector('#chart circle, #chart path');
      const info = await page.evaluate(() => {
        const cat = window.PLAN_ALLOWANCES;
        const activePill = document.querySelector('#priceSeg button[aria-pressed="true"]')?.dataset?.price || null;
        const dotIds = [...document.querySelectorAll('#chart circle[data-id]')].map(el => el.getAttribute('data-id')).sort();
        const ringIds = [...document.querySelectorAll('#chart g.lane2-bead-ring[data-id]')].map(el => el.getAttribute('data-id')).sort();
        const omissionsText = document.getElementById('omissionsList')?.textContent?.trim() || '';
        const frontierPoly = document.querySelector('#chart polyline[stroke-linejoin="round"]')?.getAttribute('points') || '';
        const chartTitle = document.getElementById('chartTitle')?.textContent || '';
        return {
          price: activePill,
          chartTitle,
          catalogDate: cat.catalogDate,
          sourceRevision: cat.sourceRevision,
          totalRows: cat.accounting.totalCompiledRows,
          dotCount: dotIds.length,
          dotIds,
          ringCount: ringIds.length,
          omissionsText,
          frontierPoly,
        };
      });
      // Page errors are NEVER filtered (Sol S4); only expected blocked-network console noise is filtered
      const realConsoleErrs = consoleErrs.filter(e => !/ERR_FAILED|Failed to fetch|Load failed|cancelled|aborted|Not allowed to load/i.test(e));
      assert.deepEqual(badReqs, [], `${label} had local 4xx/5xx: ${badReqs.join(', ')}`);
      assert.deepEqual(pageErrs, [], `${label} had pageerror: ${pageErrs.join('; ')}`);
      assert.deepEqual(realConsoleErrs, [], `${label} had console errors: ${realConsoleErrs.join('; ')}`);
      await page.close();
      return info;
    };

    const siteUrl = `${url}/index.html?noAutoUpdate=1`;
    const fileUrl = `file://${standalonePath}?noAutoUpdate=1`;

    const chromSite = await inspectTarget(bChrom, siteUrl, 'Chromium _site');
    const chromStandalone = await inspectTarget(bChrom, fileUrl, 'Chromium standalone');
    const webSite = await inspectTarget(bWeb, siteUrl, 'WebKit _site');
    const webStandalone = await inspectTarget(bWeb, fileUrl, 'WebKit standalone');

    assert.equal(chromSite.price, 'plan');
    assert.equal(chromSite.sourceRevision.slice(0, 8), '9c8ffc03');
    assert.equal(chromSite.totalRows, 58);
    assert.equal(chromSite.dotCount, 16);
    assert.equal(chromSite.ringCount, 0);
    assert.ok(chromSite.omissionsText.includes('Claude Fable 5.1'));
    assert.deepEqual(chromStandalone, chromSite, 'Chromium standalone diverged from _site');
    assert.deepEqual(webSite, chromSite, 'WebKit _site diverged from Chromium _site');
    assert.deepEqual(webStandalone, chromSite, 'WebKit standalone diverged from _site');

    console.log(`PASS AT-04 (Chromium + WebKit: _site/index.html & offline AI Model Frontier.html identical rev=9c8ffc03 rows=58 dots=${chromSite.dotCount} rings=${chromSite.ringCount})`);
  } finally {
    await bChrom.close();
    await bWeb.close();
    srv.close();
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const onlyAt01 = args.has('--at01');
  const onlyAt03 = args.has('--at03');
  const onlyAt04 = args.has('--at04');
  const runAll = !onlyAt01 && !onlyAt03 && !onlyAt04;

  const { chromium, webkit } = resolvePlaywright();
  const { srv, url } = await startServer(ROOT);
  try {
    if (runAll || onlyAt01) await runAt01(chromium, webkit, url);
    if (runAll || onlyAt03) await runAt03(chromium, url);
    if (onlyAt04 || (runAll && fs.existsSync(path.join(ROOT, '_site/index.html')) && fs.existsSync(path.join(ROOT, 'AI Model Frontier.html')))) {
      await runAt04(chromium, webkit);
    }
  } finally {
    srv.close();
  }
}

main().catch((err) => {
  console.error('FAIL plan-pricing-browser:', err?.stack || err);
  process.exit(1);
});
