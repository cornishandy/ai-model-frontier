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
      const c15Keys = new Set(CANONICAL_15.map((cm) => `${cm.family}::${cm.effort}`));
      data.models = data.models.filter((m) => !c15Keys.has(`${m.family}::${m.effort}`));
      for (const cm of CANONICAL_15) {
        data.models.push({
          ...cm, shortName: cm.name.toLowerCase(), isReasoning: true, openWeights: false, deprecated: false,
          estimated: false, defaultSelected: false, releaseDate: '2026-11-20',
        });
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

// Independent DOM-derived geometry verifier (verifies actual rendered SVG boxes, marks, bead rings, quadrant hint, same-row, and leaders)
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
    const relRect = (r) => ({ x1: r.left - sr.left, y1: r.top - sr.top, x2: r.right - sr.left, y2: r.bottom - sr.top });
    const toRelPt = (el, x, y) => {
      const pt = svg.createSVGPoint(); pt.x = x; pt.y = y;
      const sp = pt.matrixTransform(el.getScreenCTM());
      return { x: sp.x - sr.left, y: sp.y - sr.top };
    };
    const ctmScale = (el) => { const m = el.getScreenCTM(); return Math.hypot(m.a, m.b); };
    const marks = new Map();
    for (const c of svg.querySelectorAll('circle[data-id]')) {
      const id = c.getAttribute('data-id');
      const pt = toRelPt(c, +c.getAttribute('cx'), +c.getAttribute('cy'));
      const rad = (+c.getAttribute('r') + (+c.getAttribute('stroke-width') || 0) / 2) * ctmScale(c);
      const prev = marks.get(id);
      if (!prev || rad > prev.r) marks.set(id, { id, px: pt.x, py: pt.y, r: rad });
    }
    for (const g of svg.querySelectorAll('g.lane2-bead-ring[data-id]')) {
      const id = g.getAttribute('data-id');
      let m = marks.get(id);
      if (!m) {
        const r = relRect(g.getBoundingClientRect());
        m = { id, px: (r.x1 + r.x2) / 2, py: (r.y1 + r.y2) / 2, r: Math.max(r.x2 - r.x1, r.y2 - r.y1) / 2 };
        marks.set(id, m);
      }
      for (const b of g.querySelectorAll('circle')) {
        const bp = toRelPt(b, +b.getAttribute('cx'), +b.getAttribute('cy'));
        const br = Math.hypot(bp.x - m.px, bp.y - m.py) + (+b.getAttribute('r') + (+b.getAttribute('stroke-width') || 0) / 2) * ctmScale(b);
        if (br > m.r) m.r = br;
      }
    }
    const markList = [...marks.values()];
    const lbls = [...svg.querySelectorAll('text.lbl-lane1, text.lbl-lane2')].map((el) => ({
      id: el.getAttribute('data-id'),
      text: el.textContent,
      isLane2: el.classList.contains('lbl-lane2'),
      box: relRect(el.getBoundingClientRect()),
    }));
    const leaders = [...svg.querySelectorAll('line.sub-leader')].map((el) => ({
      id: el.getAttribute('data-id'),
      x1: +el.getAttribute('x1'), y1: +el.getAttribute('y1'), x2: +el.getAttribute('x2'), y2: +el.getAttribute('y2'),
    }));
    const leaderById = new Map(leaders.map((l) => [l.id, l]));
    const qhEl = svg.querySelector('text.quad-hint');
    const qhBox = qhEl ? relRect(qhEl.getBoundingClientRect()) : null;
    const hit = (a, b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
    const distPtBox = (px, py, b) => Math.hypot(px < b.x1 ? b.x1 - px : px > b.x2 ? px - b.x2 : 0, py < b.y1 ? b.y1 - py : py > b.y2 ? py - b.y2 : 0);
    const segDist = (px, py, x1, y1, x2, y2) => {
      const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / L)) : 0;
      return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
    };
    const segHitsBox = (x1, y1, x2, y2, b) => {
      let t0 = 0, t1 = 1, dx = x2 - x1, dy = y2 - y1;
      for (const [pv, qv] of [[-dx, x1 - b.x1], [dx, b.x2 - x1], [-dy, y1 - b.y1], [dy, b.y2 - y1]]) {
        if (pv === 0) { if (qv < 0) return false; }
        else { const rv = qv / pv; if (pv < 0) { if (rv > t1) return false; if (rv > t0) t0 = rv; } else { if (rv < t0) return false; if (rv < t1) t1 = rv; } }
      }
      return t0 <= t1;
    };

    const segsCross = (a, b) => {
      const ccw = (ax, ay, bx, by, cx, cy) => (cx - ax) * (by - ay) - (cy - ay) * (bx - ax);
      const onSeg = (ax, ay, bx, by, px, py) =>
        Math.min(ax, bx) - 1e-6 <= px && px <= Math.max(ax, bx) + 1e-6 &&
        Math.min(ay, by) - 1e-6 <= py && py <= Math.max(ay, by) + 1e-6;
      const d1 = ccw(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1), d2 = ccw(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2);
      const d3 = ccw(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1), d4 = ccw(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2);
      if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
      if (Math.abs(d1) < 1e-6 && onSeg(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1)) return true;
      if (Math.abs(d2) < 1e-6 && onSeg(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2)) return true;
      if (Math.abs(d3) < 1e-6 && onSeg(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1)) return true;
      if (Math.abs(d4) < 1e-6 && onSeg(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2)) return true;
      return false;
    };

    let overlaps = 0, dotOverlaps = 0, quadHintOverlaps = 0, misattached = 0, sameRowHits = 0, leaderThroughMark = 0, leaderThroughLabel = 0, leaderCrossLeader = 0, maxLeader = 0;
    for (let i = 0; i < lbls.length; i++) {
      const a = lbls[i], pa = marks.get(a.id);
      if (qhBox && hit(a.box, qhBox)) quadHintOverlaps++;
      for (let j = i + 1; j < lbls.length; j++) if (hit(a.box, lbls[j].box)) overlaps++;
      const cy = (a.box.y1 + a.box.y2) / 2;
      for (const m of markList) {
        if (m.id === a.id) continue;
        if (distPtBox(m.px, m.py, a.box) < m.r) dotOverlaps++;
        if (Math.abs(cy - m.py) < 9 && Math.min(Math.abs(a.box.x1 - m.px), Math.abs(a.box.x2 - m.px)) < 18) sameRowHits++;
      }
      const l = leaderById.get(a.id);
      if (l) {
        maxLeader = Math.max(maxLeader, Math.hypot(l.x2 - l.x1, l.y2 - l.y1));
        for (const m of markList) if (m.id !== a.id && segDist(m.px, m.py, l.x1, l.y1, l.x2, l.y2) < m.r + 2) leaderThroughMark++;
        for (const b of lbls) {
          if (b.id === a.id) continue;
          const inset = { x1: b.box.x1 + 1, y1: b.box.y1 + 1, x2: b.box.x2 - 1, y2: b.box.y2 - 1 };
          if (inset.x2 > inset.x1 && inset.y2 > inset.y1 && segHitsBox(l.x1, l.y1, l.x2, l.y2, inset)) leaderThroughLabel++;
        }
        for (let j = i + 1; j < lbls.length; j++) {
          const lj = leaderById.get(lbls[j].id);
          if (lj && segsCross(l, lj)) leaderCrossLeader++;
        }
      } else if (pa) {
        const ownD = distPtBox(pa.px, pa.py, a.box);
        if (markList.some((o) => o.id !== a.id && distPtBox(o.px, o.py, a.box) < ownD + 4)) misattached++;
      }
    }
    return { clipped, overlaps, dotOverlaps, quadHintOverlaps, misattached, sameRowHits, leaderThroughMark, leaderThroughLabel, leaderCrossLeader, maxLeader, labelCount: lbls.length };
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

    // Desktop Tall (shape=tall, tallRatio=3) real #downloadSvg keeps desktop layout (rotated Y title, exact live width on Example entry, byte-identical across profiles, zero clips)
    await p1.evaluate(() => window.__AIMF_TEST.setStatePatch({ grid: 'normal', xRel: 'off', labels: 'auto', pareto: 'step', zone: 'off', shape: 'tall', tallRatio: 3 }));
    await p2.evaluate(() => window.__AIMF_TEST.setStatePatch({ grid: 'normal', xRel: 'off', labels: 'auto', pareto: 'step', zone: 'off', shape: 'tall', tallRatio: 3 }));
    const tallLive2 = await p2.evaluate(() => ({
      w: +document.getElementById('chart').getAttribute('width'),
      h: +document.getElementById('chart').getAttribute('height'),
      yRot: document.querySelector('#chart text[transform*="rotate(-90)"]')?.textContent || '',
    }));
    const [tallDl1, tallDl2] = await Promise.all([
      Promise.all([p1.waitForEvent('download'), p1.click('#downloadSvg')]).then(([d]) => d),
      Promise.all([p2.waitForEvent('download'), p2.click('#downloadSvg')]).then(([d]) => d),
    ]);
    const tallSvg1 = fs.readFileSync(await tallDl1.path(), 'utf8');
    const tallSvg2 = fs.readFileSync(await tallDl2.path(), 'utf8');
    assert.equal(tallSvg1, tallSvg2, 'Desktop Tall real #downloadSvg must be byte-identical across distinct local profiles');
    const tallExpAudit = await p2.evaluate(() => window.__AIMF_TEST.svgString());
    assert.equal(tallExpAudit.width, tallLive2.w, `Desktop Tall export width ${tallExpAudit.width} != Example entry live ${tallLive2.w}`);
    assert.equal(tallExpAudit.width, await p1.evaluate(() => +document.getElementById('chart').getAttribute('width')), 'Desktop Tall export width must also match custom-profile live width');
    assert.ok(tallSvg1.includes('rotate(-90)'), 'Desktop Tall export must preserve rotated desktop Y-axis title (not switch to phone layout)');
    assert.ok(tallExpAudit.height < tallLive2.h + 120, `Desktop Tall export height ${tallExpAudit.height} unexpectedly expanded vs live ${tallLive2.h}`);
    assert.equal(tallExpAudit.labelAudit.clippedTexts.length, 0, `Desktop Tall export clipped text: ${JSON.stringify(tallExpAudit.labelAudit.clippedTexts)}`);

    // Desktop Tall + Ladder with 3 labs set to No plan must STILL match live width and produce byte-identical SVG across profiles!
    await p1.evaluate(() => {
      window.__AIMF_TEST.setStatePatch({ labels: 'ladder', shape: 'tall', tallRatio: 3 });
      window.__AIMF_TEST.setProfile({ plans: { anthropic: { id: 'none', fee: null }, openai: { id: 'none', fee: null }, google: { id: 'none', fee: null }, xai: { id: 'supergrok', fee: null } }, use: 1, fableCap: 'shared', estimate: true });
    });
    await p2.evaluate(() => window.__AIMF_TEST.setStatePatch({ labels: 'ladder', shape: 'tall', tallRatio: 3 }));
    const tallLadLive1 = await p1.evaluate(() => +document.getElementById('chart').getAttribute('width'));
    const tallLadLive2 = await p2.evaluate(() => +document.getElementById('chart').getAttribute('width'));
    const tallLadExp1 = await p1.evaluate(() => window.__AIMF_TEST.svgString());
    const tallLadExp2 = await p2.evaluate(() => window.__AIMF_TEST.svgString());
    assert.equal(tallLadLive1, tallLadLive2, `Desktop Tall Ladder live width diverged across profiles: ${tallLadLive1} vs ${tallLadLive2}`);
    assert.equal(tallLadExp1.width, tallLadLive1, `Desktop Tall Ladder export width ${tallLadExp1.width} != live ${tallLadLive1}`);
    assert.equal(tallLadExp1.text, tallLadExp2.text, 'Desktop Tall Ladder export must be byte-identical across profiles');
    assert.equal(tallLadExp1.labelAudit.clippedTexts.length, 0, `Desktop Tall Ladder clipped text: ${JSON.stringify(tallLadExp1.labelAudit.clippedTexts)}`);
    // Desktop Tall Ladder with Also show (autoBest=1) AND with sweet-spot Y ref (yRel=sweet): live width === export width & full byte-identical SVG incl. aria-label!
    for (const [modeTag, patch] of [
      ['AlsoShow', { shape: 'tall', tallRatio: 3, labels: 'ladder', ladderAt: 'high', autoBest: true, autoBestPct: 100, yRel: 'off' }],
      ['SweetY', { shape: 'tall', tallRatio: 3, labels: 'ladder', ladderAt: 'high', autoBest: false, yRel: 'sweet' }],
    ]) {
      await p1.evaluate((pt) => window.__AIMF_TEST.setStatePatch(pt), patch);
      await p2.evaluate((pt) => window.__AIMF_TEST.setStatePatch(pt), patch);
      const lw1 = await p1.evaluate(() => +document.getElementById('chart').getAttribute('width'));
      const lw2 = await p2.evaluate(() => +document.getElementById('chart').getAttribute('width'));
      const ex1 = await p1.evaluate(() => window.__AIMF_TEST.svgString());
      const ex2 = await p2.evaluate(() => window.__AIMF_TEST.svgString());
      assert.equal(lw1, lw2, `Desktop Tall Ladder ${modeTag} live width diverged across profiles: ${lw1} vs ${lw2}`);
      assert.equal(ex1.width, lw1, `Desktop Tall Ladder ${modeTag} export width ${ex1.width} != live ${lw1}`);
      assert.equal(ex1.text, ex2.text, `Desktop Tall Ladder ${modeTag} export SVG (incl. aria-label) must be byte-identical across profiles`);
      assert.equal(ex1.labelAudit.clippedTexts.length, 0, `Desktop Tall Ladder ${modeTag} clipped text`);
    }
    await p2.evaluate(() => window.__AIMF_TEST.setStatePatch({ shape: 'standard', labels: 'auto', ladderAt: 'top', autoBest: false, yRel: 'off' }));
    await p1.evaluate(() => {
      window.__AIMF_TEST.setStatePatch({ labels: 'auto', ladderAt: 'top', autoBest: false, yRel: 'off' });
      window.__AIMF_TEST.setProfile({ plans: { anthropic: { id: 'claude_max_20x', fee: 4321.77 }, openai: { id: 'chatgpt_pro_20x', fee: 199 }, google: { id: 'google_ai_ultra_20x_us', fee: 0 }, xai: { id: 'none', fee: null } }, use: 0.25, fableCap: 'own', estimate: false });
    });

    // Diamond shape under Plan $: live & export zero clipped endpoint ticks ($0.00, 65.0)
    await p1.evaluate(() => window.__AIMF_TEST.setStatePatch({ shape: 'diamond' }));
    const diaDom = await independentDomAudit(p1, '#chart');
    const diaExp = await p1.evaluate(() => window.__AIMF_TEST.svgString());
    assert.equal(diaDom.clipped.length, 0, `Diamond live clipped text: ${JSON.stringify(diaDom.clipped)}`);
    assert.equal(diaExp.labelAudit.clippedTexts.length, 0, `Diamond export clipped text: ${JSON.stringify(diaExp.labelAudit.clippedTexts)}`);

    // Restore default settings & check live phone width preservation (282px on 320px viewport) + pinned Y-value tag zero clip
    await p1.evaluate(() => window.__AIMF_TEST.setStatePatch({ shape: 'standard', grid: 'normal', xRel: 'off', labels: 'auto', pareto: 'step', zone: 'off' }));
    await p1.setViewportSize({ width: 320, height: 640 });
    await p1.waitForTimeout(80);
    const phoneLiveW = await p1.evaluate(() => ({ liveW: +document.getElementById('chart').getAttribute('width'), exp: window.__AIMF_TEST.svgString() }));
    assert.equal(phoneLiveW.exp.width, phoneLiveW.liveW, `Export width (${phoneLiveW.exp.width}) must match live phone SVG width (${phoneLiveW.liveW})`);
    assert.equal(phoneLiveW.exp.labelAudit.clippedTexts.length, 0, 'Live-width phone export clipped text');
    // Pinned model Y-value tag at 320px & 390px must not clip left edge
    for (const pw of [320, 390]) {
      await p1.setViewportSize({ width: pw, height: pw === 320 ? 640 : 844 });
      await p1.goto(`${baseUrl}/index.html?noAutoUpdate=1&pin=claude-opus-5-5:xhigh`, { waitUntil: 'networkidle' });
      const pinDom = await independentDomAudit(p1, '#chart');
      assert.equal(pinDom.clipped.length, 0, `Pinned model clipped text at ${pw}px on Plan $: ${JSON.stringify(pinDom.clipped)}`);
    }

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

    // ?price=pct&fullFrontier=1&autoBest=1 suppresses cross-pool frontier, sweet spot (X & Y), and knee zone even with Also show active!
    const pctFull = await pFirst.evaluate(() => {
      window.__AIMF_TEST.setStatePatch({ fullFrontier: true, xRel: 'sweet', yRel: 'sweet', zone: 'knee', autoBest: true, autoBestPct: 100 });
      const r = window.__AIMF_TEST.getLastRender();
      return {
        comparable: r.evalRes.comparable,
        noticeHidden: document.getElementById('priceNotice').hidden,
        frontLines: document.querySelectorAll('#chart polyline').length,
        ghostCircles: document.querySelectorAll('#chart circle[fill-opacity="0.4"]').length,
        refLines: document.querySelectorAll('#chart line.reference-line').length,
        zoneChildren: document.querySelector('#chart g.zone-layer')?.children.length || 0,
        xTitle: document.getElementById('chartTitle').textContent,
        legendHasFrontier: document.getElementById('legend').textContent.includes('Pareto frontier'),
      };
    });
    assert.equal(pctFull.comparable, false, 'fullFrontier=1 on % of week with multi-pool ghosts/autoBest must suppress frontier');
    assert.equal(pctFull.noticeHidden, false, 'Cross-pool suppression notice must be visible');
    assert.equal(pctFull.ghostCircles, 0, 'Incompatible-pool ghosts must not render on % of week');
    assert.equal(pctFull.refLines, 0, 'Cross-pool % of week with Also show must not apply X or Y sweet-spot reference line');
    assert.equal(pctFull.zoneChildren, 0, 'Cross-pool % of week with Also show must not draw knee zone');
    assert.equal(pctFull.xTitle.includes('sweet spot'), false, 'Cross-pool % of week must keep original units');
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

    // $0 fee on log scale explains $0.00 clearly & splits mixed non-zero missing models separately (no skip!);
    // API $ negative/zero benchmark scores on log scale must NEVER print "$0.00" or "$0 plans"!
    await pFirst.goto(`${baseUrl}/index.html?noAutoUpdate=1&xScale=log&price=plan`, { waitUntil: 'networkidle' });
    const zeroLogNote = await pFirst.evaluate(() => {
      const prof = window.__AIMF_TEST.getProfile();
      prof.plans.anthropic.fee = 0;
      window.__AIMF_TEST.setProfile(prof);
      return document.getElementById('chartNote').textContent;
    });
    assert.match(zeroLogNote, /\$0\.00/, `$0 fee on log scale must explain $0.00, got: ${zeroLogNote}`);
    // Deterministic mixed log-scale hide: 1 Anthropic $0.00 row + 1 4-lab row with null costPerTask (works on committed AND refreshed data!)
    const pMix = await bChrom.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
    await attachTestRoutes(pMix);
    await pMix.route('**/data/models.js*', async (route) => {
      const response = await route.fetch();
      let body = await response.text();
      // If a future live data refresh omits all 4-lab null-cost rows, append one deterministic probe row so the check never flakes or skips
      const ctx = { window: {} };
      require('node:vm').runInNewContext(body, ctx);
      const fourLabs = new Set(['anthropic', 'openai', 'google', 'xai']);
      const hasReal = (ctx.window.AA_DATA?.models || []).some(m => fourLabs.has(m.creatorSlug) && m.costPerTask == null && m.intelligence != null && !m.deprecated);
      if (!hasReal) {
        const base = (ctx.window.AA_DATA?.models || []).find(m => m.creatorSlug === 'google' && m.intelligence != null && !m.deprecated);
        if (base) {
          const probe = { ...base, id: 'probe-null-cost-row', slug: 'probe-null-cost-low', name: 'Gemini Probe (Low)', shortName: 'Gemini Probe (low)', effort: 'low', effortLevel: 20, costPerTask: null, costToRun: null, defaultSelected: false };
          ctx.window.AA_DATA.models.push(probe);
          body = `window.AA_DATA = ${JSON.stringify(ctx.window.AA_DATA)};\n`;
        }
      }
      await route.fulfill({ response, body });
    });
    await pMix.goto(`${baseUrl}/index.html?noAutoUpdate=1&xScale=log&price=plan`, { waitUntil: 'networkidle' });
    const mixedLogNote = await pMix.evaluate(() => {
      const prof = window.__AIMF_TEST.getProfile();
      prof.plans.anthropic.fee = 0;
      window.__AIMF_TEST.setProfile(prof);
      const fourLabs = new Set(['anthropic', 'openai', 'google', 'xai']);
      const anthZero = window.AA_DATA.models.find(m => m.creatorSlug === 'anthropic' && m.family === 'claude-opus-5-5' && m.effort === 'xhigh');
      const noCost = window.AA_DATA.models.find(m => fourLabs.has(m.creatorSlug) && m.costPerTask == null && m.intelligence != null && !m.deprecated && m.effort === 'low')
        || window.AA_DATA.models.find(m => fourLabs.has(m.creatorSlug) && m.costPerTask == null && m.intelligence != null && !m.deprecated);
      if (!anthZero || !noCost) return { missingFixture: true };
      window.__AIMF_TEST.setSelection([anthZero.id, noCost.id]);
      const lbl = (m) => m.shortName.replace(/ with fallback\)/, ')');
      return { missingFixture: false, note: document.getElementById('chartNote').textContent, zeroLabel: lbl(anthZero), missLabel: lbl(noCost) };
    });
    await pMix.close();
    assert.equal(mixedLogNote.missingFixture, false, 'Expected deterministic $0.00 + null-cost models');
    const noteParts = mixedLogNote.note.split(' · ');
    const zeroPart = noteParts.find(s => /1 selected model-effort variant is hidden on a log scale because Plan \$ per task is \$0\.00/.test(s)) || '';
    const missPart = noteParts.find(s => /1 selected model-effort variant has no Plan \$ per task data/.test(s)) || '';
    assert.ok(zeroPart, `Missing $0.00 sentence in: ${mixedLogNote.note}`);
    assert.ok(missPart, `Missing no-data sentence in: ${mixedLogNote.note}`);
    assert.ok(zeroPart.includes(mixedLogNote.zeroLabel) && !zeroPart.includes(mixedLogNote.missLabel), `Wrong names in $0.00 sentence: ${zeroPart}`);
    assert.ok(missPart.includes(mixedLogNote.missLabel) && !missPart.includes(mixedLogNote.zeroLabel), `Wrong names in no-data sentence: ${missPart}`);

    // Non-vacuous fresh-page regression: API $ AND Plan $ log Y on AA-Omniscience (negative scores) must show non-empty note naming negative models and NEVER "$0.00" or "$0 plans"!
    for (const [tag, qs] of [
      ['API log Omniscience', 'noAutoUpdate=1&price=api&x=intelligence&y=omniscience&yScale=log'],
      ['Plan $ log Omniscience', 'noAutoUpdate=1&price=plan&x=costPerTask&y=omniscience&yScale=log'],
    ]) {
      const pOmni = await bChrom.newPage({ viewport: { width: 1280, height: 860 } });
      await attachTestRoutes(pOmni);
      await pOmni.goto(`${baseUrl}/index.html?${qs}`, { waitUntil: 'networkidle' });
      const omniNote = await pOmni.locator('#chartNote').innerText();
      await pOmni.close();
      assert.ok(omniNote.includes('GPT-6 Luna'), `${tag} regression check must be non-vacuous and name negative-score models, got: ${omniNote}`);
      assert.equal(omniNote.includes('$0 plans'), false, `${tag} wrongly claimed "$0 plans": ${omniNote}`);
      assert.equal(omniNote.includes('$0.00'), false, `${tag} wrongly claimed "$0.00": ${omniNote}`);
    }
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
              assert.equal(dom.dotOverlaps, 0, `DOM dot overlap ${tag}`);
              assert.equal(dom.quadHintOverlaps, 0, `DOM quad-hint overlap ${tag}`);
              assert.equal(dom.misattached, 0, `DOM misattached label ${tag}`);
              assert.equal(dom.sameRowHits, 0, `DOM same-row hit ${tag}`);
              assert.equal(dom.leaderThroughMark, 0, `DOM leader through mark ${tag}`);
              assert.equal(dom.leaderThroughLabel, 0, `DOM leader through label ${tag}`);
              assert.equal(dom.leaderCrossLeader, 0, `DOM leader cross leader ${tag}`);
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
          // Public export at this width (780 when w===960) — verified via BOTH app audit AND independent rendered-DOM audit!
          const expW = vp.w === 960 ? 780 : vp.w;
          const expMeasured = {};
          for (const est of [false, true]) {
            const exp = await pLbl.evaluate(({ expW, est }) => {
              const o = window.__AIMF_TEST.svgString({ width: expW, pubEst: est });
              let host = document.getElementById('expAuditHost');
              if (!host) { host = document.createElement('div'); host.id = 'expAuditHost'; document.body.appendChild(host); }
              host.style.cssText = `position:absolute;left:0;top:0;width:${o.width}px;pointer-events:none;z-index:-1`;
              host.innerHTML = o.text;
              return { labelAudit: o.labelAudit, width: o.width };
            }, { expW, est });
            const edom = await independentDomAudit(pLbl, '#expAuditHost svg');
            await pLbl.evaluate(() => document.getElementById('expAuditHost')?.remove());
            const a = exp.labelAudit;
            const tag = `${engineName}/${ds.label} export ${expW}px est=${est}`;
            assert.equal(edom.clipped.length, 0, `${tag} DOM clipped: ${JSON.stringify(edom.clipped)}`);
            assert.equal(edom.overlaps, 0, `${tag} DOM overlaps`);
            assert.equal(edom.dotOverlaps, 0, `${tag} DOM dotOverlaps`);
            assert.equal(edom.quadHintOverlaps, 0, `${tag} DOM quadHintOverlaps`);
            assert.equal(edom.misattached, 0, `${tag} DOM misattached`);
            assert.equal(edom.sameRowHits, 0, `${tag} DOM sameRowHits`);
            assert.equal(edom.leaderThroughMark, 0, `${tag} DOM leaderThroughMark`);
            assert.equal(edom.leaderThroughLabel, 0, `${tag} DOM leaderThroughLabel`);
            assert.equal(edom.leaderCrossLeader, 0, `${tag} DOM leaderCrossLeader`);
            assert.ok(edom.maxLeader <= 80, `${tag} DOM maxLeader=${edom.maxLeader}`);
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
        // Real width stride sweep for Heavy est-OFF -> est-ON superset, maxLeader, & DOM audit across narrow/mid/laptop/Values=both widths
        if (ds.canonical) {
          for (const sw of [320, 330, 360, 380, 400, 420, 440, 760, 780, 960, 1040, 1120, 1160, 1280]) {
            await pLbl.setViewportSize({ width: sw, height: sw < 560 ? 640 : 860 });
            await pLbl.waitForTimeout(30);
            const offIds = await pLbl.evaluate(() => {
              window.__AIMF_TEST.setStatePatch({ labels: 'auto', valueLabels: 'off' });
              window.__AIMF_TEST.setProfile(window.PlanMath.getExampleProfile(window.PLAN_ALLOWANCES, 'heavy', false));
              return window.__AIMF_TEST.getLastLabelAudit().drawnMeasuredIds;
            });
            await pLbl.evaluate(() => {
              window.__AIMF_TEST.setProfile(window.PlanMath.getExampleProfile(window.PLAN_ALLOWANCES, 'heavy', true));
            });
            const a = await pLbl.evaluate(() => window.__AIMF_TEST.getLastLabelAudit());
            const dom = await independentDomAudit(pLbl, '#chart');
            assert.equal(a.droppedFrontierCount, 0, `${engineName} sweep ${sw}px Heavy ON dropped frontier`);
            assert.equal(a.droppedMeasuredCount, 0, `${engineName} sweep ${sw}px Heavy ON dropped measured`);
            assert.ok(dom.maxLeader <= 80, `${engineName} sweep ${sw}px Heavy ON maxLeader ${dom.maxLeader} > 80`);
            for (const id of offIds) assert.ok(a.drawnMeasuredIds.includes(id), `${engineName} sweep ${sw}px Heavy ON dropped est-OFF measured ${id}`);
            assert.equal(dom.overlaps + dom.dotOverlaps + dom.quadHintOverlaps + dom.misattached + dom.sameRowHits + dom.leaderThroughMark + dom.leaderThroughLabel + dom.leaderCrossLeader + dom.clipped.length, 0, `${engineName} sweep ${sw}px Heavy ON DOM issue: ${JSON.stringify(dom)}`);
          }
          for (const sw of [760, 780]) {
            await pLbl.setViewportSize({ width: sw, height: 860 });
            await pLbl.evaluate(() => {
              window.__AIMF_TEST.setStatePatch({ labels: 'auto', valueLabels: 'both' });
              window.__AIMF_TEST.setProfile(window.PlanMath.getExampleProfile(window.PLAN_ALLOWANCES, 'heavy', true));
            });
            const a = await pLbl.evaluate(() => window.__AIMF_TEST.getLastLabelAudit());
            assert.equal(a.droppedFrontierCount, 0, `${engineName} sweep ${sw}px Values=both dropped frontier`);
            assert.equal(a.droppedMeasuredCount, 0, `${engineName} sweep ${sw}px Values=both dropped measured`);
          }
          await pLbl.evaluate(() => window.__AIMF_TEST.setStatePatch({ valueLabels: 'off' }));
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
        // Deterministic CPU-throttling check (Chromium CDP): identical labels & bit-for-bit identical dense SVG exports across 1x vs 6x/4x CPU!
        if (ds.canonical && engineName === 'chromium') {
          const cdp = await pLbl.context().newCDPSession(pLbl);
          try {
            await pLbl.setViewportSize({ width: 320, height: 640 });
            await pLbl.evaluate(() => {
              window.__AIMF_TEST.setStatePatch({ labels: 'auto', valueLabels: 'off' });
              window.__AIMF_TEST.setProfile(window.PlanMath.getExampleProfile(window.PLAN_ALLOWANCES, 'heavy', true));
            });
            const baseAudit = await pLbl.evaluate(() => window.__AIMF_TEST.getLastLabelAudit());
            await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
            const slowAudit = await pLbl.evaluate(() => {
              window.__AIMF_TEST.setProfile(window.PlanMath.getExampleProfile(window.PLAN_ALLOWANCES, 'heavy', true));
              return window.__AIMF_TEST.getLastLabelAudit();
            });
            assert.deepEqual(slowAudit.drawnLabels, baseAudit.drawnLabels, '6x CPU throttle changed canonical15 320px Heavy labels');
            assert.equal(slowAudit.droppedFrontierCount, 0, '6x CPU throttle dropped canonical15 frontier label');
            await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
            await pLbl.setViewportSize({ width: 900, height: 860 });
            const denseSvg1 = await pLbl.evaluate(() => {
              const ids = window.AA_DATA.models.filter(m => ['anthropic','openai','google','xai'].includes(m.creatorSlug) && !m.deprecated && m.intelligence != null && m.costPerTask > 0).map(m => m.id);
              window.__AIMF_TEST.setSelection(ids);
              window.__AIMF_TEST.setStatePatch({ labels: 'all', valueLabels: 'both' });
              return window.__AIMF_TEST.svgString().text;
            });
            await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
            const denseSvg4 = await pLbl.evaluate(() => window.__AIMF_TEST.svgString().text);
            assert.equal(denseSvg4, denseSvg1, 'Dense SVG export changed under 4x CPU throttling');
          } finally {
            await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => {});
          }
        }
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
      // Full-cycle modal Tab & Shift+Tab trap check in BOTH Chromium AND WebKit (must NEVER drop to BODY!)
      for (const dir of ['Tab', 'Shift+Tab']) {
        for (let step = 0; step < 26; step++) {
          await mp.keyboard.press(dir);
          const inPop = await mp.evaluate(() => {
            const pop = document.getElementById('plansPop');
            return pop.contains(document.activeElement) && document.activeElement !== document.body;
          });
          assert.equal(inPop, true, `${engineName} modal focus escaped on ${dir} step ${step}`);
        }
      }
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

    // 4. FAIL-CLOSED when plan-math.js fails to load:
    //    (a) #setExport & Gist PATCH (503+retry) emit ZERO subPlans AND strip malformed wire values AND preserve 1001-char names;
    //    (b) same-name #importFile preserves local subPlans;
    //    (c) legacy X/Y SVG downloads stay isolated from personal fee (4321.77) with exact Decision 6 disclosures!
    const failCtx = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
    await failCtx.route('**/plan-math.js*', (r) => r.abort());
    let patchAttempts = 0;
    const failPatches = [];
    const name1001 = 'L'.repeat(1001);
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
    await pFail.addInitScript((n1001) => {
      localStorage.setItem('aa-charts:gh-token', 'test-sync-token-placeholder');
      localStorage.setItem('aa-charts:sets', JSON.stringify({
        'Private Local Set': {
          x: 'planCost', y: 'intelligence', price: 'api', pareto: 'bad-sentinel', grid: 'bad-grid', smallCaps: 'not-bool',
          efforts: ['xhigh', 'bogus-effort'], subPlans: { anthropic: 'SECRET_LOCAL_PICK' }, planPrice: 200, estimate: false, unknownLeak: 'SECRET_UNKNOWN',
        },
        [n1001]: { x: 'costPerTask', y: 'intelligence', price: 'api', subPlans: { anthropic: 'SECRET_1001' } },
      }));
    }, name1001);
    await pFail.goto(`${baseUrl}/index.html?noAutoUpdate=1`, { waitUntil: 'networkidle' });
    assert.equal(await pFail.evaluate(() => typeof window.PlanMath), 'undefined', 'plan-math.js should be unavailable in this test');
    const [expDl] = await Promise.all([pFail.waitForEvent('download'), pFail.click('#setExport')]);
    const exportedJson = fs.readFileSync(await expDl.path(), 'utf8');
    const exportedObj = JSON.parse(exportedJson);
    assert.equal(exportedJson.includes('subPlans'), false, 'Failed plan-math.js export leaked subPlans');
    assert.equal(exportedJson.includes('SECRET_LOCAL_PICK'), false, 'Failed plan-math.js export leaked private plan value');
    assert.equal(exportedJson.includes('SECRET_UNKNOWN'), false, 'Failed plan-math.js export leaked unknown field');
    assert.equal('pareto' in exportedObj['Private Local Set'], false, 'Failed plan-math.js fallback must strip malformed enum pareto');
    assert.equal('grid' in exportedObj['Private Local Set'], false, 'Failed plan-math.js fallback must strip malformed enum grid');
    assert.equal('smallCaps' in exportedObj['Private Local Set'], false, 'Failed plan-math.js fallback must strip non-boolean smallCaps');
    assert.deepEqual(exportedObj['Private Local Set'].efforts, ['xhigh'], 'Failed plan-math.js fallback must strip unknown efforts');
    assert.ok(exportedObj[name1001], '1001-char set name must survive export');
    // Sync attempt 1 (503) + retry attempt 2 (200)
    await pFail.click('#syncBtn');
    await pFail.waitForFunction(() => document.getElementById('syncStatus').textContent.includes('HTTP 503'));
    await pFail.click('#syncBtn');
    await pFail.waitForFunction(() => document.getElementById('syncStatus').textContent.includes('Saved sets match GitHub'));
    assert.equal(failPatches.length, 2, 'Expected 503 attempt + retry attempt');
    for (const body of failPatches) {
      assert.equal(body.includes('subPlans'), false, 'Failed plan-math.js Gist PATCH leaked subPlans');
      assert.equal(body.includes('SECRET_LOCAL_PICK'), false, 'Failed plan-math.js Gist PATCH leaked private value');
      assert.equal(body.includes('bad-sentinel'), false, 'Failed plan-math.js Gist PATCH emitted malformed enum');
    }
    const survivedLocal = await pFail.evaluate(() => JSON.parse(localStorage.getItem('aa-charts:sets')));
    assert.deepEqual(survivedLocal['Private Local Set'].subPlans, { anthropic: 'SECRET_LOCAL_PICK' }, 'Local subPlans must survive fail-closed sync');
    assert.equal(survivedLocal['Private Local Set'].unknownLeak, 'SECRET_UNKNOWN', 'Untouched local extra key preserved locally while stripped on wire');
    assert.ok(survivedLocal[name1001], '1001-char set name must survive fail-closed sync');
    // Same-name #importFile must preserve local subPlans while applying inbound public edits and stripping inbound subPlans
    const importTmp = path.join(os.tmpdir(), `aimf-import-${process.pid}.json`);
    fs.writeFileSync(importTmp, JSON.stringify({
      'Private Local Set': { x: 'costPerTask', y: 'intelligence', price: 'api', xScale: 'log', subPlans: { anthropic: 'HOSTILE_IMPORT' } },
    }));
    pFail.once('dialog', d => d.accept());
    await pFail.setInputFiles('#importFile', importTmp);
    await pFail.waitForTimeout(100);
    fs.rmSync(importTmp, { force: true });
    const afterImport = await pFail.evaluate(() => JSON.parse(localStorage.getItem('aa-charts:sets')));
    assert.equal(afterImport['Private Local Set'].xScale, 'log', 'Same-name import must apply public edit');
    assert.deepEqual(afterImport['Private Local Set'].subPlans, { anthropic: 'SECRET_LOCAL_PICK' }, 'Same-name import must preserve existing local subPlans');
    // Legacy X/Y downloads when plan-math.js fails to load must remain isolated from personal fee (4321.77) and keep exact Decision 6 disclosures!
    for (const [param, metric] of [['x', 'planCost'], ['x', 'planTasks'], ['y', 'planCost'], ['y', 'planTasks']]) {
      const pLegDef = await failCtx.newPage();
      await pLegDef.goto(`${baseUrl}/index.html?noAutoUpdate=1&${param}=${metric}`, { waitUntil: 'networkidle' });
      const [dlDef] = await Promise.all([pLegDef.waitForEvent('download'), pLegDef.click('#downloadSvg')]);
      const svgDef = fs.readFileSync(await dlDef.path(), 'utf8');
      await pLegDef.close();

      const pLegPriv = await failCtx.newPage();
      await pLegPriv.addInitScript(() => {
        localStorage.setItem('aa-charts:state:v2', JSON.stringify({ planPrice: 4321.77, subPlans: { anthropic: 'Claude Max 20x' } }));
      });
      await pLegPriv.goto(`${baseUrl}/index.html?noAutoUpdate=1&${param}=${metric}`, { waitUntil: 'networkidle' });
      const [dlPriv] = await Promise.all([pLegPriv.waitForEvent('download'), pLegPriv.click('#downloadSvg')]);
      const svgPriv = fs.readFileSync(await dlPriv.path(), 'utf8');
      await pLegPriv.close();

      assert.equal(svgPriv, svgDef, `Missing plan-math.js legacy download ?${param}=${metric} differed under personal fee 4321.77`);
      const wantTitle = metric === 'planTasks' ? PM.DISCLOSURES.legacyExportTitleTasks : PM.DISCLOSURES.legacyExportTitleCost;
      const wantAxis = metric === 'planTasks' ? PM.DISCLOSURES.legacyExportAxisTasks : PM.DISCLOSURES.legacyExportAxisCost;
      assert.ok(svgPriv.includes(wantTitle), `Missing plan-math.js legacy export missing title on ?${param}=${metric}`);
      assert.ok(svgPriv.includes(wantAxis), `Missing plan-math.js legacy export missing axis disclosure on ?${param}=${metric}`);
    }
    await failCtx.close();

    console.log('PASS AT-03 (legacy byte & numerical parity, all 4 legacy URLs & X/Y exports incl. missing plan-math.js, cross-catalog + 121/1001-char sync, same-name import preservation, fail-closed missing plan-math.js export/sync/503-retry)');
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
  assert.equal(/<script(?=[\s/])(?:[^>"']|"[^"]*"|'[^']*')*(?:[\s/]|(?<=["']))src\s*=/i.test(standaloneRaw), false, 'Standalone AI Model Frontier.html must contain zero external <script src=> tags');
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
