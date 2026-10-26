// A numeric field Artificial Analysis adds later should become a benchmark with no edit to the known list.
import '../aa-data.js';

const found = globalThis.AAData.discoverNumericFields([
  {
    intelligenceIndex: 40,
    price1mInputTokens: 2,
    gpqa: 0.9,
    brandNewEval: 0.42,
    brandNewElo: 1500,
    capabilities: { brandNewCap: 0.55, financeAndAccounting: 0.8 },
  },
]);
const keys = new Set(found.map((b) => b.key));
const fail = [];
if (!keys.has('brandNewEval')) fail.push('missing brandNewEval');
if (!keys.has('brandNewElo')) fail.push('missing brandNewElo');
if (!keys.has('cap_brandNewCap')) fail.push('missing cap_brandNewCap');
if (keys.has('gpqa') || keys.has('price1mInputTokens') || keys.has('intelligenceIndex') || keys.has('capFinance')) fail.push('known field leaked: ' + [...keys].join(','));
const frac = found.find((b) => b.key === 'brandNewEval');
const elo = found.find((b) => b.key === 'brandNewElo');
if (!frac?.frac || frac.fmt !== 'pct') fail.push('fraction not detected');
if (elo?.fmt !== 'elo') fail.push('elo not detected');
if (fail.length) { console.error(fail.join('\n')); process.exit(1); }
console.log('dynamic benchmarks ok:', [...keys].sort().join(', '));
