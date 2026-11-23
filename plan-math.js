// Pure, zero-DOM, deterministic subscription pricing, lane, geometry, footer, and typed-projection engine.
// Shared by index.html, standalone AI Model Frontier.html, scripts/gen-facts.mjs, and tests/plan-pricing.mjs.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    const api = factory();
    root.PlanMath = api;
    root.PlanMathB = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const hasOwn = (obj, key) => !!obj && Object.prototype.hasOwnProperty.call(obj, key);

  // Single fixed constant governing untouched first-visit toggle AND all Example entry plans SVG/PNG exports.
  const PUBLIC_DEFAULT_ESTIMATES = true;

  const PLANS_STORAGE_KEY = 'aa-charts:plans-v1';
  const PRICE_MODES = ['api', 'plan', 'pct'];
  const LEGACY_AXES = new Set(['planCost', 'planTasks']);
  const PRICE_ELIGIBLE_METRICS = new Set(['costPerTask', 'myCost']);
  const UTIL_STEPS = [1, 0.75, 0.5, 0.25];
  const LAB_ORDER = ['anthropic', 'openai', 'google', 'xai'];

  const DISCLOSURES = {
    fourWeeks: 'We use four weeks per month to allocate the monthly plan fee. Plan dollars per task estimate the share of that fee at your selected use.',
    download: 'Subscription images use Example entry plans and the default estimate setting. If you have changed either, they can differ from your live chart. Legacy plan-axis images use the default plan picks and fee.',
    legacySwitchCost: 'Legacy plan axis switched to Cost per task for this Price view.',
    legacySwitchIntel: 'Legacy plan axis switched to Intelligence for this Price view.',
    legacySwitchBoth: 'Legacy plan axes switched to Cost per task and Intelligence for this Price view.',
    lane2Key: 'Approximate plan estimate · not used for the frontier',
    frontierMeasuredOnly: 'Pareto frontier (measured plans only)',
    frontierMeasuredAndScaled: 'Pareto frontier (measured & scaled plans; excludes ≈)',
    frontierDefault: 'Pareto frontier',
    legacyExportTitleCost: 'Plan cost per task · default plan prices',
    legacyExportTitleTasks: 'Tasks a month · default plan prices',
    legacyExportAxisCost: 'Plan cost per task (estimated, legacy API-fee math)',
    legacyExportAxisTasks: 'Tasks a month (legacy API-fee math, higher is better)',
  };

  function normalizeLab(slug) {
    if (slug === 'spacexai') return 'xai';
    if (slug === 'kimi') return 'moonshot';
    return slug;
  }

  function labName(lab) {
    return { anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google', xai: 'xAI', moonshot: 'Kimi' }[lab] || lab;
  }

  function parseNowMs(nowOpt) {
    if (nowOpt === undefined) return Date.now();
    const ms = typeof nowOpt === 'number' ? nowOpt : Date.parse(nowOpt);
    if (!Number.isFinite(ms)) throw new RangeError(`Invalid opts.now timestamp: ${String(nowOpt)}`);
    return ms;
  }

  function getPlan(catalog, planId) {
    if (!planId || typeof planId !== 'string') return null;
    return hasOwn(catalog?.plans, planId) ? catalog.plans[planId] : null;
  }

  function parseFeeInput(raw) {
    const s = String(raw ?? '').trim().replace(',', '.');
    if (s === '') return { ok: true, fee: null };
    if (!/^\d+(?:\.\d{1,2})?$/.test(s)) return { ok: false, fee: null };
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0 || n > 100000) return { ok: false, fee: null };
    return { ok: true, fee: n };
  }

  function fmtFeeEcho(v) {
    if (!Number.isFinite(v)) return '0';
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
  }

  function getExampleProfile(catalog, presetName = 'entry', publicDefaultEstimates = PUBLIC_DEFAULT_ESTIMATES) {
    const preset = hasOwn(catalog?.presets, presetName) ? catalog.presets[presetName] : catalog?.presets?.entry;
    const plans = {};
    for (const lab of LAB_ORDER) {
      const pid = preset?.plans?.[lab] || 'none';
      plans[lab] = { id: pid, fee: null };
    }
    return {
      plans,
      use: 1,
      fableCap: 'shared',
      estimate: !!publicDefaultEstimates,
    };
  }

  function sanitizeProfile(raw, catalog, publicDefaultEstimates = PUBLIC_DEFAULT_ESTIMATES) {
    const base = getExampleProfile(catalog, 'entry', publicDefaultEstimates);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
    const plans = {};
    for (const lab of LAB_ORDER) {
      const entry = raw.plans && hasOwn(raw.plans, lab) ? raw.plans[lab] : null;
      const rawId = entry && typeof entry.id === 'string' ? entry.id : base.plans[lab].id;
      const plan = rawId === 'none' ? null : getPlan(catalog, rawId);
      const validId = rawId === 'none' ? 'none' : (plan && plan.lab === lab ? rawId : base.plans[lab].id);
      let fee = null;
      if (validId !== 'none' && entry && entry.fee != null) {
        const n = Number(entry.fee);
        if (Number.isFinite(n) && n >= 0 && n <= 100000) fee = Math.round(n * 100) / 100;
      }
      plans[lab] = { id: validId, fee };
    }
    const use = UTIL_STEPS.includes(Number(raw.use)) ? Number(raw.use) : 1;
    const fableCap = raw.fableCap === 'own' ? 'own' : 'shared';
    const estimate = typeof raw.estimate === 'boolean' ? raw.estimate : !!publicDefaultEstimates;
    return { plans, use, fableCap, estimate };
  }

  function loadLocalProfile(storage, catalog, publicDefaultEstimates = PUBLIC_DEFAULT_ESTIMATES) {
    try {
      const txt = storage?.getItem?.(PLANS_STORAGE_KEY);
      if (!txt) return getExampleProfile(catalog, 'entry', publicDefaultEstimates);
      return sanitizeProfile(JSON.parse(txt), catalog, publicDefaultEstimates);
    } catch {
      return getExampleProfile(catalog, 'entry', publicDefaultEstimates);
    }
  }

  function saveLocalProfile(storage, profile, catalog) {
    try {
      const clean = sanitizeProfile(profile, catalog);
      storage?.setItem?.(PLANS_STORAGE_KEY, JSON.stringify(clean));
      return true;
    } catch {
      return false;
    }
  }

  // First-visit & returning default price mode resolution.
  function resolveInitialPrice({ hasSavedState, savedPrice, urlX, urlY, urlPrice } = {}) {
    if (PRICE_MODES.includes(urlPrice)) return urlPrice;
    if (hasSavedState) return PRICE_MODES.includes(savedPrice) ? savedPrice : 'api';
    if (LEGACY_AXES.has(urlX) || LEGACY_AXES.has(urlY)) return 'api';
    return 'plan';
  }

  // Explicit Plan $ or % of week selection while one or both axes are legacy.
  // Names the exact destination axis (costPerTask vs intelligence vs both) and never collapses to y = x.
  function switchFromLegacyAxes({ x, y, targetPrice }) {
    if (targetPrice !== 'plan' && targetPrice !== 'pct') {
      return { x, y, price: targetPrice, switched: false, notice: null };
    }
    const xLeg = LEGACY_AXES.has(x);
    const yLeg = LEGACY_AXES.has(y);
    if (!xLeg && !yLeg) return { x, y, price: targetPrice, switched: false, notice: null };
    if (xLeg && yLeg) {
      return { x: 'costPerTask', y: 'intelligence', price: targetPrice, switched: true, notice: DISCLOSURES.legacySwitchBoth };
    }
    if (xLeg) {
      const toIntel = PRICE_ELIGIBLE_METRICS.has(y);
      return {
        x: toIntel ? 'intelligence' : 'costPerTask',
        y,
        price: targetPrice,
        switched: true,
        notice: toIntel ? DISCLOSURES.legacySwitchIntel : DISCLOSURES.legacySwitchCost,
      };
    }
    const toIntel = PRICE_ELIGIBLE_METRICS.has(x);
    return {
      x,
      y: toIntel ? 'intelligence' : 'costPerTask',
      price: targetPrice,
      switched: true,
      notice: toIntel ? DISCLOSURES.legacySwitchIntel : DISCLOSURES.legacySwitchCost,
    };
  }

  function hasActiveLegacyAxis(x, y) {
    return LEGACY_AXES.has(x) || LEGACY_AXES.has(y);
  }

  function isPriceEligibleAxis(metricKey) {
    return PRICE_ELIGIBLE_METRICS.has(metricKey);
  }

  // Single exact lookup + calculation from compiled PLAN_ALLOWANCES.
  function priceTask(catalog, model, profile, opts = {}) {
    const mode = PRICE_MODES.includes(opts.price) ? opts.price : 'plan';
    const basis = opts.basis || 'aa';
    const nowMs = parseNowMs(opts.now);
    const apiCost = hasOwn(opts, 'apiCost') ? opts.apiCost : model?.costPerTask;

    if (!(apiCost > 0) || !Number.isFinite(apiCost)) {
      return {
        mode, omitted: true, status: 'unavailable_cost', reasonCode: 'unavailable_cost',
        shortReason: 'Unavailable task cost',
        reason: 'Task API cost is missing or unavailable for this benchmark basis',
        val: null, lane: null, comparable: false, poolKey: null, weeklyPoolKey: null,
      };
    }

    if (mode === 'api') {
      return {
        mode: 'api', omitted: false, status: 'ok', reasonCode: 'ok',
        val: apiCost, apiCost, lane: 0, mark: 'solid', isEstimated: false,
        comparable: true, poolKey: `api|usd|task|${basis}`, weeklyPoolKey: null,
        basis: 'Pay-as-you-go API list price (Artificial Analysis)',
      };
    }

    const lab = normalizeLab(model.lab || model.creatorSlug);
    const labCfg = hasOwn(profile?.plans, lab) ? profile.plans[lab] : null;
    const planId = labCfg?.id || 'none';
    const plan = getPlan(catalog, planId);

    if (planId === 'none' || !plan) {
      return {
        mode, omitted: true, status: 'no_plan', reasonCode: 'no_plan',
        shortReason: `No ${labName(lab)} plan selected`,
        reason: `No ${labName(lab)} plan selected`,
        val: null, apiCost, lane: null, comparable: false, poolKey: null, weeklyPoolKey: null,
      };
    }

    const key = `${planId}::${model.family}`;
    const row = hasOwn(catalog?.allowances, key) ? catalog.allowances[key] : null;
    if (!row) {
      return {
        mode, omitted: true, status: 'missing_allowance', reasonCode: 'missing_allowance',
        shortReason: `No audited data on ${plan.name}`,
        reason: `Missing audited allowance for ${model.familyName || model.name || model.family} on ${plan.name}`,
        val: null, apiCost, plan, lane: null, comparable: false, poolKey: null, weeklyPoolKey: null,
      };
    }

    // Target promo expiry check (explicit status OR clock past expiresAt)
    const expMs = row.expiresAt ? Date.parse(row.expiresAt) : NaN;
    if (row.status === 'expired' || (Number.isFinite(expMs) && nowMs > expMs)) {
      return {
        mode, omitted: true, status: 'expired_promo', reasonCode: 'expired_promo',
        shortReason: row.shortReason || `${plan.name} offer ended`,
        reason: row.detailReason || row.shortReason || `${plan.name} offer ended`,
        val: null, apiCost, plan, lane: null, comparable: false, poolKey: null, weeklyPoolKey: null,
        sourceUrl: row.evidence?.sourceUrl || null,
      };
    }

    if (row.period !== 'week' && (mode === 'pct' || opts.requireWeekly)) {
      return {
        mode, omitted: true, status: 'unsupported_period', reasonCode: 'unsupported_period',
        shortReason: 'Unsupported billing period',
        reason: `${plan.name} uses a ${row.period}ly pool, not a weekly limit`,
        val: null, apiCost, plan, lane: null, comparable: false, poolKey: null, weeklyPoolKey: null,
      };
    }

    const allowEstimates = profile?.estimate !== undefined ? !!profile.estimate : PUBLIC_DEFAULT_ESTIMATES;
    if (row.lane === 2 && !allowEstimates) {
      return {
        mode, omitted: true, status: 'estimates_off', reasonCode: 'estimates_off',
        shortReason: 'Estimates off',
        reason: row.sourceClass === 'measured_low'
          ? `Low-confidence reading hidden on ${plan.name} (estimates off)`
          : `Estimate from similar model hidden on ${plan.name} (estimates off)`,
        val: null, apiCost, plan, lane: null, sourceClass: row.sourceClass,
        comparable: false, poolKey: null, weeklyPoolKey: null,
      };
    }

    const A = row.allowanceWk;
    if (!(A > 0) || !Number.isFinite(A)) {
      return {
        mode, omitted: true, status: 'missing_allowance', reasonCode: 'missing_allowance',
        shortReason: `No audited data on ${plan.name}`,
        reason: `Allowance unavailable for ${model.familyName || model.name || model.family} on ${plan.name}`,
        val: null, apiCost, plan, lane: null, comparable: false, poolKey: null, weeklyPoolKey: null,
      };
    }

    const subCap = (Number.isFinite(row.subCap) && row.subCap > 0 && row.subCap <= 1) ? row.subCap : 1;
    const hasSubCap = subCap < 1;
    const fableCapMode = profile?.fableCap === 'own' ? 'own' : 'shared';
    const W = (hasSubCap && fableCapMode === 'own') ? (A * subCap) : A;
    const fee = (labCfg?.fee != null && Number.isFinite(labCfg.fee) && labCfg.fee >= 0) ? labCfg.fee : plan.fee;
    const use = (Number.isFinite(profile?.use) && profile.use > 0 && profile.use <= 1) ? profile.use : 1;
    const weeks = row.weeks || 4;

    const planCost = (apiCost * fee) / (weeks * W * use);
    const planCostShared = (apiCost * fee) / (weeks * A * use);
    const planCostOwn = hasSubCap ? (apiCost * fee) / (weeks * A * subCap * use) : null;
    const pctShared = (100 * apiCost) / A;
    const pctOwn = hasSubCap ? (100 * apiCost) / (A * subCap) : null;
    const pctSelected = (100 * apiCost) / W;
    const tasksPerWeek = (A * subCap) / apiCost;

    const meterKind = (hasSubCap && fableCapMode === 'own') ? 'fable_cap' : (row.pool || 'shared_week');
    const poolLabel = formatPoolLabel(plan, meterKind, hasSubCap, fableCapMode);
    const weeklyPoolKey = `${planId}|${meterKind}|${row.period}|${basis}`;
    const poolKey = mode === 'plan' ? `plan_usd|${basis}` : weeklyPoolKey;

    return {
      mode,
      omitted: false,
      status: 'ok',
      reasonCode: 'ok',
      val: mode === 'plan' ? planCost : pctSelected,
      apiCost,
      allowanceWk: A,
      selectedAllowanceWk: W,
      planCost,
      planCostShared,
      planCostOwn,
      pctShared,
      pctOwn,
      pctSelected,
      tasksPerWeek,
      plan,
      fee,
      use,
      weeks,
      hasSubCap,
      subCap,
      subCapLabel: row.subCapLabel || null,
      subCapNote: row.subCapNote || null,
      fableCapMode,
      meterKind,
      pool: row.pool,
      poolLabel,
      poolKey,
      weeklyPoolKey,
      comparable: true,
      lane: row.lane,
      isLane2: row.lane === 2,
      isEstimated: row.lane === 2,
      mark: row.lane === 2 ? 'bead_ring' : 'solid',
      sourceClass: row.sourceClass,
      sourceLabel: formatSourceLabel(row.sourceClass),
      confidence: row.confidence,
      dataDate: row.dataDate,
      evidence: row.evidence,
      caveat: row.evidence?.caveat || null,
      note: row.evidence?.note || null,
    };
  }

  function formatSourceLabel(sc) {
    return {
      measured: 'Measured',
      measured_raw: 'Measured (raw sample)',
      scaled: 'Scaled from plan tier',
      measured_low: 'Direct (low conf., ≈)',
      predecessor: 'Estimated from similar model (≈)',
    }[sc] || sc;
  }

  function formatPoolLabel(plan, meterKind, hasSubCap, fableCapMode) {
    if (hasSubCap && fableCapMode === 'own') return `${plan.name} · Fable-only 50% cap`;
    if (meterKind === 'google_pro_pool') return `${plan.name} · Pro pool`;
    if (meterKind === 'google_fast_pool') return `${plan.name} · Fast pool`;
    if (meterKind === 'google_argon_pool') return `${plan.name} · Argon pool`;
    return `${plan.name} · Shared limit`;
  }

  // Evaluate Lane-1 frontier, Lane-2 "beyond" & "beaten" counts, scaled-step disclosure, and pool comparability.
  function evaluateComparison(items, { mode = 'plan', xField = null, yField = 'score', xBetter = 'low', yBetter = 'high' } = {}) {
    const plotted = [];
    const omitted = [];
    for (const item of items) {
      const p = item.price;
      if (!p || p.omitted) { omitted.push(item); continue; }
      const xVal = xField ? item[xField] : (mode === 'tasks_week' ? p.tasksPerWeek : p.val);
      const yVal = item[yField];
      if (!Number.isFinite(xVal) || !Number.isFinite(yVal)) { omitted.push(item); continue; }
      plotted.push({ ...item, xVal, yVal });
    }

    const lane1 = plotted.filter(d => d.price.lane === 1 || d.price.lane === 0);
    const lane2 = plotted.filter(d => d.price.lane === 2);

    const isWeekly = mode === 'pct' || mode === 'tasks_week';
    const lane1Pools = new Map();
    for (const d of lane1) {
      if (d.price.weeklyPoolKey) lane1Pools.set(d.price.weeklyPoolKey, d.price.poolLabel);
    }

    let comparable = true;
    let suppressReason = null;
    let soleLane1Pool = null;
    let soleLane1PoolLabel = null;
    if (isWeekly) {
      if (lane1Pools.size > 1) {
        comparable = false;
        suppressReason = `Weekly frontier suppressed: eligible models span ${lane1Pools.size} different quota pools (${[...lane1Pools.values()].join(', ')}). Pick one plan/pool to compare directly.`;
      } else if (lane1Pools.size === 1) {
        [[soleLane1Pool, soleLane1PoolLabel]] = [...lane1Pools.entries()];
      }
    }

    const betterOrEq = (a, b, dir) => dir === 'low' ? a <= b + 1e-12 : a >= b - 1e-12;
    const strictlyBetter = (a, b, dir) => dir === 'low' ? a < b - 1e-12 : a > b + 1e-12;
    const dominates = (a, b) =>
      betterOrEq(a.xVal, b.xVal, xBetter) &&
      betterOrEq(a.yVal, b.yVal, yBetter) &&
      (strictlyBetter(a.xVal, b.xVal, xBetter) || strictlyBetter(a.yVal, b.yVal, yBetter));

    let frontierSteps = [];
    if (comparable) {
      frontierSteps = lane1
        .filter(d => !lane1.some(other => other.id !== d.id && dominates(other, d)))
        .sort((a, b) => xBetter === 'low' ? (a.xVal - b.xVal || b.yVal - a.yVal) : (b.xVal - a.xVal || b.yVal - a.yVal));
    }
    const frontierIds = new Set(frontierSteps.map(d => d.id));
    const hasScaledOnFrontier = frontierSteps.some(s => s.price.sourceClass === 'scaled');

    const beyondLane2 = comparable ? lane2.filter(e =>
      !lane1.some(m => betterOrEq(m.yVal, e.yVal, yBetter) && betterOrEq(m.xVal, e.xVal, xBetter))
    ) : [];

    const beatenSteps = comparable ? frontierSteps.filter(step =>
      lane2.some(e => dominates(e, step))
    ) : [];

    const anyLane2Beyond = beyondLane2.length > 0;
    const hasOtherPoolLane2 = isWeekly && soleLane1Pool != null && lane2.some(e => e.price.weeklyPoolKey !== soleLane1Pool);

    let frontierKeyLabel = DISCLOSURES.frontierDefault;
    if (anyLane2Beyond) {
      frontierKeyLabel = hasScaledOnFrontier ? DISCLOSURES.frontierMeasuredAndScaled : DISCLOSURES.frontierMeasuredOnly;
    } else if (hasScaledOnFrontier && mode !== 'api') {
      frontierKeyLabel = DISCLOSURES.frontierMeasuredAndScaled;
    }
    if (isWeekly && soleLane1PoolLabel) {
      frontierKeyLabel = `${frontierKeyLabel} · ${soleLane1PoolLabel}`;
    }

    return {
      plotted,
      omitted,
      lane1,
      lane2,
      comparable,
      suppressReason,
      soleLane1Pool,
      soleLane1PoolLabel,
      hasOtherPoolLane2,
      frontierSteps,
      frontierIds,
      hasScaledOnFrontier,
      beyondLane2,
      beatenSteps,
      anyLane2Beyond,
      frontierKeyLabel,
      lane2KeyLabel: DISCLOSURES.lane2Key,
    };
  }

  // Geometry helpers
  function dotOuter(r, dual = 'off', p = null) {
    const R = dual === 'ring' ? r + 2.25 : dual === 'split' ? r + 0.75 : r;
    return (p && p.isLane2) ? R + 6 : R;
  }

  function beadRingSpec(r, dual = 'off') {
    const R = dotOuter(r, dual);
    return {
      baseR: R,
      beadCount: 16,
      ringRadius: R + 4,
      beadRadius: 1,
      strokeWidth: 2,
      innerEdge: R + 2,
      outerExtent: R + 6,
      startAngleDeg: -90,
      paintOrder: 'stroke fill',
    };
  }

  function pinnedCompareRadius(r, dual = 'off', p = null) {
    if (p && p.isLane2) return Math.max(10, dotOuter(r, dual, p) + 3.5);
    return 10;
  }

  function hoverLabelOffset(dual = 'off', p = null) {
    if (p && p.isLane2) return dotOuter(7, dual, p) + 5;
    return 12;
  }

  function glowRadius(p, dual = 'off') {
    return dotOuter(p?.isEnd ? 5.5 : 4.25, dual) + 3;
  }

  function effortSquareHalf(r, dual = 'off', p = null) {
    const ro = dotOuter(r, dual, p);
    return Math.max(8, ro + 2.5);
  }

  // One-line SVG omission footer with reason-grouped truncation, 3+ reason narrow overflow fallback, and exact row conservation.
  const REASON_ORDER = ['expired_promo', 'estimates_off', 'no_plan', 'missing_allowance', 'unavailable_cost', 'unsupported_period'];

  function defaultMeasurePx(text, fontSize = 9.5) {
    return text.length * (fontSize * 0.54);
  }

  function formatOmissionFooter(omittedItems, maxWidthPx, measureFn = defaultMeasurePx, opts = {}) {
    if (!omittedItems || !omittedItems.length) {
      return { text: '', totalOmittedRows: 0, representedRows: 0, hiddenRows: 0, groups: [], fits: true, tier: 0 };
    }

    const byCode = new Map();
    for (const item of omittedItems) {
      const code = item.price?.reasonCode || 'missing_allowance';
      const reason = item.price?.shortReason || 'Omitted';
      const key = `${code}::${reason}`;
      if (!byCode.has(key)) byCode.set(key, { code, reason, models: new Map(), shortModels: new Map(), totalRows: 0 });
      const g = byCode.get(key);
      const fullLabel = item.name || item.familyName || item.short || item.label;
      const shortLabel = item.short || item.familyName || item.name || item.label;
      g.models.set(fullLabel, (g.models.get(fullLabel) || 0) + 1);
      g.shortModels.set(shortLabel, (g.shortModels.get(shortLabel) || 0) + 1);
      g.totalRows++;
    }

    const groups = [...byCode.values()].sort((a, b) => {
      const ia = REASON_ORDER.indexOf(a.code), ib = REASON_ORDER.indexOf(b.code);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

    const compactReason = (r, tier) => {
      if (tier === 0) return r;
      if (tier === 1) {
        return r
          .replace(/^Claude Pro offer ended Nov 16$/i, 'Pro offer ended Nov 16')
          .replace(/^No (.+) plan selected$/i, 'No $1 plan')
          .replace(/^No audited data on /i, 'No data: ');
      }
      return r
        .replace(/^Claude Pro offer ended Nov 16$/i, 'Offer ended')
        .replace(/^No (.+) plan selected$/i, 'No $1 plan')
        .replace(/^No audited data on /i, 'No data: ');
    };

    const renderGroup = (g, keepCount, tier) => {
      const map = (tier >= 1 || opts.useShortNames) ? g.shortModels : g.models;
      const entries = [...map.entries()];
      const shown = entries.slice(0, keepCount);
      const hidden = entries.slice(keepCount);
      const representedRows = shown.reduce((s, [, c]) => s + c, 0);
      const hiddenRows = hidden.reduce((s, [, c]) => s + c, 0);
      const namesStr = shown.map(([n]) => n).join(', ');
      const rLabel = compactReason(g.reason, tier);
      const rowWord = hiddenRows === 1 ? 'row' : 'rows';
      let seg;
      if (keepCount === 0) {
        seg = g.code === 'estimates_off'
          ? `${rLabel}: ${hiddenRows} hidden`
          : `${rLabel}: ${hiddenRows} ${rowWord}`;
      } else if (hiddenRows > 0) {
        seg = `${rLabel}: ${namesStr} … +${hiddenRows} more ${rowWord}`;
      } else {
        seg = `${rLabel}: ${namesStr}`;
      }
      return {
        code: g.code,
        reason: rLabel,
        printedNames: shown.map(([n]) => n),
        representedRows,
        hiddenRows,
        totalRows: g.totalRows,
        seg,
      };
    };

    const buildLine = (keepCounts, tier) => {
      const rendered = groups.map((g, i) => renderGroup(g, keepCounts[i], tier));
      const text = groups.length === 1
        ? `Omitted (${rendered[0].reason}): ${rendered[0].seg.slice(rendered[0].reason.length + 2)}`
        : `Omitted — ${rendered.map(r => r.seg).join(' · ')}`;
      const totalOmittedRows = rendered.reduce((s, r) => s + r.totalRows, 0);
      const representedRows = rendered.reduce((s, r) => s + r.representedRows, 0);
      const hiddenRows = rendered.reduce((s, r) => s + r.hiddenRows, 0);
      return { text, totalOmittedRows, representedRows, hiddenRows, groups: rendered, widthPx: measureFn(text), tier };
    };

    const startTiers = opts.useShortNames ? [1, 2] : [0, 1, 2];
    for (const tier of startTiers) {
      const keep = groups.map(g => (tier >= 1 || opts.useShortNames ? g.shortModels.size : g.models.size));
      let cand = buildLine(keep, tier);
      if (cand.widthPx <= maxWidthPx) return { ...cand, fits: true };

      while (cand.widthPx > maxWidthPx) {
        let pickIdx = -1, bestSize = 1;
        for (let i = 0; i < keep.length; i++) {
          if (keep[i] > bestSize) { bestSize = keep[i]; pickIdx = i; }
        }
        if (pickIdx === -1) break;
        keep[pickIdx]--;
        cand = buildLine(keep, tier);
        if (cand.widthPx <= maxWidthPx) return { ...cand, fits: true };
      }

      while (cand.widthPx > maxWidthPx) {
        let pickIdx = -1, bestRows = -1;
        for (let i = 0; i < keep.length; i++) {
          if (keep[i] > 0 && groups[i].totalRows > bestRows) { bestRows = groups[i].totalRows; pickIdx = i; }
        }
        if (pickIdx === -1) break;
        keep[pickIdx]--;
        cand = buildLine(keep, tier);
        if (cand.widthPx <= maxWidthPx) return { ...cand, fits: true };
      }
    }

    const totalOmittedRows = groups.reduce((s, g) => s + g.totalRows, 0);
    const reasonCount = groups.length;
    const textFull = `Omitted: ${totalOmittedRows} rows across ${reasonCount} reasons`;
    const textShort = `Omitted: ${totalOmittedRows} rows (${reasonCount} reasons)`;
    const chosen = measureFn(textFull) <= maxWidthPx ? textFull : textShort;
    const renderedGroups = groups.map(g => ({
      code: g.code, reason: compactReason(g.reason, 2),
      printedNames: [], representedRows: 0, hiddenRows: g.totalRows, totalRows: g.totalRows,
    }));
    const widthPx = measureFn(chosen);
    return {
      text: chosen,
      totalOmittedRows,
      representedRows: 0,
      hiddenRows: totalOmittedRows,
      groups: renderedGroups,
      widthPx,
      tier: 3,
      collapsedToSummary: true,
      fits: widthPx <= maxWidthPx,
    };
  }

  // Exact typed projection schema covering all 62 host snapshot() keys + public `price` = 63 keys.
  const SNAPSHOT_SCHEMA = {
    selected:          { scope: 'public', type: 'idArray' },
    efforts:           { scope: 'public', type: 'effortArray' },
    pinned:            { scope: 'public', type: 'idArray' },
    x:                 { scope: 'public', type: 'metricKey' },
    y:                 { scope: 'public', type: 'metricKey' },
    price:             { scope: 'public', type: 'enum', values: PRICE_MODES },
    xScale:            { scope: 'public', type: 'enum', values: ['linear', 'sqrt', 'log', 'logit'] },
    yScale:            { scope: 'public', type: 'enum', values: ['linear', 'sqrt', 'log', 'logit'] },
    pareto:            { scope: 'public', type: 'enum', values: ['off', 'step', 'line'] },
    frontStyle:        { scope: 'public', type: 'enum', values: ['shade', 'fade', 'rings'] },
    fullFrontier:      { scope: 'public', type: 'boolean' },
    guides:            { scope: 'public', type: 'enum', values: ['hover', 'pinned', 'frontier', 'all'] },
    labels:            { scope: 'public', type: 'enum', values: ['auto', 'autoplus', 'ladder', 'series', 'all', 'none'] },
    ladderAt:          { scope: 'public', type: 'enum', values: ['top', 'low', 'medium', 'high', 'xhigh', 'max'] },
    colorBy:           { scope: 'public', type: 'enum', values: ['lab', 'effort', 'x', 'y', 'both'] },
    idColor:           { scope: 'public', type: 'enum', values: ['lab', 'effort'] },
    dual:              { scope: 'public', type: 'enum', values: ['off', 'lines', 'ring', 'field', 'split'] },
    connect:           { scope: 'public', type: 'boolean' },
    markEffort:        { scope: 'public', type: 'enum', values: ['none', 'minimal', 'low', 'medium', 'default', 'high', 'xhigh', 'max'] },
    markStyle:         { scope: 'public', type: 'enum', values: ['none', 'hash', 'ring', 'square'] },
    grid:              { scope: 'public', type: 'enum', values: ['normal', 'faint', 'off'] },
    axisText:          { scope: 'public', type: 'enum', values: ['normal', 'faint'] },
    glow:              { scope: 'public', type: 'enum', values: ['off', 'on'] },
    hideOlder:         { scope: 'public', type: 'boolean' },
    zone:              { scope: 'public', type: 'enum', values: ['off', 'quadrant', 'near', 'top', 'knee', 'beats', 'diagonal'] },
    zoneStyle:         { scope: 'public', type: 'enum', values: ['none', 'tint', 'hatch', 'outline', 'gradient'] },
    shape:             { scope: 'public', type: 'enum', values: ['standard', 'tall', 'diamond'] },
    focus:             { scope: 'public', type: 'enum', values: ['off', 'pinned'] },
    basis:             { scope: 'public', type: 'enum', values: ['aa', 'A', 'B', 'C', 'listed', 'custom'] },
    basisFill:         { scope: 'public', type: 'boolean' },
    customWeights:     { scope: 'public', type: 'weightMap', min: 0, max: 100 },
    customCover:       { scope: 'public', type: 'number', min: 0, max: 1 },
    rowLayout:         { scope: 'public', type: 'enum', values: ['grouped', 'bars'] },
    rowMetric:         { scope: 'public', type: 'metricKeyOrAxis' },
    rowScale:          { scope: 'public', type: 'enum', values: ['linear', 'log'] },
    lineStyle:         { scope: 'public', type: 'enum', values: ['off', 'solid', 'dashed', 'dotted'] },
    valueLabels:       { scope: 'public', type: 'enum', values: ['off', 'x', 'y', 'both'] },
    valueFront:        { scope: 'public', type: 'boolean' },
    shortEffort:       { scope: 'public', type: 'boolean' },
    shortEffortTouched:{ scope: 'public', type: 'boolean' },
    extWithFamily:     { scope: 'public', type: 'enum', values: ['auto', 'on', 'off'] },
    xRel:              { scope: 'public', type: 'refString' },
    yRel:              { scope: 'public', type: 'refString' },
    ramp:              { scope: 'public', type: 'enum', values: ['viridis', 'cividis', 'magma', 'plasma', 'accent', 'diverge'] },
    guideAxes:         { scope: 'public', type: 'enum', values: ['both', 'x', 'y'] },
    guideBox:          { scope: 'public', type: 'enum', values: ['none', 'tint', 'hatch', 'gradient'] },
    guideBoxColor:     { scope: 'public', type: 'enum', values: ['model', 'grey'] },
    zoneColor:         { scope: 'public', type: 'enum', values: ['theme', 'grey', 'model'] },
    nameAt:            { scope: 'public', type: 'enum', values: ['end', 'maxX'] },
    tallRatio:         { scope: 'public', type: 'number', min: 1.2, max: 3 },
    valueAsX:          { scope: 'public', type: 'enum', values: ['auto', 'value', 'rel', 'vr', 'rv', 'delta', 'vd'] },
    valueAsY:          { scope: 'public', type: 'enum', values: ['auto', 'value', 'rel', 'vr', 'rv', 'delta', 'vd'] },
    valueVsX:          { scope: 'public', type: 'enum', values: ['axis', 'best'] },
    valueVsY:          { scope: 'public', type: 'enum', values: ['axis', 'best'] },
    smallCaps:         { scope: 'public', type: 'boolean' },
    smallCapsOff:      { scope: 'public', type: 'boolean' },
    smallCapsAuto:     { scope: 'public', type: 'boolean' },
    subPlans:          { scope: 'local',  type: 'subPlansMap' },
    autoPts:           { scope: 'public', type: 'numberMap', min: 0, max: 1e9 },
    autoBest:          { scope: 'public', type: 'boolean' },
    autoBestPct:       { scope: 'public', type: 'number', min: 0, max: 100 },
    autoBase:          { scope: 'public', type: 'boolean' },
    autoBasePts:       { scope: 'public', type: 'number', min: 0, max: 1e9 },
  };

  const DEFAULT_EFFORTS = new Set(['non-reasoning', 'minimal', 'low', 'medium', 'default', 'high', 'xhigh', 'max']);

  function validateSnapshotCoverage(hostKeys) {
    const missing = [];
    for (const k of hostKeys) {
      if (!hasOwn(SNAPSHOT_SCHEMA, k)) missing.push(k);
    }
    const extra = Object.keys(SNAPSHOT_SCHEMA).filter(k => k !== 'price' && !hostKeys.includes(k));
    if (missing.length || extra.length) {
      throw new Error(`SNAPSHOT_SCHEMA drift: missing=[${missing.join(',')}] extra=[${extra.join(',')}]`);
    }
    return {
      totalTyped: Object.keys(SNAPSHOT_SCHEMA).length,
      publicCount: Object.values(SNAPSHOT_SCHEMA).filter(v => v.scope === 'public').length,
      localCount: Object.values(SNAPSHOT_SCHEMA).filter(v => v.scope === 'local').length,
    };
  }

  function scrubSet(snap, ctx = {}) {
    if (!snap || typeof snap !== 'object' || Array.isArray(snap)) return null;
    const validIds = ctx.validIds instanceof Set ? ctx.validIds : null;
    const validMetrics = ctx.validMetrics instanceof Set ? ctx.validMetrics : null;
    const validBenchKeys = ctx.validBenchKeys instanceof Set ? ctx.validBenchKeys : null;
    const validAutoKeys = ctx.validAutoKeys instanceof Set ? ctx.validAutoKeys : null;
    const validEfforts = ctx.validEfforts instanceof Set ? ctx.validEfforts : DEFAULT_EFFORTS;
    const validRefStrings = ctx.validRefStrings instanceof Set ? ctx.validRefStrings : null;
    const out = {};

    for (const [k, def] of Object.entries(SNAPSHOT_SCHEMA)) {
      if (def.scope !== 'public') continue;
      if (!hasOwn(snap, k)) continue;
      const v = snap[k];
      if (v === undefined || v === null) continue;

      switch (def.type) {
        case 'boolean':
          if (typeof v === 'boolean') out[k] = v;
          break;
        case 'enum':
          if (typeof v === 'string' && def.values.includes(v)) out[k] = v;
          break;
        case 'number':
          if (typeof v === 'number' && Number.isFinite(v) && v >= def.min && v <= def.max) out[k] = v;
          break;
        case 'metricKey':
          if (typeof v === 'string' && /^(?:[a-zA-Z0-9_]+|ext:[a-zA-Z0-9_-]+)$/.test(v) && (!validMetrics || validMetrics.has(v))) out[k] = v;
          break;
        case 'metricKeyOrAxis':
          if (typeof v === 'string' && /^(?:[a-zA-Z0-9_]+|ext:[a-zA-Z0-9_-]+)$/.test(v) && (v === 'x' || v === 'y' || !validMetrics || validMetrics.has(v))) out[k] = v;
          break;
        case 'refString':
          if (typeof v === 'string' && v.length <= 160) {
            const isBuiltIn = ['off', 'sweet', 'best', 'median', 'pinned'].includes(v);
            const isModelRef = /^model:[a-z0-9._-]+:[a-z0-9._-]+(?::[a-z0-9._-]+)?$/i.test(v);
            if ((isBuiltIn || isModelRef) && (!validRefStrings || isBuiltIn || validRefStrings.has(v))) {
              out[k] = v;
            }
          }
          break;
        case 'idArray':
          if (Array.isArray(v)) {
            const clean = [];
            const seen = new Set();
            for (const item of v) {
              if (typeof item !== 'string' || !/^[a-z0-9._:-]+$/i.test(item) || seen.has(item)) continue;
              if (validIds && !validIds.has(item)) continue;
              seen.add(item);
              clean.push(item);
            }
            out[k] = clean;
          }
          break;
        case 'effortArray':
          if (Array.isArray(v)) {
            const clean = [];
            const seen = new Set();
            for (const item of v) {
              if (typeof item !== 'string' || !validEfforts.has(item) || seen.has(item)) continue;
              seen.add(item);
              clean.push(item);
            }
            out[k] = clean;
          }
          break;
        case 'weightMap':
          if (v && typeof v === 'object' && !Array.isArray(v)) {
            const m = {};
            for (const mk of Object.keys(v).sort()) {
              if (!/^(?:[a-zA-Z0-9_]+|ext:[a-zA-Z0-9_-]+)$/.test(mk)) continue;
              if (validBenchKeys && !validBenchKeys.has(mk)) continue;
              const num = v[mk];
              if (typeof num === 'number' && Number.isFinite(num) && num >= def.min && num <= def.max) m[mk] = num;
            }
            out[k] = m;
          }
          break;
        case 'numberMap':
          if (v && typeof v === 'object' && !Array.isArray(v)) {
            const m = {};
            for (const mk of Object.keys(v).sort()) {
              if (!/^[a-zA-Z0-9_.:-]+$/.test(mk)) continue;
              if (validAutoKeys && !validAutoKeys.has(mk)) continue;
              const num = v[mk];
              if (typeof num === 'number' && Number.isFinite(num) && num >= def.min && num <= def.max) m[mk] = num;
            }
            out[k] = m;
          }
          break;
        default:
          break;
      }
    }
    return out;
  }

  function scrubSetCollection(rawSets, ctx = {}) {
    if (!rawSets || typeof rawSets !== 'object' || Array.isArray(rawSets)) return {};
    const out = {};
    for (const name of Object.keys(rawSets).sort()) {
      if (typeof name !== 'string' || !name.trim() || name === '__proto__' || name === 'constructor' || name === 'prototype') continue;
      const scrubbed = scrubSet(rawSets[name], ctx);
      if (scrubbed && Object.keys(scrubbed).length) out[name] = scrubbed;
    }
    return out;
  }

  function fmtPlanUsd(v, isEst = false) {
    if (!Number.isFinite(v) || v < 0) return '—';
    const core = v === 0 ? '$0.00' : v >= 0.1 ? '$' + v.toFixed(2) : v >= 0.001 ? '$' + v.toPrecision(2) : '<$0.001';
    return isEst ? `≈${core}` : core;
  }

  function fmtPct(v, isEst = false) {
    if (!Number.isFinite(v) || v < 0) return '—';
    const core = v === 0 ? '0%' : v < 0.01 ? '<0.01%' : v >= 100 ? `${Math.round(v).toLocaleString('en-US')}%` : v >= 10 ? `${v.toFixed(1)}%` : `${v.toPrecision(2)}%`;
    return isEst ? `≈${core}` : core;
  }

  function fmtTasksWk(v, isEst = false) {
    if (!Number.isFinite(v) || v <= 0) return '—';
    const core = v < 1 ? '<1' : v < 100 ? (v < 10 ? v.toFixed(1) : String(Math.round(v))) : Math.round(v).toLocaleString('en-US');
    return isEst ? `≈${core}` : core;
  }

  return {
    PUBLIC_DEFAULT_ESTIMATES, PLANS_STORAGE_KEY, PRICE_MODES, LEGACY_AXES, PRICE_ELIGIBLE_METRICS, UTIL_STEPS, LAB_ORDER,
    DISCLOSURES, SNAPSHOT_SCHEMA,
    normalizeLab, labName, getPlan, parseFeeInput, fmtFeeEcho,
    getExampleProfile, sanitizeProfile, loadLocalProfile, saveLocalProfile,
    resolveInitialPrice, switchFromLegacyAxes, hasActiveLegacyAxis, isPriceEligibleAxis,
    priceTask, formatSourceLabel, formatPoolLabel, evaluateComparison,
    dotOuter, beadRingSpec, pinnedCompareRadius, hoverLabelOffset, glowRadius, effortSquareHalf,
    formatOmissionFooter, validateSnapshotCoverage, scrubSet, scrubSetCollection,
    fmtPlanUsd, fmtPct, fmtTasksWk,
  };
});
