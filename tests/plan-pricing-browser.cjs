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

// Rich mixed Lane-1 + Lane-2 + expired-promo selection (adapts seamlessly to committed or freshly scraped data/models.js)
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

async function selectReplay15(page) {
  return page.evaluate((specs) => {
    const all = window.AA_DATA?.models || [];
    const ids = [];
    for (const [fams, eff] of specs) {
      let picked = null;
      for (const fam of fams) {
        picked = all.find((x) => x.family === fam && x.effort === eff && !x.deprecated && x.intelligence != null && x.costPerTask > 0)
          || all.find((x) => x.family === fam && x.effort === eff && x.intelligence != null && x.costPerTask > 0);
        if (picked) break;
      }
      if (picked && !ids.includes(picked.id)) ids.push(picked.id);
    }
    window.__AIMF_SUB.setSelection(ids);
    return ids.length;
  }, REPLAY_SPECS);
}

async function auditSvgNoClip(page, selector = '#chart') {
  return page.evaluate((sel) => {
    const svg = document.querySelector(sel);
    if (!svg) return { clipped: [], width: 0 };
    const sr = svg.getBoundingClientRect();
    const w = sr.width;
    const h = sr.height;
    const clipped = [];
    for (const t of svg.querySelectorAll('text')) {
      const tr = t.getBoundingClientRect();
      if (tr.width > 0 && tr.height > 0 && (tr.left < sr.left - 0.8 || tr.right > sr.right + 0.8 || tr.top < sr.top - 0.8 || tr.bottom > sr.bottom + 0.8)) {
        clipped.push({
          text: t.textContent,
          left: +(tr.left - sr.left).toFixed(1),
          right: +(tr.right - sr.left).toFixed(1),
          top: +(tr.top - sr.top).toFixed(1),
          bottom: +(tr.bottom - sr.top).toFixed(1),
          w: +w.toFixed(1),
          h: +h.toFixed(1),
        });
      }
    }
    return { clipped, width: w };
  }, selector);
}

// =========================================================================
// AT-01: Public outputs parity, contrast, zero-clip, phone editor,
//        Tasks / week compact table (before & after Space), & host label audit
// =========================================================================
async function runAt01(chromium, webkit, baseUrl) {
  const bChrom = await chromium.launch({ headless: true });
  const bWeb = await webkit.launch({ headless: true });
  try {
    // 1. Two deliberately different local profiles + nested sentinels -> byte-identical public SVG exports!
    const ctx1 = await bChrom.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
    const ctx2 = await bChrom.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();
    const errors = [];
    p1.on('pageerror', e => errors.push(`p1:${e.message}`));
    p2.on('pageerror', e => errors.push(`p2:${e.message}`));

    await p1.addInitScript(() => {
      localStorage.setItem('aa-charts:plans-v1', JSON.stringify({
        plans: {
          anthropic: { id: 'claude_max_20x', fee: 249.5 },
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
    await Promise.all([
      ctx1.route('https://api.github.com/gists/**', (r) => r.abort()),
      ctx2.route('https://api.github.com/gists/**', (r) => r.abort()),
    ]);
    const url = `${baseUrl}/index.html?noAutoUpdate=1&now=${encodeURIComponent(CLOCK)}`;
    await Promise.all([p1.goto(url, { waitUntil: 'networkidle' }), p2.goto(url, { waitUntil: 'networkidle' })]);
    await Promise.all([selectReplay15(p1), selectReplay15(p2)]);

    const [exp1On, exp2On, exp1Off, exp2Off, st1] = await Promise.all([
      p1.evaluate(() => window.__AIMF_SUB.svgString({ width: 780, pubEst: true })),
      p2.evaluate(() => window.__AIMF_SUB.svgString({ width: 780, pubEst: true })),
      p1.evaluate(() => window.__AIMF_SUB.svgString({ width: 320, pubEst: false })),
      p2.evaluate(() => window.__AIMF_SUB.svgString({ width: 320, pubEst: false })),
      p1.evaluate(() => window.__AIMF_SUB.getState()),
    ]);
    assert.equal(st1.price, 'plan', 'First visit must open on Plan $');
    assert.equal(exp1On.text, exp2On.text, 'Two distinct local profiles must yield byte-identical public SVG (est ON)');
    assert.equal(exp1Off.text, exp2Off.text, 'Two distinct local profiles must yield byte-identical public SVG (est OFF)');
    assert.equal(exp1On.text.includes('249.5'), false, 'Personal custom fee leaked into public SVG');
    assert.equal(exp1On.labelAudit.clippedTexts.length, 0, '780px export clipped text');
    assert.equal(exp1Off.labelAudit.clippedTexts.length, 0, '320px export clipped text');

    // Untouched first visit defaults (theoSelection() untouched!)
    const pFirst = await bChrom.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
    await pFirst.route('https://api.github.com/gists/**', (r) => r.abort());
    await pFirst.goto(url, { waitUntil: 'networkidle' });
    const firstInfo = await pFirst.evaluate(() => ({
      state: window.__AIMF_SUB.getState(),
      render: window.__AIMF_SUB.getLastRender(),
      downloadText: document.getElementById('subDownloadNote')?.textContent || '',
      fourWeeksText: document.getElementById('subFourWeeksNote')?.textContent || '',
      planPressed: document.querySelector('#priceSeg button[data-price="plan"]')?.getAttribute('aria-pressed'),
    }));
    assert.equal(firstInfo.state.price, 'plan');
    assert.equal(firstInfo.planPressed, 'true');
    assert.equal(firstInfo.render.evalRes.lane1.length, 16, 'Untouched theoSelection() should plot 16 Lane-1 points');
    assert.equal(firstInfo.render.evalRes.lane2.length, 0, 'Untouched theoSelection() should plot 0 Lane-2 points');
    assert.equal(firstInfo.render.evalRes.omitted.length, 5, 'Untouched theoSelection() should omit 5 Claude Fable 5.1 rows');
    assert.equal(firstInfo.downloadText, PM.DISCLOSURES.download, 'Verbatim download disclosure mismatch');
    assert.ok(firstInfo.fourWeeksText.includes(PM.DISCLOSURES.fourWeeks), 'Missing four-weeks disclosure');
    // Verify untouched first visit for the opposite PUBLIC_DEFAULT_ESTIMATES value (estimate=false) matches identical lane counts
    const firstEstOff = await pFirst.evaluate(() => {
      const p = window.PlanMath.getExampleProfile(window.PLAN_ALLOWANCES, 'entry', false);
      window.__AIMF_SUB.setProfile(p);
      const r = window.__AIMF_SUB.getLastRender();
      return { lane1: r.evalRes.lane1.length, lane2: r.evalRes.lane2.length, omitted: r.evalRes.omitted.length };
    });
    assert.deepEqual(firstEstOff, { lane1: 16, lane2: 0, omitted: 5 }, 'Untouched theoSelection() with estimates OFF must match');
    await pFirst.close();

    // 2. Host label engine audit across 320, 390, 780/960, 1280px (Entry & Heavy in-app + Example entry exports; est ON & OFF)
    //    Checking clauses (i)-(v), 0 clipped text, 0 overlaps, and measured-priority superset!
    const pLbl = await bChrom.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
    await pLbl.route('https://api.github.com/gists/**', (r) => r.abort());
    await pLbl.goto(url, { waitUntil: 'networkidle' });
    const rCount = await selectReplay15(pLbl);
    assert.ok(rCount >= 12, `Expected replay15 models to match (>=12), got ${rCount}`);
    const widths = [320, 390, 960, 1280];
    for (const w of widths) {
      await pLbl.setViewportSize({ width: w, height: w <= 320 ? 640 : 860 });
      await pLbl.waitForTimeout(60);
      for (const preset of ['entry', 'heavy']) {
        const measuredIds = {};
        for (const est of [false, true]) {
          await pLbl.evaluate(({ preset, est }) => {
            const p = window.PlanMath.getExampleProfile(window.PLAN_ALLOWANCES, preset, est);
            window.__AIMF_SUB.setProfile(p);
          }, { preset, est });
          await pLbl.waitForTimeout(40);
          const audit = await pLbl.evaluate(() => window.__AIMF_SUB.getLastLabelAudit());
          const clip = await auditSvgNoClip(pLbl, '#chart');
          assert.ok(audit, `Missing label audit at ${w}px ${preset} est=${est}`);
          assert.equal(clip.clipped.length, 0, `Clipped SVG text at ${w}px ${preset} est=${est}: ${JSON.stringify(clip.clipped)}`);
          assert.equal(audit.overlaps, 0, `Label overlap at ${w}px ${preset} est=${est}`);
          assert.equal(audit.dotOverlaps, 0, `Dot overlap at ${w}px ${preset} est=${est}`);
          assert.equal(audit.misattached, 0, `Misattached label at ${w}px ${preset} est=${est}`);
          assert.equal(audit.sameRowHits, 0, `Same-row hit at ${w}px ${preset} est=${est}`);
          assert.equal(audit.leaderThroughOtherMark, 0, `Leader through mark at ${w}px ${preset} est=${est}`);
          assert.equal(audit.leaderThroughOtherLabel, 0, `Leader through label at ${w}px ${preset} est=${est}`);
          assert.equal(audit.leaderCrossLeader, 0, `Leader cross leader at ${w}px ${preset} est=${est}`);
          assert.ok(audit.maxLeaderLenRaw <= 80, `Leader > 80px (${audit.maxLeaderLenRaw}) at ${w}px ${preset} est=${est}`);
          assert.equal(audit.droppedFrontierCount, 0, `Dropped frontier label at ${w}px ${preset} est=${est}`);
          assert.equal(audit.droppedMeasuredCount, 0, `Dropped measured label at ${w}px ${preset} est=${est}`);
          measuredIds[String(est)] = new Set(audit.drawnMeasuredIds);
        }
        // Measured priority superset: every measured label drawn with estimates OFF is also drawn with estimates ON
        for (const id of measuredIds.false) {
          assert.ok(measuredIds.true.has(id), `Measured label ${id} dropped when estimates ON at ${w}px ${preset}`);
        }
      }
      // Also audit public export at this width (780 when w===960)
      const expW = w === 960 ? 780 : w;
      const expMeasured = {};
      for (const est of [false, true]) {
        const exp = await pLbl.evaluate(({ expW, est }) => window.__AIMF_SUB.svgString({ width: expW, pubEst: est }), { expW, est });
        const a = exp.labelAudit;
        assert.equal(a.clippedTexts.length, 0, `Export ${expW}px est=${est} clipped: ${JSON.stringify(a.clippedTexts)}`);
        assert.equal(a.overlaps, 0, `Export ${expW}px est=${est} overlaps`);
        assert.equal(a.dotOverlaps, 0, `Export ${expW}px est=${est} dotOverlaps`);
        assert.equal(a.misattached, 0, `Export ${expW}px est=${est} misattached`);
        assert.equal(a.sameRowHits, 0, `Export ${expW}px est=${est} sameRowHits`);
        assert.equal(a.leaderThroughOtherMark, 0, `Export ${expW}px est=${est} leaderThroughOtherMark`);
        assert.equal(a.leaderThroughOtherLabel, 0, `Export ${expW}px est=${est} leaderThroughOtherLabel`);
        assert.equal(a.leaderCrossLeader, 0, `Export ${expW}px est=${est} leaderCrossLeader`);
        assert.ok(a.maxLeaderLenRaw <= 80, `Export ${expW}px est=${est} maxLeader=${a.maxLeaderLenRaw}`);
        assert.equal(a.droppedFrontierCount, 0, `Export ${expW}px est=${est} droppedFrontier`);
        assert.equal(a.droppedMeasuredCount, 0, `Export ${expW}px est=${est} droppedMeasured`);
        expMeasured[String(est)] = new Set(a.drawnMeasuredIds);
      }
      for (const id of expMeasured.false) {
        assert.ok(expMeasured.true.has(id), `Export measured label ${id} dropped when estimates ON at ${expW}px`);
      }
    }
    await pLbl.close();

    // 3. Phone bottom sheet (390x844, 390x664 Safari, 320x640, 430x932), touch targets >= 44x44,
    //    invalid fee role="alert" + $0 + Tab/Enter focus + direct first-tap activation +
    //    Tasks / week compact table (before & after Space!) in BOTH Chromium AND WebKit!
    for (const [engineName, br] of [['chromium', bChrom], ['webkit', bWeb]]) {
      const mCtx = await br.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
      await mCtx.route('https://api.github.com/gists/**', (r) => r.abort());
      const mp = await mCtx.newPage();
      const mErrs = [];
      mp.on('pageerror', e => mErrs.push(e.message));
      await mp.goto(url, { waitUntil: 'networkidle' });
      await selectReplay15(mp);

      // Open Your plans sheet
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
        return {
          position: cs.position,
          scrollH: pop.scrollHeight,
          clientH: pop.clientHeight,
          padBot: parseFloat(cs.paddingBottom),
          small,
        };
      });
      assert.equal(sheet844.position, 'fixed', `${engineName} bottom sheet must be position:fixed`);
      assert.ok(sheet844.scrollH <= sheet844.clientH + 1, `${engineName} 390x844 sheet overflow: ${sheet844.scrollH} > ${sheet844.clientH}`);
      assert.ok(sheet844.padBot >= 18, `${engineName} safe-area bottom padding ${sheet844.padBot} < 18`);
      assert.deepEqual(sheet844.small, [], `${engineName} controls under 44x44px: ${JSON.stringify(sheet844.small)}`);

      // Safari-height 390x664 internal scroll reaches CTA cleanly
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

      // Invalid fee validation (-1, abc, 100001) + Enter focus retention + direct first-tap on 75% chip without blur-shift swallow + $0 acceptance
      const feeInp = mp.locator('input[data-fee-lab="anthropic"]');
      for (const bad of ['-1', 'abc', '100001']) {
        await feeInp.fill(bad);
        await feeInp.press('Enter');
        const errState = await mp.evaluate(() => ({
          hidden: document.getElementById('feeError').hidden,
          text: document.getElementById('feeError').textContent,
          invalid: document.querySelector('input[data-fee-lab="anthropic"]').getAttribute('aria-invalid'),
          activeTag: document.activeElement?.dataset?.feeLab || document.activeElement?.tagName,
          fee: window.__AIMF_SUB.getProfile().plans.anthropic.fee,
        }));
        assert.equal(errState.hidden, false, `${engineName} feeError hidden for ${bad}`);
        assert.match(errState.text, /keeping \$20\./, `${engineName} feeError text: ${errState.text}`);
        assert.equal(errState.invalid, 'true', `${engineName} aria-invalid missing for ${bad}`);
        assert.equal(errState.activeTag, 'anthropic', `${engineName} Enter lost focus to ${errState.activeTag}`);
        assert.equal(errState.fee, null, `${engineName} active fee mutated on invalid ${bad}`);
      }

      // Direct first-tap on 75% chip while invalid fee is still typed (verifies zero blur-shift swallowed tap!)
      await feeInp.fill('-5');
      await mp.waitForSelector('#feeError:not([hidden])');
      await mp.locator('#useChips button[data-use="0.75"]').tap();
      const useAfterTap = await mp.evaluate(() => window.__AIMF_SUB.getProfile().use);
      assert.equal(useAfterTap, 0.75, `${engineName} direct tap on 75% chip was swallowed after invalid fee`);

      // $0 fee accepted & clears alert
      await feeInp.fill('0');
      await feeInp.press('Enter');
      const zeroFeeState = await mp.evaluate(() => ({
        hidden: document.getElementById('feeError').hidden,
        fee: window.__AIMF_SUB.getProfile().plans.anthropic.fee,
        readout: document.getElementById('liveReadout').textContent,
      }));
      assert.equal(zeroFeeState.hidden, true, `${engineName} $0 fee should clear alert`);
      assert.equal(zeroFeeState.fee, 0, `${engineName} $0 fee should save 0`);
      assert.match(zeroFeeState.readout, /\$0\.00 \/ task/, `${engineName} $0 fee should update readout to $0.00`);

      // Compare Tasks / week CTA -> closes sheet, opens panel, moves focus to #toggleTasksChartBtn inside viewport,
      // 0px page & table overflow, Model + Tasks / wk 100% visible BEFORE AND AFTER both Space toggles across 300/320/390/430px!
      await mp.locator('#openTasksFromPop').tap();
      await mp.waitForSelector('#tasksPanel:not([hidden])');
      const afterCta = await mp.evaluate(() => {
        const popOpen = document.getElementById('plansPop').classList.contains('open');
        const activeId = document.activeElement?.id || document.activeElement?.tagName;
        const btnRect = document.getElementById('toggleTasksChartBtn').getBoundingClientRect();
        const thRect = document.querySelector('#tasksTable thead').getBoundingClientRect();
        return {
          popOpen, activeId,
          btnInView: btnRect.left >= 0 && btnRect.right <= window.innerWidth + 0.5 && btnRect.top >= 0 && btnRect.bottom <= window.innerHeight + 0.5,
          thInView: thRect.top >= 0 && thRect.bottom <= window.innerHeight + 0.5,
          wrapTabIndex: document.getElementById('tasksTableWrap').getAttribute('tabindex'),
          wrapRole: document.getElementById('tasksTableWrap').getAttribute('role'),
          wrapLabel: document.getElementById('tasksTableWrap').getAttribute('aria-label'),
        };
      });
      assert.equal(afterCta.popOpen, false, `${engineName} sheet stayed open after Compare Tasks / week`);
      assert.equal(afterCta.activeId, 'toggleTasksChartBtn', `${engineName} focus moved to ${afterCta.activeId} instead of toggleTasksChartBtn`);
      assert.equal(afterCta.btnInView, true, `${engineName} focused Tasks button out of viewport`);
      assert.equal(afterCta.thInView, true, `${engineName} Tasks table header out of viewport`);
      assert.equal(afterCta.wrapTabIndex, '0');
      assert.equal(afterCta.wrapRole, 'region');
      assert.equal(afterCta.wrapLabel, 'Tasks per week comparison table');

      // Check compact 3-col layout at 300, 320, 390, 430px BEFORE and AFTER pressing Space twice (Astra/Sol/Fable R13 fold-in!)
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
            allHeadersFit,
            allCellsFit,
            chartBars: document.getElementById('tasksChartWrap').children.length,
          };
        });
        assert.ok(st.pageOverflow <= 0, `${engineName} ${w}px (${stage}) pageOverflow=${st.pageOverflow}`);
        assert.ok(st.wrapOverflow <= 0, `${engineName} ${w}px (${stage}) wrapOverflow=${st.wrapOverflow}`);
        assert.equal(st.visCols, 3, `${engineName} ${w}px (${stage}) expected 3 compact columns, got ${st.visCols}`);
        assert.ok(st.headerTexts.includes('Model') && st.headerTexts.some(t => t.includes('Tasks / wk')), `${engineName} ${w}px (${stage}) missing Model or Tasks / wk: ${st.headerTexts}`);
        assert.equal(st.allHeadersFit, true, `${engineName} ${w}px (${stage}) header clipped horizontally`);
        assert.equal(st.allCellsFit, true, `${engineName} ${w}px (${stage}) body cell clipped horizontally`);
        return st;
      };

      for (const w of [300, 320, 390, 430]) {
        await mp.setViewportSize({ width: w, height: w === 430 ? 932 : 640 });
        await mp.waitForTimeout(30);
        const before = await checkCompactCols(w, 'before-space');
        assert.ok(before.chartBars > 0, `${engineName} ${w}px expected chart bars visible before Space`);
        await mp.locator('#toggleTasksChartBtn').focus();
        await mp.keyboard.press('Space');
        const afterOff = await checkCompactCols(w, 'after-space-off');
        assert.equal(afterOff.chartBars, 0, `${engineName} ${w}px Space did not hide weekly chart`);
        await mp.keyboard.press('Space');
        const afterOn = await checkCompactCols(w, 'after-space-on');
        assert.ok(afterOn.chartBars > 0, `${engineName} ${w}px second Space did not restore weekly chart`);
      }

      // Desktop 641px switches cleanly back to 6 columns
      await mp.setViewportSize({ width: 641, height: 800 });
      await mp.waitForTimeout(30);
      const cols641 = await mp.evaluate(() => [...document.querySelectorAll('#tasksTable thead th')].filter(el => getComputedStyle(el).display !== 'none').length);
      assert.equal(cols641, 6, `${engineName} expected 6 columns at 641px, got ${cols641}`);
      assert.deepEqual(mErrs, [], `${engineName} page errors: ${mErrs.join('; ')}`);
      await mCtx.close();
    }

    assert.deepEqual(errors, [], `AT-01 page errors: ${errors.join('; ')}`);
    await ctx1.close();
    await ctx2.close();
    console.log('PASS AT-01 (Chromium + WebKit: parity, first-visit defaults, 320..1280px host labels (i)-(v) + superset, bottom sheet, fee alerts, Tasks / week before & after Space)');
  } finally {
    await bChrom.close();
    await bWeb.close();
  }
}

// =========================================================================
// AT-03: Legacy continuity, exact numerical identity vs origin/main,
//        local subPlans preservation across sync, all 4 legacy URLs,
//        ?price=plan&x=planCost, axis switching notices, & Decision 6 exports
// =========================================================================
async function runAt03(chromium, baseUrl) {
  // Load origin/main index.html planShareOf/derive baseline via git show origin/main:index.html
  const baseHtml = execFileSync('git', ['show', 'origin/main:index.html'], { cwd: ROOT, encoding: 'utf8' });
  const baseShares = execFileSync('git', ['show', 'origin/main:data/plan-shares.js'], { cwd: ROOT, encoding: 'utf8' });
  const curShares = fs.readFileSync(path.join(ROOT, 'data/plan-shares.js'), 'utf8');
  assert.equal(curShares, baseShares, 'data/plan-shares.js must remain byte-identical to origin/main');

  // Verify derive() source block in index.html is identical to origin/main
  const extractDerive = (src) => {
    const m = src.match(/function planShareOf\(m\)[\s\S]*?function derive\(\)[\s\S]*?\n  \}/);
    return m ? m[0] : null;
  };
  assert.equal(extractDerive(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')), extractDerive(baseHtml), 'planShareOf/derive() must remain byte-identical to origin/main');

  const browser = await chromium.launch({ headless: true });
  try {
    // 1. All 4 legacy URL first visits open price='api' and stay API $ when switching axis
    for (const [param, metric] of [['x', 'planCost'], ['x', 'planTasks'], ['y', 'planCost'], ['y', 'planTasks']]) {
      const p = await browser.newPage({ viewport: { width: 1280, height: 860 } });
      await p.route('https://api.github.com/gists/**', (r) => r.abort());
      await p.goto(`${baseUrl}/index.html?noAutoUpdate=1&${param}=${metric}&now=${encodeURIComponent(CLOCK)}`, { waitUntil: 'networkidle' });
      const st = await p.evaluate(() => ({
        state: window.__AIMF_SUB.getState(),
        pressedCount: document.querySelectorAll('#priceSeg button[aria-pressed="true"]').length,
        legacySummary: document.querySelector('#planCard summary')?.textContent || '',
      }));
      assert.equal(st.state.price, 'api', `?${param}=${metric} must default price to api`);
      assert.equal(st.pressedCount, 0, `?${param}=${metric} must have no active Price pill while legacy axis is active`);
      assert.match(st.legacySummary, /Legacy API-fee math/);
      // Switching the legacy axis away via the real axis picker menu must stay on API $
      const btnId = param === 'x' ? '#xSel' : '#ySel';
      const nextMetric = param === 'x' ? 'costPerTask' : 'intelligence';
      await p.click(btnId);
      await p.locator(`#menuList .mi[data-k="${nextMetric}"]`).click();
      const afterAxisSwitch = await p.evaluate(() => ({
        state: window.__AIMF_SUB.getState(),
        apiPressed: document.querySelector('#priceSeg button[data-price="api"]')?.getAttribute('aria-pressed'),
      }));
      assert.equal(afterAxisSwitch.state.price, 'api', `Switching ${param}=${metric} away must stay on price=api`);
      assert.equal(afterAxisSwitch.apiPressed, 'true', `Switching ${param}=${metric} away must activate API $ pill`);
      await p.close();
    }

    // 2. Explicit ?price=plan&x=planCost keeps legacy axis with NO active Price pill,
    //    and clicking Plan $ switches cleanly without y=x and shows exact destination notice;
    //    and opening Tasks / week on legacy axis shows Fable N13-2 empty-state message!
    const pComb = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await pComb.goto(`${baseUrl}/index.html?noAutoUpdate=1&price=plan&x=planCost&now=${encodeURIComponent(CLOCK)}`, { waitUntil: 'networkidle' });
    const combInit = await pComb.evaluate(() => ({
      state: window.__AIMF_SUB.getState(),
      pressedCount: document.querySelectorAll('#priceSeg button[aria-pressed="true"]').length,
    }));
    assert.equal(combInit.state.x, 'planCost');
    assert.equal(combInit.pressedCount, 0, '?price=plan&x=planCost must show no active Price pill');

    // Legacy empty-state message in Tasks / week panel (Fable N13-2)
    await pComb.click('#tasksBtn');
    const legEmpty = await pComb.evaluate(() => ({
      emptyHidden: document.getElementById('tasksEmpty').hidden,
      emptyText: document.getElementById('tasksEmpty').textContent,
      wrapHidden: document.getElementById('tasksTableWrap').hidden,
    }));
    assert.equal(legEmpty.emptyHidden, false, 'Legacy axis must display tasksEmpty explanation');
    assert.equal(legEmpty.wrapHidden, true, 'Legacy axis must hide empty tasks table');
    assert.match(legEmpty.emptyText, /Switch to Plan \$ or % of week/);

    // Decision 6 legacy export titles & axis labels (both planCost and planTasks, zero estimate bead ring)
    const expLegCost = await pComb.evaluate(() => window.__AIMF_SUB.svgString({ width: 780 }));
    assert.equal(expLegCost.caption, PM.DISCLOSURES.legacyExportTitleCost);
    assert.ok(expLegCost.text.includes(PM.DISCLOSURES.legacyExportAxisCost), 'Legacy planCost export missing axis label');
    assert.equal(expLegCost.text.includes('lane2-bead-ring'), false, 'Legacy export must have zero estimate bead rings');

    await pComb.goto(`${baseUrl}/index.html?noAutoUpdate=1&x=planTasks&now=${encodeURIComponent(CLOCK)}`, { waitUntil: 'networkidle' });
    const expLegTasks = await pComb.evaluate(() => window.__AIMF_SUB.svgString({ width: 780 }));
    assert.equal(expLegTasks.caption, PM.DISCLOSURES.legacyExportTitleTasks);
    assert.ok(expLegTasks.text.includes(PM.DISCLOSURES.legacyExportAxisTasks), 'Legacy planTasks export missing axis label');

    // Clicking Plan $ when x=planTasks & y=costPerTask switches x -> intelligence (no y=x!) with exact notice
    await pComb.goto(`${baseUrl}/index.html?noAutoUpdate=1&x=planTasks&y=costPerTask&now=${encodeURIComponent(CLOCK)}`, { waitUntil: 'networkidle' });
    await pComb.click('#priceSeg button[data-price="plan"]');
    const afterSw = await pComb.evaluate(() => ({
      state: window.__AIMF_SUB.getState(),
      notice: document.getElementById('priceNotice').textContent,
      noticeHidden: document.getElementById('priceNotice').hidden,
    }));
    assert.equal(afterSw.state.x, 'intelligence');
    assert.equal(afterSw.state.y, 'costPerTask');
    assert.notEqual(afterSw.state.x, afterSw.state.y, 'Axis switch collapsed to y=x');
    assert.equal(afterSw.noticeHidden, false);
    assert.equal(afterSw.notice, PM.DISCLOSURES.legacySwitchIntel);

    // 3. Local legacy set preserves non-default subPlans locally across merge/sync while wire strips subPlans & zero false dirty flag
    const pSync = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await pSync.route('https://api.github.com/gists/**', (route) => route.abort());
    await pSync.addInitScript(() => {
      const legacySet = {
        x: 'planCost', y: 'intelligence', price: 'api', xScale: 'log', yScale: 'linear',
        subPlans: { anthropic: 'Claude Max 20x' },
      };
      localStorage.setItem('aa-charts:sets', JSON.stringify({ 'Legacy Sub Set': legacySet }));
      localStorage.setItem('aa-charts:synced-sets', JSON.stringify({
        'Legacy Sub Set': { x: 'planCost', y: 'intelligence', price: 'api', xScale: 'log', yScale: 'linear' },
      }));
    });
    await pSync.goto(`${baseUrl}/index.html?noAutoUpdate=1&now=${encodeURIComponent(CLOCK)}`, { waitUntil: 'networkidle' });
    const syncCheck = await pSync.evaluate(() => {
      const raw = window.__AIMF_SUB.getSetsRaw();
      const merged = window.__AIMF_SUB.mergeTest({
        'Legacy Sub Set': { x: 'planCost', y: 'intelligence', price: 'api', xScale: 'log', yScale: 'linear', subPlans: { anthropic: 'HOSTILE_INBOUND' }, evilKey: 'DROP_ME' },
      });
      return { raw, merged };
    });
    assert.equal(syncCheck.raw.unsynced, false, 'Device-local subPlans must NOT trigger false unsynced dirty flag');
    assert.equal('subPlans' in syncCheck.raw.wire['Legacy Sub Set'], false, 'Wire export must strip subPlans');
    assert.deepEqual(syncCheck.merged['Legacy Sub Set'].subPlans, { anthropic: 'Claude Max 20x' }, 'Local subPlans must survive remote merge without accepting inbound subPlans');
    assert.equal('evilKey' in syncCheck.merged['Legacy Sub Set'], false, 'Inbound unknown keys must be dropped');

    await pComb.close();
    await pSync.close();
    console.log('PASS AT-03 (legacy byte-identity, all 4 legacy URLs, ?price=plan&x=planCost, no y=x, Decision 6 exports, local subPlans sync isolation)');
  } finally {
    await browser.close();
  }
}

// =========================================================================
// AT-04: Shipping artifacts parity (_site/index.html + offline standalone AI Model Frontier.html)
// =========================================================================
async function runAt04(chromium, webkit) {
  const siteDir = path.join(ROOT, '_site');
  const siteIndex = path.join(siteDir, 'index.html');
  const standalonePath = path.join(ROOT, 'AI Model Frontier.html');
  assert.equal(fs.existsSync(siteIndex), true, '_site/index.html must exist before --at04');
  assert.equal(fs.existsSync(standalonePath), true, 'AI Model Frontier.html must exist before --at04');

  // Verify compiled catalog file SHA-256 (4af5bdbd) matches repo, _site/data/plan-allowances.js, and inlined standalone bundle
  const repoCatRaw = fs.readFileSync(path.join(ROOT, 'data/plan-allowances.js'), 'utf8');
  const siteCatPath = path.join(siteDir, 'data/plan-allowances.js');
  assert.equal(fs.existsSync(siteCatPath), true, '_site/data/plan-allowances.js must exist');
  const siteCatRaw = fs.readFileSync(siteCatPath, 'utf8');
  const repoCatSha = crypto.createHash('sha256').update(repoCatRaw).digest('hex').slice(0, 8);
  const siteCatSha = crypto.createHash('sha256').update(siteCatRaw).digest('hex').slice(0, 8);
  assert.equal(repoCatSha, '4af5bdbd', `Expected repo catalog SHA 4af5bdbd, got ${repoCatSha}`);
  assert.equal(siteCatSha, '4af5bdbd', `Expected _site catalog SHA 4af5bdbd, got ${siteCatSha}`);
  const standaloneRaw = fs.readFileSync(standalonePath, 'utf8');
  assert.equal(standaloneRaw.includes(repoCatRaw.trim()), true, 'Standalone AI Model Frontier.html must inline exact compiled data/plan-allowances.js (4af5bdbd)');
  assert.equal(/<script\s+src="/i.test(standaloneRaw), false, 'Standalone AI Model Frontier.html must contain zero external <script src=> tags');

  const { srv, url } = await startServer(siteDir);
  const bChrom = await chromium.launch({ headless: true });
  const bWeb = await webkit.launch({ headless: true });
  try {
    const inspectTarget = async (br, targetUrl, label) => {
      const page = await br.newPage({ viewport: { width: 1280, height: 860 } });
      const errs = [], badReqs = [];
      page.on('pageerror', e => errs.push(e.message));
      page.on('console', msg => { if (msg.type() === 'error') errs.push(msg.text()); });
      page.on('response', res => {
        if (res.status() >= 400 && res.url().startsWith('http://127.0.0.1')) badReqs.push(`${res.status()} ${res.url()}`);
      });
      // Block all external network traffic so offline standalone & _site parity are genuinely proven offline!
      await page.route('**/*', (route) => {
        const u = route.request().url();
        if (u.startsWith('http://127.0.0.1') || u.startsWith('file://') || u.startsWith('data:')) route.continue();
        else route.abort();
      });
      await page.goto(targetUrl, { waitUntil: 'load' });
      await page.waitForSelector('#chart circle, #chart path');
      const info = await page.evaluate(() => {
        const cat = window.PLAN_ALLOWANCES;
        const r = window.__AIMF_SUB.getLastRender();
        const st = window.__AIMF_SUB.getState();
        return {
          price: st.price,
          catalogDate: cat.catalogDate,
          sourceRevision: cat.sourceRevision,
          totalRows: cat.accounting.totalCompiledRows,
          lane1: r.evalRes.lane1.length,
          lane2: r.evalRes.lane2.length,
          omitted: r.evalRes.omitted.length,
          frontier: r.evalRes.frontierSteps.map(s => [s.id, +s.xv.toFixed(6)]),
        };
      });
      // Ignore abort noise from blocked external sync/update fetches
      const realErrs = errs.filter(e => !/ERR_FAILED|Failed to fetch|Load failed|cancelled|aborted/i.test(e));
      assert.deepEqual(badReqs, [], `${label} had local 4xx/5xx: ${badReqs.join(', ')}`);
      assert.deepEqual(realErrs, [], `${label} had console/page errors: ${realErrs.join('; ')}`);
      await page.close();
      return info;
    };

    const siteUrl = `${url}/index.html?noAutoUpdate=1&now=${encodeURIComponent(CLOCK)}`;
    const fileUrl = `file://${standalonePath}?noAutoUpdate=1&now=${encodeURIComponent(CLOCK)}`;

    const chromSite = await inspectTarget(bChrom, siteUrl, 'Chromium _site');
    const chromStandalone = await inspectTarget(bChrom, fileUrl, 'Chromium standalone');
    const webSite = await inspectTarget(bWeb, siteUrl, 'WebKit _site');
    const webStandalone = await inspectTarget(bWeb, fileUrl, 'WebKit standalone');

    assert.equal(chromSite.sourceRevision.slice(0, 8), '9c8ffc03');
    assert.equal(chromSite.totalRows, 58);
    assert.deepEqual(chromStandalone, chromSite, 'Chromium standalone diverged from _site');
    assert.deepEqual(webSite, chromSite, 'WebKit _site diverged from Chromium _site');
    assert.deepEqual(webStandalone, chromSite, 'WebKit standalone diverged from _site');

    console.log(`PASS AT-04 (Chromium + WebKit: _site/index.html & offline AI Model Frontier.html identical rev=9c8ffc03 rows=58 lane1=${chromSite.lane1} omitted=${chromSite.omitted})`);
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
