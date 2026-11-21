const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const playwright = process.env.PLAYWRIGHT_PATH || path.join(os.homedir(), 'Library/Caches/aaii-ladder/pw/node_modules/playwright');
const { chromium, webkit } = require(playwright);
const root = path.resolve(__dirname, '..');
const origin = 'http://aimf.localhost';
const hook = `window.__mixTest = {
  S, ALL, METRICS, deriveMix, applySet, snapshot, renderRows,
  rankedScores: () => Object.fromEntries(ALL.filter(m => !m.deprecated && !m.extOnly && m.myIndex != null).map(m => [m.id, m.myIndex])),
};`;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .replace('  // ---------- boot ----------', hook + '\n  // ---------- boot ----------');

async function scenario(browser, name, options) {
  const context = await browser.newContext(options);
  const errors = [];
  const requestLog = [];
  const files = new Set(['/aa-data.js', '/scoring.js', '/priors-fit.js', '/data/models.js', '/data/external.js', '/data/plan-shares.js']);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      if (url.hostname === 'api.github.com') return route.fulfill({ json: { files: {} } });
      requestLog.push(url.hostname);
      return route.fulfill({ status: 200, body: '' });
    }
    if (url.pathname === '/index.html') return route.fulfill({ body: html, contentType: 'text/html' });
    if (files.has(url.pathname)) return route.fulfill({ path: path.join(root, url.pathname), contentType: 'application/javascript' });
    return route.fulfill({ status: 200, body: '' });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const click = selector => page.locator(selector).click();
  const input = selector => page.locator(selector).inputValue();
  const readState = () => page.evaluate(() => JSON.parse(localStorage.getItem('aa-charts:state:v2')));
  const scrollTo = selector => page.locator(selector).evaluate(el => el.scrollIntoView({ block: 'start' }));
  const noOverflow = async () => {
    const overflow = await page.evaluate(() => ['html', 'main', '#rowsCard', '#mixCard', '#gradeCard', '.gtable'].flatMap(selector => {
      const el = document.querySelector(selector);
      return el.clientWidth && el.scrollWidth > el.clientWidth + 1 ? [[selector, el.clientWidth, el.scrollWidth]] : [];
    }));
    assert.deepEqual(overflow, []);
  };
  try {
    const url = origin + '/index.html?noAutoUpdate';
    await page.goto(url);
    assert.equal(await page.locator('#rowLayoutSeg [data-v=grouped]').getAttribute('aria-pressed'), 'true');
    const pills = await page.locator('#rowsCard .seg button').evaluateAll(buttons => buttons.map(el => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const label = range.getBoundingClientRect();
      const button = el.getBoundingClientRect();
      return {
        text: el.textContent,
        justify: getComputedStyle(el).justifyContent,
        height: button.height,
        offset: label.y + label.height / 2 - (button.y + button.height / 2),
      };
    }));
    assert.ok(pills.length > 0);
    for (const { text, justify, height, offset } of pills) {
      assert.equal(justify, 'center', text);
      assert.ok(height >= 44 && Math.abs(offset) <= 2, `${text}: ${height}px high, label offset ${offset}px`);
    }
    assert.ok(await page.locator('#groupedLegend').isVisible());
    assert.ok(await page.locator('.gfill').count() > 1);
    assert.ok(await page.locator('#rows [data-fam]').evaluateAll(rows => rows.every(row => {
      const pills = [...row.querySelectorAll('.effort-marker rect')].map(el => el.getBoundingClientRect());
      return pills.every((pill, i) => i === 0 || pill.left >= pills[i - 1].right);
    })));
    if (process.env.AIMF_SHOTS) {
      await scrollTo('#rowsCard');
      await page.screenshot({ path: path.join(process.env.AIMF_SHOTS, `grading-${name}-grouped.png`) });
    }

    await click('#rowLayoutSeg [data-v=bars]');
    assert.equal(await page.locator('#groupedLegend').isVisible(), false);
    const bars = await page.locator('.effort-bar').evaluateAll(elements => elements.slice(0, 6)
      .map(el => [Number(el.dataset.value), Number(el.getAttribute('width')), Number(el.getAttribute('x'))]));
    assert.ok(bars.length > 1 && bars[0][0] > 0);
    assert.ok(bars.every(([value, width, x]) => x === bars[0][2] && Math.abs(width / value - bars[0][1] / bars[0][0]) < 1e-8));
    await click('#rowLayoutSeg [data-v=grouped]');
    await page.goto(url + '&y=omniscience&rowMetric=y');
    assert.equal(await page.locator('.effort-zero').count(), 1);
    assert.equal(await page.locator('#groupedLegend').isVisible(), false);
    const signed = await page.evaluate(() => {
      const zero = +document.querySelector('.effort-zero').getAttribute('x1');
      return [...document.querySelectorAll('.effort-bar')].some(el => Number(el.dataset.value) < 0 && +el.getAttribute('x') < zero);
    });
    assert.ok(signed);

    await click('#rowMetricSeg [data-v=costPerTask]');
    await click('#rowScaleSeg [data-v=log]');
    assert.ok(await page.locator('.effort-log-dot').count() > 1);
    assert.equal(await page.locator('#groupedLegend').isVisible(), false);
    const log = await page.evaluate(() => {
      const values = [1, 10, 100, 0, undefined];
      __mixTest.renderRows(__mixTest.ALL.slice(0, values.length).map((m, i) => ({ ...m, costPerTask: values[i] })));
      return {
        x: [...document.querySelectorAll('.effort-log-dot')].map(el => +el.getAttribute('cx')),
        labels: [...document.querySelectorAll('#rows text')].map(el => el.textContent),
      };
    });
    assert.equal(log.x.length, 3);
    assert.ok(Math.abs((log.x[2] - log.x[1]) - (log.x[1] - log.x[0])) < 1e-8);
    assert.ok(log.labels.includes('missing') && log.labels.includes('≤0 (cannot plot on log)'));

    await click('#editMix');
    assert.ok(await page.locator('#mixCard').getAttribute('open') !== null);
    assert.match(await page.locator('#mixGrade option[value=B]').textContent(), /^19 B or better$/);
    assert.equal(await page.locator('#mixPreset option[value=""]').textContent(), 'Load preset…');
    await page.locator('#mixPreset').selectOption('B');
    assert.equal(await page.locator('#mixCard').getAttribute('data-basis'), 'B');
    const presetState = await readState();
    assert.equal(presetState.basis, 'B');
    const sliders = page.locator('#mixSliders input[type=range]');
    const slider = sliders.first();
    const sliderKey = await slider.getAttribute('data-weight');
    const nextKey = await sliders.nth(1).getAttribute('data-weight');
    const remove = page.locator(`#mixSliders .mix-remove[data-remove="${sliderKey}"]`);
    const target = await remove.boundingBox();
    assert.ok(target.width >= 44 && target.height >= 44);
    assert.match(await remove.getAttribute('aria-label'), /^Remove .+$/);
    await noOverflow();
    await remove.click();
    assert.equal(await page.locator(`#mixSliders [data-bench="${sliderKey}"]`).count(), 0);
    const expectedWeights = { ...presetState.customWeights };
    delete expectedWeights[sliderKey];
    const removedState = await page.evaluate(() => ({ basis: __mixTest.S.basis, weights: __mixTest.S.customWeights }));
    assert.deepEqual(removedState, { basis: 'custom', weights: expectedWeights });
    assert.equal(await page.evaluate(() => document.activeElement.dataset.weight), nextKey);
    await click('#mixUndo');
    assert.equal(await remove.count(), 1);
    assert.deepEqual(await readState(), presetState);

    assert.ok((await slider.boundingBox()).height >= 44);
    await slider.fill('78');
    assert.equal((await readState()).basis, 'custom');
    assert.equal((await readState()).customWeights[sliderKey], 2.43);
    await click('#mixUndo');
    assert.equal((await readState()).basis, 'B');
    const badge = page.locator('#mixSliders .pdetail summary').first();
    assert.ok((await badge.boundingBox()).height >= 44);
    await badge.click();
    assert.equal(await page.locator('#mixSliders .pdetail[open] .pbar span').count(), 6);
    assert.equal((await page.locator('#mixSliders .pdetail[open] .pmeta').innerText()).match(/Raw /g).length, 1);

    const lineup = page.locator('#fitLineup > li strong');
    const before = await lineup.allTextContents();
    const down = page.locator('#fitLineup [data-move="1"]').first();
    const button = await down.boundingBox();
    assert.ok(button.width >= 44 && button.height >= 44);
    await down.click();
    const moved = await lineup.allTextContents();
    assert.deepEqual(moved.slice(0, 2), before.slice(0, 2).reverse());
    if (!options.hasTouch) {
      const grip = page.locator('#fitLineup .fit-grip').first();
      await grip.scrollIntoViewIfNeeded();
      const from = await grip.boundingBox();
      const to = await page.locator('#fitLineup > li').nth(1).boundingBox();
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
      await page.mouse.up();
      assert.deepEqual(await lineup.allTextContents(), before);
    }
    assert.equal(await input('#fitGrade'), 'B');
    assert.equal(await input('#fitCover'), '0.75');
    assert.equal(await input('#fitMax'), '6');
    await click('#fitRun');
    await page.waitForFunction(() => /\d+\/\d+ requested pairs matched/.test(document.querySelector('#fitStatus').textContent));
    await page.waitForFunction(() => !document.querySelector('#fitApply').disabled);
    assert.match(await page.locator('#fitResults').innerText(), /overall #\d+ \(\d+\.\d\)/);
    const results = await page.locator('#fitResults li').allTextContents();
    const previewLabels = await lineup.allTextContents();
    await click('#fitApply');
    const applied = await page.evaluate(labels => {
      const scores = __mixTest.rankedScores();
      return labels.map(label => {
        const id = __mixTest.ALL.find(m => m.label === label && !m.deprecated && !m.extOnly)?.id;
        return scores[id]?.toFixed(1);
      });
    }, previewLabels);
    for (const [i, row] of results.entries()) {
      const score = row.match(/overall #\d+ \(\d+\.\d\)/)?.[0].split('(')[1].slice(0, -1);
      assert.equal(applied[i] ?? null, score ?? null);
    }
    const after = await readState();
    assert.equal(after.basis, 'custom');
    assert.ok(Object.keys(after.customWeights).length > 0 && Object.keys(after.customWeights).length <= 6);
    assert.match(await page.locator('#rowSubtitle').textContent(), /Ranked by your mix · \d+ benchmarks? · data as of/);
    const scores = await page.evaluate(() => __mixTest.rankedScores());
    if (process.env.AIMF_SHOTS) {
      await scrollTo('#mixCard');
      await page.screenshot({ path: path.join(process.env.AIMF_SHOTS, `grading-${name}-mix.png`) });
    }

    await click('#gradeCard > summary');
    const tableHard = page.locator('#gradeRows [data-bench=critptHard]');
    const chip = await tableHard.locator('.ii-tag').boundingBox();
    const title = await tableHard.locator('.col-head strong').boundingBox();
    if (options.viewport.width === 390) assert.ok(chip.y >= title.y + title.height);
    const grade = tableHard.locator('.pdetail summary');
    assert.ok((await grade.boundingBox()).height >= 44);
    await grade.click();
    assert.equal(await tableHard.locator('.pbar span').count(), 6);
    assert.doesNotMatch(await tableHard.locator('.pmeta').innerText(), /Raw /);
    assert.match(await tableHard.locator('.preason').innerText(), /Raw .+ → Final .+ · Excluded \(subcomponent/);
    const tableText = await page.locator('#gradeCard').innerText();
    assert.match(tableText, /MKA Climb WSR/);
    assert.match(tableText, /VIALS Score/);
    const rawKeys = await page.locator('#gradeRows > tr').evaluateAll(els => els.map(el => el.dataset.bench));
    assert.equal(rawKeys.length, 67);
    const visible = tableText + await page.locator('#mixCard').innerText();
    for (const key of rawKeys) {
      if (key.startsWith('ext:') || /[a-z][A-Z]/.test(key)) assert.ok(!visible.includes(key), `Leaked benchmark key ${key}`);
    }
    assert.doesNotMatch(visible, /Mka Climb Wsr|Vials Score|single-llm-judge|0\.0–-0\.0/);
    await noOverflow();
    if (process.env.AIMF_SHOTS) {
      await scrollTo('#gradeCard');
      await page.screenshot({ path: path.join(process.env.AIMF_SHOTS, `grading-${name}-table.png`) });
    }

    await page.reload();
    assert.equal(await page.locator('#mixCard').getAttribute('data-basis'), 'custom');
    assert.deepEqual(await page.evaluate(() => __mixTest.rankedScores()), scores);
    const roundtrip = await page.evaluate(() => {
      const snap = __mixTest.snapshot();
      __mixTest.applySet({ rowMetric: 'costPerTask' });
      const legacy = __mixTest.snapshot();
      __mixTest.applySet(snap);
      const restored = __mixTest.snapshot();
      return { legacy, restored };
    });
    assert.equal(roundtrip.legacy.basis, 'aa');
    assert.deepEqual(roundtrip.legacy.customWeights, {});
    assert.equal(roundtrip.legacy.rowLayout, 'grouped');
    for (const key of ['basis', 'basisFill', 'rowLayout', 'rowMetric', 'rowScale', 'customWeights']) {
      assert.deepEqual(roundtrip.restored[key], after[key]);
    }

    const shared = await page.evaluate(() => PriorsFit.serializeMix(__mixTest.S.customWeights));
    const params = new URLSearchParams({ noAutoUpdate: '', basis: 'custom', rowLayout: 'bars', mix: shared + ',__proto__:1,constructor:3,invalid:1' });
    await page.goto(origin + '/index.html?' + params);
    assert.equal(await page.locator('#rowLayoutSeg [data-v=bars]').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await page.evaluate(() => __mixTest.S.customWeights), after.customWeights);
    assert.deepEqual(await page.evaluate(() => __mixTest.rankedScores()), scores);

    await page.goto(origin + '/index.html?' + new URLSearchParams({ noAutoUpdate: '', basis: 'custom', mix: sliderKey + ':1' }));
    await click('#editMix');
    await slider.fill('0');
    await remove.click();
    assert.equal(await remove.count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'mixAdd');
    await click('#mixUndo');
    assert.equal(await remove.count(), 1);
    assert.equal(await slider.inputValue(), '0');
    assert.deepEqual(errors, []);
    assert.deepEqual(requestLog.filter(host => host === 'artificialanalysis.ai'), []);
    console.log(`PASS ${name}: chart scales and pill centering, preset and removal/Undo, lineup, fitter/apply/reload, grades, URL and no overflow or errors`);
  } finally { await context.close(); }
}

(async () => {
  const desktop = await chromium.launch();
  try {
    await scenario(desktop, 'desktop-dark', { colorScheme: 'dark', viewport: { width: 1280, height: 900 } });
    await scenario(desktop, 'desktop-light', { colorScheme: 'light', viewport: { width: 1280, height: 900 } });
  } finally { await desktop.close(); }
  const mobile = await webkit.launch();
  try {
    await scenario(mobile, 'mobile-390', { colorScheme: 'dark', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  } finally { await mobile.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
