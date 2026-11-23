#!/usr/bin/env node
// Pure, schema-validated compiler for data/plan-allowances.js.
// Usage: node scripts/build-allowances.mjs <rap_points.json> [data/models.js] [data/plan-allowances.js]
// Emits flat planId::family allowance rows with MIT attribution; zero raw upstream warning text is shipped.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const ID_RE = /^[a-z0-9._-]+$/i;
const DATE_RE = /^\d{4}-\d{2}(?:-\d{2})?(?:~\d{4}-\d{2}(?:-\d{2})?)?$/;

export const SCHEMA_VERSION = 3;

// Release-scope v1 plans: 4 labs x 13 weekly plans.
// Kimi CN monthly pool and scheduled CI refresh are explicitly Phase 2.
export const PLAN_META = {
  // OpenAI
  chatgpt_plus:          { id: 'chatgpt_plus',          lab: 'openai',    name: 'ChatGPT Plus',        short: 'Plus',       fee: 20,    weeks: 4, period: 'week', entry: true },
  chatgpt_pro_10x:       { id: 'chatgpt_pro_10x',       lab: 'openai',    name: 'ChatGPT Pro 10x',     short: 'Pro 10x',    fee: 100,   weeks: 4, period: 'week' },
  chatgpt_pro_20x:       { id: 'chatgpt_pro_20x',       lab: 'openai',    name: 'ChatGPT Pro 20x',     short: 'Pro 20x',    fee: 200,   weeks: 4, period: 'week' },
  // Google
  google_ai_pro_us:      { id: 'google_ai_pro_us',      lab: 'google',    name: 'Google AI Pro',       short: 'AI Pro',     fee: 19.99, weeks: 4, period: 'week', entry: true, worthMult: 1 },
  google_ai_ultra_5x_us: { id: 'google_ai_ultra_5x_us', lab: 'google',    name: 'Google AI Ultra 5x',  short: 'Ultra 5x',   fee: 99.99, weeks: 4, period: 'week', worthMult: 5 },
  google_ai_ultra_20x_us:{ id: 'google_ai_ultra_20x_us',lab: 'google',    name: 'Google AI Ultra 20x', short: 'Ultra 20x',  fee: 199.99,weeks: 4, period: 'week', worthMult: 20 },
  // Anthropic
  claude_pro:            { id: 'claude_pro',            lab: 'anthropic', name: 'Claude Pro',          short: 'Pro',        fee: 20,    weeks: 4, period: 'week', entry: true },
  claude_max_5x:         { id: 'claude_max_5x',         lab: 'anthropic', name: 'Claude Max 5x',       short: 'Max 5x',     fee: 100,   weeks: 4, period: 'week' },
  claude_max_20x:        { id: 'claude_max_20x',        lab: 'anthropic', name: 'Claude Max 20x',      short: 'Max 20x',    fee: 200,   weeks: 4, period: 'week' },
  claude_team:           { id: 'claude_team',           lab: 'anthropic', name: 'Claude Team Premium', short: 'Team',       fee: 125,   weeks: 4, period: 'week' },
  // xAI (SuperGrok Lite $10 dropped — low-confidence raw data only)
  supergrok:             { id: 'supergrok',             lab: 'xai',       name: 'SuperGrok',           short: 'SuperGrok',  fee: 30,    weeks: 4, period: 'week', entry: true },
  supergrok_plus:        { id: 'supergrok_plus',        lab: 'xai',       name: 'SuperGrok Plus',      short: 'Grok Plus',  fee: 100,   weeks: 4, period: 'week' },
  supergrok_heavy:       { id: 'supergrok_heavy',       lab: 'xai',       name: 'SuperGrok Heavy',     short: 'Grok Heavy', fee: 300,   weeks: 4, period: 'week' },
};

export const PRESETS = {
  entry: {
    label: 'Example entry plans',
    plans: {
      anthropic: 'claude_pro',
      openai: 'chatgpt_plus',
      google: 'google_ai_pro_us',
      xai: 'supergrok',
    },
  },
  heavy: {
    label: 'Example heavy plans',
    plans: {
      anthropic: 'claude_max_20x',
      openai: 'chatgpt_pro_20x',
      google: 'google_ai_ultra_20x_us',
      xai: 'supergrok_heavy',
    },
  },
};

export const MIXES = {
  standard:  { cached: 0.97, input: 0.025, write5m: 0,     output: 0.005 },
  lowCache:  { cached: 0.85, input: 0.145, write5m: 0,     output: 0.005 },
  anthropic: { cached: 0.97, input: 0,     write5m: 0.025, output: 0.005 },
};

export const FAMILY_POOL = {
  'gemini-4-neon':     'google_pro_pool',
  'gemini-4-carbon':   'google_pro_pool',
  'gemini-4-hydrogen': 'google_fast_pool',
  'gemini-3-8-flash':  'google_fast_pool',
  'gemini-3-6-flash':  'google_fast_pool',
  'gemini-4-argon':    'google_argon_pool',
};

export const VERIFIED_CACHE_RATIOS = {
  'claude-fable-5-2': 0.025,
  'claude-opus-5-5': 0.05,
  'claude-sonnet-5-5': 0.05,
  'claude-haiku-5-5': 0.10,
  'gpt-6-2-astra': 0.05,
  'gpt-6-2-sol': 0.05,
  'gpt-6-1-sol': 0.05,
  'gpt-6-sol': 0.10,
  'gpt-6-astra': 0.10,
  'gpt-6-luna': 0.05,
  'gpt-5-6-sol': 0.10,
  'gpt-5-6-terra': 0.10,
  'gemini-4-neon': 0.05,
  'gemini-4-carbon': 0.05,
  'gemini-4-hydrogen': 0.05,
  'gemini-4-argon': 0.10,
  'gemini-3-8-flash': 0.10,
  'gemini-3-6-flash': 0.10,
  'grok-4-7': 0.25,
  'grok-4-6': 0.25,
  'grok-4-5': 0.15,
};

export const VALIDATED_RAW_ROWS = {
  'chatgpt_plus::gpt-6-astra':     { dataDate: '2026-09-11',            real: 0.12578616,  tol: 0.05, minWkWorth: 50,   maxWkWorth: 70 },
  'chatgpt_pro_20x::gpt-6-astra':  { dataDate: '2026-09-07~2026-09-21', real: 0.052465897, tol: 0.05, minWkWorth: 1200, maxWkWorth: 1550 },
  'chatgpt_plus::gpt-5-6-sol':     { dataDate: '2026-07-30',            real: 0.032467532, tol: 0.05, minWkWorth: 80,   maxWkWorth: 105 },
  'chatgpt_pro_10x::gpt-5-6-sol':  { dataDate: '2026-07-30~2026-10-30', real: 0.016233766, tol: 0.05, minWkWorth: 800,  maxWkWorth: 1050 },
  'chatgpt_pro_20x::gpt-5-6-sol':  { dataDate: '2026-06-10~2026-09-06', real: 0.015501473, tol: 0.05, minWkWorth: 1700, maxWkWorth: 2150 },
  'chatgpt_plus::gpt-5-6-terra':   { dataDate: '2026-07-30',            real: 0.016785564, tol: 0.05, minWkWorth: 80,   maxWkWorth: 105 },
  'chatgpt_pro_10x::gpt-5-6-terra':{ dataDate: '2026-07-30~2026-10-30', real: 0.0083929935,tol: 0.05, minWkWorth: 800,  maxWkWorth: 1050 },
  'chatgpt_pro_20x::gpt-5-6-terra':{ dataDate: '2026-06-10~2026-09-06', real: 0.0080143617,tol: 0.05, minWkWorth: 1700, maxWkWorth: 2150 },
};

export const PROMO_EXPIRIES = {
  'claude_pro::claude-fable-5-2': {
    expiresAt: '2026-11-16T23:59:59-08:00',
    shortReason: 'Claude Pro offer ended Nov 16',
    detailReason: 'Usage credits only on Claude Pro (included launch offer ended Nov 16; included on Max 5x and Max 20x)',
    evidenceId: 'anthropic-fable-5-2-launch-2026-11-16',
    verifiedAt: '2026-11-22',
    sourceUrl: 'https://support.claude.com/en/articles/17506494-claude-fable-5-2-launch-offers',
  },
};

export const SUB_CAPS = {
  'claude-fable-5-2': {
    fraction: 0.5,
    plans: ['claude_max_5x', 'claude_max_20x'],
    label: 'Fable 50% cap',
    note: 'Fable can use at most half the weekly limit.',
    evidenceId: 'anthropic-fable-subcap-50pct',
    verifiedAt: '2026-11-22',
    sourceUrl: 'https://support.claude.com/en/articles/17506494-claude-fable-5-2-launch-offers',
  },
};

export const AUDITED_SCALED_TARGETS = [
  {
    planId: 'claude_max_5x',
    family: 'claude-fable-5-2',
    donorPlanId: 'claude_pro',
    allowArchivedDonor: true,
    method: 'sibling_median',
    evidenceId: 'scale-claude-max-5x-fable-5-2',
    verifiedAt: '2026-11-22',
    sourceUrl: 'https://support.claude.com/en/articles/17506494-claude-fable-5-2-launch-offers',
    note: 'Scaled from archived Claude Pro launch-offer measurement via same-workload Claude siblings; matches Real API Pricing Fable 5.1 readings.',
  },
  {
    planId: 'claude_max_20x',
    family: 'claude-fable-5-2',
    donorPlanId: 'claude_pro',
    allowArchivedDonor: true,
    method: 'sibling_median',
    evidenceId: 'scale-claude-max-20x-fable-5-2',
    verifiedAt: '2026-11-22',
    sourceUrl: 'https://support.claude.com/en/articles/17506494-claude-fable-5-2-launch-offers',
    note: 'Scaled from archived Claude Pro launch-offer measurement via same-workload Claude siblings; matches Real API Pricing Fable 5.1 reading on Max 20x.',
  },
  {
    planId: 'google_ai_ultra_5x_us',
    family: 'gemini-4-neon',
    donorPlanId: 'google_ai_pro_us',
    method: 'worth_mult',
    evidenceId: 'scale-google-ultra-5x-gemini-4-neon',
    verifiedAt: '2026-11-22',
    sourceUrl: 'https://github.com/Fei2411/real-api-pricing/blob/main/CONVENTIONS.md',
    note: 'Scaled from Google AI Pro via official 5× weekly allowance multiplier.',
  },
  {
    planId: 'google_ai_ultra_20x_us',
    family: 'gemini-4-neon',
    donorPlanId: 'google_ai_pro_us',
    method: 'worth_mult',
    evidenceId: 'scale-google-ultra-20x-gemini-4-neon',
    verifiedAt: '2026-11-22',
    sourceUrl: 'https://github.com/Fei2411/real-api-pricing/blob/main/CONVENTIONS.md',
    note: 'Scaled from Google AI Pro via official 20× weekly allowance multiplier.',
  },
];

export const AUDITED_PREDECESSORS = [
  {
    planId: 'chatgpt_plus', family: 'gpt-6-2-astra',
    donorPlanId: 'chatgpt_plus', donorFamily: 'gpt-6-astra', donorName: 'GPT-6 Astra',
    scaleMethod: 'direct_same_plan', expectedMult: 1, multTol: 0.001,
    workloadAssumption: 'Standard 97%/2.5%/0.5% mix on corroborated raw-token donor sample.',
    caveat: 'Rough estimate from GPT-6 Astra. GPT-6.2 list prices changed, so actual cost could be up to ~1.9× higher.',
    evidenceId: 'pred-chatgpt-plus-gpt-6-2-astra', verifiedAt: '2026-11-22', expiresAt: null,
    sourceUrl: 'https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex',
  },
  {
    planId: 'chatgpt_pro_10x', family: 'gpt-6-2-astra',
    donorPlanId: 'chatgpt_plus', donorFamily: 'gpt-6-astra', donorName: 'GPT-6 Astra',
    scaleMethod: 'sibling_median', expectedMult: 10, multTol: 0.02,
    workloadAssumption: 'Direct ChatGPT Plus GPT-6 Astra allowance scaled by same-workload OpenAI siblings to Pro 10x.',
    caveat: 'Rough estimate from GPT-6 Astra. GPT-6.2 list prices changed, so actual cost could be up to ~1.9× higher.',
    evidenceId: 'pred-chatgpt-pro-10x-gpt-6-2-astra', verifiedAt: '2026-11-22', expiresAt: null,
    sourceUrl: 'https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex',
  },
  {
    planId: 'chatgpt_pro_20x', family: 'gpt-6-2-astra',
    donorPlanId: 'chatgpt_pro_20x', donorFamily: 'gpt-6-astra', donorName: 'GPT-6 Astra',
    scaleMethod: 'direct_same_plan', expectedMult: 1, multTol: 0.001,
    workloadAssumption: 'Standard 97%/2.5%/0.5% mix on corroborated Pro 20x raw-token donor sample.',
    caveat: 'Rough estimate from GPT-6 Astra. GPT-6.2 list prices changed, so actual cost could be up to ~1.9× higher.',
    evidenceId: 'pred-chatgpt-pro-20x-gpt-6-2-astra', verifiedAt: '2026-11-22', expiresAt: null,
    sourceUrl: 'https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex',
  },
  {
    planId: 'chatgpt_plus', family: 'gpt-6-2-sol',
    donorPlanId: 'chatgpt_plus', donorFamily: 'gpt-6-1-sol', donorName: 'GPT-6.1 Sol',
    scaleMethod: 'direct_same_plan', expectedMult: 1, multTol: 0.001,
    workloadAssumption: 'Same published API token rates and Codex pool as GPT-6.1 Sol on ChatGPT Plus.',
    caveat: 'Estimated from GPT-6.1 Sol (same published token rates).',
    evidenceId: 'pred-chatgpt-plus-gpt-6-2-sol', verifiedAt: '2026-11-22', expiresAt: null,
    sourceUrl: 'https://developers.openai.com/codex/pricing',
  },
  {
    planId: 'chatgpt_pro_10x', family: 'gpt-6-2-sol',
    donorPlanId: 'chatgpt_plus', donorFamily: 'gpt-6-1-sol', donorName: 'GPT-6.1 Sol',
    scaleMethod: 'sibling_median', expectedMult: 10, multTol: 0.02,
    workloadAssumption: 'Direct ChatGPT Plus GPT-6.1 Sol allowance scaled by same-workload OpenAI siblings to Pro 10x.',
    caveat: 'Estimated from GPT-6.1 Sol on ChatGPT Plus, scaled to Pro 10x (same published token rates).',
    evidenceId: 'pred-chatgpt-pro-10x-gpt-6-2-sol', verifiedAt: '2026-11-22', expiresAt: null,
    sourceUrl: 'https://developers.openai.com/codex/pricing',
  },
  {
    planId: 'chatgpt_pro_20x', family: 'gpt-6-2-sol',
    donorPlanId: 'chatgpt_plus', donorFamily: 'gpt-6-1-sol', donorName: 'GPT-6.1 Sol',
    scaleMethod: 'sibling_median', expectedMult: 20, multTol: 0.02,
    workloadAssumption: 'Direct ChatGPT Plus GPT-6.1 Sol allowance scaled by same-workload OpenAI siblings to Pro 20x.',
    caveat: 'Estimated from GPT-6.1 Sol on ChatGPT Plus, scaled to Pro 20x (same published token rates).',
    evidenceId: 'pred-chatgpt-pro-20x-gpt-6-2-sol', verifiedAt: '2026-11-22', expiresAt: null,
    sourceUrl: 'https://developers.openai.com/codex/pricing',
  },
  {
    planId: 'google_ai_pro_us', family: 'gemini-4-carbon',
    donorPlanId: 'google_ai_pro_us', donorFamily: 'gemini-4-neon', donorName: 'Gemini 4 Neon',
    scaleMethod: 'direct_same_plan', expectedMult: 1, multTol: 0.001,
    workloadAssumption: 'Assumes the same Google AI pro-tier weekly quota pool as Gemini 4 Neon.',
    caveat: 'Estimated from Gemini 4 Neon (assumes same Google AI quota pool).',
    evidenceId: 'pred-google-pro-gemini-4-carbon', verifiedAt: '2026-11-22', expiresAt: null,
    sourceUrl: 'https://github.com/Fei2411/real-api-pricing/blob/main/CONVENTIONS.md',
  },
  {
    planId: 'google_ai_ultra_5x_us', family: 'gemini-4-carbon',
    donorPlanId: 'google_ai_pro_us', donorFamily: 'gemini-4-neon', donorName: 'Gemini 4 Neon',
    scaleMethod: 'worth_mult', expectedMult: 5, multTol: 0.001,
    workloadAssumption: 'Direct Google AI Pro Gemini 4 Neon allowance scaled by official 5× Ultra multiplier.',
    caveat: 'Estimated from Gemini 4 Neon on Google AI Pro, scaled 5× to Ultra 5x.',
    evidenceId: 'pred-google-ultra-5x-gemini-4-carbon', verifiedAt: '2026-11-22', expiresAt: null,
    sourceUrl: 'https://github.com/Fei2411/real-api-pricing/blob/main/CONVENTIONS.md',
  },
  {
    planId: 'google_ai_ultra_20x_us', family: 'gemini-4-carbon',
    donorPlanId: 'google_ai_pro_us', donorFamily: 'gemini-4-neon', donorName: 'Gemini 4 Neon',
    scaleMethod: 'worth_mult', expectedMult: 20, multTol: 0.001,
    workloadAssumption: 'Direct Google AI Pro Gemini 4 Neon allowance scaled by official 20× Ultra multiplier.',
    caveat: 'Estimated from Gemini 4 Neon on Google AI Pro, scaled 20× to Ultra 20x.',
    evidenceId: 'pred-google-ultra-20x-gemini-4-carbon', verifiedAt: '2026-11-22', expiresAt: null,
    sourceUrl: 'https://github.com/Fei2411/real-api-pricing/blob/main/CONVENTIONS.md',
  },
  {
    planId: 'google_ai_pro_us', family: 'gemini-4-hydrogen',
    donorPlanId: 'google_ai_pro_us', donorFamily: 'gemini-3-8-flash', donorName: 'Gemini 3.8 Flash',
    scaleMethod: 'direct_same_plan', expectedMult: 1, multTol: 0.001,
    workloadAssumption: 'Assumes the same fast-tier Google AI quota pool as Gemini 3.8 Flash.',
    caveat: 'Estimated from Gemini 3.8 Flash (assumes same fast-tier Google AI pool).',
    evidenceId: 'pred-google-pro-gemini-4-hydrogen', verifiedAt: '2026-11-22', expiresAt: null,
    sourceUrl: 'https://github.com/Fei2411/real-api-pricing/blob/main/CONVENTIONS.md',
  },
  {
    planId: 'google_ai_ultra_5x_us', family: 'gemini-4-hydrogen',
    donorPlanId: 'google_ai_pro_us', donorFamily: 'gemini-3-8-flash', donorName: 'Gemini 3.8 Flash',
    scaleMethod: 'worth_mult', expectedMult: 5, multTol: 0.001,
    workloadAssumption: 'Direct Google AI Pro Gemini 3.8 Flash allowance scaled by official 5× Ultra multiplier.',
    caveat: 'Estimated from Gemini 3.8 Flash on Google AI Pro, scaled 5× to Ultra 5x.',
    evidenceId: 'pred-google-ultra-5x-gemini-4-hydrogen', verifiedAt: '2026-11-22', expiresAt: null,
    sourceUrl: 'https://github.com/Fei2411/real-api-pricing/blob/main/CONVENTIONS.md',
  },
  {
    planId: 'google_ai_ultra_20x_us', family: 'gemini-4-hydrogen',
    donorPlanId: 'google_ai_pro_us', donorFamily: 'gemini-3-8-flash', donorName: 'Gemini 3.8 Flash',
    scaleMethod: 'worth_mult', expectedMult: 20, multTol: 0.001,
    workloadAssumption: 'Direct Google AI Pro Gemini 3.8 Flash allowance scaled by official 20× Ultra multiplier.',
    caveat: 'Estimated from Gemini 3.8 Flash on Google AI Pro, scaled 20× to Ultra 20x.',
    evidenceId: 'pred-google-ultra-20x-gemini-4-hydrogen', verifiedAt: '2026-11-22', expiresAt: null,
    sourceUrl: 'https://github.com/Fei2411/real-api-pricing/blob/main/CONVENTIONS.md',
  },
];

function isValidDateStr(s) {
  if (!DATE_RE.test(s)) return false;
  for (const part of s.split('~')) {
    const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(part);
    if (!m) return false;
    const y = +m[1], mo = +m[2], d = m[3] ? +m[3] : 1;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return false;
  }
  return true;
}

export function rapModelToFamily(rapModel) {
  return String(rapModel || '').toLowerCase().replace(/\./g, '-').replace(/[^a-z0-9-]/g, '');
}

function validateMixSums(mixes) {
  for (const [name, m] of Object.entries(mixes)) {
    const sum = (m.cached || 0) + (m.input || 0) + (m.write5m || 0) + (m.output || 0);
    if (Math.abs(sum - 1) > 1e-6) throw new Error(`Mix ${name} does not sum to 1 (got ${sum})`);
  }
}

function validPriceObj(lp) {
  return !!(
    lp &&
    Number.isFinite(lp.input) && lp.input > 0 &&
    Number.isFinite(lp.output) && lp.output > 0 &&
    Number.isFinite(lp.cached) && lp.cached >= 0 &&
    (lp.write5m == null || (Number.isFinite(lp.write5m) && lp.write5m >= 0))
  );
}

function blendListPrice(lp, workload) {
  const mixKey = workload === 'measured' ? 'standard' : workload;
  const m = MIXES[mixKey];
  if (!m || !validPriceObj(lp)) return null;
  const write5m = lp.write5m != null ? lp.write5m : lp.input * 1.25;
  const val = m.cached * lp.cached + m.input * lp.input + (m.write5m || 0) * write5m + m.output * lp.output;
  return Number.isFinite(val) && val > 0 ? val : null;
}

function median(nums) {
  if (!nums.length) return null;
  const s = nums.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function siblingAllowanceMultiplier(directRows, donorPlanId, targetPlanId, donorWorkload, excludeFamily) {
  const donorPlan = PLAN_META[donorPlanId];
  const targetPlan = PLAN_META[targetPlanId];
  if (!donorPlan || !targetPlan) return null;

  const pByFam = new Map();
  const qByFam = new Map();
  for (const r of directRows) {
    if (r.family === excludeFamily || r.confidence === 'low') continue;
    if (r.planId === targetPlanId) pByFam.set(r.family, r);
    if (r.planId === donorPlanId) qByFam.set(r.family, r);
  }
  const donorIsRaw = donorWorkload === 'measured';
  const eligible = [];
  for (const [sFam, rp] of pByFam) {
    const rq = qByFam.get(sFam);
    if (!rq || rp.workload !== rq.workload) continue;
    if ((rp.workload === 'measured') !== donorIsRaw) continue;
    eligible.push({ sFam, workload: rp.workload, shareRatio: rp.share / rq.share });
  }
  if (!eligible.length) return null;
  const exactWk = eligible.filter(s => s.workload === donorWorkload);
  const pool = exactWk.length ? exactWk : eligible;
  const shareRatioMed = median(pool.map(s => s.shareRatio));
  const allowanceMult = (targetPlan.fee / donorPlan.fee) / shareRatioMed;
  return {
    allowanceMult,
    shareRatio: shareRatioMed,
    siblings: pool.map(s => s.sFam).sort(),
  };
}

export function compileAllowances(rapPoints, aaModels = [], meta = {}) {
  validateMixSums(MIXES);

  for (const [pid, plan] of Object.entries(PLAN_META)) {
    if (plan.id !== pid || !ID_RE.test(pid)) throw new Error(`Invalid plan id: ${pid}`);
    if (plan.period !== 'week' || plan.weeks !== 4) throw new Error(`Unsupported period on ${pid}`);
    if (!(plan.fee > 0) || !Number.isFinite(plan.fee)) throw new Error(`Invalid fee on ${pid}`);
  }

  const aaPrices = new Map();
  for (const m of aaModels) {
    if (!m.family || !(m.priceInput > 0) || !(m.priceOutput > 0)) continue;
    const prev = aaPrices.get(m.family);
    if (!prev || (prev.deprecated && !m.deprecated)) {
      aaPrices.set(m.family, { input: m.priceInput, output: m.priceOutput, deprecated: !!m.deprecated });
    }
  }

  const rapApiPrices = new Map();
  const rapSubPrices = new Map();
  for (const p of rapPoints) {
    if (!p?.list_price) continue;
    const fam = rapModelToFamily(p.model || (p.id || '').split('::')[1]);
    const lp = {
      input: Number(p.list_price.input),
      cached: Number(p.list_price.cached),
      output: Number(p.list_price.output),
      ...(p.list_price.write5m != null ? { write5m: Number(p.list_price.write5m) } : {}),
    };
    if (!validPriceObj(lp)) continue;
    if (p.billing === 'api' || p.billing === 'metered') {
      if (!rapApiPrices.has(fam)) rapApiPrices.set(fam, lp);
    } else if (!rapSubPrices.has(fam)) {
      rapSubPrices.set(fam, lp);
    }
  }

  const accounting = {
    totalSubRows: 0,
    directKept: 0,
    directActive: 0,
    scaledCompiled: 0,
    predecessorCompiled: 0,
    expiredCompiled: 0,
    skippedNonAllowlisted: 0,
    rejectedUnpriced: 0,
    rejectedInvalid: 0,
    warnings: [],
  };

  const directRows = [];
  const directByKey = new Map();
  const seenPlanFees = new Map();

  for (const p of rapPoints) {
    if (p.billing !== 'subscription') continue;
    accounting.totalSubRows++;

    const rawId = String(p.id || '');
    const idParts = rawId.split('::');
    const [planId, rawModel] = idParts;
    if (idParts.length !== 2 || !planId || !rawModel || !ID_RE.test(planId) || !ID_RE.test(rawModel)) {
      accounting.rejectedInvalid++;
      accounting.warnings.push(`Rejected invalid id: ${rawId}`);
      continue;
    }
    const plan = Object.prototype.hasOwnProperty.call(PLAN_META, planId) ? PLAN_META[planId] : null;
    if (!plan) {
      accounting.skippedNonAllowlisted++;
      continue;
    }

    const family = rapModelToFamily(rawModel);
    const key = `${planId}::${family}`;
    if (directByKey.has(key)) throw new Error(`Duplicate upstream key: ${key}`);

    if (p.price_usd != null) {
      const upstreamFee = Number(p.price_usd);
      if (!Number.isFinite(upstreamFee) || upstreamFee <= 0) {
        accounting.rejectedInvalid++;
        accounting.warnings.push(`Rejected invalid fee on ${key}`);
        continue;
      }
      if (seenPlanFees.has(planId) && Math.abs(seenPlanFees.get(planId) - upstreamFee) > 0.01) {
        throw new Error(`Conflicting upstream fee on ${key}: ${upstreamFee} vs ${seenPlanFees.get(planId)}`);
      }
      if (Math.abs(upstreamFee - plan.fee) > 0.50) {
        accounting.rejectedInvalid++;
        accounting.warnings.push(`Rejected fee mismatch on ${key}`);
        continue;
      }
      seenPlanFees.set(planId, upstreamFee);
    }

    const real = Number(p.real_usd_per_mtok);
    const workload = p.workload;
    const confidence = p.confidence;
    const dataDate = String(p.data_date || '');
    if (!Number.isFinite(real) || real <= 0 || !['standard', 'lowCache', 'anthropic', 'measured'].includes(workload) ||
        !['high', 'medium', 'low'].includes(confidence) || !isValidDateStr(dataDate)) {
      accounting.rejectedInvalid++;
      accounting.warnings.push(`Rejected malformed fields on ${key}`);
      continue;
    }

    let listPrice = null;
    let listSource = null;
    if (p.list_price) {
      const cand = {
        input: Number(p.list_price.input),
        cached: Number(p.list_price.cached),
        output: Number(p.list_price.output),
        ...(p.list_price.write5m != null ? { write5m: Number(p.list_price.write5m) } : {}),
      };
      if (validPriceObj(cand)) { listPrice = cand; listSource = 'rap'; }
    }
    if (!listPrice && rapApiPrices.has(family)) { listPrice = rapApiPrices.get(family); listSource = 'rap_api'; }
    if (!listPrice && rapSubPrices.has(family)) { listPrice = rapSubPrices.get(family); listSource = 'rap_sub'; }
    if (!listPrice) {
      const aa = aaPrices.get(family);
      const ratio = Object.prototype.hasOwnProperty.call(VERIFIED_CACHE_RATIOS, family) ? VERIFIED_CACHE_RATIOS[family] : null;
      if (aa && ratio != null) {
        listPrice = { input: aa.input, cached: +(aa.input * ratio).toPrecision(6), output: aa.output };
        listSource = 'aa_verified';
      } else {
        accounting.rejectedUnpriced++;
        accounting.warnings.push(`Rejected unpriced ${key}`);
        continue;
      }
    }

    const L = blendListPrice(listPrice, workload);
    const share = L ? real / L : null;
    if (!(share > 0 && share <= 1 && Number.isFinite(share))) {
      accounting.rejectedInvalid++;
      accounting.warnings.push(`Rejected invalid share on ${key}`);
      continue;
    }
    const allowanceWk = (plan.fee / share) / plan.weeks;
    if (!(allowanceWk > 0 && Number.isFinite(allowanceWk))) {
      accounting.rejectedInvalid++;
      accounting.warnings.push(`Rejected invalid allowance on ${key}`);
      continue;
    }

    let rawValidated = false;
    if (workload === 'measured') {
      const pin = Object.prototype.hasOwnProperty.call(VALIDATED_RAW_ROWS, key) ? VALIDATED_RAW_ROWS[key] : null;
      if (!pin) {
        accounting.rejectedUnpriced++;
        accounting.warnings.push(`Rejected uncorroborated raw-mix ${key}`);
        continue;
      }
      const dateMatch = dataDate === pin.dataDate;
      const rateMatch = Math.abs(real - pin.real) / pin.real <= pin.tol;
      const worthMatch = allowanceWk >= pin.minWkWorth && allowanceWk <= pin.maxWkWorth;
      if (!dateMatch || !rateMatch || !worthMatch) {
        accounting.rejectedUnpriced++;
        accounting.warnings.push(`Rejected drifted raw-mix ${key}`);
        continue;
      }
      rawValidated = true;
    }

    let listPriceDriftRatio = null;
    const aaLive = aaPrices.get(family);
    if (aaLive && listSource !== 'aa_verified') {
      const inRatio = aaLive.input / listPrice.input;
      const outRatio = aaLive.output / listPrice.output;
      if (Math.abs(inRatio - 1) > 0.10 || Math.abs(outRatio - 1) > 0.10) {
        listPriceDriftRatio = +inRatio.toFixed(2);
        accounting.warnings.push(`List-price drift on ${key}: ${listPriceDriftRatio}x`);
      }
    }

    const dr = {
      key, planId, family, lab: plan.lab, real, L, share, allowanceWk,
      workload, confidence, dataDate, listSource, rawValidated, listPriceDriftRatio,
    };
    directRows.push(dr);
    directByKey.set(key, dr);
    accounting.directKept++;
  }

  const accounted = accounting.directKept + accounting.skippedNonAllowlisted + accounting.rejectedUnpriced + accounting.rejectedInvalid;
  if (accounted !== accounting.totalSubRows) {
    throw new Error(`Accounting mismatch: ${accounted} !== ${accounting.totalSubRows}`);
  }

  const allowances = {};
  const putRow = (key, row) => {
    if (Object.prototype.hasOwnProperty.call(allowances, key)) {
      throw new Error(`Duplicate compiled allowance key: ${key}`);
    }
    allowances[key] = row;
  };

  const capFor = (planId, family) => {
    const c = SUB_CAPS[family];
    if (c && c.plans.includes(planId)) return { subCap: c.fraction, subCapLabel: c.label, subCapNote: c.note };
    return { subCap: 1, subCapLabel: null, subCapNote: null };
  };

  for (const [key, exp] of Object.entries(PROMO_EXPIRIES)) {
    const [planId, family] = key.split('::');
    const plan = PLAN_META[planId];
    if (!plan) throw new Error(`Unknown plan in PROMO_EXPIRIES: ${planId}`);
    const archived = directByKey.get(key);
    putRow(key, {
      planId, family, lab: plan.lab, allowanceWk: null,
      period: plan.period, weeks: plan.weeks, pool: FAMILY_POOL[family] || 'shared_week',
      subCap: 1, status: 'expired', expiresAt: exp.expiresAt,
      reasonCode: 'expired_promo', shortReason: exp.shortReason, detailReason: exp.detailReason,
      sourceClass: 'expired_promo', lane: null,
      confidence: archived ? archived.confidence : null,
      dataDate: archived ? archived.dataDate : null,
      evidence: { ids: [exp.evidenceId], verifiedAt: exp.verifiedAt, sourceUrl: exp.sourceUrl },
    });
    accounting.expiredCompiled++;
  }

  for (const dr of directRows) {
    if (Object.prototype.hasOwnProperty.call(allowances, dr.key)) continue;
    const isLow = dr.confidence === 'low';
    const sourceClass = isLow ? 'measured_low' : (dr.rawValidated ? 'measured_raw' : 'measured');
    const lane = isLow ? 2 : 1;
    const cap = capFor(dr.planId, dr.family);
    const plan = PLAN_META[dr.planId];
    putRow(dr.key, {
      planId: dr.planId, family: dr.family, lab: dr.lab, allowanceWk: dr.allowanceWk,
      period: plan.period, weeks: plan.weeks, pool: FAMILY_POOL[dr.family] || 'shared_week',
      ...cap, status: 'active', expiresAt: null, reasonCode: 'ok',
      sourceClass, lane, confidence: dr.confidence, dataDate: dr.dataDate,
      evidence: {
        ids: [`rap::${dr.key}`], workload: dr.workload, listSource: dr.listSource,
        ...(dr.rawValidated ? { rawValidated: true } : {}),
        ...(dr.listPriceDriftRatio ? { listPriceDriftRatio: dr.listPriceDriftRatio } : {}),
        note: dr.rawValidated
          ? `Modeled from corroborated raw-token sample (${dr.confidence} confidence, Real API Pricing).`
          : `Directly measured quota (${dr.confidence} confidence, Real API Pricing).`,
      },
    });
    accounting.directActive++;
  }

  for (const spec of AUDITED_SCALED_TARGETS) {
    const key = `${spec.planId}::${spec.family}`;
    if (Object.prototype.hasOwnProperty.call(allowances, key)) continue;
    const targetPlan = PLAN_META[spec.planId];
    const donorPlan = PLAN_META[spec.donorPlanId];
    if (!targetPlan || !donorPlan || targetPlan.lab !== donorPlan.lab) throw new Error(`Invalid scaled target plans: ${key}`);
    const donorKey = `${spec.donorPlanId}::${spec.family}`;
    const donor = directByKey.get(donorKey);
    if (!donor || donor.confidence === 'low') throw new Error(`Scaled target ${key} missing direct non-low donor ${donorKey}`);
    if (PROMO_EXPIRIES[donorKey] && !spec.allowArchivedDonor) throw new Error(`Scaled target ${key} cannot use expired donor ${donorKey} without audit flag`);

    let mult = null, siblings = [];
    if (spec.method === 'worth_mult') {
      if (!(targetPlan.worthMult > 0 && donorPlan.worthMult > 0)) throw new Error(`Missing worthMult for ${key}`);
      mult = targetPlan.worthMult / donorPlan.worthMult;
    } else if (spec.method === 'sibling_median') {
      const s = siblingAllowanceMultiplier(directRows, spec.donorPlanId, spec.planId, donor.workload, spec.family);
      if (!s) throw new Error(`No same-workload siblings for ${key}`);
      mult = s.allowanceMult; siblings = s.siblings;
    } else throw new Error(`Unknown scale method ${spec.method} for ${key}`);

    const allowanceWk = donor.allowanceWk * mult;
    if (!(allowanceWk > 0 && Number.isFinite(allowanceWk))) throw new Error(`Non-positive scaled allowance for ${key}`);
    const cap = capFor(spec.planId, spec.family);
    putRow(key, {
      planId: spec.planId, family: spec.family, lab: targetPlan.lab, allowanceWk,
      period: targetPlan.period, weeks: targetPlan.weeks, pool: FAMILY_POOL[spec.family] || 'shared_week',
      ...cap, status: 'active', expiresAt: null, reasonCode: 'ok',
      sourceClass: 'scaled', lane: 1, confidence: donor.confidence, dataDate: donor.dataDate,
      evidence: {
        ids: [spec.evidenceId, `rap::${donorKey}`], donorPlanId: spec.donorPlanId, donorPlanName: donorPlan.name,
        donorFamily: spec.family, method: spec.method, multiplier: +mult.toPrecision(8), siblings,
        verifiedAt: spec.verifiedAt, sourceUrl: spec.sourceUrl, note: spec.note,
      },
    });
    accounting.scaledCompiled++;
  }

  for (const spec of AUDITED_PREDECESSORS) {
    const key = `${spec.planId}::${spec.family}`;
    if (Object.prototype.hasOwnProperty.call(allowances, key)) continue;
    const targetPlan = PLAN_META[spec.planId];
    const donorPlan = PLAN_META[spec.donorPlanId];
    if (!targetPlan || !donorPlan || targetPlan.lab !== donorPlan.lab) throw new Error(`Invalid predecessor target plans: ${key}`);
    const donorKey = `${spec.donorPlanId}::${spec.donorFamily}`;
    const donor = directByKey.get(donorKey);
    if (!donor || donor.confidence === 'low' || PROMO_EXPIRIES[donorKey]) throw new Error(`Predecessor ${key} requires active direct non-low donor ${donorKey}`);

    let mult = 1, siblings = [];
    if (spec.scaleMethod === 'direct_same_plan') {
      if (spec.planId !== spec.donorPlanId) throw new Error(`direct_same_plan mismatch on ${key}`);
      mult = 1;
    } else if (spec.scaleMethod === 'worth_mult') {
      mult = targetPlan.worthMult / donorPlan.worthMult;
    } else if (spec.scaleMethod === 'sibling_median') {
      const s = siblingAllowanceMultiplier(directRows, spec.donorPlanId, spec.planId, donor.workload, spec.donorFamily);
      if (!s) throw new Error(`No same-workload siblings for predecessor ${key}`);
      mult = s.allowanceMult; siblings = s.siblings;
    } else throw new Error(`Unknown predecessor scaleMethod ${spec.scaleMethod}`);

    if (Math.abs(mult - spec.expectedMult) / spec.expectedMult > spec.multTol) {
      throw new Error(`Predecessor ${key} factor audit failed: got ${mult}, expected ${spec.expectedMult} (±${spec.multTol * 100}%)`);
    }
    const allowanceWk = donor.allowanceWk * mult;
    if (!(allowanceWk > 0 && Number.isFinite(allowanceWk))) throw new Error(`Non-positive predecessor allowance for ${key}`);
    const cap = capFor(spec.planId, spec.family);
    putRow(key, {
      planId: spec.planId, family: spec.family, lab: targetPlan.lab, allowanceWk,
      period: targetPlan.period, weeks: targetPlan.weeks, pool: FAMILY_POOL[spec.family] || 'shared_week',
      ...cap, status: 'active', expiresAt: spec.expiresAt || null, reasonCode: 'ok',
      sourceClass: 'predecessor', lane: 2, confidence: donor.confidence, dataDate: donor.dataDate,
      evidence: {
        ids: [spec.evidenceId, `rap::${donorKey}`], donorPlanId: spec.donorPlanId, donorPlanName: donorPlan.name,
        donorFamily: spec.donorFamily, donorName: spec.donorName, scaleMethod: spec.scaleMethod,
        multiplier: +mult.toPrecision(8), siblings, workloadAssumption: spec.workloadAssumption,
        caveat: spec.caveat, verifiedAt: spec.verifiedAt, sourceUrl: spec.sourceUrl,
      },
    });
    accounting.predecessorCompiled++;
  }

  for (const [key, r] of Object.entries(allowances)) {
    if (key !== `${r.planId}::${r.family}`) throw new Error(`Key mismatch: ${key}`);
    if (!PLAN_META[r.planId]) throw new Error(`Unknown plan in compiled row: ${key}`);
    if (r.period !== 'week' || r.weeks !== 4) throw new Error(`Bad period in ${key}`);
    if (r.status === 'active') {
      if (!(r.allowanceWk > 0 && Number.isFinite(r.allowanceWk))) throw new Error(`Bad allowanceWk in ${key}`);
      if (r.lane !== 1 && r.lane !== 2) throw new Error(`Bad lane in ${key}`);
      if (!r.evidence?.ids?.length) throw new Error(`Missing evidence ids in ${key}`);
    } else if (r.status === 'expired') {
      if (r.lane !== null || r.allowanceWk !== null || !r.expiresAt) throw new Error(`Bad expired row ${key}`);
    } else throw new Error(`Unknown status in ${key}: ${r.status}`);
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    catalogDate: meta.catalogDate || '2026-11-21',
    sourceRevision: meta.sourceRevision || '9c8ffc039781023e41d5e3071778ee61b4ff3618',
    license: 'MIT',
    attribution: 'Copyright (c) 2026 Fei2411 — Real API Pricing (https://github.com/Fei2411/real-api-pricing)',
    weeksPerMonthDisclosure: 'We use four weeks per month to allocate the monthly plan fee. Plan dollars per task estimate the share of that fee at your selected use.',
    plans: PLAN_META,
    presets: PRESETS,
    mixes: MIXES,
    allowances,
    accounting: {
      totalSubRows: accounting.totalSubRows,
      directKept: accounting.directKept,
      directActive: accounting.directActive,
      scaledCompiled: accounting.scaledCompiled,
      predecessorCompiled: accounting.predecessorCompiled,
      expiredCompiled: accounting.expiredCompiled,
      totalCompiledRows: Object.keys(allowances).length,
      skippedNonAllowlisted: accounting.skippedNonAllowlisted,
      rejectedUnpriced: accounting.rejectedUnpriced,
      rejectedInvalid: accounting.rejectedInvalid,
      warningCount: accounting.warnings.length,
    },
    _cliWarnings: accounting.warnings,
  };
}

export function serializeCatalog(built) {
  const { _cliWarnings, ...shipped } = built;
  if (!/^[0-9a-f]{7,40}$/i.test(String(shipped.sourceRevision || ''))) {
    throw new Error(`Invalid sourceRevision (expected 7-40 hex chars): ${JSON.stringify(shipped.sourceRevision)}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(shipped.catalogDate || '')) || !isValidDateStr(String(shipped.catalogDate || ''))) {
    throw new Error(`Invalid catalogDate (expected calendar-valid YYYY-MM-DD): ${JSON.stringify(shipped.catalogDate)}`);
  }
  return [
    `// ${shipped.attribution}`,
    `// Compiled Approach B allowance catalog · schema v${shipped.schemaVersion} · catalog ${shipped.catalogDate} · rev ${shipped.sourceRevision.slice(0, 8)}`,
    `window.PLAN_ALLOWANCES = ${JSON.stringify(shipped)};`,
    '',
  ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rapPath = process.argv[2];
  if (!rapPath) {
    console.error('Usage: node scripts/build-allowances.mjs <rap_points.json> [data/models.js] [data/plan-allowances.js]');
    process.exit(2);
  }
  const aaPath  = process.argv[3] || path.join(ROOT_DIR, 'data', 'models.js');
  const outPath = process.argv[4] || path.join(ROOT_DIR, 'data', 'plan-allowances.js');

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const rap = JSON.parse(fs.readFileSync(rapPath, 'utf8'));
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(aaPath, 'utf8'), sandbox);
  const aaModels = sandbox.window?.AA_DATA?.models || [];

  const snapshotRaw = rap.generatedAt || rap.generated_at || '';
  const catalogDate = /^\d{4}-\d{2}-\d{2}/.test(snapshotRaw) ? snapshotRaw.slice(0, 10) : '2026-11-21';

  const built = compileAllowances(rap.points || [], aaModels, {
    catalogDate,
    sourceRevision: rap.sourceSha || '9c8ffc039781023e41d5e3071778ee61b4ff3618',
  });
  const outJs = serializeCatalog(built);
  fs.writeFileSync(outPath, outJs);
  const sha = crypto.createHash('sha256').update(outJs).digest('hex').slice(0, 8);
  console.log(`Wrote ${path.relative(ROOT_DIR, outPath)} (${sha}) rows=${built.accounting.totalCompiledRows} warnings=${built.accounting.warningCount}`);
}
