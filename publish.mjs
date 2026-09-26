// Refreshes the built-in data and publishes the site: commits and pushes to GitHub, and
// GitHub Pages serves index.html at https://cornishandy.github.io/ai-model-frontier/
// Run: node publish.mjs   (commit your own edits first, or they go out in the same commit)
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: here, encoding: 'utf8', ...opts });

run(process.execPath, ['scrape.mjs'], { stdio: 'inherit' });
run('git', ['add', '-A']);
if (!run('git', ['status', '--porcelain']).trim()) console.log('Nothing changed.');
else run('git', ['commit', '-q', '-m', `Update data (${new Date().toISOString().slice(0, 10)})`]);
run('git', ['push', '-q'], { stdio: 'inherit' });
console.log('Published: https://cornishandy.github.io/ai-model-frontier/ (live in about a minute)');
