#!/usr/bin/env node
// Shared offline standalone bundler: inlines every local script & data file into "AI Model Frontier.html".
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

export const STANDALONE_SCRIPTS = [
  "scoring.js",
  "priors-fit.js",
  "aa-data.js",
  "plan-math.js",
  "data/models.js",
  "data/external.js",
  "data/plan-shares.js",
  "data/plan-allowances.js"
];

export function buildStandalone({ rootDir = ROOT_DIR, modelsJs = null, outPath = null } = {}) {
  const read = (rel) => fs.readFileSync(path.join(rootDir, rel), 'utf8');
  const inlineScript = (js) => `<script>${js.replace(/<\//g, '<\\/')}</script>`;
  let page = read('index.html');
  for (const rel of STANDALONE_SCRIPTS) {
    const tag = `<script src="${rel}"></script>`;
    if (!page.includes(tag)) throw new Error(`index.html no longer contains ${tag}`);
    const js = rel === 'data/models.js' ? (modelsJs ?? read(rel)) : read(rel);
    page = page.replace(tag, () => inlineScript(js));
  }
  const leftover = page.match(/<script\b[^>]*\bsrc\s*=/gi);
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
