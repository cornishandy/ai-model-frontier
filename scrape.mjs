// Refreshes the data files and rebuilds the standalone page. The scraping itself lives in
// aa-data.js, which the page also uses for its "Update data" button.
import fs from 'node:fs';
import './aa-data.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const here = (p) => new URL(p, import.meta.url);

console.log('Fetching artificialanalysis.ai …');
const out = await globalThis.AAData.scrape({ fetchOpts: { headers: { 'user-agent': UA } }, log: (s) => console.log('  ' + s) });

fs.mkdirSync(here('./data/'), { recursive: true });
fs.writeFileSync(here('./data/models.json'), JSON.stringify(out));
fs.writeFileSync(here('./data/models.js'), `window.AA_DATA = ${JSON.stringify(out)};\n`);

// Self-contained copy: index.html with the scraper and data inlined, so the single file works anywhere
// (opened on its own, moved, emailed, or in viewers that don't load sibling files).
const inlineScript = (js) => `<script>${js.replace(/<\//g, '<\\/')}</script>`;
const tags = {
  '<script src="aa-data.js"></script>': inlineScript(fs.readFileSync(here('./aa-data.js'), 'utf8')),
  '<script src="data/models.js"></script>': inlineScript(`window.AA_DATA = ${JSON.stringify(out)};`),
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
