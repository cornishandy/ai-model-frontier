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
  // Optional: the Intelligence Index evaluation page carries extra results the other two pages don't (CritPt v2, the Cyber
  // Index's parts, Global-MMLU-Lite, MMLU-Pro, MATH-500). The deploy reads it; a failure there doesn't stop an update.
  const EXTRA_PAGES = ['/evaluations/artificial-analysis-intelligence-index'];
  // The methodology page names every evaluation, says whether it's in the index (and at what weight), and describes it.
  const METHODOLOGY = '/methodology/intelligence-benchmarking';
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

  async function loadManifests(fetchOpts, log, extraPages) {
    let partial = !extraPages;
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
    const optional = (page) => readPage(page).then((found) => found.map((m) => ({ ...m, optional: true })))
      .catch((err) => { log(`skipped ${page} (${err.message})`); partial = true; return []; });
    const pages = await Promise.all([...PAGES.map(readPage), ...(extraPages ? EXTRA_PAGES.map(optional) : [])]);
    for (const found of pages) for (const m of found) if (!list.some((x) => x.path === m.path)) list.push(m);
    const read = async ({ path, key, page }) => {
      const buf = await (await get(BASE + path).catch((err) => { throw new Error(`${path}: ${err.message}`); })).arrayBuffer();
      const out = await decrypt(buf, key).catch((err) => {
        if (err.name !== 'OperationError') throw new Error(`${path}: ${err.message}`);
        throw Object.assign(new Error(`${path}: its key didn't match (the site may have just changed it); try again`), { keyMismatch: true });
      });
      log(`decrypted ${path} (from ${page})`);
      return out;
    };
    const out = await Promise.all(list.map((m) => m.optional ? read(m).catch((err) => { log(`skipped ${m.path} (${err.message})`); partial = true; return null; }) : read(m)));
    return Object.assign(out.filter(Boolean), { partial });
  }

  const median = (xs) => {
    const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
  };
  const num = (x) => (Number.isFinite(x) ? x : null);

  // Known non-benchmark numeric fields on AA model records, so dynamic benchmark discovery skips them.
  const NON_BENCH = new Set([
    'id', 'slug', 'name', 'shortName', 'release', 'creator', 'effort', 'isReasoning', 'isOpenWeights', 'deprecated',
    'intelligenceIndexIsEstimated', 'releaseDate', 'intelligenceIndex', 'intelligenceIndexCost', 'intelligenceIndexCostPerTask',
    'intelligenceIndexOutputTokensPerTask', 'intelligenceIndexTimePerTask', 'intelligenceIndexEvaluations',
    'canonicalIntelligenceIndexTokenCount', 'price1mBlended0To3To1', 'price1mBlended7To2To1', 'price1mBlended0To1To1',
    'price1mBlended100To1To1', 'price1mBlended0To100To1', 'price1mInputTokens', 'price1mOutputTokens',
    'pricePerInputToken', 'pricePerOutputToken', 'pricePerReasoningToken', 'pricePerCachedInputToken', 'cacheReadPrice',
    'cacheHitPrice', 'cacheHitDiscountPercent', 'cacheWritePrice', 'pricePer1k1mpImages',
    'timescaleData', 'medianOutputSpeed', 'outputSpeedVariance', 'timeToFirstChunkVariance', 'performanceByPromptType',
    'timeToFirstAnswerToken', 'endToEndResponseTime', 'parameters', 'inferenceParametersActiveBillions',
    'contextWindowTokens', 'reasoningTokens', 'hostModelCount', 'chartDefaultSelected', 'chartHighlighted',
    'briefcaseBreakdown', 'briefcaseTotalCost', 'briefcaseElo', 'gdpvalNormalized', 'openness', 'capabilities',
    'automationBenchPartialScore', 'enterpriseOpsGym', 'itBenchSre', 'gdpPdfAllPass', 'mlcrOverall', 'harveyLab',
    'omniscienceHallucinationRate', 'score', 'briefcaseElo', 'itbenchSre', 'opennessIndex', 'cyberIndex', 'activeParams',
    'cacheHitRate', 'medianCanonicalAnswerOutputSpeed', 'enterpriseOpsGymAvgConversationTurns', 'itbenchAvgTurnsPerTask',
    'cweBenchRefusalRate', 'deepsecBenchRefusalRate', 'cybergymE2eRefusalRate', 'analystAgentPassAt1', 'analystAgentPassAtK',
    'mlcrAccuracy', 'mlcrCompleteness', 'knowledgeCutoffDate', 'sizeClass',
    // read by BENCHMARKS under other names
    'critptAgenticHard', 'critptAgentic', 'globalMmluLiteScore', 'healthbenchProfessional', 'code2videoElo', 'aa3dElo', 'cybergymE2e',
  ]);

  const humanizeKey = (k) => k.replace(/^cap_/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());

  function buildModels(manifests) {
    // Model-level arrays (objects with intelligenceIndex), endpoint-level arrays (objects with host + modelId),
    // and specialized index arrays (cyberIndexModels, decisionIndexContestants).
    const modelById = new Map(), modelBySlug = new Map();
    const endpoints = [], cyber = [], decision = [];
    for (const m of manifests) {
      if (Array.isArray(m?.cyberIndexModels)) cyber.push(...m.cyberIndexModels);
      if (Array.isArray(m?.decisionIndexContestants)) decision.push(...m.decisionIndexContestants);
      const arrays = Array.isArray(m) ? [m] : Object.values(m).filter(Array.isArray);
      for (const arr of arrays) {
        if (arr === m?.cyberIndexModels || arr === m?.decisionIndexContestants) continue;
        for (const o of arr) {
          if (!o || typeof o !== 'object') continue;
          if ('intelligenceIndex' in o && o.creator && !('refusalRate' in o && 'score' in o)) {
            // Merge: later/richer records fill in missing fields.
            const prev = modelById.get(o.id) || {};
            for (const [k, v] of Object.entries(o)) if (prev[k] == null || (typeof v === 'object' && v && Object.keys(v).length > Object.keys(prev[k] || {}).length)) prev[k] = v;
            modelById.set(o.id, prev);
            if (prev.slug) modelBySlug.set(prev.slug, prev);
          } else if (o.modelId && o.host) endpoints.push(o);
        }
      }
    }
    for (const c of cyber) {
      const m = modelById.get(c.id) || modelBySlug.get(c.slug);
      if (m && Number.isFinite(c.score)) m._cyberIndex = c.score;
    }
    for (const d of decision) {
      if (d.kind && d.kind !== 'llm') continue;
      const m = modelById.get(d.id) || modelBySlug.get(d.slug);
      if (m && Number.isFinite(d.indexScore)) m._decisionIndex = d.indexScore;
    }

    const speedByModel = new Map();
    for (const e of endpoints) {
      const s = e.timescaleData?.medianOutputSpeed;
      if (!Number.isFinite(s)) continue;
      (speedByModel.get(e.modelId) || speedByModel.set(e.modelId, []).get(e.modelId)).push(s);
    }

    // Every model AA lists. A new index version is first run on the newest models only (v5.0 scored 78 of ~270 current
    // ones at launch), so a model without an index score is kept as long as it has some benchmark result.
    const rawModels = [...modelById.values()].filter((m) => m.name && m.creator);
    // A numeric field AA adds later, and that this file does not already name, becomes a benchmark on its own.
    const dynamicBenchmarks = discoverNumericFields(rawModels);
    const dynamicKeys = dynamicBenchmarks.map((b) => b.key);
    const getters = [...BENCHMARKS, ...dynamicKeys.map((k) => [k, (m) => (k.startsWith('cap_') ? m.capabilities?.[k.slice(4)] : m[k])])];
    const slugKey = indexKeysOf(rawModels, getters);

    const models = rawModels
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
        costPerTask: num(m.intelligenceIndexCostPerTask?.cost?.total ?? m.intelligenceIndexCostPerTask?.total),
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
        ...Object.fromEntries(getters.map(([k, get]) => [k, num(get(m))])),
        // each Intelligence Index evaluation's own cost and output tokens per task: { key: [usd, tokens] }
        evals: evalsOf(m, slugKey),
        defaultSelected: !!m.chartDefaultSelected,
      }))
      .filter((m) => m.intelligence != null || getters.some(([k]) => k !== 'openness' && m[k] != null))
      .sort((a, b) => (b.intelligence ?? -1) - (a.intelligence ?? -1));
    return { models, dynamicBenchmarks, slugKey };
  }
  const CAP_KEYS = {
    financeAndAccounting: 'capFinance',
    strategyAndOps: 'capStrategy',
    legal: 'capLegal',
    healthcareAndMedical: 'capMedical',
    engineering: 'capEngineering',
    economics: 'capEconomics',
  };
  // Every per-model benchmark the site publishes (the page's METRICS has the labels): our key -> the field on AA's record.
  const BENCHMARKS = Object.entries({
    gpqa: (m) => m.gpqa, hle: (m) => m.hle, critpt: (m) => m.critpt, scicode: (m) => m.scicode,
    omniscience: (m) => m.omniscience, omniscienceAccuracy: (m) => m.omniscienceAccuracy, hallucination: (m) => m.omniscienceHallucinationRate,
    lcr: (m) => m.lcr, ifbench: (m) => m.ifbench, mmmuPro: (m) => m.mmmuPro, livecodebench: (m) => m.livecodebench, aime25: (m) => m.aime25,
    hleDiamond: (m) => m.hleDiamond, critptHard: (m) => m.critptAgenticHard, critptV2: (m) => m.critptAgentic,
    globalMmlu: (m) => m.globalMmluLiteScore, mmluPro: (m) => m.mmluPro, math500: (m) => m.math500,
    healthbench: (m) => m.healthbench, healthbenchPro: (m) => m.healthbenchProfessional,
    terminalBench40: (m) => m.terminalBench40, terminalBench21: (m) => m.terminalBench21, terminalbenchHard: (m) => m.terminalbenchHard, terminalBenchScience: (m) => m.terminalBenchScience,
    frontierCode20: (m) => m.frontierCode20, frontierCode: (m) => m.frontierCode, code2video: (m) => m.code2videoElo, aa3d: (m) => m.aa3dElo,
    cyberIndex: (m) => m._cyberIndex ?? m.cyberIndex, cweBench: (m) => m.cweBench, deepsecBench: (m) => m.deepsecBench, cybergym: (m) => m.cybergymE2e,
    decisionIndex: (m) => m._decisionIndex,
    tau2: (m) => m.tau2, tauBanking: (m) => m.tauBanking, automationBench: (m) => m.automationBenchPartialScore, enterpriseOps: (m) => m.enterpriseOpsGym,
    apexAgents: (m) => m.apexAgents, itBench: (m) => m.itBenchSre, analystAgent: (m) => m.analystAgent,
    gdpval: (m) => m.gdpval, briefcase: (m) => m.briefcaseBreakdown?.overall?.elo ?? m.briefcaseElo, gdpPdf: (m) => m.gdpPdfAllPass, mlcr: (m) => m.mlcrOverall, harvey: (m) => m.harveyLab,
    capFinance: (m) => m.capabilities?.financeAndAccounting, capStrategy: (m) => m.capabilities?.strategyAndOps,
    capLegal: (m) => m.capabilities?.legal, capMedical: (m) => m.capabilities?.healthcareAndMedical,
    capEngineering: (m) => m.capabilities?.engineering, capEconomics: (m) => m.capabilities?.economics,
    openness: (m) => m.openness?.opennessIndex ?? m.opennessIndex,
  });

  // Numeric fields on AA's own records that are not in BENCHMARKS or NON_BENCH. Called from a scrape, and from
  // tests/dynamic-benchmarks.mjs with a fake record, so a new eval shows up without a code change.
  function discoverNumericFields(rawModels) {
    const knownKeys = new Set(BENCHMARKS.map(([k]) => k));
    const extraBench = new Map();
    for (const m of rawModels) {
      for (const [k, v] of Object.entries(m)) {
        if (k.startsWith('_') || NON_BENCH.has(k) || knownKeys.has(k) || !Number.isFinite(v)) continue;
        const cur = extraBench.get(k) || { n: 0, min: Infinity, max: -Infinity, cap: false };
        cur.n++; cur.min = Math.min(cur.min, v); cur.max = Math.max(cur.max, v);
        extraBench.set(k, cur);
      }
      if (m.capabilities && typeof m.capabilities === 'object') {
        for (const [ck, cv] of Object.entries(m.capabilities)) {
          const key = CAP_KEYS[ck] || 'cap_' + ck;
          if (knownKeys.has(key) || !Number.isFinite(cv)) continue;
          const cur = extraBench.get(key) || { n: 0, min: Infinity, max: -Infinity, cap: true, rawKey: ck };
          cur.n++; cur.min = Math.min(cur.min, cv); cur.max = Math.max(cur.max, cv);
          extraBench.set(key, cur);
        }
      }
    }
    return [...extraBench.entries()].filter(([, s]) => s.n >= 1).map(([k, s]) => {
      const frac = s.min >= 0 && s.max > 0 && s.max <= 1;
      const elo = s.max > 400;
      const label = humanizeKey(k);
      return {
        key: k, rawKey: s.rawKey || k, label, long: `Artificial Analysis ${label}`,
        fmt: frac ? 'pct' : elo ? 'elo' : 'one', frac,
        group: s.cap ? 'Work & documents' : /code|term|swe/i.test(k) ? 'Coding & terminal' : /agent|bench|ops|tau/i.test(k) ? 'Agents & tool use' : 'Knowledge & reasoning',
      };
    });
  }

  // The Intelligence Index evaluations (AA's slugs) under the page's metric keys. Only a seed: indexKeysOf works the
  // mapping out from the data, so an evaluation that joins the index later is matched without an edit here.
  const INDEX_EVALS = {
    'aa-briefcase': 'briefcase', 'gdpval-aa': 'gdpval', 'automationbench-aa': 'automationBench', 'terminalbench-4-0': 'terminalBench40',
    scicode: 'scicode', 'humanitys-last-exam': 'hle', 'gdp-pdf': 'gdpPdf', critpt: 'critpt', omniscience: 'omniscience',
    'artificial-analysis-long-context-reasoning': 'lcr', 'frontiercode-2-0': 'frontierCode20', 'hle-diamond': 'hleDiamond',
    'critpt-v2-hard': 'critptHard', 'terminal-bench-science': 'terminalBenchScience',
  };
  // Each index evaluation's slug -> the benchmark key whose value equals the evaluation's score on (nearly) every model
  // that has both. Scores of 0 and 1 are too common to tell fields apart, so they don't count. The seed wins whenever its
  // key agrees; otherwise one clear winner is needed, and a tie or no agreeing key keeps the seed (or the slug's own name).
  function indexKeysOf(rawModels, getters) {
    const stats = new Map();
    for (const m of rawModels) for (const e of m.intelligenceIndexEvaluations || []) {
      const st = stats.get(e.slug) || stats.set(e.slug, new Map()).get(e.slug);
      if (!Number.isFinite(e.score) || e.score === 0 || e.score === 1) continue;
      for (const [k, get] of getters) {
        const x = get(m);
        if (!Number.isFinite(x)) continue;
        const c = st.get(k) || st.set(k, { hit: 0, seen: 0 }).get(k);
        c.seen++;
        if (Math.abs(x - e.score) <= 1e-9 * Math.max(1, Math.abs(x))) c.hit++;
      }
    }
    const out = {};
    for (const [slug, st] of stats) {
      const seed = INDEX_EVALS[slug];
      const agree = [...st].filter(([, c]) => c.hit && c.hit >= 0.9 * c.seen).sort((a, b) => b[1].hit - a[1].hit);
      out[slug] = seed && agree.some(([k]) => k === seed) ? seed
        : agree.length && (agree.length === 1 || agree[0][1].hit > agree[1][1].hit) ? agree[0][0] : seed || slug;
    }
    return out;
  }
  const round = (v) => +v.toPrecision(4);
  function evalsOf(m, slugKey) {
    const out = {};
    for (const e of m.intelligenceIndexEvaluations || []) {
      const k = slugKey[e.slug] || INDEX_EVALS[e.slug] || e.slug;
      if (Number.isFinite(e.costPerTask)) out[k] = [round(e.costPerTask), Number.isFinite(e.outputTokensPerTask) ? Math.round(e.outputTokensPerTask) : null];
    }
    return Object.keys(out).length ? out : null;
  }
  // Each evaluation's weight in the index, read off a model with the full cost breakdown (weighted cost ÷ cost).
  function indexWeightsOf(manifests, slugKey) {
    for (const man of manifests) for (const arr of Array.isArray(man) ? [man] : Object.values(man).filter(Array.isArray)) for (const m of arr) {
      const weighted = m?.intelligenceIndexCostPerTask?.evaluations, evs = m?.intelligenceIndexEvaluations;
      if (!Array.isArray(weighted) || !Array.isArray(evs) || weighted.length < 2) continue;
      const w = {};
      for (const e of weighted) {
        const c = evs.find((x) => x.slug === e.slug)?.costPerTask;
        if (!(c > 0) || !Number.isFinite(e.weightedCostPerTask)) { w.bad = 1; break; }
        w[slugKey[e.slug] || INDEX_EVALS[e.slug] || e.slug] = Math.round((e.weightedCostPerTask / c) * 1000) / 1000;
      }
      const sum = Object.values(w).reduce((a, b) => a + b, 0);
      if (!w.bad && Math.abs(sum - 1) < 0.01) return w;
    }
    return null;
  }
  // The index's version, from the newest "methodology updated" entry in the site's feed that names one.
  const indexVersionOf = (changelog) => {
    for (const c of changelog) { const v = /Intelligence Index (v\d+(?:\.\d+)*)/.exec(c.title)?.[1]; if (v && c.type === 'methodologyUpdated') return { version: v, since: c.date }; }
    for (const c of changelog) { const v = /Intelligence Index (v\d+(?:\.\d+)*)/.exec(c.title)?.[1]; if (v) return { version: v, since: c.date }; }
    return null;
  };

  // The methodology page: every evaluation's name, section, status ("Included in … v5.0 at 15% weighting", "Removed …",
  // "Standalone …") and description, under the page's metric keys. Run by the deploy (scrape.mjs) only.
  const ANCHOR_KEYS = {
    'critpt-v2-hard': 'critptHard', 'critpt-v2': 'critptV2', 'harvey-lab-aa': 'harvey', 'enterprise-ops-gym-aa': 'enterpriseOps',
    'global-mmlu-lite': 'globalMmlu', 'gpqa-diamond': 'gpqa', 'tau3-banking': 'tauBanking', 'tau2-bench-telecom': 'tau2',
    aime: 'aime25', 'aa-lcr': 'lcr', healthbench: 'healthbench',
  };
  const normKey = (k) => k.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/v(?=\d)/g, '').replace(/^aa|aa$/g, '');
  function parseMethodology(html, keys) {
    const rows = new Map();
    for (const line of rscPayload(html).split('\n')) { const m = /^([0-9a-f]+):(.*)$/.exec(line); if (m) rows.set(m[1], m[2]); }
    const text = (n) => typeof n === 'string' ? n : Array.isArray(n) ? (n[0] === '$' ? text(n[3]?.children) : n.map(text).join('')) : '';
    const byNorm = new Map(keys.map((k) => [normKey(k), k]));
    const evals = [], seen = new Set();
    const walk = (o, path) => {
      if (Array.isArray(o)) return o.forEach((x) => walk(x, path));
      if (!o || typeof o !== 'object') return;
      if (o.type === 'section' && o.section) {
        const sec = o.section, nodes = (sec.content || []).filter((c) => c.type === 'node').map((c) => String(c.node).replace(/^\$L?/, ''));
        let body = '';
        for (const id of nodes) { try { body += text(JSON.parse(rows.get(id) || 'null')) + '\n'; } catch {} }
        const status = /(?:Status|Note):\s*([^\n]*?)(?=Description:|$)/s.exec(body)?.[1]?.trim();
        const desc = /Description:\s*(.*?)(?=(?:Paper|Dataset|Key|Repository|Source|Website|Code|Announcement|Implementation|Methodology|Blog|Leaderboard|Note)s?:|\n|$)/s.exec(body)?.[1]?.trim();
        const key = ANCHOR_KEYS[sec.anchor] || byNorm.get(normKey(sec.anchor || '')) || null;
        if (desc && sec.anchor && !seen.has(sec.anchor)) {
          seen.add(sec.anchor);
          const inc = /^Included in [^.]*?Intelligence Index (v[\d.]+?)\.? at (\d+(?:\.\d+)?)% weighting/.exec(status || '');
          evals.push({ anchor: sec.anchor, key, name: sec.heading, group: path[path.length - 1] || null, status: status || null, desc,
            ...(inc ? { inIndex: true, weight: +inc[2] / 100 } : {}) });
        }
        return walk(sec.content, [...path, sec.heading]);
      }
      for (const v of Object.values(o)) walk(v, path);
    };
    for (const raw of rows.values()) if (raw.includes('"type":"section"')) { try { walk(JSON.parse(raw), []); } catch {} }
    const all = [...rows.values()].join('\n');
    const head = /Intelligence Index (v\d+(?:\.\d+)*) incorporates (\d+) evaluations/.exec(all);
    return evals.length ? { version: head?.[1] || null, count: head ? +head[2] : null, evals } : null;
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

  // -> { v, scrapedAt, source, models, dynamicBenchmarks, indexWeights, changelog, codingAgents }
  // extraPages: also read the optional pages. When one can't be read the result says `partial: true`, and the page keeps
  // what only that page supplied from the copy it already has (see fillPartial in index.html).
  async function scrape({ fetchOpts = {}, log = () => {}, extraPages = true } = {}) {
    let manifests;
    try { manifests = await loadManifests(fetchOpts, log, extraPages); }
    catch (err) {
      // The pages and the manifests are cached separately, so just as the site changes its keys a page's key can briefly
      // belong to the manifest's next or previous version. Give the caches a moment and read everything again, once.
      if (!err.keyMismatch) throw err;
      log(`${err.message.replace(/; try again$/, '')}; reading again`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      manifests = await loadManifests(fetchOpts, log, extraPages);
    }
    const { models: built, dynamicBenchmarks, slugKey } = buildModels(manifests);
    // Most models have only some benchmarks: leave the missing ones out rather than storing nulls.
    const models = built.map((m) => Object.fromEntries(Object.entries(m).filter(([, v]) => v != null)));
    if (!models.length) throw new Error('Decoded the data but found no models — the format may have changed.');
    const changelog = changelogOf(manifests), indexWeights = indexWeightsOf(manifests, slugKey);
    // What the index is made of right now: its version and each evaluation's benchmark key and weight.
    const index = indexWeights ? { ...indexVersionOf(changelog), evals: Object.entries(indexWeights).map(([key, weight]) => ({ key, weight, slug: Object.keys(slugKey).find((s) => slugKey[s] === key) || key })) } : null;
    return { v: VERSION, scrapedAt: new Date().toISOString(), source: BASE, models, ...(dynamicBenchmarks.length ? { dynamicBenchmarks } : {}), indexWeights, index, changelog, codingAgents: codingAgentsOf(manifests), ...(manifests.partial ? { partial: true } : {}) };
  }
  // The methodology page through the same fetch (Node only: it's large, and the deploy refreshes it for everyone).
  async function scrapeMethodology({ fetchOpts = {}, keys = [] } = {}) {
    const res = await fetch(BASE + METHODOLOGY, { signal: AbortSignal.timeout?.(30000), ...fetchOpts });
    if (!res.ok) throw new Error(`${METHODOLOGY}: HTTP ${res.status}`);
    return parseMethodology(await res.text(), keys);
  }
  // Bump when the saved shape changes, so the page ignores copies saved by an older version.
  const VERSION = 5; // 5: Intelligence Index v5 (index makeup from the data, models without an index score kept); 4: dynamic AA benchmarks

  globalThis.AAData = { scrape, scrapeMethodology, parseMethodology, VERSION, discoverNumericFields };
})();
