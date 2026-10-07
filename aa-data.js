// Fetches and decodes model data from artificialanalysis.ai. Shared by the page's "Update data"
// button and by scrape.mjs, so it only uses web-standard APIs (fetch, WebCrypto, DecompressionStream).
//
// The site embeds encrypted data "manifests" in its Next.js RSC payload:
// AES-256-GCM, key in the page, IV = sha256(key)[0..12], gzip-compressed JSON.
// The site serves these with `Access-Control-Allow-Origin: *`, so a page opened from disk can fetch them. Its HTML pages
// usually lack that header, though, so a browser may not read them; then a page is read through a reader service that
// adds it (RELAYS). The keys change every 10-20 minutes, so they have to come from a current copy of the page.
(() => {
  const BASE = 'https://artificialanalysis.ai';
  const PAGES = ['/models', '/'];
  // A relay only supplies the manifests' names and keys: the manifests themselves still come straight from the site, and
  // AES-GCM rejects a key that doesn't belong to them, so a relay can't alter the numbers. X-No-Cache: a cached copy's
  // keys have usually expired.
  const RELAYS = [(url) => ['https://r.jina.ai/' + url, { cache: 'no-store', headers: { 'X-Return-Format': 'html', 'X-No-Cache': 'true' } }]];
  const MANIFEST_RE = /"manifest":\{"path":"([^"]+)","key":"([0-9a-f]+)"/g;

  function rscPayload(html) {
    const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)<\/script>/g;
    let out = '';
    for (const m of html.matchAll(re)) out += JSON.parse(`"${m[1]}"`);
    return out;
  }

  async function decrypt(buf, keyHex) {
    const key = new Uint8Array(keyHex.match(/../g).map((h) => parseInt(h, 16)));
    const iv = new Uint8Array(await crypto.subtle.digest('SHA-256', key)).slice(0, 12);
    const k = await crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, k, buf);
    const text = await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    return JSON.parse(text);
  }

  async function loadManifests(fetchOpts, log) {
    if (!globalThis.crypto?.subtle || typeof DecompressionStream === 'undefined') {
      throw new Error(globalThis.isSecureContext === false ? 'browsers only decode the data on https or localhost pages' : 'this browser can\'t decode the data');
    }
    const get = async (url, opts = fetchOpts) => {
      const res = await fetch(url, { signal: AbortSignal.timeout?.(30000), ...opts });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    };
    // A page's manifests [{ path, key, page }]: read directly, else through each relay in turn.
    const readPage = async (page) => {
      const errs = [];
      for (const relay of [null, ...RELAYS]) {
        const [url, opts] = relay ? relay(BASE + page) : [BASE + page, fetchOpts];
        try {
          const found = [...rscPayload(await (await get(url, opts)).text()).matchAll(MANIFEST_RE)].map((m) => ({ path: m[1], key: m[2], page }));
          // Each page's manifests hold different parts of the data (the changelog and coding agents come from /), so a page
          // without any is a failed read (a changed layout, or an error page), not a partial success.
          if (!found.length) throw new Error('no data manifests in the page');
          if (relay) log(`read ${page} through ${new URL(url).host} (${errs[0]})`);
          return found;
        } catch (err) { errs.push(`${relay ? 'via ' + new URL(url).host : 'direct'}: ${err.message}`); }
      }
      throw new Error(`${page} — ${errs.join('; ')}`);
    };
    const list = [];
    for (const found of await Promise.all(PAGES.map(readPage))) for (const m of found) if (!list.some((x) => x.path === m.path)) list.push(m);
    return Promise.all(list.map(async ({ path, key, page }) => {
      const buf = await (await get(BASE + path).catch((err) => { throw new Error(`${path}: ${err.message}`); })).arrayBuffer();
      const out = await decrypt(buf, key).catch((err) => { throw new Error(`${path}: ${err.name === 'OperationError' ? 'its key didn\'t match (the site may have just changed it); try again' : err.message}`); });
      log(`decrypted ${path} (from ${page})`);
      return out;
    }));
  }

  const median = (xs) => {
    const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
  };
  const num = (x) => (Number.isFinite(x) ? x : null);

  function buildModels(manifests) {
    // Model-level arrays (objects with intelligenceIndex) and endpoint-level arrays (objects with host + modelId).
    const modelById = new Map();
    const endpoints = [];
    for (const m of manifests) {
      const arrays = Array.isArray(m) ? [m] : Object.values(m).filter(Array.isArray);
      for (const arr of arrays) {
        for (const o of arr) {
          if (!o || typeof o !== 'object') continue;
          if ('intelligenceIndex' in o && o.creator) {
            // Merge: later/richer records fill in missing fields.
            const prev = modelById.get(o.id) || {};
            for (const [k, v] of Object.entries(o)) if (prev[k] == null || (typeof v === 'object' && v && Object.keys(v).length > Object.keys(prev[k] || {}).length)) prev[k] = v;
            modelById.set(o.id, prev);
          } else if (o.modelId && o.host) endpoints.push(o);
        }
      }
    }

    const speedByModel = new Map();
    for (const e of endpoints) {
      const s = e.timescaleData?.medianOutputSpeed;
      if (!Number.isFinite(s)) continue;
      (speedByModel.get(e.modelId) || speedByModel.set(e.modelId, []).get(e.modelId)).push(s);
    }

    return [...modelById.values()]
      .filter((m) => Number.isFinite(m.intelligenceIndex))
      .map((m) => ({
        id: m.id,
        slug: m.slug,
        name: m.name,
        shortName: m.shortName,
        family: m.release?.slug ?? m.slug,
        familyName: m.release?.name ?? m.shortName,
        creator: m.creator?.name,
        creatorSlug: m.creator?.slug,
        creatorColor: m.creator?.color,
        effort: m.effort?.slug ?? (m.isReasoning ? 'default' : 'non-reasoning'),
        effortLevel: m.effort?.level ?? (m.isReasoning ? 35 : 0),
        isReasoning: !!m.isReasoning,
        openWeights: !!m.isOpenWeights,
        deprecated: !!m.deprecated,
        estimated: !!m.intelligenceIndexIsEstimated,
        releaseDate: m.releaseDate,
        intelligence: num(m.intelligenceIndex),
        costToRun: num(m.intelligenceIndexCost?.total),
        costPerTask: num(m.intelligenceIndexCostPerTask?.cost?.total),
        priceBlended: num(m.price1mBlended0To3To1),
        priceInput: num(m.price1mInputTokens),
        priceOutput: num(m.price1mOutputTokens),
        outputSpeed: num(m.timescaleData?.medianOutputSpeed) ?? median(speedByModel.get(m.id) || []),
        ttft: num(m.timeToFirstAnswerToken?.total),
        e2e: num(m.endToEndResponseTime?.total),
        outputTokens: num(m.canonicalIntelligenceIndexTokenCount?.output),
        tokensPerTask: num(m.intelligenceIndexOutputTokensPerTask?.output),
        timePerTask: num(m.intelligenceIndexTimePerTask),
        parameters: num(m.parameters),
        ...Object.fromEntries(BENCHMARKS.map(([k, get]) => [k, num(get(m))])),
        // each Intelligence Index evaluation's own cost and output tokens per task: { key: [usd, tokens] }
        evals: evalsOf(m),
        defaultSelected: !!m.chartDefaultSelected,
      }))
      .sort((a, b) => b.intelligence - a.intelligence);
  }
  // Every per-model benchmark the site publishes (the page's METRICS has the labels): our key -> the field on AA's record.
  const BENCHMARKS = Object.entries({
    gpqa: (m) => m.gpqa, hle: (m) => m.hle, critpt: (m) => m.critpt, scicode: (m) => m.scicode,
    omniscience: (m) => m.omniscience, omniscienceAccuracy: (m) => m.omniscienceAccuracy, hallucination: (m) => m.omniscienceHallucinationRate,
    lcr: (m) => m.lcr, ifbench: (m) => m.ifbench, mmmuPro: (m) => m.mmmuPro, livecodebench: (m) => m.livecodebench, aime25: (m) => m.aime25,
    terminalBench40: (m) => m.terminalBench40, terminalBench21: (m) => m.terminalBench21, terminalbenchHard: (m) => m.terminalbenchHard, terminalBenchScience: (m) => m.terminalBenchScience,
    tau2: (m) => m.tau2, tauBanking: (m) => m.tauBanking, automationBench: (m) => m.automationBenchPartialScore, enterpriseOps: (m) => m.enterpriseOpsGym,
    apexAgents: (m) => m.apexAgents, itBench: (m) => m.itBenchSre, analystAgent: (m) => m.analystAgent,
    gdpval: (m) => m.gdpval, briefcase: (m) => m.briefcaseBreakdown?.overall?.elo, gdpPdf: (m) => m.gdpPdfAllPass, mlcr: (m) => m.mlcrOverall, harvey: (m) => m.harveyLab,
    openness: (m) => m.openness?.opennessIndex,
  });

  // The Intelligence Index evaluations (AA's slugs) under the page's metric keys.
  const INDEX_EVALS = {
    'aa-briefcase': 'briefcase', 'gdpval-aa': 'gdpval', 'automationbench-aa': 'automationBench', 'terminalbench-4-0': 'terminalBench40',
    scicode: 'scicode', 'humanitys-last-exam': 'hle', 'gdp-pdf': 'gdpPdf', critpt: 'critpt', omniscience: 'omniscience',
    'artificial-analysis-long-context-reasoning': 'lcr',
  };
  const round = (v) => +v.toPrecision(4);
  function evalsOf(m) {
    const out = {};
    for (const e of m.intelligenceIndexEvaluations || []) {
      const k = INDEX_EVALS[e.slug] || e.slug;
      if (Number.isFinite(e.costPerTask)) out[k] = [round(e.costPerTask), Number.isFinite(e.outputTokensPerTask) ? Math.round(e.outputTokensPerTask) : null];
    }
    return Object.keys(out).length ? out : null;
  }
  // Each evaluation's weight in the index, read off a model with the full cost breakdown (weighted cost ÷ cost).
  function indexWeightsOf(manifests) {
    for (const man of manifests) for (const arr of Array.isArray(man) ? [man] : Object.values(man).filter(Array.isArray)) for (const m of arr) {
      const weighted = m?.intelligenceIndexCostPerTask?.evaluations, evs = m?.intelligenceIndexEvaluations;
      if (!Array.isArray(weighted) || !Array.isArray(evs) || weighted.length < 2) continue;
      const w = {};
      for (const e of weighted) {
        const c = evs.find((x) => x.slug === e.slug)?.costPerTask;
        if (!(c > 0) || !Number.isFinite(e.weightedCostPerTask)) { w.bad = 1; break; }
        w[INDEX_EVALS[e.slug] || e.slug] = Math.round((e.weightedCostPerTask / c) * 1000) / 1000;
      }
      const sum = Object.values(w).reduce((a, b) => a + b, 0);
      if (!w.bad && Math.abs(sum - 1) < 0.01) return w;
    }
    return null;
  }

  // The site's "what's new" feed: models added, articles published, …
  const changelogOf = (manifests) => {
    const list = manifests.find((m) => Array.isArray(m?.changelog))?.changelog || [];
    return list.map((c) => ({ id: c.id, date: c.dateLa, type: c.type, title: c.title, url: c.url })).filter((c) => c.id && c.title);
  };
  // Coding Agent Index: harness + model pairs (Claude Code, Codex, …) run on agentic coding tasks.
  const codingAgentsOf = (manifests) => {
    const list = manifests.find((m) => Array.isArray(m?.codingAgents))?.codingAgents || [];
    return list.filter((a) => !a.isUnavailable && Number.isFinite(a.indexScore)).map((a) => ({
      id: a.id, agent: a.display?.agent ?? a.agentName, model: a.display?.model ?? a.displayLabel, provider: a.display?.creator?.agent ?? a.provider,
      isDefault: !!a.isDefault, index: a.indexScore,
      evals: Object.fromEntries((a.evals || []).map((e) => [e.evaluationDatasetSlug, num(e.mean?.reward)])),
      costPerTask: num(a.mean?.costUsd), timePerTask: num(a.mean?.agentWallTimeSec), tokensPerTask: num(a.mean?.totalTokens),
      outputTokensPerTask: num(a.mean?.outputTokens), steps: num(a.mean?.steps),
    })).sort((a, b) => b.index - a.index);
  };

  // -> { v, scrapedAt, source, models, indexWeights, changelog, codingAgents }
  async function scrape({ fetchOpts = {}, log = () => {} } = {}) {
    const manifests = await loadManifests(fetchOpts, log);
    // Most models have only some benchmarks: leave the missing ones out rather than storing nulls.
    const models = buildModels(manifests).map((m) => Object.fromEntries(Object.entries(m).filter(([, v]) => v != null)));
    if (!models.length) throw new Error('Decoded the data but found no models — the format may have changed.');
    return { v: VERSION, scrapedAt: new Date().toISOString(), source: BASE, models, indexWeights: indexWeightsOf(manifests), changelog: changelogOf(manifests), codingAgents: codingAgentsOf(manifests) };
  }
  // Bump when the saved shape changes, so the page ignores copies saved by an older version.
  const VERSION = 3; // 3: per-evaluation costs and index weights

  globalThis.AAData = { scrape, VERSION };
})();
