#!/usr/bin/env node
// Shared offline standalone bundler: inlines every local script & data file into "AI Model Frontier.html".
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

export function buildStandalone({ rootDir = ROOT_DIR, modelsJs = null, outPath = null } = {}) {
  const read = (rel) => fs.readFileSync(path.join(rootDir, rel), 'utf8');
  const inlineScript = (js) => `<script>${js.replace(/<\//g, '<\\/')}</script>`;
  const tags = {
    '<script src="scoring.js"></script>': inlineScript(read('scoring.js')),
    '<script src="priors-fit.js"></script>': inlineScript(read('priors-fit.js')),
    '<script src="aa-data.js"></script>': inlineScript(read('aa-data.js')),
    '<script src="plan-math.js"></script>': inlineScript(read('plan-math.js')),
    '<script src="data/models.js"></script>': inlineScript(modelsJs ?? read('data/models.js')),
    '<script src="data/external.js"></script>': inlineScript(read('data/external.js')),
    '<script src="data/plan-shares.js"></script>': inlineScript(read('data/plan-shares.js')),
    '<script src="data/plan-allowances.js"></script>': inlineScript(read('data/plan-allowances.js')),
  };
  let page = read('index.html');
  for (const [tag, inline] of Object.entries(tags)) {
    if (!page.includes(tag)) throw new Error(`index.html no longer contains ${tag}`);
    page = page.replace(tag, () => inline);
  }
  const leftover = page.match(/<script\s+src=/gi);
  if (leftover && leftover.length) {
    throw new Error(`Standalone bundle still contains ${leftover.length} external <script src=> tag(s)`);
  }
  const dest = outPath || path.join(rootDir, 'AI Model Frontier.html');
  fs.writeFileSync(dest, page);
  return { dest, bytes: Buffer.byteLength(page, 'utf8') };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { dest, bytes } = buildStandalone();
  console.log(`Wrote "${path.basename(dest)}" (${bytes.toLocaleString('en-US')} bytes, offline standalone).`);
}
