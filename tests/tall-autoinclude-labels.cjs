// Run with node tests/tall-autoinclude-labels.cjs while this worktree is served on port 8773.
// FRONTIER_URL and PLAYWRIGHT_PATH can override the local server and Playwright installation.
// Covers the Tall shape, Also show, value forms by the dots, the bold name at the highest X with small-caps tags,
// and plan cost per task. Checks read today's data from the page instead of naming models and values.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/tmp/pw/node_modules/playwright');
const assert = require('node:assert/strict');
const origin = process.env.FRONTIER_URL || 'http://localhost:8773/index.html';
const hook = `window.__tall = {get S(){return S}, get ALL(){return ALL}, METRICS, render, updateData, get data(){return DATA}, get points(){return lastPoints}, get geom(){return lastGeom}};`;
const results = [], errors = [];

async function scenario(browser, name, viewport, query, run) {
  const context = await browser.newContext({ viewport });
  // The saved-set sync is outside this feature; keep remote API throttling out of local UI checks.
  await context.route('https://api.github.com/gists/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ files: { 'aa-charts-sync.json': { content: '{"sets":{}}' } } }) }));
  // Shape starts folded on a first visit; these checks use its controls directly.
  await context.addInitScript(() => { if (!localStorage.getItem('aa-charts:collapsed-groups')) localStorage.setItem('aa-charts:collapsed-groups', '{}'); });
  await context.route('**/index.html*', async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replace('  // ---------- boot ----------', hook + '\n  // ---------- boot ----------');
    await route.fulfill({ response, body: html });
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/api\.github\.com|Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
  await page.goto(origin + '?noAutoUpdate&' + query);
  await page.waitForFunction(() => window.__tall && document.querySelector('#chart circle[data-id]'));
  await run(page);
  assert.deepEqual(errors, [], 'No page or console errors');
  results.push(name); console.log('PASS', name);
  await context.close();
}

const chartBox = (page) => page.evaluate(() => { const r = document.getElementById('chart').getBoundingClientRect(), g = window.__tall.geom; return { w: Math.round(r.width), h: Math.round(r.height), aspect: g.PH / g.PW }; });
const tick = (page, id, on) => page.evaluate(([id, on]) => { const c = document.getElementById(id); if (c.checked !== on) c.click(); }, [id, on]);
const choose = (page, sel, v) => page.evaluate(([sel, v]) => { const s = document.querySelector(sel); s.value = v; for (const t of ['input', 'change']) s.dispatchEvent(new Event(t, { bubbles: true })); }, [sel, v]);

(async () => {
  const browser = await chromium.launch();
  const desk = { width: 1440, height: 900 };

  await scenario(browser, 'tall-desk-fits-the-window', desk, 'shape=tall&tallRatio=2', async (p) => {
    const a = await chartBox(p);
    assert.ok(a.h <= 900 && a.h >= 480, `Tall fills the window's height without overflowing it (${a.h})`);
    assert.ok(Math.abs(a.aspect - 2) < 0.05, `At aspect 2.0 the plot is twice as tall as wide (${a.aspect.toFixed(2)})`);
    await choose(p, '#tallRatio', '3'); await p.waitForTimeout(200); const b = await chartBox(p); // the slider redraws on the next frame
    assert.ok(b.w < a.w && Math.abs(b.h - a.h) <= 4 && Math.abs(b.aspect - 3) < 0.08, `Aspect 3.0 is narrower at the same height (${b.w}×${b.h}, ${b.aspect.toFixed(2)})`);
    await choose(p, '#tallRatio', '2'); await p.waitForTimeout(200);
    await p.setViewportSize({ width: 1440, height: 1200 }); await p.waitForTimeout(400);
    assert.ok((await chartBox(p)).h > a.h, 'A height-only resize redraws Tall taller');
    await p.setViewportSize(desk); await p.waitForTimeout(400);
    // Ticking Also show adds a line above the chart: the chart makes room at once, the same as a fresh load
    await tick(p, 'autoBest', true); await p.waitForTimeout(300);
    const ticked = await chartBox(p);
    await p.goto(origin + '?noAutoUpdate&shape=tall&tallRatio=2&autoBest=1'); await p.waitForFunction(() => document.querySelector('#chart circle[data-id]'));
    assert.equal(ticked.h, (await chartBox(p)).h, 'Ticking Also show refits Tall like a fresh load');
  });

  await scenario(browser, 'tall-phone-grows-down', { width: 430, height: 932 }, 'shape=tall&tallRatio=2', async (p) => {
    const a = await chartBox(p);
    assert.ok(a.h > a.w * 1.6 && Math.abs(a.aspect - 2) < 0.1, `On a phone Tall is about the width times the aspect (${a.w}×${a.h}, plot ${a.aspect.toFixed(2)})`);
    assert.match(await p.textContent('#tallRatioOut'), /2\.0× · \d+ px tall/);
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No sideways scroll');
  });

  await scenario(browser, 'also-show-within-percent-of-best', desk, 'autoBest=1&autoBestPct=4', async (p) => {
    const note = await p.textContent('#autoNote');
    const cut = +note.match(/at least ([\d.]+)/)[1];
    const { added, selected } = await p.evaluate(() => { const { points, S } = window.__tall; return { added: points.filter((q) => q.auto).map((q) => ({ id: q.m.id, y: q.yv, sel: S.selected.has(q.m.id) })), selected: S.selected.size }; });
    assert.ok(added.length > 0, 'Something is added at 4% of the best');
    for (const a of added) { assert.ok(a.y >= cut - 0.05, `${a.id} is within the rule (${a.y} vs ${cut})`); assert.equal(a.sel, false, `${a.id} is added, not selected`); }
    assert.equal(await p.locator('.auto-halo').count(), added.length, 'Each added dot gets a dashed ring');
    assert.match(note, new RegExp(`${selected} selected \\+ ${added.length} added`));
    await p.locator('#autoNote button', { hasText: 'Turn off' }).click(); await p.waitForTimeout(200);
    assert.equal(await p.locator('.auto-halo').count(), 0, 'Turn off removes the added dots');
  });

  await scenario(browser, 'also-show-names-who-left-after-a-data-update', desk, 'autoBest=1&autoBestPct=4', async (p) => {
    // A successful Update data replaces the data on show; an added model-effort that drops out must be named as having left.
    const r = await p.evaluate(async () => {
      const t = window.__tall, gone = t.points.find((q) => q.auto), d = structuredClone(t.data);
      d.models.find((m) => m.id === gone.m.id)[t.S.y] = 0;
      d.scrapedAt = new Date(Date.parse(d.scrapedAt) + 864e5).toISOString();
      window.AAData.scrape = async () => d;
      await t.updateData();
      return { label: gone.m.label, loaded: t.data.scrapedAt === d.scrapedAt, still: t.points.some((q) => q.auto && q.m.id === gone.m.id), note: document.getElementById('autoNote').textContent };
    });
    assert.ok(r.loaded, 'The simulated update loaded');
    assert.equal(r.still, false, `${r.label} leaves Also show`);
    assert.ok(r.note.includes('Since the data update') && r.note.includes('− ' + r.label), `The line names ${r.label} as having left: ${r.note}`);
  });

  await scenario(browser, 'also-show-within-points-of-y-1-and-select-these', desk, 'autoBase=1&autoBasePts=6&yRel=median', async (p) => {
    const note = await p.textContent('#autoNote');
    const [, lo, hi] = note.match(/so ([\d.]+) to ([\d.]+)\)/) || [];
    const added = await p.evaluate(() => window.__tall.points.filter((q) => q.auto).map((q) => q.m[window.__tall.S.y])); // raw Y; the axis is relative here
    assert.ok(added.length > 0 && lo && hi, `The points rule adds dots and states its range: ${note}`);
    for (const y of added) assert.ok(y >= +lo - 0.05 && y <= +hi + 0.05, `${y} is within ${lo}–${hi}`);
    const before = await p.evaluate(() => window.__tall.S.selected.size);
    await p.locator('#autoNote button', { hasText: 'Select these' }).click(); await p.waitForTimeout(300);
    const after = await p.evaluate(() => window.__tall.S.selected.size);
    assert.ok(after >= before + added.length, `Select these selects the added dots (${before} → ${after})`);
  });

  await scenario(browser, 'also-show-points-rule-pauses', desk, 'autoBase=1&yRel=median', async (p) => {
    await p.click('#selNone'); await p.waitForTimeout(300);
    assert.match(await p.textContent('#autoNote'), /points rule paused/);
    assert.equal(await p.textContent('#autoBaseRef'), "Y's 1.0 (paused)");
    assert.equal(await p.locator('.auto-halo').count(), 0);
  });

  await scenario(browser, 'value-forms-show-what-is-in-use', desk, 'valueLabels=both&valueAsY=vr&yRel=median', async (p) => {
    const st = () => p.evaluate(() => ['valueAsX', 'valueAsY', 'valueVsY'].map((id) => { const s = document.getElementById(id); return { v: s.value, t: s.selectedOptions[0]?.textContent, hidden: s.hidden }; }));
    let [x, y, vs] = await st();
    assert.equal(x.v, 'auto'); assert.match(x.t, /match axis$/, 'The closed X list shows the form in use');
    assert.equal(y.v, 'vr'); assert.match(y.t, /value \(×\)$/, 'The closed Y list shows the form in use');
    assert.equal(vs.hidden, false); assert.equal(vs.v, 'axis');
    assert.ok((await p.locator('#chart text').allTextContents()).some((t) => /\([\d.]+×\)/.test(t)), 'Dots show value (×)');
    await p.click('#selTop'); await p.waitForTimeout(300);
    [, y] = await st(); assert.equal(y.v, 'vr', 'A redraw keeps the picked form');
    // Each axis has its own vs list; with no 1.0 on that axis, its 1.0 option is greyed and "best shown" is used
    await choose(p, '#valueAsX', 'vr'); await p.waitForTimeout(200);
    const vx = await p.evaluate(() => { const s = document.getElementById('valueVsX'); return { hidden: s.hidden, v: s.value, axisOff: s.options[0].disabled, text: s.options[0].textContent }; });
    assert.deepEqual(vx, { hidden: false, v: 'best', axisOff: true, text: "vs X's 1.0" });
  });

  await scenario(browser, 'negative-times-values-take-a-true-minus', desk, 'y=omniscience&yRel=median&valueLabels=y&valueAsY=rel', async (p) => {
    const texts = await p.locator('#chart text').allTextContents();
    assert.deepEqual(texts.filter((t) => /-\d[\d.]*×/.test(t)), [], 'No × value or tick prints a hyphen for minus');
    const neg = await p.evaluate(() => window.__tall.points.some((q) => q.yv < 0));
    if (neg) assert.ok(texts.some((t) => /−\d[\d.]*×/.test(t)), 'Negative × values print a true minus');
    assert.doesNotMatch(await p.getAttribute('#smallCapsLabel', 'title'), /Priors/, 'The small-caps hover text says only what it does');
  });

  await scenario(browser, 'bold-name-sits-at-highest-x', desk, 'nameAt=maxX&x=outputSpeed', async (p) => {
    const { bold, expected } = await p.evaluate(() => {
      const byFam = new Map();
      for (const q of window.__tall.points) { const b = byFam.get(q.m.family); if (!b || q.xv > b.xv) byFam.set(q.m.family, q); }
      const expected = [...byFam.values()].map((q) => q.m.label.replace(/ \(([^)]*)\)$/, ' $1'));
      const bold = [...document.querySelectorAll('#chart text')].filter((t) => +t.getAttribute('font-weight') >= 650).map((t) => t.textContent);
      return { bold, expected };
    });
    assert.ok(bold.length >= 3, 'Bold names are drawn');
    for (const b of bold) assert.ok(expected.includes(b), `"${b}" is on its model's highest-X effort (${expected.join(', ')})`);
  });

  await scenario(browser, 'small-caps-follow-bold-and-remember-an-opt-out', desk, '', async (p) => {
    const st = () => p.evaluate(() => ['nameAtMaxX', 'smallCaps'].map((id) => +document.getElementById(id).checked).join(''));
    await tick(p, 'nameAtMaxX', true); assert.equal(await st(), '11', 'Ticking the bold name ticks small caps');
    await tick(p, 'nameAtMaxX', false); assert.equal(await st(), '00', 'Unticking it undoes that');
    await tick(p, 'smallCaps', true); await tick(p, 'nameAtMaxX', true); await tick(p, 'nameAtMaxX', false);
    assert.equal(await st(), '01', 'Small caps ticked by hand survive the bold name going on and off');
    await tick(p, 'smallCaps', false); await tick(p, 'nameAtMaxX', true);
    assert.equal(await st(), '10', 'Small caps unticked by hand stay off');
    await p.reload(); await p.waitForFunction(() => document.querySelector('#chart circle[data-id]'));
    await tick(p, 'nameAtMaxX', false); await tick(p, 'nameAtMaxX', true);
    assert.equal(await st(), '10', 'The opt-out survives a reload');
  });

  await scenario(browser, 'plan-cost-draws-only-models-with-plan-data', desk, 'x=planCost&xScale=log', async (p) => {
    await p.click('#selTop'); await p.waitForTimeout(400);
    const { drawn, noData } = await p.evaluate(() => {
      const { points, ALL, S } = window.__tall;
      return { drawn: points.map((q) => ({ label: q.m.label, v: q.m.planCost })), noData: ALL.filter((m) => S.selected.has(m.id) && m.costPerTask && m.planCost == null).map((m) => m.label) };
    });
    assert.ok(drawn.length > 0 && drawn.every((d) => Number.isFinite(d.v) && d.v > 0), 'Every drawn dot has a plan cost');
    const note = await p.textContent('#relativeNote');
    assert.match(note, /Real API Pricing/);
    for (const name of new Set(noData.map((l) => l.replace(/ \([^)]*\)$/, '')))) {
      assert.ok(note.includes(name), `The note names ${name}, which has no plan data`);
      assert.equal((note.match(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 1, `${name} is named once`);
    }
    assert.doesNotMatch(await p.textContent('#chartDesc'), /use API prices/, 'The description matches what the axis does');
    // One share per plan and model: within a family every effort's plan cost is the same multiple of its API cost
    const spread = await p.evaluate(() => {
      const r = new Map();
      for (const m of window.__tall.ALL) if (m.planCost != null && m.costPerTask) { const k = m.family, f = m.planCost / m.costPerTask; const v = r.get(k) || [f, f]; r.set(k, [Math.min(v[0], f), Math.max(v[1], f)]); }
      return [...r].filter(([, [lo, hi]]) => hi / lo > 1.0001).map(([k]) => k);
    });
    assert.deepEqual(spread, [], 'Every effort of a model uses the same plan share');
  });

  await scenario(browser, 'plan-pick-survives-a-saved-set', desk, 'x=planCost', async (p) => {
    const A = '#subPlansWrap select[data-lab=anthropic]';
    // a model that several of the lab's plans cover, so picking a plan moves its price
    const id = await p.evaluate(() => window.__tall.ALL.find((m) => m.creatorSlug === 'anthropic' && m.planCost != null && /median of [2-9]/.test(m.planInfo))?.id);
    assert.ok(id, 'An Anthropic model has data on several plans');
    const opus = () => p.evaluate((id) => window.__tall.ALL.find((m) => m.id === id).planCost, id);
    const median = await opus();
    const plans = await p.$$eval(`${A} option`, (o) => o.map((x) => x.value).filter((v) => v !== 'median'));
    assert.ok(plans.length >= 2, 'Anthropic has plans to pick');
    await choose(p, A, plans[0]); const first = await opus();
    p.once('dialog', (d) => d.accept('plan check')); await p.click('#setSave'); await p.waitForTimeout(200);
    await choose(p, A, plans[1]); assert.notEqual(await opus(), undefined);
    await choose(p, '#setSelect', 'plan check'); await p.waitForTimeout(300);
    assert.equal(await p.$eval(A, (s) => s.value), plans[0], 'Loading the set brings back its plan');
    assert.equal(await opus(), first, 'and its prices');
    // The median of a lab's plans sits between its cheapest and dearest plan
    const each = [];
    for (const plan of plans) { await choose(p, A, plan); each.push(await opus()); }
    assert.ok(Math.max(...each) > Math.min(...each) * 1.01, 'Picking a plan changes the price (the share is applied)');
    assert.ok(Number.isFinite(median) && median >= Math.min(...each) - 1e-12 && median <= Math.max(...each) + 1e-12, `Median ${median} lies within the plans' range ${Math.min(...each)}–${Math.max(...each)}`);
  });

  await browser.close();
  console.log(`${results.length} scenarios passed; ${errors.length} errors.`);
})().catch((e) => { console.error(e); process.exit(1); });
