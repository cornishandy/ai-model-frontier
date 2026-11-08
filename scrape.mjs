// Refreshes the data files and rebuilds the standalone page. The scraping itself lives in
// aa-data.js, which the page also uses for its "Update data" button.
import fs from 'node:fs';
import './aa-data.js';
import './scoring.js';
import vm from 'node:vm';
import { scrapeExternal } from './external.mjs';
import { readLive, readFailurePolicy, publicationState, knownState } from './publication-state.mjs';
import { missingSpeedFields } from './speed-health.mjs';
import os from 'node:os';
import path from 'node:path';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const here = (p) => new URL(p, import.meta.url);

const previous = await readLive('https://cornishandy.github.io/ai-model-frontier/data/models.js');
const policy = previous ? 'deploy' : await readFailurePolicy(process.env.GITHUB_EVENT_NAME);
if (policy === 'skip' || policy === 'fail') {
  console.log('::notice::Live publication could not be read; keeping the existing deployment.');
  if (policy === 'fail') throw Error('Live publication unreadable for at least six hours since the last successful deploy started');
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'deploy=false\n');
  process.exit(0);
}
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'deploy=true\n');
console.log('Fetching artificialanalysis.ai …');
const fetchOpts = { headers: { 'user-agent': UA } };
const out = await globalThis.AAData.scrape({ fetchOpts, log: (s) => console.log('  ' + s) });
if (out.partial) console.log('  warning: an optional page could not be read; this copy lacks the benchmarks only it supplies');

// Every evaluation's name, status in the index and description, from the methodology page. Not essential: without it
// the page keeps its own descriptions.
try {
  const keys = [...new Set(out.models.flatMap((m) => Object.keys(m)))];
  const meth = await globalThis.AAData.scrapeMethodology({ fetchOpts, keys });
  if (meth) {
    out.methodology = meth;
    if (out.index && meth.version) out.index.version = meth.version; // the page's own wording beats the feed's
    console.log(`  methodology: ${meth.evals.length} evaluations, index ${meth.version} (${meth.count} evaluations)` +
      `; not matched to a benchmark: ${meth.evals.filter((e) => !e.key).map((e) => e.anchor).join(', ') || 'none'}`);
  }
} catch (err) { console.log(`  methodology skipped (${err.message})`); }

// Health check. Artificial Analysis changes its data's shape from time to time (v5.0 of the index moved cost per task
// and left most models without an index score). Stop here, before anything is written or deployed, when the result
// looks broken, so the run fails (GitHub emails the failure) and the previous deployment stays up.
const scored = out.models.filter((m) => !m.deprecated && m.intelligence != null);
const problems = [
  !out.models.length && 'no models',
  !out.index && 'no index',
  scored.length < 20 && `only ${scored.length} current models have an Intelligence Index score`,
  scored.filter((m) => m.costPerTask != null).length < scored.length / 2 && `cost per task is missing for ${scored.filter((m) => m.costPerTask == null).length} of ${scored.length} scored models`,
  !out.indexWeights && 'the index weights could not be worked out',
].filter(Boolean);
const unmatched = (out.index?.evals || []).filter((e) => e.key === e.slug && !out.models.some((m) => m[e.key] != null));
if (unmatched.length) console.log(`  warning: index evaluations with no matching benchmark field: ${unmatched.map((e) => e.slug).join(', ')}`);
if (problems.length) { console.error(`Data check failed: ${problems.join('; ')}.`); process.exit(1); }
if (out.index) console.log(`  index ${out.index.version || '(version unknown)'}: ${out.index.evals.map((e) => `${e.key} ${Math.round(e.weight * 100)}%`).join(', ')}`);

console.log('Fetching independent benchmarks …');
await scrapeExternal(here('./data/external.js'), (s) => console.log('  ' + s));

const externalContext = {window:{}};
vm.runInNewContext(fs.readFileSync(here('./data/external.js'), 'utf8'), externalContext);
const external = externalContext.window.EXT_DATA;
const board = FrontierScoring.buildSnapshot(out, external);
if (!previous) console.log('::notice::Live publication could not be read; deploying this push with unknown comparison state.');
const missing = missingSpeedFields(out.models);
const previousMissing = knownState(previous?.publication) ? previous.publication.missingSpeedFields : null;
out.publication = previous ? publicationState(out, previous, missing, undefined, external, board) : {
  status:'unknown', date:new Date().toISOString(), reason:'Live publication could not be read before this push'
};
if (previous && !knownState(previous.publication)) console.log('Publication baseline reset: previous state absent or unknown.');
// Ephemeral job input, not a second persistent history store; compare only AFTER deployment.
fs.writeFileSync(process.env.SPEED_COMPARISON_PATH || path.join(os.tmpdir(), 'aimf-speed-comparison.json'), JSON.stringify({previous:previousMissing,current:missing}));
fs.mkdirSync(here('./data/'), { recursive: true });
fs.writeFileSync(here('./data/models.json'), JSON.stringify(out));
fs.writeFileSync(here('./data/models.js'), `window.AA_DATA = ${JSON.stringify(out)};\n`);

// Self-contained copy: index.html with the scraper and data inlined, so the single file works anywhere
// (opened on its own, moved, emailed, or in viewers that don't load sibling files).
const inlineScript = (js) => `<script>${js.replace(/<\//g, '<\\/')}</script>`;
const tags = {
  '<script src="scoring.js"></script>': inlineScript(fs.readFileSync(here('./scoring.js'), 'utf8')),
  '<script src="aa-data.js"></script>': inlineScript(fs.readFileSync(here('./aa-data.js'), 'utf8')),
  '<script src="data/models.js"></script>': inlineScript(`window.AA_DATA = ${JSON.stringify(out)};`),
  '<script src="data/external.js"></script>': inlineScript(fs.readFileSync(here('./data/external.js'), 'utf8')),
};
let page = fs.readFileSync(here('./index.html'), 'utf8');
for (const [tag, inline] of Object.entries(tags)) {
  if (!page.includes(tag)) throw new Error(`index.html no longer contains ${tag}`);
  page = page.replace(tag, () => inline);
}
fs.writeFileSync(here('./AI Model Frontier.html'), page);
console.log('Wrote "AI Model Frontier.html" (standalone, data inlined).');

const live = out.models.filter((m) => !m.deprecated);
console.log(`Saved ${out.models.length} models (${live.length} current). With cost per task: ${live.filter((m) => m.costPerTask != null).length}, with speed: ${live.filter((m) => m.outputSpeed != null).length}.`);
