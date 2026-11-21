// Square-root track formula (mix-slider.ts) and ranking-fit optimization idea
// (optimizer.ts) adapted from adamholter/priors, MIT License.
(() => {
  const { weightHundredths, roundWeight, normalizeWeights } = globalThis.FrontierScoring;
  const trackToWeight = track => roundWeight((track / 50) ** 2);
  const weightToTrack = weight => 50 * Math.sqrt(roundWeight(weight));

  function sharesFromWeights(weights) {
    const entries = Object.entries(normalizeWeights(weights));
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    return Object.fromEntries(entries.map(([key, weight]) => [key, Math.round(100 * weight / total)]));
  }

  function serializeMix(weights) {
    return Object.entries(normalizeWeights(weights)).map(([key, weight]) => `${key}:${weight.toFixed(2)}`).join(',');
  }

  function parseMix(query, validKeys) {
    const known = new Set(validKeys);
    const entries = [];
    for (const part of (query || '').split(',')) {
      const sep = part.lastIndexOf(':');
      if (sep < 1) continue;
      const key = part.slice(0, sep);
      const weight = roundWeight(part.slice(sep + 1));
      if (known.has(key) && weight > 0) entries.push([key, weight]);
    }
    return normalizeWeights(Object.fromEntries(entries));
  }

  function shannonEntropy(weights) {
    const values = Object.values(normalizeWeights(weights)).map(weightHundredths).sort((a, b) => a - b);
    const total = values.reduce((sum, w) => sum + w, 0);
    return values.reduce((entropy, weight) => {
      const share = weight / total;
      return entropy - share * Math.log(share);
    }, 0);
  }

  function pairAgreement(targetIds, rankedRows) {
    const ranks = new Map(rankedRows.map(row => [row.id, row.rank]));
    let matched = 0, total = 0, weighted = 0, reversed = 0;
    for (let i = 0; i < targetIds.length; i++) {
      const first = ranks.get(targetIds[i]);
      for (let j = i + 1; j < targetIds.length; j++) {
        const second = ranks.get(targetIds[j]);
        total++;
        if (!Number.isFinite(first) || !Number.isFinite(second)) continue;
        if (first < second) { matched++; weighted += 1 / (i + 1) ** 2; }
        if (first > second) reversed++;
      }
    }
    return { matched, total, weighted, reversed };
  }

  function kendallTau(targetIds, rankedRows) {
    const { matched, total, reversed } = pairAgreement(targetIds, rankedRows);
    return total > 0 && matched + reversed === total ? (matched - reversed) / total : null;
  }

  async function fitWeights({ targetIds, candidateKeys, deriveFn, maxBenches = 6, timeBudgetMs = 2500, onProgress, shouldStop = () => false }) {
    const keys = [...new Set(candidateKeys)].filter(key => typeof key === 'string' && key && !Object.hasOwn(Object.prototype, key));
    const limit = Math.max(1, Math.min(keys.length, Math.floor(maxBenches) || 1));
    if (targetIds.length < 2 || !keys.length) return null;

    const now = () => performance.now();
    const deadline = now() + Math.max(0, timeBudgetMs);
    const refineEnd = deadline - Math.min(50, timeBudgetMs * 0.08);
    const searchEnd = Math.min(refineEnd, deadline - timeBudgetMs * 0.15);
    const seen = new Set();
    let best = null, sliceStart = now(), seed = 0x5072696f;
    // Fixed seed makes the early search reproducible. A time budget bounds the rest.
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const pick = items => items[Math.floor(random() * items.length)];
    const better = (a, b) => !b || a.ag.weighted > b.ag.weighted ||
      (a.ag.weighted === b.ag.weighted && a.entropy > b.entropy);
    const score = draft => {
      const weights = Object.fromEntries(Object.entries(normalizeWeights(draft)).sort(([a], [b]) => a.localeCompare(b)));
      const ranked = deriveFn(weights);
      return { weights, ranked, ag: pairAgreement(targetIds, ranked), entropy: shannonEntropy(weights) };
    };
    const evaluate = (draft, verify = false) => {
      const signature = serializeMix(Object.fromEntries(Object.entries(draft).sort(([a], [b]) => a.localeCompare(b))));
      if (!signature || (!verify && seen.has(signature))) return null;
      seen.add(signature);
      const candidate = score(draft);
      if (better(candidate, best)) {
        best = candidate;
        onProgress?.(best);
      }
      return candidate;
    };
    async function yieldFrame() {
      if (now() - sliceStart < 12) return;
      await new Promise(resolve => setTimeout(resolve, 0));
      sliceStart = now();
    }

    const starts = [];
    for (const key of keys) {
      if (shouldStop()) return null;
      if (best && now() >= searchEnd) break;
      starts.push(evaluate({ [key]: 1 }));
      await yieldFrame();
    }
    starts.sort((a, b) => b.ag.weighted - a.ag.weighted);
    if (now() < searchEnd) evaluate(Object.fromEntries(starts.slice(0, limit).flatMap(start => Object.entries(start.weights))));
    for (let restart = 0; now() < searchEnd && restart < 140; restart++) {
      let current = restart % 3 === 0 ? best : pick(starts.slice(0, Math.min(12, starts.length)));
      for (let step = 0; step < 36 && now() < searchEnd; step++) {
        if (shouldStop()) return null;
        const draft = { ...current.weights }, used = Object.keys(draft);
        const key = step < keys.length && restart % 2 === 0 ? keys[(step + restart) % keys.length] : pick(keys);
        if (!Object.hasOwn(draft, key) && used.length >= limit) delete draft[pick(used)];
        const value = draft[key] ?? 1;
        draft[key] = pick([0, 0.25, 0.75, 1, 1.5, 2.5, 4, Math.min(4, value * (0.65 + random() * 0.7))]);
        const candidate = evaluate(draft);
        if (candidate) {
          const temperature = 0.22 * (1 - step / 36);
          const delta = candidate.ag.weighted - current.ag.weighted;
          if (better(candidate, current) || random() < Math.exp(delta / temperature)) current = candidate;
        }
        await yieldFrame();
      }
    }
    // Polish the incumbent with an exact coordinate ascent around each weight
    // and the even-weight alternative. Keep annealing away from this final pass.
    for (const key of Object.keys(best.weights)) {
      for (const weight of [1, best.weights[key] - 0.05, best.weights[key] + 0.05]) {
        if (now() >= refineEnd || shouldStop()) break;
        if (weight > 0 && weight <= 4) evaluate({ ...best.weights, [key]: weight });
        await yieldFrame();
      }
    }
    // Every removal is verified against the same full ranking. A removal can
    // improve the objective or retain it and win on entropy.
    for (const key of Object.keys(best.weights)) {
      if (now() >= deadline || Object.keys(best.weights).length <= 1) break;
      const draft = { ...best.weights };
      delete draft[key];
      evaluate(draft, true);
      await yieldFrame();
    }
    return shouldStop() ? null : score(best.weights);
  }

  globalThis.PriorsFit = {
    weightHundredths, roundWeight, normalizeWeights, trackToWeight, weightToTrack,
    sharesFromWeights, serializeMix, parseMix, shannonEntropy, pairAgreement, kendallTau, fitWeights,
  };
})();
