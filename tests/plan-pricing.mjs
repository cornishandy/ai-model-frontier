// Unit & contract suite for subscription pricing, compiled allowances, geometry, footers, and typed projection.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { compileAllowances, serializeCatalog } from '../scripts/build-allowances.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PM = require(path.join(ROOT, 'plan-math.js'));

const CLOCK = '2026-11-23T05:00:00Z';

const sbCat = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'data/plan-allowances.js'), 'utf8'), sbCat);
const CAT = sbCat.window.PLAN_ALLOWANCES;

const sbModels = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'data/models.js'), 'utf8'), sbModels);
const LIVE_MODELS = sbModels.window.AA_DATA.models;

// Frozen 15-row current-frontier comparison replay (identical values to the Gate 1 design package)
const MODELS = [
  { id: 'claude-fable-5-2',        name: 'Claude Fable 5.2',  short: 'Fable 5.2',     family: 'claude-fable-5-2',  lab: 'anthropic', effort: 'max',   isEnd: true,  score: 64.563595756626,  costPerTask: 26.53855780398091 },
  { id: 'claude-fable-5-2-high',   name: 'Claude Fable 5.2',  short: 'Fable 5.2',     family: 'claude-fable-5-2',  lab: 'anthropic', effort: 'high',  isEnd: false, score: 61.8218785440284, costPerTask: 9.078414777860381 },
  { id: 'gpt-6-2-astra',           name: 'GPT-6.2 Astra',     short: 'GPT-6.2 Astra', family: 'gpt-6-2-astra',     lab: 'openai',    effort: 'max',   isEnd: true,  score: 62.1387990593969, costPerTask: 3.9979061566801852 },
  { id: 'gpt-6-2-astra-xhigh',     name: 'GPT-6.2 Astra',     short: 'GPT-6.2 Astra', family: 'gpt-6-2-astra',     lab: 'openai',    effort: 'xhigh', isEnd: false, score: 61.5602325371388, costPerTask: 2.5211433764120375 },
  { id: 'gemini-4-neon',           name: 'Gemini 4 Neon',     short: 'Neon',          family: 'gemini-4-neon',     lab: 'google',    effort: 'xhigh', isEnd: true,  score: 61.3982491392674, costPerTask: 6.444838101104699 },
  { id: 'gemini-4-carbon',         name: 'Gemini 4 Carbon',   short: 'Carbon',        family: 'gemini-4-carbon',   lab: 'google',    effort: 'high',  isEnd: true,  score: 60.025738829526,  costPerTask: 7.755545745286556 },
  { id: 'gemini-4-neon-high',      name: 'Gemini 4 Neon',     short: 'Neon',          family: 'gemini-4-neon',     lab: 'google',    effort: 'high',  isEnd: false, score: 59.6189441875232, costPerTask: 3.7427499092845027 },
  { id: 'claude-opus-5-5',         name: 'Claude Opus 5.5',   short: 'Opus 5.5',      family: 'claude-opus-5-5',   lab: 'anthropic', effort: 'max',   isEnd: true,  score: 59.1060336078904, costPerTask: 10.036409719512749 },
  { id: 'claude-opus-5-5-xhigh',   name: 'Claude Opus 5.5',   short: 'Opus 5.5',      family: 'claude-opus-5-5',   lab: 'anthropic', effort: 'xhigh', isEnd: false, score: 57.4447060170507, costPerTask: 6.047194490848774 },
  { id: 'gpt-6-2-sol',             name: 'GPT-6.2 Sol',       short: 'GPT-6.2 Sol',   family: 'gpt-6-2-sol',       lab: 'openai',    effort: 'max',   isEnd: true,  score: 57.2576209885477, costPerTask: 1.014379970300768 },
  { id: 'gpt-6-2-sol-xhigh',       name: 'GPT-6.2 Sol',       short: 'GPT-6.2 Sol',   family: 'gpt-6-2-sol',       lab: 'openai',    effort: 'xhigh', isEnd: false, score: 55.7351067246438, costPerTask: 0.6479676730055945 },
  { id: 'gemini-4-hydrogen',       name: 'Gemini 4 Hydrogen', short: 'Hydrogen',      family: 'gemini-4-hydrogen', lab: 'google',    effort: 'xhigh', isEnd: true,  score: 53.9192287317542, costPerTask: 3.1601590757006157 },
  { id: 'claude-sonnet-5-5-xhigh', name: 'Claude Sonnet 5.5', short: 'Sonnet 5.5',    family: 'claude-sonnet-5-5', lab: 'anthropic', effort: 'xhigh', isEnd: true,  score: 49.9240327787242, costPerTask: 4.091984916321919 },
  { id: 'grok-4-7',                name: 'Grok 4.7',          short: 'Grok 4.7',      family: 'grok-4-7',          lab: 'xai',       effort: 'xhigh', isEnd: true,  score: 35.4850117067196, costPerTask: 7.771539401587139 },
  { id: 'grok-4-7-high',           name: 'Grok 4.7',          short: 'Grok 4.7',      family: 'grok-4-7',          lab: 'xai',       effort: 'high',  isEnd: false, score: 35.2122962959703, costPerTask: 6.18359556537658 },
];

function makeMinimalValidPoints() {
  const lpA = { input: 5, cached: 0.25, output: 25 };
  const lpO = { input: 2, cached: 0.1, output: 10 };
  const lpG = { input: 2, cached: 0.2, output: 12 };
  return [
    { id: 'claude_pro::claude-opus-5-5', billing: 'subscription', price_usd: 20, real_usd_per_mtok: 0.015, workload: 'anthropic', confidence: 'high', data_date: '2026-11-20', list_price: lpA },
    { id: 'claude_max_5x::claude-opus-5-5', billing: 'subscription', price_usd: 100, real_usd_per_mtok: 0.015, workload: 'anthropic', confidence: 'high', data_date: '2026-11-20', list_price: lpA },
    { id: 'claude_max_20x::claude-opus-5-5', billing: 'subscription', price_usd: 200, real_usd_per_mtok: 0.0075, workload: 'anthropic', confidence: 'high', data_date: '2026-11-20', list_price: lpA },
    { id: 'claude_pro::claude-fable-5-2', billing: 'subscription', price_usd: 20, real_usd_per_mtok: 0.03, workload: 'anthropic', confidence: 'high', data_date: '2026-11-15', list_price: lpA },
    { id: 'chatgpt_plus::gpt-6-astra', billing: 'subscription', price_usd: 20, real_usd_per_mtok: 0.02, workload: 'standard', confidence: 'high', data_date: '2026-11-20', list_price: lpO },
    { id: 'chatgpt_pro_10x::gpt-6-astra', billing: 'subscription', price_usd: 100, real_usd_per_mtok: 0.01, workload: 'standard', confidence: 'high', data_date: '2026-11-20', list_price: lpO },
    { id: 'chatgpt_pro_20x::gpt-6-astra', billing: 'subscription', price_usd: 200, real_usd_per_mtok: 0.01, workload: 'standard', confidence: 'high', data_date: '2026-11-20', list_price: lpO },
    { id: 'chatgpt_plus::gpt-6-1-sol', billing: 'subscription', price_usd: 20, real_usd_per_mtok: 0.02, workload: 'standard', confidence: 'high', data_date: '2026-11-20', list_price: lpO },
    { id: 'chatgpt_pro_10x::gpt-6-1-sol', billing: 'subscription', price_usd: 100, real_usd_per_mtok: 0.01, workload: 'standard', confidence: 'high', data_date: '2026-11-20', list_price: lpO },
    { id: 'chatgpt_pro_20x::gpt-6-1-sol', billing: 'subscription', price_usd: 200, real_usd_per_mtok: 0.01, workload: 'standard', confidence: 'high', data_date: '2026-11-20', list_price: lpO },
    { id: 'google_ai_pro_us::gemini-4-neon', billing: 'subscription', price_usd: 19.99, real_usd_per_mtok: 0.02, workload: 'standard', confidence: 'high', data_date: '2026-11-20', list_price: lpG },
    { id: 'google_ai_pro_us::gemini-3-8-flash', billing: 'subscription', price_usd: 19.99, real_usd_per_mtok: 0.01, workload: 'standard', confidence: 'high', data_date: '2026-11-20', list_price: lpG },
  ];
}

test('1. Compiled schema v3 catalog, 4 labs x 13 plans, numeric warningCount, and bad ID/date rejection', () => {
  assert.equal(CAT.schemaVersion, 3);
  assert.equal(CAT.catalogDate, '2026-11-21');
  assert.equal(CAT.sourceRevision.slice(0, 8), '9c8ffc03');
  assert.equal(CAT.license, 'MIT');
  assert.equal(Object.keys(CAT.plans).length, 13);
  const labs = [...new Set(Object.values(CAT.plans).map(p => p.lab))].sort();
  assert.deepEqual(labs, ['anthropic', 'google', 'openai', 'xai']);
  assert.equal(typeof CAT.accounting.warningCount, 'number');
  assert.equal(
    CAT.accounting.directActive + CAT.accounting.scaledCompiled + CAT.accounting.predecessorCompiled + CAT.accounting.expiredCompiled,
    CAT.accounting.totalCompiledRows,
  );
  assert.equal(CAT.accounting.totalCompiledRows, 58);
  assert.equal('_cliWarnings' in CAT, false);
  assert.equal('warnings' in CAT.accounting, false);

  for (const [k, r] of Object.entries(CAT.allowances)) {
    assert.equal(k, `${r.planId}::${r.family}`);
    assert.equal(r.period, 'week');
    assert.equal(r.weeks, 4);
    if (r.status === 'active') {
      assert.ok(r.allowanceWk > 0 && Number.isFinite(r.allowanceWk));
      assert.ok(r.lane === 1 || r.lane === 2);
      assert.ok(Array.isArray(r.evidence?.ids) && r.evidence.ids.length >= 1);
    } else {
      assert.equal(r.status, 'expired');
      assert.equal(r.lane, null);
      assert.equal(r.allowanceWk, null);
    }
  }

  // Compiler rejects malformed 3-segment IDs and impossible calendar dates
  const synthetic = makeMinimalValidPoints().concat([
    { id: 'claude_pro::claude-opus-5-5::extra', billing: 'subscription', price_usd: 20, real_usd_per_mtok: 0.01, workload: 'anthropic', confidence: 'high', data_date: '2026-11-20', list_price: { input: 5, cached: 0.25, output: 25 } },
    { id: 'claude_pro::claude-haiku-9', billing: 'subscription', price_usd: 20, real_usd_per_mtok: 0.01, workload: 'anthropic', confidence: 'high', data_date: '2026-02-31', list_price: { input: 1, cached: 0.1, output: 5 } },
  ]);
  const cMut = compileAllowances(synthetic, LIVE_MODELS);
  assert.equal(cMut.accounting.rejectedInvalid, 2);
  assert.equal('claude_pro::claude-haiku-9' in cMut.allowances, false);
  assert.ok('claude_pro::claude-opus-5-5' in cMut.allowances);
});

test('2. Evidence precedence: active direct low-confidence beats proxy; expired promo beats direct', () => {
  assert.equal(CAT.allowances['claude_pro::claude-sonnet-5-5'].sourceClass, 'measured_low');
  assert.equal(CAT.allowances['claude_pro::claude-sonnet-5-5'].lane, 2);
  assert.equal(CAT.allowances['claude_pro::claude-fable-5-2'].status, 'expired');
  assert.equal(CAT.allowances['claude_pro::claude-fable-5-2'].lane, null);

  const synthetic = makeMinimalValidPoints().concat([
    { id: 'chatgpt_plus::gpt-6-2-sol', billing: 'subscription', price_usd: 20, real_usd_per_mtok: 0.02, workload: 'standard', confidence: 'low', data_date: '2026-11-22', list_price: { input: 2, cached: 0.1, output: 10 } },
  ]);
  const compiled = compileAllowances(synthetic, LIVE_MODELS);
  assert.equal(compiled.allowances['chatgpt_plus::gpt-6-2-sol'].sourceClass, 'measured_low');
  assert.equal(compiled.allowances['chatgpt_plus::gpt-6-2-sol'].lane, 2);
});

test('3. 15-row replay: exact lane counts, frontier steps, truthful scaled key, beyond (5/7 & 6/7), beaten (2/4 & 4/5), estimates-off omissions', () => {
  const runReplay = (preset, est = true) => {
    const prof = PM.getExampleProfile(CAT, preset, est);
    const items = MODELS.map(m => ({ ...m, price: PM.priceTask(CAT, m, prof, { price: 'plan', now: CLOCK }) }));
    return PM.evaluateComparison(items, { mode: 'plan' });
  };
  const entry = runReplay('entry', true);
  assert.equal(entry.lane1.length, 6);
  assert.equal(entry.lane2.length, 7);
  assert.equal(entry.omitted.length, 2);
  assert.equal(entry.hasScaledOnFrontier, false);
  assert.equal(entry.frontierKeyLabel, 'Pareto frontier (measured plans only)');
  assert.deepEqual(entry.frontierSteps.map(s => s.id), ['claude-opus-5-5-xhigh', 'claude-opus-5-5', 'gemini-4-neon-high', 'gemini-4-neon']);
  assert.equal(entry.beyondLane2.length, 5);
  assert.deepEqual(entry.beatenSteps.map(s => s.id), ['gemini-4-neon-high', 'gemini-4-neon']);

  const entryOff = runReplay('entry', false);
  assert.equal(entryOff.lane1.length, 6);
  assert.equal(entryOff.lane2.length, 0);
  assert.equal(entryOff.omitted.length, 9);
  assert.equal(entryOff.frontierKeyLabel, 'Pareto frontier');

  const heavy = runReplay('heavy', true);
  assert.equal(heavy.lane1.length, 8);
  assert.equal(heavy.lane2.length, 7);
  assert.equal(heavy.omitted.length, 0);
  assert.equal(heavy.hasScaledOnFrontier, true);
  assert.equal(heavy.frontierKeyLabel, 'Pareto frontier (measured & scaled plans; excludes ≈)');
  assert.deepEqual(heavy.frontierSteps.map(s => s.id), ['claude-opus-5-5-xhigh', 'gemini-4-neon-high', 'gemini-4-neon', 'claude-fable-5-2-high', 'claude-fable-5-2']);
  assert.equal(heavy.beyondLane2.length, 6);
  assert.deepEqual(heavy.beatenSteps.map(s => s.id), ['claude-opus-5-5-xhigh', 'gemini-4-neon-high', 'gemini-4-neon', 'claude-fable-5-2-high']);

  const heavyOff = runReplay('heavy', false);
  assert.equal(heavyOff.lane1.length, 8);
  assert.equal(heavyOff.lane2.length, 0);
  assert.equal(heavyOff.omitted.length, 7);
  assert.equal(heavyOff.frontierKeyLabel, 'Pareto frontier (measured & scaled plans; excludes ≈)');
});

test('4. Fable dual meters, fee & utilization invariance, zero fee, fmtFeeEcho, and strict parseFeeInput', () => {
  const fableMax = MODELS[0];
  const heavyShared = PM.getExampleProfile(CAT, 'heavy', true);
  const heavyOwn = { ...heavyShared, fableCap: 'own' };
  const s = PM.priceTask(CAT, fableMax, heavyShared, { price: 'plan', now: CLOCK });
  const o = PM.priceTask(CAT, fableMax, heavyOwn, { price: 'plan', now: CLOCK });
  assert.ok(Math.abs(s.planCost - 1.017912437) < 1e-6);
  assert.ok(Math.abs(o.planCost - 2.035824874) < 1e-6);
  assert.equal(PM.fmtPlanUsd(s.planCost), '$1.02');
  assert.equal(PM.fmtPct(s.pctSelected), '2.0%');
  assert.equal(PM.fmtPlanUsd(o.planCost), '$2.04');
  assert.equal(PM.fmtPct(o.pctSelected), '4.1%');
  assert.equal(s.tasksPerWeek, o.tasksPerWeek);
  assert.ok(Math.abs(s.tasksPerWeek - 24.560069447) < 1e-5);

  const halfUseCustomFee = { ...heavyShared, use: 0.5, plans: { ...heavyShared.plans, anthropic: { id: 'claude_max_20x', fee: 400 } } };
  const mod = PM.priceTask(CAT, fableMax, halfUseCustomFee, { price: 'pct', now: CLOCK });
  assert.ok(Math.abs(mod.planCost - s.planCost * 4) < 1e-9);
  assert.equal(mod.pctSelected, s.pctSelected);
  assert.equal(mod.tasksPerWeek, s.tasksPerWeek);

  const freePlan = { ...heavyShared, plans: { ...heavyShared.plans, anthropic: { id: 'claude_max_20x', fee: 0 } } };
  const z = PM.priceTask(CAT, fableMax, freePlan, { price: 'plan', now: CLOCK });
  assert.equal(z.omitted, false);
  assert.equal(z.planCost, 0);
  assert.equal(z.pctSelected, s.pctSelected);

  assert.equal(PM.fmtFeeEcho(20), '20');
  assert.equal(PM.fmtFeeEcho(19.9), '19.90');
  assert.equal(PM.fmtFeeEcho(19.99), '19.99');

  for (const bad of ['-5', '-1', 'abc', '100000.01', '100001', '20.123', '1,234.50', '1e3', '$200']) {
    const r = PM.parseFeeInput(bad);
    assert.equal(r.ok, false, `Expected parseFeeInput(${JSON.stringify(bad)}) to fail`);
    assert.equal(r.fee, null);
  }
  assert.deepEqual(PM.parseFeeInput(''), { ok: true, fee: null });
  assert.deepEqual(PM.parseFeeInput('0'), { ok: true, fee: 0 });
  assert.deepEqual(PM.parseFeeInput('19.99'), { ok: true, fee: 19.99 });
  assert.deepEqual(PM.parseFeeInput('19,99'), { ok: true, fee: 19.99 });
  assert.deepEqual(PM.parseFeeInput('100000'), { ok: true, fee: 100000 });
});

test('5. Unavailable task cost & Astra-only ~1.9x caveat scope', () => {
  const prof = PM.getExampleProfile(CAT, 'entry', true);
  const astra = MODELS.find(m => m.id === 'gpt-6-2-astra');
  for (const v of [null, undefined, 0, -1, NaN]) {
    assert.equal(PM.priceTask(CAT, astra, prof, { price: 'plan', apiCost: v, now: CLOCK }).reasonCode, 'unavailable_cost');
  }
  for (const [k, row] of Object.entries(CAT.allowances)) {
    const has19 = String(row.evidence?.caveat || '').includes('1.9×');
    assert.equal(has19, row.family === 'gpt-6-2-astra', `Unexpected 1.9x caveat on ${k}`);
  }
});

test('6. Weekly pool comparability: mixed-pool suppression vs sole-pool + other-pool Lane 2', () => {
  const entry = PM.getExampleProfile(CAT, 'entry', true);
  const mixed = PM.evaluateComparison(
    MODELS.map(m => ({ ...m, price: PM.priceTask(CAT, m, entry, { price: 'pct', now: CLOCK }) })),
    { mode: 'pct' },
  );
  assert.equal(mixed.comparable, false);
  assert.equal(mixed.frontierSteps.length, 0);

  const googleOnly = { plans: { google: { id: 'google_ai_pro_us', fee: null } }, use: 1, fableCap: 'shared', estimate: true };
  const gModels = MODELS.filter(m => m.lab === 'google');
  const gComp = PM.evaluateComparison(
    gModels.map(m => ({ ...m, price: PM.priceTask(CAT, m, googleOnly, { price: 'pct', now: CLOCK }) })),
    { mode: 'pct' },
  );
  assert.equal(gComp.comparable, true);
  assert.equal(gComp.soleLane1PoolLabel, 'Google AI Pro · Pro pool');
  assert.equal(gComp.hasOtherPoolLane2, true);
  assert.match(gComp.frontierKeyLabel, /Google AI Pro · Pro pool/);
  assert.equal(gComp.lane2.find(d => d.id === 'gemini-4-hydrogen').price.poolLabel, 'Google AI Pro · Fast pool');
});

test('7. Geometry clearances, initial price resolution (all legacy URL cases), and exact legacy-switch notices', () => {
  assert.equal(PM.PUBLIC_DEFAULT_ESTIMATES, true);
  assert.equal(PM.dotOuter(4.25, 'off'), 4.25);
  assert.equal(PM.dotOuter(4.25, 'ring'), 6.5);
  assert.equal(PM.dotOuter(4.25, 'off', { isLane2: true }), 10.25);
  assert.equal(PM.pinnedCompareRadius(4.25, 'off', { isLane2: false }), 10);
  assert.equal(PM.pinnedCompareRadius(6.5, 'ring', { isLane2: true }), 18.25);
  assert.equal(PM.hoverLabelOffset('ring', { isLane2: false }), 12);
  assert.equal(PM.hoverLabelOffset('ring', { isLane2: true }), 20.25);

  for (const r of [4.25, 5.5, 6.5]) {
    for (const dual of ['off', 'ring', 'split']) {
      for (const isLane2 of [false, true]) {
        const ro = PM.dotOuter(r, dual, { isLane2 });
        assert.ok((PM.effortSquareHalf(r, dual, { isLane2 }) - 1) - ro >= 1.5 - 1e-9);
      }
    }
  }

  assert.equal(PM.resolveInitialPrice({ hasSavedState: false }), 'plan');
  assert.equal(PM.resolveInitialPrice({ hasSavedState: true }), 'api');
  assert.equal(PM.resolveInitialPrice({ hasSavedState: true, savedPrice: 'pct' }), 'pct');
  assert.equal(PM.resolveInitialPrice({ hasSavedState: false, urlX: 'planCost' }), 'api');
  assert.equal(PM.resolveInitialPrice({ hasSavedState: false, urlX: 'planTasks' }), 'api');
  assert.equal(PM.resolveInitialPrice({ hasSavedState: false, urlY: 'planCost' }), 'api');
  assert.equal(PM.resolveInitialPrice({ hasSavedState: false, urlY: 'planTasks' }), 'api');
  assert.equal(PM.resolveInitialPrice({ hasSavedState: false, urlX: 'planCost', urlPrice: 'plan' }), 'plan');

  const both = PM.switchFromLegacyAxes({ x: 'planCost', y: 'planTasks', targetPrice: 'plan' });
  assert.deepEqual({ x: both.x, y: both.y, notice: both.notice }, { x: 'costPerTask', y: 'intelligence', notice: PM.DISCLOSURES.legacySwitchBoth });
  const singleToCost = PM.switchFromLegacyAxes({ x: 'intelligence', y: 'planTasks', targetPrice: 'pct' });
  assert.deepEqual({ x: singleToCost.x, y: singleToCost.y, notice: singleToCost.notice }, { x: 'intelligence', y: 'costPerTask', notice: PM.DISCLOSURES.legacySwitchCost });
  const yLegWithXCost = PM.switchFromLegacyAxes({ x: 'costPerTask', y: 'planTasks', targetPrice: 'plan' });
  assert.deepEqual({ x: yLegWithXCost.x, y: yLegWithXCost.y, notice: yLegWithXCost.notice }, { x: 'costPerTask', y: 'intelligence', notice: PM.DISCLOSURES.legacySwitchIntel });
  const xLegWithYCost = PM.switchFromLegacyAxes({ x: 'planCost', y: 'myCost', targetPrice: 'plan' });
  assert.deepEqual({ x: xLegWithYCost.x, y: xLegWithYCost.y, notice: xLegWithYCost.notice }, { x: 'intelligence', y: 'myCost', notice: PM.DISCLOSURES.legacySwitchIntel });
});

test('8. SI-28 320px omission footers (1-, 2-, 3-, and 4-reason) preserve exact row conservation', () => {
  const meas = (t) => t.length * 4.8;
  const entryOff = PM.getExampleProfile(CAT, 'entry', false);
  const twoReason = MODELS.map(m => ({ ...m, price: PM.priceTask(CAT, m, entryOff, { price: 'plan', now: CLOCK }) })).filter(x => x.price.omitted);
  assert.equal(twoReason.length, 9);

  const r2 = PM.formatOmissionFooter(twoReason, 300, meas);
  assert.equal(r2.fits, true);
  assert.equal(r2.representedRows + r2.hiddenRows, 9);
  assert.equal(r2.groups.length, 2);
  assert.match(r2.text, /Estimates off: 7 hidden/i);

  const threeReason = [
    ...twoReason.slice(0, 2),
    { name: 'Kimi K3', short: 'Kimi K3', price: { reasonCode: 'no_plan', shortReason: 'No Kimi plan selected' } },
    { name: 'Claude Fable 5.1', short: 'Fable 5.1', price: { reasonCode: 'missing_allowance', shortReason: 'No audited data on Claude Pro' } },
  ];
  const r3 = PM.formatOmissionFooter(threeReason, 300, meas);
  assert.equal(r3.fits, true);
  assert.equal(r3.representedRows + r3.hiddenRows, 4);

  const fourReason = [
    ...twoReason,
    { name: 'Kimi K3', short: 'Kimi K3', price: { reasonCode: 'no_plan', shortReason: 'No Kimi plan selected' } },
    { name: 'Kimi K3.1', short: 'Kimi K3.1', price: { reasonCode: 'no_plan', shortReason: 'No Kimi plan selected' } },
    { name: 'Claude Fable 5.1', short: 'Fable 5.1', price: { reasonCode: 'missing_allowance', shortReason: 'No audited data on Claude Pro' } },
  ];
  const r4 = PM.formatOmissionFooter(fourReason, 300, meas);
  assert.equal(r4.fits, true);
  assert.equal(r4.representedRows + r4.hiddenRows, 12);
  assert.equal(r4.collapsedToSummary, true);
  assert.match(r4.text, /12 rows across 4 reasons/);
  assert.equal(/see chart list/i.test(r4.text), false);
});

test('9. Typed scrubSet covers 100% of live index.html snapshot() keys (63 typed, 0 untyped), host enums, ext:*, 4-seg model refs, and strips sentinels', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const m = html.match(/function snapshot\(\)\s*\{\s*return\s*\{([\s\S]*?)\};\s*\}/);
  assert.ok(m, 'Missing snapshot() in index.html');
  const liveKeys = [...m[1].matchAll(/([a-zA-Z0-9_]+)\s*:/g)].map(x => x[1]);
  assert.equal(liveKeys.length, 63);
  assert.ok(liveKeys.includes('price'));
  assert.deepEqual(PM.validateSnapshotCoverage(liveKeys), { totalTyped: 63, publicCount: 62, localCount: 1 });

  const extAndModelRefs = {
    x: 'ext:weirdml',
    y: 'ext:arcAgi3',
    rowMetric: 'ext:weirdml',
    customWeights: { 'ext:weirdml': 1, gpqa: 2 },
    autoPts: { 'ext:weirdml': 125, intelligence: 400 },
    xRel: 'model:claude-opus-5-5:xhigh',
    yRel: 'model:claude-opus-5-5:max:claude-opus-5-5-202611',
  };
  assert.deepEqual(PM.scrubSet(extAndModelRefs), extAndModelRefs);

  const hostEnumSample = {
    x: 'costPerTask', y: 'intelligence', price: 'pct',
    xScale: 'sqrt', yScale: 'logit', pareto: 'line', frontStyle: 'rings',
    guides: 'frontier', guideAxes: 'x', guideBox: 'hatch', guideBoxColor: 'grey',
    labels: 'autoplus', ladderAt: 'xhigh', colorBy: 'both', idColor: 'effort',
    dual: 'split', markEffort: 'max', markStyle: 'square', grid: 'faint',
    axisText: 'faint', glow: 'on', zone: 'diagonal', zoneStyle: 'gradient',
    zoneColor: 'grey', shape: 'tall', focus: 'pinned', basis: 'listed',
    rowLayout: 'bars', rowMetric: 'y', rowScale: 'log', lineStyle: 'off',
    valueLabels: 'x', extWithFamily: 'on', xRel: 'sweet', yRel: 'model:claude-opus-5-5:xhigh',
    ramp: 'diverge', nameAt: 'maxX', tallRatio: 2.5,
    valueAsX: 'vd', valueAsY: 'rv', valueVsX: 'best', valueVsY: 'axis',
    autoPts: { intelligence: 450, costPerTask: 125.5 }, autoBasePts: 1000, autoBestPct: 12.5,
  };
  assert.deepEqual(PM.scrubSet(hostEnumSample), hostEnumSample);

  const dirty = {
    x: 'costPerTask', y: 'intelligence', price: 'plan',
    subPlans: { anthropic: 'Claude Max 20x', sentinel: 'SENTINEL_LOCAL_PLAN' },
    planPrice: 200,
    estimate: false,
    selected: ['claude-opus-5-5', 'INVALID_SENTINEL', 'claude-opus-5-5'],
    efforts: ['xhigh', 'HACKED'],
    customWeights: { gpqa: 2, SENTINEL_WEIGHT: 99, badStr: '1' },
    autoPts: { intelligence: 1.5, evil: { nested: 'SENTINEL_NESTED' } },
    xScale: 'bogus',
    tallRatio: 999,
    unknownTopLevel: { secret: 'SENTINEL_TOP' },
  };
  const clean = PM.scrubSet(dirty, {
    validIds: new Set(['claude-opus-5-5']),
    validMetrics: new Set(['costPerTask', 'intelligence']),
    validBenchKeys: new Set(['gpqa']),
    validAutoKeys: new Set(['intelligence']),
  });
  assert.equal('subPlans' in clean, false);
  assert.equal('planPrice' in clean, false);
  assert.equal('estimate' in clean, false);
  assert.equal('unknownTopLevel' in clean, false);
  assert.equal('xScale' in clean, false);
  assert.equal('tallRatio' in clean, false);
  assert.deepEqual(clean.selected, ['claude-opus-5-5']);
  assert.deepEqual(clean.efforts, ['xhigh']);
  assert.deepEqual(clean.customWeights, { gpqa: 2 });
  assert.deepEqual(clean.autoPts, { intelligence: 1.5 });
  assert.equal(JSON.stringify(clean).includes('SENTINEL'), false);

  const coll = PM.scrubSetCollection({
    'My legacy view': dirty,
    __proto__: { evil: 1 },
  }, { validIds: new Set(['claude-opus-5-5']), validMetrics: new Set(['costPerTask', 'intelligence']), validBenchKeys: new Set(['gpqa']), validAutoKeys: new Set(['intelligence']) });
  assert.deepEqual(Object.keys(coll), ['My legacy view']);
  assert.equal('subPlans' in coll['My legacy view'], false);

  // Shape-only projection (ctx = {}) preserves cross-catalog model IDs/ext metrics and long set names (121 & 1001 chars), while stripping private fields
  const longName = 'A'.repeat(121);
  const veryLongName = 'B'.repeat(1001);
  const futureSet = {
    x: 'ext:futureBench2027',
    y: 'intelligence',
    price: 'plan',
    selected: ['future-model-2027-max'],
    pinned: ['future-model-2027-max'],
    customWeights: { 'ext:futureBench2027': 3 },
    subPlans: { anthropic: 'Claude Max 20x' },
    planPrice: 200,
    estimate: false,
    evilExtra: 'DROP',
  };
  const crossCat = PM.scrubSetCollection({ [longName]: futureSet, [veryLongName]: futureSet }, {});
  assert.deepEqual(Object.keys(crossCat).sort(), [longName, veryLongName].sort());
  assert.equal(crossCat[longName].x, 'ext:futureBench2027');
  assert.deepEqual(crossCat[longName].selected, ['future-model-2027-max']);
  assert.deepEqual(crossCat[longName].pinned, ['future-model-2027-max']);
  assert.deepEqual(crossCat[longName].customWeights, { 'ext:futureBench2027': 3 });
  assert.equal('subPlans' in crossCat[longName], false);
  assert.equal('planPrice' in crossCat[longName], false);
  assert.equal('estimate' in crossCat[longName], false);
  assert.equal('evilExtra' in crossCat[longName], false);

  // Decision 5 exact source label for predecessor estimates
  assert.equal(PM.formatSourceLabel('predecessor'), 'Estimated from similar model (≈)');

  // serializeCatalog rejects malformed or impossible-calendar dates & bad sourceRevision before comment interpolation
  assert.throws(() => serializeCatalog({ ...CAT, sourceRevision: 'bad\nwindow.X=1;' }), /Invalid sourceRevision/);
  assert.throws(() => serializeCatalog({ ...CAT, catalogDate: '2026-11-21\n//injected' }), /Invalid catalogDate/);
  assert.throws(() => serializeCatalog({ ...CAT, catalogDate: '2026-02-30' }), /Invalid catalogDate/);
  assert.throws(() => serializeCatalog({ ...CAT, catalogDate: '2026-04-31' }), /Invalid catalogDate/);

  // Shared standalone bundler rejects un-inlined scripts regardless of attribute order (e.g. <script defer src=...>)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimf-bundle-test-'));
  try {
    for (const rel of ['scoring.js', 'priors-fit.js', 'aa-data.js', 'plan-math.js', 'data/models.js', 'data/external.js', 'data/plan-shares.js', 'data/plan-allowances.js']) {
      const dst = path.join(tmpDir, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(dst, fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    }
    fs.writeFileSync(path.join(tmpDir, 'index.html'), html.replace('</body>', '<script defer src="missing-local.js"></script></body>'));
    const { buildStandalone } = await import(path.join(ROOT, 'scripts/build-standalone.mjs'));
    assert.throws(() => buildStandalone({ rootDir: tmpDir, outPath: path.join(tmpDir, 'out.html') }), /external <script src=>/);
    fs.writeFileSync(path.join(tmpDir, 'index.html'), html.replace('</body>', '<script data-probe=">" defer src="offline-probe.js"></script></body>'));
    assert.throws(() => buildStandalone({ rootDir: tmpDir, outPath: path.join(tmpDir, 'out.html') }), /external <script src=>/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  assert.match(fs.readFileSync(path.join(ROOT, 'scrape.mjs'), 'utf8'), /buildStandalone/, 'scrape.mjs must use shared scripts/build-standalone.mjs');
});

test('10. Local profile persistence, sanitization & malformed-storage recovery', () => {
  const mem = new Map();
  const fakeStorage = {
    getItem: (k) => mem.has(k) ? mem.get(k) : null,
    setItem: (k, v) => mem.set(k, String(v)),
  };
  const def = PM.loadLocalProfile(fakeStorage, CAT);
  assert.equal(def.plans.anthropic.id, 'claude_pro');
  assert.equal(def.estimate, PM.PUBLIC_DEFAULT_ESTIMATES);

  PM.saveLocalProfile(fakeStorage, {
    plans: {
      anthropic: { id: 'claude_max_20x', fee: 185.5 },
      openai: { id: 'chatgpt_pro_20x', fee: 0 },
      google: { id: 'bogus_plan_id', fee: -99 },
      xai: { id: 'none', fee: 50 },
    },
    use: 0.75,
    fableCap: 'own',
    estimate: false,
  }, CAT);
  const loaded = PM.loadLocalProfile(fakeStorage, CAT);
  assert.deepEqual(loaded.plans.anthropic, { id: 'claude_max_20x', fee: 185.5 });
  assert.deepEqual(loaded.plans.openai, { id: 'chatgpt_pro_20x', fee: 0 });
  assert.deepEqual(loaded.plans.google, { id: 'google_ai_pro_us', fee: null });
  assert.deepEqual(loaded.plans.xai, { id: 'none', fee: null });
  assert.equal(loaded.use, 0.75);
  assert.equal(loaded.fableCap, 'own');
  assert.equal(loaded.estimate, false);

  // Corrupt JSON falls back cleanly to Example entry
  fakeStorage.setItem(PM.PLANS_STORAGE_KEY, '{not valid json');
  assert.equal(PM.loadLocalProfile(fakeStorage, CAT).plans.anthropic.id, 'claude_pro');
});
