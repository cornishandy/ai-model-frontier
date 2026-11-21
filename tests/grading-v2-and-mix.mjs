import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import '../aa-data.js';
import '../scoring.js';
import '../priors-fit.js';

globalThis.window = {};
await import('../data/models.js');
await import('../data/external.js');
const { AA_DATA, EXT_DATA } = window;
const {
  buildSnapshot, canonicalBenchLabel, computeP5a, createMixDeriver, famKey, gradeCatalog,
  reportCardFor, validateAuditEntry, weightHundredths, joinExternal, frontierFor,
} = FrontierScoring;
const { fitWeights, kendallTau, normalizeWeights, pairAgreement, parseMix, serializeMix, shannonEntropy,
  sharesFromWeights, trackToWeight, weightToTrack } = PriorsFit;

const cards = gradeCatalog(AA_DATA, EXT_DATA);
const byKey = key => reportCardFor(cards, key);
const eligibleB = cards.filter(card => card.eligible && ['A', 'B'].includes(card.letter));
assert.equal(new Set(cards.map(card => card.k)).size, cards.length);
for (const card of cards) {
  assert.match(card.reason, /^Raw (—|\d+) → .+ → Final (—|[ABCDF] \d+) · (Eligible|Excluded \([^)]+\)) · .+$/);
  if (card.score == null) {
    assert.equal(card.letter, '—');
    assert.equal(card.eligible, false);
    continue;
  }
  const pillars = [card.p1, card.p2, card.p3, card.p4, card.p5, card.p6];
  assert.ok(pillars.every((score, i) => Number.isInteger(score) && score >= 0 && score <= [25, 20, 20, 15, 10, 10][i]));
  assert.equal(card.rawSum, pillars.reduce((a, b) => a + b, 0));
  assert.equal(card.eligible, card.role === 'atomic' && !card.sup && card.active);
  assert.equal(card.letter, card.score >= 80 ? 'A' : card.score >= 65 ? 'B' : card.score >= 50 ? 'C' : card.score >= 35 ? 'D' : 'F');
  validateAuditEntry(card.k, card);
}
if (AA_DATA.scrapedAt === '2026-11-16T18:51:17.514Z') {
  assert.equal(cards.length, 67);
  assert.equal(eligibleB.length, 19);
  assert.deepEqual(Object.fromEntries([...new Set(cards.map(c => c.letter))].map(letter => [letter, cards.filter(c => c.letter === letter).length])),
    { A: 18, B: 14, C: 12, D: 13, F: 7, '—': 3 });
  // Frozen review fixture covers every score, pillar, cap, label and evidence chain.
  const fields = cards.map(c => [c.k, c.label, c.letter, c.rawSum, c.score, c.eligible, c.p1, c.p2, c.p3, c.p4, c.p5, c.p6, c.reason]);
  assert.equal(createHash('sha256').update(JSON.stringify(fields)).digest('hex'), 'a837381c53b2383d93f916182d07d5dad57cbc41b2a1ed6cfe86bdf5a2148a3b');
  assert.match(byKey('ext:gameArenaWerewolf').reason, /top 3: — \(no frontier models\)/);
}
assert.equal(byKey('critptV2').eligible, true);
assert.equal(byKey('critptHard').eligible, false);
assert.ok(Object.hasOwn(AA_DATA.indexWeights, 'critptHard'));
assert.deepEqual(buildSnapshot(AA_DATA, EXT_DATA).keys, eligibleB.map(card => card.k));
assert.deepEqual(computeP5a(4, 5, true, 5), { active: true, p5a: 6 });
assert.deepEqual(computeP5a(0, 4, true, 5), { active: false, p5a: 0 });
assert.deepEqual(computeP5a(4, 4, false, 5), { active: false, p5a: 0 });
assert.equal(new Set(['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6'].map(famKey)).size, 3);
assert.equal(famKey('OpenAI/GPT-6 Astra (High)'), famKey('gpt-6-astra'));
const exactFamilies = ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6'].map(family => ({ id: family, family, effort: 'default' }));
joinExternal(exactFamilies, [{ key: 'unit', rows: [{ fam: 'OpenAI/GPT-6 Astra', value: 0.8 }] }]);
assert.deepEqual(exactFamilies.map(m => m['ext:unit']), [0.8, undefined, undefined]);
const graceModel = { family: 'test', intelligence: 60, releaseDate: '2026-11-02' };
assert.equal(frontierFor([graceModel], '2026-11-15T23:59:59Z').fresh.has('test'), true);
assert.equal(frontierFor([graceModel], '2026-11-16T00:00:00Z').fresh.has('test'), false);
assert.doesNotThrow(() => validateAuditEntry('unit', { auditPenalty: 0 }));
assert.throws(() => validateAuditEntry('unit', { auditPenalty: -5 }), /Off-menu/);
assert.throws(() => validateAuditEntry('hle', { auditPenalty: -15, auditCite: ' ', auditSource: 'scoring.js AUD.hle' }), /untraceable/);
assert.throws(() => validateAuditEntry('hle', { auditPenalty: -15, auditCite: 'Audit', auditSource: 'scoring.js AUD.gpqa' }), /untraceable/);
assert.doesNotThrow(() => validateAuditEntry('hle', { auditPenalty: -15, auditCite: 'FutureHouse HLE audit', auditSource: 'scoring.js AUD.hle' }));
assert.match(byKey('healthbench').reason, /Single-LLM judge/);
assert.equal(canonicalBenchLabel('mkaClimbWsr', 'Mka Climb Wsr'), 'MKA Climb WSR');
assert.equal(canonicalBenchLabel('vialsScore', 'Vials Score'), 'VIALS Score');
assert.equal(byKey('mkaClimbWsr').reason, 'Raw — → Unaudited → Final — · Excluded (ungraded) · Auto-discovered');
const sparse = gradeCatalog({ ...AA_DATA, models: [{ family: 'one', hle: 0.8 }] });
assert.equal(reportCardFor(sparse, 'hle').reason, 'Raw — → Insufficient data (<3 models) → Final — · Excluded (insufficient data) · 1 model measured');
const phase = gradeCatalog({ ...AA_DATA, scrapedAt: '2032-01-01T00:00:00Z' }, EXT_DATA);
assert.ok(reportCardFor(phase, 'terminalBench40').p2 < byKey('terminalBench40').p2);
assert.doesNotMatch(fs.readFileSync(new URL('../scoring.js', import.meta.url), 'utf8'), /Date\.now\(/);
console.log(`PASS ${cards.length} Grading v2 rows, snapshot eligibility, canonical family joins, sourced audits, honest grace and snapshot-date scoring`);

const keys = ['frontierCode20', 'critptV2', 'ext:arcAgi3', '__proto__', 'constructor', 'toString'];
const weightsAt = (first, second) => ({ frontierCode20: trackToWeight(first), critptV2: trackToWeight(second) });
const pool = [
  { id: 'donor', family: 'test', frontierCode20: 0.70, critptV2: 0.6 },
  { id: 'partial', family: 'test', frontierCode20: 0.80 },
];
const derive = createMixDeriver(pool, (key, value) => value, (m, key) => m.id === 'partial' ? pool[0][key] : null);
assert.deepEqual(Object.values(sharesFromWeights([100, 50, 50].map(trackToWeight))), [67, 17, 17]);
assert.equal(weightToTrack(4), 100);
assert.equal(weightHundredths(Infinity), 0);
assert.equal(derive({ frontierCode20: 0.72, critptV2: 0.28 }).some(m => m.id === 'partial'), false);
assert.equal(derive({ frontierCode20: 0.75, critptV2: 0.25 }).find(m => m.id === 'partial').estShare, 0.25);
assert.equal(derive({ frontierCode20: 0.75, critptV2: 0.25 }, { fill: false }).find(m => m.id === 'partial').estShare, 0);
assert.equal(derive(weightsAt(14, 8)).some(m => m.id === 'partial'), false);
assert.equal(derive(weightsAt(23, 13)).find(m => m.id === 'partial').measuredPct, 75);
for (let t1 = 0; t1 <= 100; t1++) {
  for (let t2 = 0; t2 <= 100; t2++) {
    const input = weightsAt(t1, t2);
    const h1 = Math.round((t1 / 50) ** 2 * 100), h2 = Math.round((t2 / 50) ** 2 * 100);
    const expected = h1 + h2 > 0 && h1 * 100 >= 75 * (h1 + h2);
    const preview = derive(input);
    assert.equal(preview.some(m => m.id === 'partial'), expected, `coverage at ${t1},${t2}`);
    const qp = new URLSearchParams({ basis: 'custom', rowLayout: 'bars', mix: serializeMix(input) });
    assert.deepEqual(derive(parseMix(qp.get('mix'), keys)), preview, `URL reload at ${t1},${t2}`);
  }
}
assert.deepEqual(parseMix('ext:arcAgi3:2.43,__proto__:1,constructor:1,toString:1,unknown:3,critptV2:-4,frontierCode20:NaN', keys), { 'ext:arcAgi3': 2.43 });
assert.deepEqual(normalizeWeights(JSON.parse('{"__proto__":50,"constructor":2,"critptV2":0.706}')), { critptV2: 0.71 });
console.log('PASS all 10,201 track pairs, exact coverage, gap-fill exclusion, canonical shares and URL serialization');

const fitPool = [{ id: 'a', b1: 0.9, b2: 0.9, b3: 0.2 }, { id: 'b', b1: 0.6, b2: 0.7, b3: 0.4 }, { id: 'c', b1: 0.3, b2: 0.3 }];
const scoreMix = createMixDeriver(fitPool, (key, value) => value, () => 0.1);
const calls = [];
const targetIds = ['a', 'b', 'c'];
const result = await fitWeights({ targetIds, candidateKeys: ['b1', 'b2', 'b3', 'b1', 'constructor'], timeBudgetMs: 150, maxBenches: 2,
  deriveFn(weights) {
    assert.deepEqual(weights, normalizeWeights(weights));
    assert.ok(Object.keys(weights).length <= 2);
    calls.push(weights);
    return scoreMix(weights);
  },
});
assert.ok(calls.length > 3);
assert.deepEqual(calls.at(-1), result.weights, 'finalist is re-scored');
assert.deepEqual(result.ranked, scoreMix(parseMix(serializeMix(result.weights), ['b1', 'b2', 'b3'])));
assert.deepEqual(result.ag, { matched: 3, total: 3, weighted: 2.25, reversed: 0 });
assert.ok(Math.abs(result.entropy - Math.log(2)) < 1e-12, 'equal-weight winner maximizes entropy');
assert.equal(shannonEntropy({ a: 2, b: 2 }), Math.log(2));
assert.equal(kendallTau(targetIds, result.ranked), 1);
assert.equal(kendallTau(targetIds, [{ id: 'a', rank: 1 }, { id: 'b', rank: 1 }, { id: 'c', rank: 3 }]), null);
assert.equal(kendallTau(targetIds, [{ id: 'a', rank: 1 }, { id: 'b', rank: 2 }]), null);
assert.equal(pairAgreement(['a', 'b'], [{ id: 'a', rank: 2 }, { id: 'b', rank: 1 }]).matched, 0);
console.log('PASS derive-verified fit, max-entropy tie-break and Kendall tie/missing semantics');

const root = file => new URL('../' + file, import.meta.url);
const scrape = fs.readFileSync(root('scrape.mjs'), 'utf8');
const deploy = fs.readFileSync(root('.github/workflows/deploy.yml'), 'utf8');
assert.match(deploy, /cp index\.html aa-data\.js scoring\.js priors-fit\.js _site\//);
const inlineBlock = scrape.slice(scrape.indexOf('const inlineScript'), scrape.indexOf('const live = out.models'));
const writes = new Map();
vm.runInNewContext(inlineBlock, {
  fs: { readFileSync: (url, enc) => fs.readFileSync(url, enc), writeFileSync: (url, html) => writes.set(url.href, html) },
  here: root, out: AA_DATA, console: { log() {} },
});
const standalone = writes.get(root('AI Model Frontier.html').href);
assert.ok(standalone);
assert.doesNotMatch(standalone, /<script src=/);
const scriptContext = vm.createContext({ window: {} });
const scripts = [...standalone.matchAll(/<script>([\s\S]*?)<\/script>/g)];
scripts.forEach(([_, script]) => new vm.Script(script));
for (const [_, script] of scripts.filter(([, code]) => code.includes('globalThis.FrontierScoring =') || code.includes('globalThis.PriorsFit ='))) vm.runInContext(script, scriptContext);
assert.equal(scriptContext.PriorsFit.trackToWeight(50), 1);
console.log('PASS production standalone inlining logic and deployment asset wiring');
