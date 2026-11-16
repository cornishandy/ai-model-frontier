// Since November 2026 Artificial Analysis no longer sends each evaluation's own result (intelligenceIndexEvaluations), so
// the index weights can't be worked out from the data. scrape() then takes them from the sources it is given, if they fit
// the index's makeup, and rebuilds each evaluation's cost from the weighted cost breakdown. The methodology page, the
// deploy's source for them, must also read a section that follows a text row on the same line (GDP.pdf did).
// Runs the real scrape() against encrypted fixtures through a stubbed fetch: no network.
import assert from 'node:assert/strict';
import '../aa-data.js';
const { scrape, parseMethodology, methodologyWeights } = globalThis.AAData;

// --- the methodology page ---------------------------------------------------------------------------------------------
const li = (label, text) => ['$', 'li', null, { children: [['$', 'strong', null, { children: [label] }], text] }];
const ul = (status, desc) => JSON.stringify(['$', 'ul', null, { children: [li('Status:', ' ' + status), li('Description:', ' ' + desc)] }]);
const section = (heading, anchor, node) => ({ type: 'section', section: { heading, anchor, content: [{ type: 'node', node } ] } });
const tree = JSON.stringify([{ type: 'section', section: { heading: 'Knowledge Work', anchor: 'knowledge-work', content: [
  section('AA-Briefcase', 'aa-briefcase', '$L2'), section('GDP.pdf', 'gdp-pdf', '$L4')] } }]);
const note = 'Café notes — “quoted”, with a line\nbreak'; // a text row; its length is in UTF-8 bytes
const payload = `1:${tree}\n2:${ul('Included in Artificial Analysis Intelligence Index v5.0.1 at 80% weighting.', 'Office tasks.')}\n` +
  `3:T${Buffer.byteLength(note).toString(16)},${note}4:${ul('Included in Artificial Analysis Intelligence Index v5.0.1 at 20% weighting.', 'Long PDFs.')}\n` +
  `5:"Artificial Analysis Intelligence Index v5.0.1 incorporates 2 evaluations"\n`;
const html = `<script>self.__next_f.push([1,${JSON.stringify(payload)}])</script>`;
const meth = parseMethodology(html, ['briefcase', 'gdpPdf']);
assert.deepEqual(meth.evals.map((e) => [e.anchor, e.key, e.weight]), [['aa-briefcase', 'briefcase', 0.8], ['gdp-pdf', 'gdpPdf', 0.2]],
  'the section after a text row is read');
assert.deepEqual(methodologyWeights(meth), { briefcase: 0.8, gdpPdf: 0.2 });
assert.equal(methodologyWeights(null), null);

// --- scrape() with and without the per-evaluation results ---------------------------------------------------------------
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
async function encrypt(obj) {
  const key = crypto.getRandomValues(new Uint8Array(32)), iv = new Uint8Array(await crypto.subtle.digest('SHA-256', key)).slice(0, 12);
  const gz = await new Response(new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  const k = await crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['encrypt']);
  return { key: hex(key), body: await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, k, gz) };
}
const creator = { name: 'Lab', slug: 'lab' };
const breakdown = [{ slug: 'aa-briefcase', weightedCostPerTask: 0.6 }, { slug: 'gdp-pdf', weightedCostPerTask: 0.4 }, { slug: 'brand-new-eval-aa', weightedCostPerTask: 0 }];
const base = { id: 'a', slug: 'model-a', name: 'Model A', creator, intelligenceIndex: 40, briefcaseElo: 1400, gdpPdfAllPass: 0.3, brandNewEval: 0.5 };
async function run(models, opts = {}) {
  // /models has the cost breakdown; / has the same model with a flat cost total (more keys, so it wins the merge)
  const pages = {
    '/models': await encrypt({ models }),
    '/': await encrypt({ models: [{ ...base, intelligenceIndexCostPerTask: { total: 1, input: 0.5, output: 0.5 } }],
      changelog: [{ id: 'c1', dateLa: '2026-11-03', type: 'methodologyUpdated', title: 'Intelligence Index v5.0.1' }] }),
    '/evaluations/artificial-analysis-intelligence-index': await encrypt({ models: [] }),
  };
  const saved = globalThis.fetch, log = [];
  globalThis.fetch = async (url) => {
    const u = new URL(url), page = pages[u.pathname];
    if (page) return new Response(`<script>self.__next_f.push([1,${JSON.stringify(`"manifest":{"path":"/data${u.pathname.replace(/\//g, '_')}.txt","key":"${page.key}"}`)}])</script>`);
    const m = Object.entries(pages).find(([p]) => u.pathname === `/data${p.replace(/\//g, '_')}.txt`);
    return m ? new Response(m[1].body) : new Response('', { status: 404 });
  };
  try { return { out: await scrape({ log: (s) => log.push(s), ...opts }), log }; } finally { globalThis.fetch = saved; }
}
const noResults = [{ ...base, intelligenceIndexCostPerTask: { cost: { total: 1 }, evaluations: breakdown } }];
const fits = { briefcase: 0.7, gdpPdf: 0.2, brandNewEval: 0.1 };

// No sources: no weights, as before the fix (the deploy's data check then fails).
let { out } = await run(noResults);
assert.equal(out.indexWeights, null); assert.equal(out.index, null); assert.equal(out.models[0].evals, undefined);

// The first source that fits wins; one naming other evaluations, or not adding to 100%, is passed over and logged.
let log;
({ out, log } = await run(noResults, { indexWeights: { 'a stale copy': { briefcase: 0.8, hle: 0.2 }, 'a bad sum': { ...fits, gdpPdf: 0.5 }, 'the page': fits } }));
assert.deepEqual(out.indexWeights, fits);
assert.deepEqual(Object.keys(out.indexWeights), ['briefcase', 'gdpPdf', 'brandNewEval'], 'in the order AA lists them');
assert.deepEqual(out.index, { version: 'v5.0.1', since: '2026-11-03', evals: [
  { key: 'briefcase', weight: 0.7, slug: 'aa-briefcase' }, { key: 'gdpPdf', weight: 0.2, slug: 'gdp-pdf' },
  { key: 'brandNewEval', weight: 0.1, slug: 'brand-new-eval-aa' }] }, 'a slug with no seed matches its benchmark by name');
assert.deepEqual(out.models[0].evals, { briefcase: [0.8571, null], gdpPdf: [2, null], brandNewEval: [0, null] }, 'cost = weighted cost ÷ weight');
assert.ok(log.some((s) => /a stale copy don't fit.*they name briefcase, hle/.test(s)) && log.some((s) => /a bad sum don't fit.*130%/.test(s)) && log.includes('index weights from the page'));

// A source given as a function gets the benchmark keys; one that throws leaves the weights unknown.
({ out } = await run(noResults, { indexWeights: async (keys) => { assert.ok(keys.includes('briefcase')); return { m: fits }; } }));
assert.deepEqual(out.indexWeights, fits);
({ out, log } = await run(noResults, { indexWeights: async () => { throw Error('offline'); } }));
assert.equal(out.indexWeights, null); assert.ok(log.includes('index weights: offline'));

// When AA sends each evaluation's own cost again, the weights come from the data and the sources go unused.
const results = [{ ...noResults[0], intelligenceIndexEvaluations: [
  { slug: 'aa-briefcase', score: 1400, costPerTask: 0.6 / 0.75, outputTokensPerTask: 10 }, { slug: 'gdp-pdf', score: 0.3, costPerTask: 2, outputTokensPerTask: 20 },
  { slug: 'brand-new-eval-aa', score: 0.5, costPerTask: 1, outputTokensPerTask: 30 }] }];
results[0].intelligenceIndexCostPerTask = { cost: { total: 1 }, evaluations: [...breakdown.slice(0, 2), { slug: 'brand-new-eval-aa', weightedCostPerTask: 0.05 }] };
({ out, log } = await run(results, { indexWeights: { 'the page': fits } }));
assert.deepEqual(out.indexWeights, { briefcase: 0.75, gdpPdf: 0.2, brandNewEval: 0.05 });
assert.deepEqual(out.models[0].evals, { briefcase: [0.8, 10], gdpPdf: [2, 20], brandNewEval: [1, 30] });
assert.ok(!log.some((s) => s.startsWith('index weights')));

console.log('PASS methodology text rows, index weights from given sources (fit, order, function, failure) and from the data');
