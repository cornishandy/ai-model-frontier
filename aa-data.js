// Fetches and decodes model data from artificialanalysis.ai. Shared by the page's "Update data"
// button and by scrape.mjs, so it only uses web-standard APIs (fetch, WebCrypto, DecompressionStream).
//
// The site embeds encrypted data "manifests" in its Next.js RSC payload:
// AES-256-GCM, key in the page, IV = sha256(key)[0..12], gzip-compressed JSON.
// The site serves these with `Access-Control-Allow-Origin: *`, so a page opened from disk can fetch them.
(() => {
  const BASE = 'https://artificialanalysis.ai';
  const PAGES = ['/models', '/'];

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
    const get = async (path) => {
      const res = await fetch(BASE + path, fetchOpts);
      if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
      return res;
    };
    const seen = new Map();
    for (const page of PAGES) {
      const rsc = rscPayload(await (await get(page)).text());
      for (const m of rsc.matchAll(/"manifest":\{"path":"([^"]+)","key":"([0-9a-f]+)"/g)) {
        if (seen.has(m[1])) continue;
        seen.set(m[1], await decrypt(await (await get(m[1])).arrayBuffer(), m[2]));
        log(`decrypted ${m[1]} (from ${page})`);
      }
    }
    if (!seen.size) throw new Error('No data manifests found — the site layout may have changed.');
    return [...seen.values()];
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
        timePerTask: num(m.intelligenceIndexTimePerTask),
        gpqa: num(m.gpqa),
        hle: num(m.hle),
        scicode: num(m.scicode),
        terminalBench: num(m.terminalBench40 ?? m.terminalbenchHard),
        omniscience: num(m.omniscience),
        gdpval: num(m.gdpval),
        defaultSelected: !!m.chartDefaultSelected,
      }))
      .sort((a, b) => b.intelligence - a.intelligence);
  }

  // -> { scrapedAt, source, models }
  async function scrape({ fetchOpts = {}, log = () => {} } = {}) {
    const models = buildModels(await loadManifests(fetchOpts, log));
    if (!models.length) throw new Error('Decoded the data but found no models — the format may have changed.');
    return { scrapedAt: new Date().toISOString(), source: BASE, models };
  }

  globalThis.AAData = { scrape };
})();
