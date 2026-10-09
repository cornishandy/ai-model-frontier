// Run with node tests/pinned-areas.cjs while this worktree is served (FRONTIER_URL, default port 8780).
// Covers "1.0 =" a model (lists, URL, saved sets, right-click, off-chart), Guides → Pinned area, Good zone None and
// colours, and Values → frontier only. PLAYWRIGHT_PATH can point at another Playwright installation.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/tmp/pw/node_modules/playwright');
const assert = require('node:assert/strict');
const origin = process.env.FRONTIER_URL || 'http://localhost:8780/index.html';
const hook = 'window.__t = {S, render, snapshot, applySet, fixAxes, syncControls, get geom(){return lastGeom}, get points(){return lastPoints}};';
const OPUS = 'model:claude-opus-5-5:xhigh';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const passed = [];
  async function scenario(name, query, run, { viewport = { width: 1280, height: 900 } } = {}) {
    const context = await browser.newContext({ viewport });
    await context.route('https://api.github.com/gists/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"files":{}}' }));
    await context.addInitScript(() => { if (!localStorage.getItem('aa-charts:collapsed-groups')) localStorage.setItem('aa-charts:collapsed-groups', '{}'); });
    await context.route('**/index.html*', async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replace('  // ---------- boot ----------', hook + '\n  // ---------- boot ----------') });
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(origin + query);
    await page.waitForFunction(() => window.__t?.geom);
    await run(page);
    assert.deepEqual(errors, [], `${name}: no page or console errors`);
    passed.push(name); console.log('PASS', name);
    await context.close();
  }
  const ev = (page, fn, arg) => page.evaluate(fn, arg);

  await scenario('1.0 = a model from the URL, both axes', `?theme=light&xRel=${OPUS}&yRel=${OPUS}`, async (page) => {
    const r = await ev(page, () => ({ x: __t.geom.X.ref, y: __t.geom.Y.ref, title: document.querySelector('#chartTitle').textContent,
      note: document.querySelector('#relativeNote').textContent, sel: document.querySelector('#xRel').value,
      groups: [...document.querySelectorAll('#xRel optgroup')].map((g) => g.label), ring: document.querySelectorAll('.reference-dot').length }));
    assert.equal(r.x.key, 'model'); assert.equal(r.y.key, 'model'); assert.equal(r.sel, 'model:claude-opus-5-5:xhigh');
    assert.match(r.title, /× Claude Opus 5\.5 xhigh/); assert.match(r.note, /X: 1\.0 = Claude Opus 5\.5 xhigh \(\$/);
    assert.deepEqual(r.groups, ['A model on the chart']); assert.equal(r.ring, 1);
    const p = await ev(page, () => { const p = __t.points.find((q) => q.m.family === 'claude-opus-5-5' && q.m.effort === 'xhigh'); return [p.xv, p.yv]; });
    assert.ok(Math.abs(p[0] - 1) < 1e-9 && Math.abs(p[1] - 1) < 1e-9, 'the reference dot sits at 1.0 on both axes');
  });

  await scenario('saved sets and pins keep a model reference; the compare tooltip names it', `?theme=light&xRel=${OPUS}`, async (page) => {
    const r = await ev(page, () => {
      const snap = JSON.parse(JSON.stringify(__t.snapshot())); __t.S.xRel = 'off'; __t.render(); const off = __t.geom.X.ref;
      __t.applySet(snap); return { snapRel: snap.xRel, off, after: __t.geom.X.ref?.key, sel: document.querySelector('#xRel').value };
    });
    assert.equal(r.snapRel, OPUS); assert.equal(r.off, undefined); assert.equal(r.after, 'model'); assert.equal(r.sel, OPUS);
    // pin one dot, hover another: the tooltip's ratio line names the reference model
    const [a, b] = await ev(page, () => { const box = document.querySelector('#chart').getBoundingClientRect(), ps = __t.points.filter((p) => p.m.family === 'gpt-6-sol');
      return ps.slice(0, 2).map((p) => [box.left + p.px, box.top + p.py]); });
    await page.mouse.click(...a); await page.mouse.move(...b); await page.waitForTimeout(150);
    const tip = await ev(page, () => document.querySelector('#tooltip').textContent);
    assert.match(tip, /of Claude Opus 5\.5 xhigh/);
  });

  await scenario('a reference that leaves the chart keeps its value and says so', `?theme=light&xRel=${OPUS}&yRel=${OPUS}`, async (page) => {
    const before = await ev(page, () => __t.geom.X.ref.value);
    const r = await ev(page, () => { for (const id of [...__t.S.selected]) if (id && __t.points.find((p) => p.m.id === id)?.m.family === 'claude-opus-5-5') __t.S.selected.delete(id); __t.render();
      return { ref: __t.geom.X.ref, note: document.querySelector('#relativeNote').textContent, groups: [...document.querySelectorAll('#xRel optgroup')].map((g) => g.label), sel: document.querySelector('#xRel').value, ring: document.querySelectorAll('.reference-dot').length }; });
    assert.equal(r.ref.value, before); assert.equal(r.ref.offChart, true); assert.match(r.note, /isn’t on the chart/);
    assert.ok(r.groups.includes('Not on the chart')); assert.equal(r.sel, OPUS); assert.equal(r.ring, 0);
  });

  await scenario('off-chart reference on "Your index" cost', `?theme=light&basis=B&x=myCost&xRel=${OPUS}`, async (page) => {
    const r = await ev(page, () => { const k = __t.S.x; for (const id of [...__t.S.selected]) if (__t.points.find((p) => p.m.id === id)?.m.family === 'claude-opus-5-5') __t.S.selected.delete(id); __t.render();
      return { k, ref: __t.geom.X.ref, note: document.querySelector('#relativeNote').textContent }; });
    if (r.ref) { assert.equal(r.ref.offChart, true); assert.ok(r.ref.value > 0); }
    else assert.match(r.note, /Original units shown|no .* data/);
  });

  await scenario('a model that left the data falls back to Off', '?theme=light&xRel=model:no-such-family:high', async (page) => {
    assert.equal(await ev(page, () => __t.S.xRel), 'off');
  });

  await scenario('right-click a dot: use it as 1.0, then stop', '?theme=light', async (page) => {
    const xy = await ev(page, () => { const box = document.querySelector('#chart').getBoundingClientRect(), p = __t.points.find((q) => q.m.family === 'gpt-6-sol' && q.m.effort === 'high'); return [box.left + p.px, box.top + p.py]; });
    await page.mouse.click(...xy, { button: 'right' });
    await page.locator('.ctx-item', { hasText: 'Use as 1.0 on X' }).click();
    assert.equal(await ev(page, () => [__t.S.xRel, __t.S.yRel].join()), 'model:gpt-6-sol:high,off');
    await page.mouse.click(...(await ev(page, () => { const box = document.querySelector('#chart').getBoundingClientRect(), p = __t.points.find((q) => q.m.family === 'gpt-6-sol' && q.m.effort === 'high'); return [box.left + p.px, box.top + p.py]; })), { button: 'right' });
    await page.locator('.ctx-item', { hasText: 'Stop using as 1.0' }).click();
    assert.equal(await ev(page, () => __t.S.xRel), 'off');
  });

  await scenario('model list right-click: any effort as 1.0 on both axes', '?theme=light', async (page) => {
    await page.locator('#modelList .fam-name[data-fam="claude-fable-5-1"]').first().click({ button: 'right' });
    const items = await page.locator('.ctx-item').allTextContents();
    assert.ok(items.some((t) => /^Use .+ as 1\.0 on both axes$/.test(t)), items.join(' | '));
    await page.locator('.ctx-item', { hasText: /as 1\.0 on both axes/ }).first().click();
    const r = await ev(page, () => [__t.S.xRel, __t.S.yRel, __t.geom.X.ref?.key]);
    assert.ok(r[0].startsWith('model:claude-fable-5-1:') && r[0] === r[1] && r[2] === 'model', r.join());
  });

  await scenario('Pinned area: tint, hatch, gradient and none, in model colour or grey', '?theme=light&guides=pinned&pin=claude-opus-5-5:xhigh', async (page) => {
    const area = () => ev(page, () => [...document.querySelectorAll('#guideLayer polygon')].map((p) => [p.getAttribute('fill'), p.getAttribute('fill-opacity')]));
    const set = (k, v) => ev(page, ([k, v]) => { __t.S[k] = v; __t.render(); }, [k, v]);
    const opus = await ev(page, () => __t.points.find((p) => p.m.family === 'claude-opus-5-5' && p.m.effort === 'xhigh').color);
    let a = await area(); assert.equal(a.length, 1); assert.equal(a[0][0], opus);
    await set('guideBox', 'hatch'); a = await area(); assert.match(a[0][0], /^url\(#guideArea\d+\)$/);
    await set('guideBox', 'gradient'); a = await area(); assert.match(a[0][0], /^url\(#guideArea\d+\)$/);
    await set('guideBoxColor', 'grey'); await set('guideBox', 'tint'); a = await area(); assert.notEqual(a[0][0], opus);
    await set('guideBox', 'none'); a = await area(); assert.equal(a.length, 0);
    assert.ok(await ev(page, () => document.querySelectorAll('#guideLayer line').length) >= 2, 'the guide lines stay');
    // hovering a dot follows the same setting
    const xy = await ev(page, () => { const box = document.querySelector('#chart').getBoundingClientRect(), p = __t.points.find((q) => q.m.family === 'gpt-6-sol'); return [box.left + p.px, box.top + p.py]; });
    await page.mouse.move(...xy); await page.waitForTimeout(150);
    assert.equal(await ev(page, () => document.querySelectorAll('#hoverLayer polygon').length), 0);
    // the control hides when guides run to one axis
    await page.locator('#guideAxisSeg [data-v="x"]').click();
    assert.equal(await page.locator('.group[data-g="guideBox"]').isVisible(), false);
  });

  await scenario('Good zone None draws no area; Beats pinned keeps its lines; Model colour per pin', '?theme=light&zone=beats&pin=claude-opus-5-5:xhigh,gpt-6-sol:high', async (page) => {
    const set = (k, v) => ev(page, ([k, v]) => { __t.S[k] = v; __t.render(); }, [k, v]);
    await set('zoneStyle', 'none');
    let r = await ev(page, () => ({ polys: document.querySelectorAll('#chart g[clip-path] > polygon').length, legend: document.querySelector('#legend').textContent, sw: document.querySelector('.legend i.zone-sw')?.getAttribute('style') }));
    assert.match(r.legend, /better than a pinned model/); assert.match(r.sw, /repeating-linear-gradient/);
    const lines = await ev(page, () => [...document.querySelectorAll('line[stroke-dasharray="3 4"]')].length);
    assert.ok(lines >= 4, `two lines per pin (${lines})`);
    for (const z of ['quadrant', 'near', 'top', 'knee', 'diagonal']) { await set('zone', z); const html = await ev(page, () => document.querySelector('#chart').innerHTML); assert.ok(!/fill="undefined"|style="undefined"/.test(html), z); }
    await set('zone', 'beats'); await set('zoneStyle', 'hatch'); await set('zoneColor', 'model');
    r = await ev(page, () => [...document.querySelectorAll('pattern[id^="zoneHatch"]')].map((p) => p.firstChild.getAttribute('stroke')));
    assert.equal(r.length, 2); assert.notEqual(r[0], r[1]);
    assert.equal(await page.locator('#zoneColorSeg [data-v="model"]').isDisabled(), false);
    await page.locator('#zoneSeg [data-v="quadrant"]').click();
    assert.equal(await page.locator('#zoneColorSeg [data-v="model"]').isDisabled(), true);
  });

  await scenario('Values: frontier only', '?theme=light&valueLabels=y', async (page) => {
    const count = () => ev(page, () => [...document.querySelectorAll('#chart text tspan, #chart text')].filter((t) => /^\d+\.\d$/.test(t.textContent.trim().split(' · ').pop())).length);
    const all = await count();
    await page.locator('#valueFront').check();
    const front = await count(), size = null;
    assert.ok(front > 0 && front < all, `${front} of ${all}`);
    await page.locator('#paretoSeg [data-v="off"]').click();
    assert.equal(await count(), front, 'with Pareto off, values follow the shown models\' frontier');
    await page.locator('#valueSeg [data-v="off"]').click();
    assert.equal(await page.locator('#valueFrontLabel').isVisible(), false);
    void size;
  });

  await scenario('phone: the 1.0 list shows a model name', `?theme=dark&xRel=${OPUS}`, async (page) => {
    await page.locator('#optsBtn, [aria-controls="opts"], .opts-btn').first().click().catch(() => {});
    const r = await ev(page, () => { const s = document.querySelector('#xRel'); return { w: s.getBoundingClientRect().width, text: s.selectedOptions[0].textContent, inMobile: !!s.closest('#relativeMobile') }; });
    assert.equal(r.inMobile, true); assert.equal(r.text, 'Claude Opus 5.5 xhigh');
  }, { viewport: { width: 390, height: 844 } });

  await browser.close();
  console.log(`${passed.length} scenarios passed`);
})().catch((e) => { console.error(e); process.exit(1); });
