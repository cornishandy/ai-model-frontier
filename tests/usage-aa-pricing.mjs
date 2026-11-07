// No browser, network, collector, or private usage data: execute the page's actual pricing helpers.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
let source = ['U_CACHE_MULT', 'uAAPrice', 'uPrice'].map((name) => {
  const matches = [...page.matchAll(new RegExp(`^  const ${name} = .+;$`, 'gm'))];
  assert.equal(matches.length, 1, `extract exactly one page definition of ${name}`);
  return matches[0][0];
}).join('\n');

// Negative control: rerun these same behavioral assertions with the pre-fix fallback.
if (process.argv.includes('--old-fallback')) {
  const oldSource = source.replace('|| [1, 1]', '|| [0.25, 1]');
  assert.notEqual(oldSource, source, 'negative control must restore the old fallback');
  source = oldSource;
}
const { uAAPrice, uPrice } = runInNewContext(`${source}\n({ uAAPrice, uPrice });`, {});
const dataContext = { window: {} };
runInNewContext(readFileSync(new URL('../data/models.js', import.meta.url), 'utf8'), dataContext);
const current = dataContext.window.AA_DATA.models.filter((m) =>
  !m.deprecated && m.priceInput > 0 && m.priceOutput > 0);

// Documented multipliers, including the preserved legacy xAI alias.
const known = new Map([
  ['anthropic', [0.1, 1.25]], ['openai', [0.1, 1]], ['google', [0.1, 1]],
  ['deepseek', [0.1, 1]], ['xai', [0.25, 1]], ['spacexai', [0.25, 1]],
]);
const omitted = current.filter((m) => !known.has(m.creatorSlug));
const mapped = current.filter((m) => known.has(m.creatorSlug));
assert(mapped.length > 0 && omitted.length > 0, 'exercise both groups in committed current data');
for (const slug of ['zai', 'alibaba']) {
  assert(omitted.some((m) => m.creatorSlug === slug), `current omitted lab ${slug} is covered`);
}
for (const m of current) {
  const [read, write] = known.get(m.creatorSlug) ?? [1, 1];
  const p = uAAPrice(m);
  assert.equal(p.in, m.priceInput);
  assert.equal(p.out, m.priceOutput);
  assert.equal(p.cachedIn, m.priceInput * read, `${m.creatorSlug}: current model cache reads`);
  assert.equal(p.cacheWrite, m.priceInput * write, `${m.creatorSlug}: current model cache writes`);
}

const cachedOnly = { inp: 0, cr: 1e6, cw: 0, out: 0 };
const mixed = { inp: 250000, cr: 1e6, cw: 500000, out: 125000 };
const omittedSlugs = [...new Set(omitted.map((m) => m.creatorSlug))];
for (const slug of [...known.keys(), ...omittedSlugs]) {
  const [read, write] = known.get(slug) ?? [1, 1];
  const p = uAAPrice({ creatorSlug: slug, priceInput: 1, priceOutput: 2 });
  assert.equal(uPrice(cachedOnly, p), read, `${slug}: 1M cached tokens at $1 input`);
  assert.equal(uPrice(mixed, p), 0.5 + read + 0.5 * write, `${slug}: mixed-token counterfactual`);
  if (!known.has(slug)) {
    assert.equal(uPrice(cachedOnly, p) < 1 * 0.9, false, `${slug}: no false 10% saving against $1 actual`);
  }
}
console.log(`usage AA pricing ok: ${mapped.length} known-lab and ${omitted.length} omitted-lab current models; ${omittedSlugs.length} omitted labs; cached and mixed-token counterfactuals`);
