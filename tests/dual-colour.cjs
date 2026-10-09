// Lab colors while coloring by value (Look → Color → Lab: Off | Lines | Ring | Field | Split).
// Run with node tests/dual-colour.cjs while this worktree is served on port 8781 (FRONTIER_URL overrides it).
const { chromium, devices } = require(process.env.PLAYWRIGHT_PATH || '/tmp/pw/node_modules/playwright');
const assert = require('node:assert/strict');
const origin = process.env.FRONTIER_URL || 'http://localhost:8781/index.html';
const hook = `window.__dual = {S, render, snapshot, applySet, familyColor, get points(){return lastPoints}};`;
const base = '?theme=light&x=costPerTask&y=intelligence&labels=auto';
let passed = 0;

async function open(browser, query, options = {}) {
  const context = await browser.newContext(options), errors = [];
  await context.route('https://api.github.com/gists/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ files: { 'aa-charts-sync.json': { content: '{"sets":{}}' } } }) }));
  await context.route('**/index.html*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('  // ---------- boot ----------', hook + '\n  // ---------- boot ----------') });
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(origin + query);
  await page.waitForFunction(() => window.__dual?.points.length);
  return { page, context, errors };
}
const ok = (name) => { passed++; console.log('PASS', name); };

(async () => {
  const browser = await chromium.launch();
  // every variant on every value coloring: lines and names in lab colors, legend with both keys, one mark per dot
  for (const colorBy of ['x', 'y', 'both']) for (const dual of ['off', 'lines', 'ring', 'field', 'split']) {
    for (const theme of ['light', 'dark']) {
      const { page, context, errors } = await open(browser, base.replace('light', theme) + `&colorBy=${colorBy}&dual=${dual}&glow=on&fullFrontier=1&pin=gpt-6-sol:high&focus=pinned`);
      const r = await page.evaluate(() => {
        const { points, familyColor } = window.__dual, norm = (c) => c.toLowerCase();
        const lines = [...document.querySelectorAll('#chart polyline[data-fam]')];
        const labStroke = lines.every((l) => { const p = points.find((q) => q.m.family === l.dataset.fam); return norm(l.getAttribute('stroke')) === norm(familyColor(p.m)); });
        const legend = document.getElementById('legend');
        return {
          labStroke, lines: lines.length, marks: document.querySelectorAll('#chart [data-id][data-fam]').length, points: points.length,
          ramp: !!legend.querySelector('i.ramp, i.ramp2d'), labs: /Anthropic/.test(legend.textContent) && /OpenAI/.test(legend.textContent),
          field: !!document.querySelector('#chart .value-field'), shown: !document.getElementById('dualWrap').hidden,
          pressed: document.querySelector('#dualSeg [aria-pressed="true"]')?.dataset.v,
        };
      });
      assert.deepEqual(errors, [], `${colorBy}/${dual}/${theme}: no errors`);
      assert.ok(r.lines > 0 && r.marks === r.points && r.ramp && r.shown, `${colorBy}/${dual}/${theme}: lines, marks, ramp key, control`);
      assert.equal(r.pressed, dual);
      assert.equal(r.labStroke, dual !== 'off', `${colorBy}/${dual}/${theme}: lines in lab colors only with Lab on`);
      assert.equal(r.labs, dual !== 'off', `${colorBy}/${dual}/${theme}: lab swatches only with Lab on`);
      assert.equal(r.field, dual === 'field');
      await context.close();
    }
    ok(`colorBy=${colorBy} dual=${dual}`);
  }
  // Color: Lab, Effort and Open/closed draw exactly as before whatever Lab is set to; the control hides there
  for (const colorBy of ['lab', 'effort', 'open']) {
    const shots = [];
    for (const dual of ['off', 'ring']) {
      const { page, context, errors } = await open(browser, base + `&colorBy=${colorBy}&dual=${dual}`);
      shots.push(await page.evaluate(() => [document.getElementById('chart').innerHTML, document.getElementById('legend').innerHTML, document.getElementById('dualWrap').hidden]));
      assert.deepEqual(errors, []);
      await context.close();
    }
    assert.deepEqual(shots[0], shots[1], `${colorBy}: unchanged by Lab`);
    assert.equal(shots[0][2], true, `${colorBy}: Lab control hidden`);
    ok(`colorBy=${colorBy} unchanged`);
  }
  // saved sets, the saved view, and a bad URL value
  {
    const { page, context, errors } = await open(browser, base + '&colorBy=y&dual=split');
    const r = await page.evaluate(() => {
      const t = window.__dual, snap = t.snapshot(), saved = JSON.parse(localStorage.getItem('aa-charts:state:v2') || '{}').dual;
      t.S.dual = 'off'; t.applySet(snap);
      return { snap: snap.dual, after: t.S.dual, saved };
    });
    assert.deepEqual(r, { snap: 'split', after: 'split', saved: r.saved }, 'saved set keeps Lab');
    await page.click('#dualSeg [data-v="field"]');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('aa-charts:state:v2')).dual), 'field', 'the saved view keeps Lab');
    assert.deepEqual(errors, []);
    await context.close();
    const bad = await open(browser, base + '&colorBy=y&dual=bogus');
    assert.equal(await bad.page.evaluate(() => window.__dual.S.dual), 'off', 'unknown ?dual= falls back to off');
    assert.deepEqual(bad.errors, []);
    await bad.context.close();
    ok('saved set, saved view, URL fallback');
  }
  // diamond, ladder labels, hover, phone
  {
    const { page, context, errors } = await open(browser, base + '&colorBy=both&dual=ring&shape=diamond', { ...devices['iPhone 12 Pro'] });
    const box = await page.locator('#chart [data-id]').first().boundingBox();
    await page.tap('#chart', { position: { x: 0, y: 0 } }).catch(() => {});
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    assert.deepEqual(errors, []);
    await context.close();
    const lad = await open(browser, base.replace('labels=auto', 'labels=ladder') + '&colorBy=y&dual=lines');
    const fills = await lad.page.evaluate(() => [...document.querySelectorAll('#chart .ladder-btn text')].map((t) => t.getAttribute('fill')));
    assert.ok(fills.length && new Set(fills).size > 1, 'ladder names in lab colors');
    const dot = await lad.page.locator('#chart [data-id]').first().boundingBox();
    await lad.page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2);
    await lad.page.waitForSelector('#tooltip', { state: 'visible' });
    assert.deepEqual(lad.errors, []);
    await lad.context.close();
    ok('diamond on a phone, ladder, hover');
  }
  await browser.close();
  console.log(`${passed} checks passed.`);
})().catch((e) => { console.error(e); process.exit(1); });
