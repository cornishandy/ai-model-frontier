// Benchmarks from outside Artificial Analysis, refreshed by scrape.mjs into data/external.js.
// Each source becomes a list of { name (as the source writes it), fam, effort, value, … } rows; the page matches
// them to Artificial Analysis models by family + reasoning effort (see joinExternal in index.html).
// A source that fails to load keeps its previous rows, so one site being down never blanks the others.
import fs from 'node:fs';

// An honest client name: Kaggle, for one, answers browser user-agents with a captcha.
const UA = 'ai-model-frontier/1.0 (+https://github.com/cornishandy/ai-model-frontier)';
const get = async (url, opts = {}) => {
  const res = await fetch(url, { ...opts, headers: { 'user-agent': UA, ...opts.headers } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
};
// When a source last changed, as YYYY-MM-DD. A missing date never fails a source.
const ymd = (d) => { const t = new Date(d); return Number.isNaN(+t) ? null : t.toISOString().slice(0, 10); };
const latest = (dates) => dates.map((d) => d && ymd(d)).filter(Boolean).sort().at(-1) || null;
// The last commit touching a file in a GitHub repo (the workflow passes its token, as runners share rate limits).
async function commitDate(repo, path) {
  try {
    const auth = process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};
    const [c] = await (await get(`https://api.github.com/repos/${repo}/commits?path=${encodeURIComponent(path)}&per_page=1`, { headers: { accept: 'application/vnd.github+json', ...auth } })).json();
    return ymd(c?.commit?.committer?.date);
  } catch { return null; }
}
const EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const effortOf = (s) => {
  s = String(s || '').toLowerCase().trim();
  if (/^(none|no[ _-]?thinking|non[ -]?reasoning|not_reasoning)$/.test(s)) return 'non-reasoning';
  return EFFORTS.includes(s) ? s : null;
};
// "openai/gpt-6-astra-pro" -> "gpt-6-astra-pro"; drops "@default", ":max", provider prefixes
const famOf = (s) => String(s).toLowerCase().replace(/^.*\//, '').replace(/[@:].*$/, '').trim();
// "claude-opus-5.5-high" / "muse-spark-1.2 (xHigh)" -> { fam, effort }
const splitEffort = (s) => {
  const m = String(s).match(/^(.*?)(?:\s*\((minimal|low|medium|high|xhigh|max|no thinking|non-reasoning)\)|-(minimal|low|medium|high|xhigh|max))$/i);
  return m ? { fam: famOf(m[1]), effort: effortOf(m[2] || m[3]) } : { fam: famOf(s), effort: null };
};

function parseCsv(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((f) => f.trim()));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}
const n = (v) => (v === '' || v == null ? null : Number.isFinite(+v) ? +v : null);

const SOURCES = [
  {
    key: 'weirdml', label: 'WeirdML v3', long: 'WeirdML v3 (agentic ML engineering; score ×100)', fmt: 'score', frac: true,
    url: 'https://htihle.github.io/weirdml.html', by: 'Håvard Tveit Ihle',
    async load() {
      const d = await (await get('https://htihle.github.io/assets/data/weirdml_v3.json')).json();
      return {
        updated: d.generated?.slice(0, 10),
        rows: d.models.map((m) => ({ name: m.name, fam: famOf(m.slug), effort: effortOf(m.reasoning_effort), value: m.score, lo: m.interval?.[0], hi: m.interval?.[1], cost: m.mean_api_cost_usd })),
      };
    },
  },
  {
    key: 'weirdml2', label: 'WeirdML v2', long: 'WeirdML v2 (17 unusual ML tasks; average accuracy)', fmt: 'pct', frac: true,
    url: 'https://htihle.github.io/weirdml_v2.html', by: 'Håvard Tveit Ihle',
    async load() {
      const rows = parseCsv(await (await get('https://htihle.github.io/data/weirdml_data.csv')).text());
      return {
        updated: await commitDate('htihle/htihle.github.io', 'data/weirdml_data.csv'),
        rows: rows.map((r) => {
          const [, fam, eff] = r.display_name.match(/^(.*?)\s*(?:\(([^)]*)\))?$/);
          return { name: r.display_name, fam: famOf(fam), effort: effortOf(eff), value: n(r.avg_acc), cost: n(r.cost_per_run_usd) };
        }).filter((r) => r.value != null),
      };
    },
  },
  {
    key: 'llmChess', label: 'LLM Chess (Elo)', long: 'LLM Chess Elo (maxim-saplin; games vs. random & Komodo Dragon)', fmt: 'elo',
    url: 'https://maxim-saplin.github.io/llm_chess/', by: 'Maxim Saplin',
    async load() {
      const base = 'https://raw.githubusercontent.com/maxim-saplin/llm_chess/main/data/';
      const [elo, meta] = await Promise.all(['elo_refined.csv', 'models_metadata.csv'].map(async (f) => parseCsv(await (await get(base + f)).text())));
      const info = new Map(meta.map((m) => [m.model, m]));
      return {
        updated: await commitDate('maxim-saplin/llm_chess', 'data/elo_refined.csv'),
        rows: elo.filter((r) => n(r.elo) != null).map((r) => {
          const m = info.get(r.Player);
          const suffix = r.Player.match(/-(minimal|low|medium|high|xhigh|max)$/)?.[1];
          const effort = m?.reasoning_status?.trim() === 'not_reasoning' ? 'non-reasoning' : effortOf(suffix) ?? effortOf(m?.reasoning_level);
          const fam = famOf(r.Player.replace(/-(minimal|low|medium|high|xhigh|max)$/, '').replace(/_adaptive-thinking|_thinking|-thinking$/, '').replace(/-non-reasoning$|-reasoning$/, ''));
          return { name: r.Player, fam, effort, value: n(r.elo), moe: n(r.elo_moe_95), cost: n(r.average_game_cost) };
        }),
      };
    },
  },
  {
    key: 'gameArena', label: 'Kaggle Game Arena chess', long: 'Kaggle Game Arena chess rating (Google DeepMind & Kaggle; text chess)', fmt: 'elo',
    url: 'https://www.kaggle.com/benchmarks/kaggle/chess-text', by: 'Google DeepMind, Google Cloud, Kaggle',
    async load() {
      // Kaggle's own (undocumented) leaderboard API, as used by the benchmark page.
      const api = (method, body) => get(`https://www.kaggle.com/api/i/benchmarks.BenchmarkService/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
      const b = await api('GetBenchmark', { benchmarkIdentifier: { slugIdentifier: { ownerSlug: 'kaggle', benchmarkSlug: 'chess-text' } } });
      const versionId = b.version?.id ?? b.benchmarkVersion?.id ?? b.currentVersion?.id;
      if (!versionId) throw new Error('Game Arena: no benchmark version in the response');
      const lb = await api('GetBenchmarkLeaderboard', { versionIdentifier: { versionIdSelector: { id: versionId } } });
      // The overall score is the result with a confidence interval (the others are tokens and cost per turn).
      return {
        updated: latest(lb.rows.flatMap((r) => (r.results || []).map((x) => x.evaluationDate))) ?? ymd(b.version?.updateTime),
        rows: lb.rows.map((r) => {
          const res = (r.results || []).find((x) => x.numericResult?.unevenConfidenceInterval);
          const mv = r.modelVersion || {};
          return { name: mv.displayName, fam: famOf(mv.modelProxySlug || mv.slug || mv.displayName), effort: null, value: n(res?.numericResult?.value) };
        }).filter((r) => r.value != null && r.name),
      };
    },
  },
  {
    key: 'dubesorChess', label: 'dubesor chess (Elo)', long: 'dubesor.de LLM chess Elo (games between models; mixed modes)', fmt: 'elo',
    url: 'https://dubesor.de/chess/chess-leaderboard', by: 'dubesor',
    async load() {
      const d = await (await get('https://dubesor.de/chess/chess-data.json')).json();
      // The leaderboard's default "mixed modes" view: each model's Reasoning and Continuation Elo, weighted by games played.
      const byName = new Map();
      for (const r of Object.values(d.eloRatings)) {
        if (!r.mode || !Number.isFinite(r.elo)) continue;
        const name = r.name.replace(/\s*˟$/, '');
        const s = byName.get(name) || byName.set(name, { elo: 0, games: 0 }).get(name);
        s.elo += r.elo * r.games; s.games += r.games;
      }
      return {
        updated: d.lastUpdated?.slice(0, 10),
        rows: [...byName].filter(([, s]) => s.games >= 5).map(([name, s]) => ({ name, fam: famOf(name), effort: null, value: Math.round(s.elo / s.games), games: s.games })),
      };
    },
  },
  {
    key: 'arcAgi2', label: 'ARC-AGI-2', long: 'ARC-AGI-2 (novel visual puzzles; semi-private set)', fmt: 'pct', frac: true,
    cost: { key: 'arcAgi2Cost', label: 'ARC-AGI-2 cost per task', long: 'ARC-AGI-2 cost per task (USD)' },
    url: 'https://arcprize.org/leaderboard', by: 'ARC Prize Foundation',
    async load() {
      const [res, models] = await Promise.all([get('https://arcprize.org/media/data/evaluations.json'), get('https://arcprize.org/media/data/models.json').then((r) => r.json())]);
      const evals = await res.json(), info = new Map(models.map((m) => [m.id, m]));
      return {
        // The results carry no dates, so use the file's own.
        updated: ymd(res.headers.get('last-modified')),
        rows: evals.filter((e) => e.datasetId === 'v2_Semi_Private' && e.display !== false && Number.isFinite(e.score)).map((e) => {
          const m = info.get(e.modelId); if (!m || m.modelGroup === 'Human') return null;
          return { name: m.displayName, ...splitEffort(m.displayName), value: e.score, cost: n(e.costPerTask) };
        }).filter(Boolean),
      };
    },
  },
  {
    key: 'simpleBench', label: 'SimpleBench', long: 'SimpleBench (trick questions humans find easy)', fmt: 'pct', frac: true,
    url: 'https://simple-bench.com', by: 'SimpleBench',
    async load() {
      const js = await (await get('https://simple-bench.com/static/js/leaderboard-data.js')).text();
      const rows = [...js.matchAll(/model:\s*"([^"]+)",\s*score:\s*"([\d.]+)%"/g)].map(([, name, score]) => ({ name, ...splitEffort(name), value: +score / 100 }));
      return { updated: latest([...js.matchAll(/dateAdded:\s*"([\d-]+)"/g)].map((m) => m[1])), rows: rows.filter((r) => !/human/i.test(r.name)) };
    },
  },
  {
    key: 'lmarenaText', label: 'LMArena Text (Elo)', long: 'LMArena Text arena rating (human preference votes; style control)', fmt: 'elo',
    url: 'https://lmarena.ai/leaderboard/text', by: 'LMArena',
    async load() {
      // Hugging Face's datasets server: its /filter endpoint times out on this dataset, so page through /rows
      // (which lists the "overall" category first, by rank) and stop once past it. Retries cover the odd HTTP 500.
      const rows = [];
      for (let offset = 0, total = Infinity; offset < total && offset < 20000; offset += 100) {
        const q = new URLSearchParams({ dataset: 'lmarena-ai/leaderboard-dataset', config: 'text_style_control', split: 'latest', offset, length: 100 });
        let d;
        for (let attempt = 0; !d; attempt++) {
          try { d = await (await get(`https://datasets-server.huggingface.co/rows?${q}`)).json(); }
          catch (err) { if (attempt >= 3) throw err; await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); }
        }
        total = d.num_rows_total;
        const overall = d.rows.map((r) => r.row).filter((r) => r.category === 'overall');
        rows.push(...overall);
        if (rows.length && overall.length < d.rows.length) break;
      }
      return {
        updated: rows[0]?.leaderboard_publish_date,
        rows: rows.map((r) => ({ name: r.model_name, ...splitEffort(r.model_name), value: r.rating, votes: r.vote_count })),
      };
    },
  },
];

export async function scrapeExternal(file, log = () => {}) {
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^window\.EXT_DATA = /, '').replace(/;\s*$/, '')); } catch {}
  const prevBy = new Map((prev.sources || []).map((s) => [s.key, s]));
  const sources = [];
  for (const { load, ...meta } of SOURCES) {
    try {
      const { rows, updated } = await load();
      if (!rows.length) throw new Error('no rows');
      // No date this time (e.g. GitHub's API was busy): the previous one still holds if nothing changed.
      const old = prevBy.get(meta.key), same = old && JSON.stringify(old.rows) === JSON.stringify(rows);
      sources.push({ ...meta, fetchedAt: new Date().toISOString(), updated: updated || (same && old.updated) || null, rows });
      log(`${meta.label}: ${rows.length} rows`);
    } catch (err) {
      const old = prevBy.get(meta.key);
      if (old) sources.push({ ...old, ...meta, rows: old.rows, stale: true });
      log(`${meta.label}: FAILED (${err.message})${old ? ' — kept the previous copy' : ''}`);
    }
  }
  fs.writeFileSync(file, `window.EXT_DATA = ${JSON.stringify({ fetchedAt: new Date().toISOString(), sources })};\n`);
  return sources;
}
