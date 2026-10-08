#!/usr/bin/env node
// Local aggregates only. Raw records and join identifiers never leave this process.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { gzipSync, gunzipSync } from 'node:zlib';
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const SITE = 'https://cornishandy.github.io/ai-model-frontier/';
const AAD = Buffer.from('aimf-usage-enc/1|A256GCM|gzip', 'ascii');
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const DEFAULT_PROJECT_DENYLIST = ['taxes', 'medical', 'secret', 'interview'];
const gistId = s => typeof s === 'string' && /^[a-f0-9]{20,40}$/i.test(s);
const ownerLogin = s => typeof s === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/.test(s);
const here = path.dirname(fileURLToPath(import.meta.url));
const BILLING = { claudeAgent: 'subscription', codex: 'subscription', antigravity: 'subscription', codex_openai_api: 'api', opencode: 'api', grok: 'unknown' };
const LABELS = { claudeAgent: 'Claude', codex: 'Codex', codex_openai_api: 'Codex — OpenAI API (paid)', antigravity: 'Antigravity', opencode: 'OpenCode', grok: 'Grok' };
// Antigravity's names for Gemini 3.1 Pro (the owner confirmed). T3 Code's usageModelAliases setting overrides these.
const DEFAULT_MODEL_ALIASES = { 'gemini-pro-agent': 'gemini-3.1-pro-preview', 'gemini-pro-default': 'gemini-3.1-pro-preview' };
class UsageError extends Error {}
const fail = message => { throw new UsageError(message); };
const requireThat = (ok, message) => { if (!ok) fail(message); };
const isCount = n => Number.isSafeInteger(n) && n >= 0;
const isCost = n => n === null || (typeof n === 'number' && Number.isFinite(n) && n >= 0);
const safeId = s => typeof s === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,159}$/.test(s);
const safeLabel = s => typeof s === 'string' && s.length <= 200 && !/[\r\n\x00-\x1f]/.test(s);
const safeProject = s => safeLabel(s) && s.length > 0 && s !== '.' && s !== '..' && !/[\\/]/.test(s);
const projectName = cwd => typeof cwd === 'string' && safeProject(path.basename(cwd)) ? path.basename(cwd) : null;
const readJSON = (file, label) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { fail(`${label}: unreadable or invalid JSON`); }
};
const tokens = (values, label) => {
  requireThat(values.length === 5 && values.every(isCount), `${label}: invalid token counters`);
  requireThat(values[4] <= values[3], `${label}: reasoning must be a subset of output`);
  return values;
};

export function localBucket(ts, tz) {
  requireThat(Number.isFinite(ts) && ts > 0 && !Number.isNaN(new Date(ts).getTime()), 'Invalid usage timestamp');
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(fmt.formatToParts(ts).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), hour: Number(p.hour) };
}

async function *lines(file, label) {
  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of reader) {
      if (!line.trim()) continue;
      let value;
      try { value = JSON.parse(line); } catch { fail(`${label}: invalid raw log record`); }
      yield value;
    }
  } catch (error) {
    if (error.message?.startsWith(label + ':')) throw error;
    fail(`${label}: raw log could not be read`);
  } finally { reader.close(); stream.destroy(); }
}

function cacheTokens(provider, u) {
  if (provider === 'claude') return tokens([u.input_tokens, u.cache_read_input_tokens ?? 0, u.cache_creation_input_tokens ?? 0, u.output_tokens, 0], 'Claude log');
  if (provider === 'codex') return tokens([u.input_tokens - (u.cached_input_tokens ?? 0) - (u.cache_write_input_tokens ?? 0), u.cached_input_tokens ?? 0, u.cache_write_input_tokens ?? 0, u.output_tokens, u.reasoning_output_tokens ?? 0], 'Codex log');
  return tokens([u.inputTokens - u.cachedReadTokens - u.cacheCreationTokens, u.cachedReadTokens, u.cacheCreationTokens, u.outputTokens, u.reasoningTokens], 'Grok log');
}

// Verify live column semantics on each source/model/tier, without retaining message content.
async function inspectFile(file, provider, wanted, scanAll = false) {
  let cwd = null, activeModel = null, firstSession = null;
  const verified = new Set(), grok = new Map();
  let scanned = 0;
  for await (const x of lines(file, `${provider} log`)) {
    scanned++;
    if (provider === 'claude' && !cwd && typeof x.cwd === 'string') cwd = x.cwd;
    if (provider === 'codex') {
      if (x.type === 'session_meta' && !firstSession) { firstSession = x.payload?.id ?? x.payload?.session_id; cwd = x.payload?.cwd; }
      if (x.type === 'turn_context') activeModel = x.payload?.model;
    }
    if (provider === 'grok' && x.params?.update?.sessionUpdate === 'turn_completed') {
      const u = x.params.update.usage;
      requireThat(u && u.modelUsage && typeof u.modelUsage === 'object' && !Array.isArray(u.modelUsage), 'Grok log: missing per-model turn usage');
      const ts = x.params._meta?.agentTimestampMs ?? x.timestamp * 1000;
      for (const [model, usage] of Object.entries(u.modelUsage)) {
        requireThat(safeId(model) && isCount(usage.modelCalls) && usage.modelCalls > 0 && isCount(usage.costUsdTicks), 'Grok log: invalid call count or cost');
        const t = cacheTokens(provider, usage);
        const k = JSON.stringify([ts, model, ...t]);
        const value = { requests: usage.modelCalls, cost: usage.costUsdTicks / 1e10 };
        if (grok.has(k)) requireThat(JSON.stringify(grok.get(k)) === JSON.stringify(value), 'Grok log: conflicting duplicate turn');
        grok.set(k, value);
      }
    }
    for (let i = 0; i < wanted.length; i++) {
      if (verified.has(i)) continue;
      const r = wanted[i];
      if (provider === 'grok') {
        const v = grok.get(JSON.stringify([r[0], r.model, ...r.slice(3, 8)]));
        if (v) { requireThat(Math.abs(v.cost - r[9]) < 1e-9, 'Grok cache: cost column no longer matches raw ticks'); verified.add(i); }
      } else {
        if (Date.parse(x.timestamp) !== r[0]) continue;
        const u = provider === 'claude' ? x.message?.usage : x.payload?.type === 'token_count' ? x.payload.info?.last_token_usage : null;
        if (!u) continue;
        const rawModel = provider === 'claude' ? x.message.model : activeModel;
        if (rawModel && rawModel !== r.model) continue;
        if (JSON.stringify(cacheTokens(provider, u)) !== JSON.stringify(r.slice(3, 8))) continue;
        if (provider === 'claude') requireThat(r[8] === `${x.message.id}:${x.requestId}`, 'Claude cache: dedupe key format changed');
        verified.add(i);
      }
    }
    if (!scanAll && verified.size === wanted.length && (cwd || scanned >= 200)) break;
    if (!scanAll && wanted.length === 0 && (cwd || scanned >= 200)) break;
  }
  requireThat(verified.size === wanted.length, `${provider} cache: sampled rows do not match raw logs`);
  return { project: projectName(cwd), grok, verified: verified.size };
}

function sourceRoots(home) {
  return [
    { provider: 'claude', instance: 'claudeAgent', dir: path.join(home, '.claude/projects') },
    { provider: 'codex', instance: 'codex', dir: path.join(home, '.codex/sessions') },
    { provider: 'codex', instance: 'codex_openai_api', dir: path.join(home, '.codex-t3-api/sessions') },
    { provider: 'grok', instance: 'grok', dir: path.join(home, '.grok/sessions') },
  ];
}

async function readCache(home, noProjects, warn) {
  const file = path.join(home, '.t3/userdata/usage-scan-cache-v5.json');
  if (!fs.existsSync(file)) { warn('T3 usage cache is missing'); return { events: [], verified: 0, duplicates: 0, synthetic: 0, missingRaw: 0, missingSource: true }; }
  const c = readJSON(file, 'T3 usage cache');
  requireThat(c.version === 5 && Array.isArray(c.models) && Array.isArray(c.sessions) && c.sources && typeof c.sources === 'object' && !Array.isArray(c.sources) && c.files && typeof c.files === 'object' && !Array.isArray(c.files), 'T3 usage cache: expected version 5 structure');
  requireThat(c.models.every(m => m === '<synthetic>' || safeId(m)) && c.sessions.every(s => typeof s === 'string'), 'T3 usage cache: invalid model/session dictionaries');
  const roots = sourceRoots(home);
  for (const [k, s] of Object.entries(c.sources)) requireThat(roots.some(r => k === `${r.provider}\0${r.dir}` && s.dir === r.dir), 'T3 usage cache: unverified source root');
  const events = [], seen = new Map(), sampled = new Set();
  let verified = 0, duplicates = 0, synthetic = 0, missingRaw = 0;
  for (const [file, entry] of Object.entries(c.files).sort(([a], [b]) => a.localeCompare(b))) {
    requireThat(entry && typeof entry === 'object', 'T3 usage cache: invalid file metadata');
    const root = roots.find(r => entry.p === r.provider && file.startsWith(r.dir + path.sep));
    requireThat(root && c.sources[`${root.provider}\0${root.dir}`] && path.resolve(file) === file && Array.isArray(entry.r), 'T3 usage cache: invalid file entry');
    const wanted = [];
    for (const r of entry.r) {
      requireThat(Array.isArray(r) && r.length === 11 && isCount(r[0]) && r[0] > 0 && !Number.isNaN(new Date(r[0]).getTime()) && isCount(r[1]) && r[1] < c.models.length && isCount(r[2]) && r[2] < c.sessions.length && (r[8] === null || typeof r[8] === 'string') && isCost(r[9]) && (r[10] === 0 || r[10] === 1), 'T3 usage cache: row layout changed');
      tokens(r.slice(3, 8), 'T3 usage cache');
      if (c.models[r[1]] === '<synthetic>') continue;
      const sampleKey = `${root.instance}:${c.models[r[1]]}:${r[10]}`;
      if (!sampled.has(sampleKey) && fs.existsSync(file)) { const sample = [...r]; sample.model = c.models[r[1]]; wanted.push(sample); sampled.add(sampleKey); }
    }
    if (!entry.r.length) continue;
    const available = fs.existsSync(file);
    if (available) requireThat(fs.realpathSync(file).startsWith(fs.realpathSync(root.dir) + path.sep), 'T3 usage cache: raw file escapes its source root');
    let info = { project: null, grok: new Map() };
    if (available && (wanted.length || !noProjects || entry.p === 'grok')) {
      info = await inspectFile(file, entry.p, wanted, entry.p === 'grok');
      verified += info.verified;
    } else if (!available) missingRaw++;
    if (entry.p === 'grok' && !noProjects) {
      try { info.project = projectName(decodeURIComponent(path.relative(root.dir, file).split(path.sep)[0])); }
      catch { fail('Grok log: invalid encoded project directory'); }
    }
    for (const r of entry.r) {
      const model = c.models[r[1]];
      if (model === '<synthetic>') { synthetic++; continue; }
      // A millisecond timestamp alone is not unique: several genuine calls can share it.
      const key = r[8] === null ? JSON.stringify([root.instance, c.sessions[r[2]], r[0], model, ...r.slice(3, 8), r[9]]) : `${root.instance}:${r[8]}`;
      const signature = JSON.stringify([r[0], model, ...r.slice(3, 8), r[9]]);
      if (seen.has(key)) {
        const prior = seen.get(key);
        requireThat(prior.signature === signature, 'T3 usage cache: conflicting dedupe key');
        if (r[8] !== null || prior.file !== file) { duplicates++; continue; }
      }
      seen.set(key, {signature,file});
      let requests = 1, cost = r[9];
      if (entry.p === 'grok') {
        const usage = info.grok.get(JSON.stringify([r[0], model, ...r.slice(3, 8)]));
        requireThat(usage, 'Grok cache: raw model call counts unavailable');
        requests = usage.requests; cost = usage.cost;
      }
      events.push({ source: 't3-usage-cache', model, instance: root.instance, driver: entry.p === 'claude' ? 'claudeAgent' : entry.p, project: noProjects ? null : info.project, session: `${root.instance}:${c.sessions[r[2]]}`, ts: r[0], requests, t: r.slice(3, 8), providerCost: cost });
    }
  }
  if (missingRaw) warn(`${missingRaw} cached files no longer have raw logs; their projects may be omitted`);
  for (const r of roots) for (const model of new Set(events.filter(e => e.instance === r.instance).map(e => e.model))) requireThat([...sampled].some(k => k.startsWith(`${r.instance}:${model}:`)), 'T3 cache: cannot verify a model against raw logs');
  return { events, verified, duplicates, synthetic, missingRaw };
}

// Fetch a consistent WAL snapshot, then release it before processing any rows.
// Read-only WAL connections may use SQLite's coordination sidecars; no SQL writes.
export function fetchDatabaseRows(file, label, fetch) {
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    db.exec('PRAGMA query_only=ON');
    requireThat(db.prepare('PRAGMA journal_mode').get().journal_mode === 'wal', `${label}: WAL journal mode is required`);
    db.exec('BEGIN');
    const rows = fetch(db);
    db.exec('COMMIT');
    return rows;
  } catch (error) {
    if (error instanceof UsageError) throw error;
    fail(`${label}: cannot fetch read-only database snapshot`);
  } finally { db?.close(); }
}
function query(db, sql, label) { try { return db.prepare(sql).all(); } catch { fail(`${label}: database schema no longer matches verified queries`); } }

function readOpenCode(home, noProjects, warn, note) {
  const file = path.join(home, '.local/share/opencode/opencode.db');
  if (!fs.existsSync(file)) { warn('OpenCode database is missing; T3 turns will be used instead'); note('missing_source', 'opencode-db'); return { events: [], duplicates: 0, zero: 0 }; }
  const rows = fetchDatabaseRows(file, 'OpenCode', db => {
    const tables = new Set(query(db, "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('message','session','session_message','session_v2')", 'OpenCode').map(r => r.name));
    requireThat((tables.has('message') && tables.has('session')) || (tables.has('session_message') && tables.has('session_v2')), 'OpenCode: unsupported usage tables');
    let rows = [];
    // Select only usage metadata. Modern migration copies win.
    for (const modern of [true, false]) {
      if (!tables.has(modern ? 'session_message' : 'message')) continue;
      const sql = modern ? `SELECT m.id,m.session_id,m.time_created,json_extract(m.data,'$.time.completed') completed,json_extract(m.data,'$.tokens') tokens,json_extract(m.data,'$.cost') cost,json_extract(m.data,'$.model.id') model,json_extract(m.data,'$.model.providerID') provider,s.directory FROM session_message m LEFT JOIN session_v2 s ON s.id=m.session_id WHERE m.type='assistant' AND json_extract(m.data,'$.tokens') IS NOT NULL` : `SELECT m.id,m.session_id,m.time_created,json_extract(m.data,'$.time.completed') completed,json_extract(m.data,'$.tokens') tokens,json_extract(m.data,'$.cost') cost,json_extract(m.data,'$.modelID') model,json_extract(m.data,'$.providerID') provider,s.directory FROM message m LEFT JOIN session s ON s.id=m.session_id WHERE json_extract(m.data,'$.role')='assistant' AND json_extract(m.data,'$.tokens') IS NOT NULL`;
      rows = rows.concat(query(db, sql, 'OpenCode'));
    }
    return rows;
  });
  const events = [], seen = new Map(); let duplicates = 0, zero = 0;
  for (const r of rows) {
    requireThat(safeId(r.model) && safeId(r.provider), 'OpenCode: invalid model metadata');
    let u; try { u = JSON.parse(r.tokens); } catch { fail('OpenCode: invalid usage JSON'); }
    const t = tokens([u.input, u.cache?.read ?? 0, u.cache?.write ?? 0, u.output + (u.reasoning ?? 0), u.reasoning ?? 0], 'OpenCode');
    requireThat(isCost(r.cost), 'OpenCode: invalid provider cost');
    const signature = JSON.stringify([r.provider, r.model, ...t, r.cost]);
    if (seen.has(r.id)) { requireThat(seen.get(r.id) === signature, 'OpenCode: conflicting migrated usage'); duplicates++; continue; }
    seen.set(r.id, signature);
    if (t.every(n => n === 0) && (r.cost === null || r.cost === 0)) { zero++; continue; }
    if (r.completed === null) { warn('OpenCode has unfinished usage; it is omitted until complete'); note('incomplete_usage', 'opencode-db'); continue; }
    requireThat(isCount(r.completed) && r.completed > 0 && !Number.isNaN(new Date(r.completed).getTime()) && isCount(r.time_created) && r.time_created > 0, 'OpenCode: invalid message time');
    events.push({ source: 'opencode-db', model: `${r.provider}/${r.model}`, instance: 'opencode', driver: 'opencode', requestUnit: 'calls', project: noProjects ? null : projectName(r.directory), session: `opencode:${r.session_id}`, ts: r.completed, start: r.time_created, requests: 1, t, providerCost: r.cost });
  }
  return { events, duplicates, zero };
}

// Antigravity keeps each call's usage as protobuf metadata in the conversation's SQLite file (the files T3 Code's usage
// page reads). Only counters, model names and times are decoded; conversation text is never selected.
const PB_FIXED = Symbol('fixed-width');
function pbFields(bytes) {
  let offset = 0;
  const out = new Map();
  const varint = () => {
    let value = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      const byte = bytes[offset++];
      requireThat(byte !== undefined && !(shift === 63n && byte > 1), 'Antigravity: invalid protobuf');
      value |= BigInt(byte & 127) << shift;
      if (byte < 128) return value > BigInt(Number.MAX_SAFE_INTEGER) ? value : Number(value);
    }
    fail('Antigravity: invalid protobuf');
  };
  while (offset < bytes.length) {
    const tag = varint();
    requireThat(typeof tag === 'number' && tag >= 8, 'Antigravity: invalid protobuf');
    const field = Math.floor(tag / 8), wire = tag % 8;
    let value;
    if (wire === 0) value = varint();
    else {
      requireThat(wire === 1 || wire === 2 || wire === 5, 'Antigravity: invalid protobuf');
      const length = wire === 2 ? varint() : wire === 1 ? 8 : 4;
      requireThat(typeof length === 'number' && length <= bytes.length - offset, 'Antigravity: invalid protobuf');
      // Fixed-width values are kept only as a marker, so a counter sent that way fails instead of reading as 0.
      value = wire === 2 ? bytes.subarray(offset, offset + length) : PB_FIXED;
      offset += length;
    }
    if (!out.has(field)) out.set(field, []);
    out.get(field).push(value);
  }
  return out;
}
const pbNum = (m, k) => typeof m.get(k)?.[0] === 'number' ? m.get(k)[0] : 0;
// Counters must be plain varints within safe integers: an oversized or mistyped one fails the file, never reads as 0.
const pbCount = (m, k) => { const v = m.get(k)?.[0]; requireThat(v === undefined || isCount(v), 'Antigravity: invalid counter'); return v ?? 0; };
const pbBytes = (m, k) => m.get(k)?.[0] instanceof Uint8Array ? m.get(k)[0] : undefined;
const pbMsg = (m, k) => pbBytes(m, k) === undefined ? new Map() : pbFields(pbBytes(m, k));
const pbText = (m, k) => {
  const b = pbBytes(m, k);
  if (b === undefined) return '';
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b).trim(); } catch { fail('Antigravity: invalid text field'); }
};
// Seconds + nanos, kept only from 2015 to two days ahead; anything else falls back to the conversation's or file's time.
const pbTime = m => {
  const s = m.get(1)?.[0], n = m.get(2)?.[0] ?? 0;
  if (!Number.isSafeInteger(s) || !Number.isSafeInteger(n) || n < 0 || n > 999999999) return null;
  const t = s * 1e3 + Math.floor(n / 1e6);
  return t >= Date.UTC(2015, 0, 1) && t <= Date.now() + 2 * 864e5 ? t : null;
};
// T3 Code's table of Antigravity's numeric model ids (older builds recorded only these).
const AG_MODEL_IDS = { 246: 'gemini-2.5-pro', 312: 'gemini-2.5-flash', 313: 'gemini-2.5-flash-thinking', 329: 'gemini-2.5-flash-thinking', 330: 'gemini-2.5-flash-lite', 281: 'claude-sonnet-4', 282: 'claude-sonnet-4', 290: 'claude-opus-4', 291: 'claude-opus-4', 333: 'claude-sonnet-4-5', 334: 'claude-sonnet-4-5', 340: 'claude-haiku-4-5', 341: 'claude-haiku-4-5', 1026: 'claude-opus-4-6', 1035: 'claude-sonnet-4-6', 1016: 'gemini-3.1-pro', 1036: 'gemini-3.1-pro', 1037: 'gemini-3.1-pro', 1018: 'gemini-3-flash-preview', 1084: 'gemini-3-flash-preview', 1047: 'gemini-3-flash-preview' };
function agModelName(name, id) {
  let s = AG_MODEL_IDS[id] ?? (id > 0 ? `antigravity-model-${id}` : '');
  if (name) {
    s = name.toLowerCase().replace(/\s*\([^)]*\)\s*$/, '').replaceAll(' ', '-');
    if (s.startsWith('claude-')) s = s.replace(/^claude-(4(?:\.\d+)?)-(sonnet|opus|haiku)/, 'claude-$2-$1').replaceAll('.', '-');
  }
  return s === '' || safeId(s) ? s : 'antigravity-unknown';
}
// A step's model is the one asked for (e.g. gemini-3.8-flash-high); a generation's is the one that served it.
function agEntry(bytes, step) {
  requireThat(bytes instanceof Uint8Array, 'Antigravity: invalid metadata row');
  const root = pbFields(bytes);
  requireThat(step || pbBytes(root, 1) !== undefined, 'Antigravity: missing generation metadata');
  const data = step ? root : pbMsg(root, 1), model = step ? pbMsg(data, 24) : data, usage = pbBytes(data, step ? 9 : 4);
  const usages = usage === undefined ? [] : [pbFields(usage)];
  for (const retry of data.get(step ? 28 : 17) ?? []) {
    requireThat(retry instanceof Uint8Array, 'Antigravity: invalid retry metadata');
    const u = pbBytes(pbFields(retry), 2);
    if (u !== undefined) usages.push(pbFields(u));
  }
  return { model: agModelName(pbText(model, step ? 12 : 19) || pbText(model, step ? 8 : 21), pbNum(model, step ? 1 : 3)), ts: step ? pbTime(pbMsg(data, 8)) ?? pbTime(pbMsg(data, 1)) : pbTime(pbMsg(pbMsg(data, 9), 4)), usages };
}
// Antigravity stores one call up to three times: as a step, as a generation, and again as an identical "retry" copy
// (T3 Code's usage page adds all three). Within one entry, a usage repeating an earlier one (same counters, no
// conflicting response id) is that copy. Each remaining usage is ranked among the same side's usages with the same
// counters, so readAntigravity can line up the nth step with the nth generation.
function agFile(file, fallbackTs) {
  const rows = fetchDatabaseRows(file, 'Antigravity', db => {
    const tables = new Set(query(db, "SELECT name FROM sqlite_master WHERE type='table'", 'Antigravity').map(r => r.name));
    requireThat(tables.has('gen_metadata') || tables.has('steps'), 'Antigravity: unsupported usage tables');
    return {
      steps: tables.has('steps') ? query(db, 'SELECT metadata FROM steps WHERE metadata IS NOT NULL ORDER BY idx', 'Antigravity') : [],
      gens: tables.has('gen_metadata') ? query(db, 'SELECT data FROM gen_metadata ORDER BY idx', 'Antigravity') : [],
      trajectory: tables.has('trajectory_metadata_blob') ? query(db, 'SELECT data FROM trajectory_metadata_blob', 'Antigravity') : [],
    };
  });
  let trajectoryTs = null, stored = 0;
  for (const r of rows.trajectory) { requireThat(r.data instanceof Uint8Array, 'Antigravity: invalid metadata row'); trajectoryTs ??= pbTime(pbMsg(pbFields(r.data), 2)); }
  const occ = [], ranks = new Map();
  const add = (entry, side) => {
    const kept = [];
    for (const u of entry.usages) {
      const output = Math.max(pbCount(u, 3), pbCount(u, 9) + pbCount(u, 10)), t = [pbCount(u, 2), pbCount(u, 5), pbCount(u, 4), output, Math.min(output, pbCount(u, 9))];
      if (t[0] + t[1] + t[2] + t[3] === 0) continue;
      stored++;
      const tuple = [2, 3, 4, 5, 9, 10].map(k => pbCount(u, k)).join(','), ids = [11, 12, 7].flatMap(k => { const id = pbText(u, k); return id ? [`${k}:${id}`] : []; });
      const twin = kept.find(o => o.tuple === tuple && (!o.ids.length || !ids.length || o.ids.some(id => ids.includes(id))));
      if (twin) { twin.ids.push(...ids.filter(id => !twin.ids.includes(id))); continue; }
      const rank = ranks.get(side + tuple) ?? 0;
      ranks.set(side + tuple, rank + 1);
      const o = { side, tuple, rank, ids, t: tokens(t, 'Antigravity'), ts: entry.ts ?? trajectoryTs ?? fallbackTs, quality: entry.ts !== null ? 2 : trajectoryTs !== null ? 1 : 0, model: entry.model, enumModel: AG_MODEL_IDS[pbNum(u, 1)] ?? '', idModel: agModelName('', pbNum(u, 1)) };
      kept.push(o); occ.push(o);
    }
  };
  for (const r of rows.steps) add(agEntry(r.metadata, true), 'step');
  for (const r of rows.gens) add(agEntry(r.data, false), 'gen');
  return { stored, occ };
}
// T3 Code's Antigravity stores: the app's own folders and each Antigravity instance's profile in T3 Code. Usages are
// one call when they share a response id (anywhere; each counter's maximum is kept, as T3 Code merges them), or when
// they hold the same place in one conversation: the nth step and the nth generation with the same counters, in this
// file and in copies of it (same file name). Usages whose response ids conflict are never merged. So copies collapse,
// while two genuinely identical calls stay two, each with its own time and model.
function readAntigravity(home, agInstances, warn, note) {
  const fallback = agInstances.includes('antigravity') ? 'antigravity' : agInstances[0] ?? 'antigravity';
  const roots = ['antigravity', 'antigravity-cli', 'antigravity-ide', 'antigravity-backup'].map(n => [path.join(home, '.gemini', n), fallback])
    .concat([[path.join(home, '.config/antigravity'), fallback]], agInstances.map(id => [path.join(home, '.t3/userdata/providers/antigravity', createHash('sha256').update(id).digest('hex'), 'antigravity-acp'), id]));
  const visited = new Map(), all = [], covered = new Set();
  let found = false, files = 0, unreadable = 0, stored = 0;
  for (const [root, instance] of roots) {
    if (!lstat(root)) continue;
    found = true;
    // A store folder that is itself a link is followed, as T3 Code does; links inside it are neither followed nor read.
    let dir;
    try { dir = fs.realpathSync(root); if (lstat(path.join(dir, 'conversations'))) dir = fs.realpathSync(path.join(dir, 'conversations')); } catch { unreadable++; continue; }
    const walk = d => {
      let entries;
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { unreadable++; return; }
      for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const file = path.join(d, e.name);
        if (e.isDirectory()) { walk(file); continue; }
        if (!e.isFile() || !e.name.endsWith('.db')) continue;
        let real, read;
        try {
          real = fs.realpathSync(file);
          // An instance whose store holds call records covers its own T3 turns, even when the records are copies.
          if (visited.has(real)) { if (visited.get(real)) covered.add(instance); continue; }
          read = agFile(file, fs.statSync(file).mtimeMs);
          visited.set(real, read.occ.length > 0);
        } catch { unreadable++; continue; }
        files++; stored += read.stored;
        if (read.occ.length) covered.add(instance);
        const session = path.basename(file, '.db');
        for (const o of read.occ) all.push({ ...o, session, instance });
      }
    };
    walk(dir);
  }
  const parent = all.map((_, i) => i), idsOf = all.map(o => new Set(o.ids));
  const find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const join = (a, b, unlessConflict) => {
    a = find(a); b = find(b);
    if (a === b || (unlessConflict && idsOf[a].size && idsOf[b].size && ![...idsOf[a]].some(x => idsOf[b].has(x)))) return;
    if (b < a) [a, b] = [b, a];
    parent[b] = a;
    for (const x of idsOf[b]) idsOf[a].add(x);
  };
  const byId = new Map(), byPlace = new Map();
  all.forEach((o, i) => { for (const id of o.ids) { if (byId.has(id)) join(i, byId.get(id)); else byId.set(id, i); } });
  all.forEach((o, i) => { const k = `${o.session}\0${o.tuple}\0${o.rank}`; if (byPlace.has(k)) join(i, byPlace.get(k), true); else byPlace.set(k, i); });
  const groups = new Map();
  all.forEach((o, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(o); });
  const events = [...groups.values()].map(g => {
    const best = g.reduce((a, o) => o.quality > a.quality || (o.quality === a.quality && o.ts < a.ts) ? o : a), pick = f => g.map(f).find(Boolean);
    return { source: 'antigravity-db', model: pick(o => o.enumModel) || pick(o => o.side === 'step' && o.model) || pick(o => o.model) || pick(o => o.idModel) || 'antigravity-unknown', instance: g[0].instance, driver: 'antigravity', requestUnit: 'calls', project: null, session: `antigravity:${g[0].session}`, ts: best.ts, requests: 1, t: g.reduce((a, o) => a.map((n, i) => Math.max(n, o.t[i])), [0, 0, 0, 0, 0]), providerCost: null };
  });
  if (!found && agInstances.length) { warn('Antigravity conversation folders are missing'); note('missing_source', 'antigravity-db'); }
  if (unreadable) { warn(`${unreadable} Antigravity conversation files or folders could not be read; their use is omitted`); note('unreadable_history', 'antigravity-db', unreadable); }
  // T3 turns stay the fallback for every Antigravity instance not in covered.
  return { events, covered, files, unreadable, collapsed: stored - events.length };
}

function readT3(home, noProjects, openCodeEvents, warn, note, antigravityCovered = new Set()) {
  const file = path.join(home, '.t3/userdata/statev2.sqlite');
  if (!fs.existsSync(file)) { warn('T3 state database is missing'); note('missing_source', 't3-turns'); return { events: [], excluded: 0, covered: 0, absent: 0 }; }
  const rows = fetchDatabaseRows(file, 'T3 state', db => query(db, `SELECT t.provider_turn_id,t.provider_thread_id,t.started_at,t.completed_at,json_extract(t.payload_json,'$.turnTokenUsage') usage,coalesce(a.provider_instance_id,r.provider_instance_id,pt.provider_instance_id,s.provider_instance_id,a.provider,r.provider,pt.provider,s.provider) instance,coalesce(a.provider,r.provider,pt.driver,s.driver,pt.provider,s.provider) driver,coalesce(json_extract(t.payload_json,'$.modelSelection.model'),json_extract(a.payload_json,'$.modelSelection.model'),json_extract(r.payload_json,'$.modelSelection.model')) model,p.workspace_root FROM orchestration_v2_projection_provider_turns t LEFT JOIN orchestration_v2_projection_run_attempts a ON a.attempt_id=t.run_attempt_id LEFT JOIN orchestration_v2_projection_runs r ON r.run_id=a.run_id LEFT JOIN orchestration_v2_projection_provider_threads pt ON pt.provider_thread_id=t.provider_thread_id LEFT JOIN orchestration_v2_projection_provider_sessions s ON s.provider_session_id=pt.provider_session_id LEFT JOIN projection_threads th ON th.thread_id=t.thread_id LEFT JOIN projection_projects p ON p.project_id=th.project_id`, 'T3 state'));
  const events = []; let excluded = 0, covered = 0, absent = 0;
  for (const r of rows) {
    // An Antigravity instance with its own call records: its T3 turns would count the same use again.
    const eligible = (r.driver === 'antigravity' && !antigravityCovered.has(r.instance)) || r.driver === 'opencode';
    if (!eligible) { if (r.usage !== null) excluded++; continue; }
    if (r.usage === null) { absent++; note(r.driver === 'antigravity' ? 'antigravity_without_counters' : 'missing_counters', 't3-turns'); continue; }
    let u; try { u = JSON.parse(r.usage); } catch { fail('T3 state: invalid usage JSON'); }
    requireThat(u.usageScope === 'main_agent' && typeof u.hasSubagents === 'boolean' && ['complete','partial','unknown'].includes(u.usageStatus), 'T3 state: unverified turn usage scope/status');
    if (u.usageStatus !== 'complete' || !r.completed_at) { warn('T3 has incomplete turn usage; it is omitted until complete'); note('incomplete_usage', 't3-turns'); continue; }
    requireThat(Number.isFinite(Date.parse(r.completed_at)), 'T3 state: invalid turn completion time');
    const t = tokens([u.inputTokens - u.cachedInputTokens - u.cacheCreationTokens, u.cachedInputTokens, u.cacheCreationTokens, u.outputTokens, u.reasoningTokens], 'T3 turn');
    if (r.driver === 'opencode' && openCodeEvents.length) {
      const start = Date.parse(r.started_at), end = Date.parse(r.completed_at);
      requireThat(Number.isFinite(start), 'T3 state: invalid turn start time');
      const matches = openCodeEvents.filter(e => e.start >= start - 2000 && e.ts <= end + 2000);
      const summed = matches.reduce((a,e) => a.map((v,i) => v + e.t[i]), [0,0,0,0,0]);
      if (JSON.stringify(summed) === JSON.stringify(t)) covered++;
      else { warn('OpenCode history does not exactly reconcile a T3 turn; database messages remain authoritative'); note('partial_history', 'opencode-db'); }
      excluded++; continue;
    }
    requireThat(safeId(r.instance) && (r.model === null || safeId(r.model)), 'T3 state: invalid captured model/instance');
    // Provider-session model is mutable and must never reprice historical turns.
    const model = r.model ?? 'unattributed';
    if (r.model === null) note('unattributed_model', 't3-turns');
    if (u.hasSubagents) { warn('T3 main-agent-only usage omits unreported subagent tokens'); note('unreported_subagents', 't3-turns'); }
    events.push({ source: 't3-turns', model, instance: r.instance, driver: r.driver, requestUnit: 'turns', project: noProjects ? null : projectName(r.workspace_root), session: `${r.instance}:${r.provider_thread_id}`, ts: Date.parse(r.completed_at), requests: 1, t, providerCost: null });
  }
  if (absent) warn(`Eligible T3 turns without token telemetry: ${absent}; no usage is invented`);
  return { events, excluded, covered, absent };
}

const normalize = s => s.toLowerCase().replace(/[._]/g, '-');
function baseModel(id, aliases) {
  let s = id.split('/').at(-1).replace(/^antigravity-/, '');
  const seen = new Set();
  while (Object.hasOwn(aliases, s)) { requireThat(!seen.has(s), 'Settings: model alias cycle'); seen.add(s); s = aliases[s]; }
  return s;
}
function labFor(id, aa) {
  if (aa?.creatorSlug) return ({ 'xai': 'xai', 'google': 'google', 'openai': 'openai', 'anthropic': 'anthropic', 'z-ai': 'zai' })[aa.creatorSlug] ?? aa.creatorSlug;
  if (/^claude-/.test(id)) return 'anthropic';
  if (/^(gpt-|codex-)/.test(id)) return 'openai';
  if (/^grok-/.test(id)) return 'xai';
  if (/^gemini-/.test(id)) return 'google';
  if (/^deepseek-/.test(id)) return 'deepseek';
  if (/^glm-/.test(id)) return 'zai';
  if (/^qwen/.test(id)) return 'alibaba';
  if (/^mimo-/.test(id)) return 'xiaomi';
  return 'other';
}
function loadPrices(home, aaFile, warn) {
  const rateFile = path.join(home, '.t3/userdata/usage-model-rates.json');
  let rates = {};
  if (fs.existsSync(rateFile)) { const x = readJSON(rateFile, 'Model rates'); requireThat(x.document && typeof x.document === 'object' && !Array.isArray(x.document), 'Model rates: expected LiteLLM document'); rates = x.document; }
  else warn('T3 model rates are missing; using site price fallback');
  const context = { window: {} };
  try { vm.runInNewContext(fs.readFileSync(aaFile, 'utf8'), context, { timeout: 1000 }); } catch { fail('Site model data: could not load'); }
  const aa = context.window.AA_DATA?.models;
  requireThat(Array.isArray(aa) && aa.every(m => safeId(m.family)), 'Site model data: unexpected model format');
  return { rates, aa };
}
function resolvePrice(id, aliases, rates, aaModels, providerOnly) {
  const base = id === 'unattributed' ? id : baseModel(id, aliases), n = normalize(base).replace(/-build$/, '');
  const aa = aaModels.find(m => normalize(m.family) === n) ?? null;
  const lab = labFor(base, aa);
  const variants = [...new Set([base, base.replace(/\./g, '-'), base.replace(/-(\d)-(\d)(?=-|$)/g, '$1.$2')])];
  let rate;
  for (const key of [id, ...variants, ...variants.flatMap(m => [`${lab}/${m}`, `${lab}.${m}`, `openai/${m}`, `anthropic/${m}`, `gemini/${m}`])]) {
    const r = rates[key];
    if (r && typeof r.input_cost_per_token === 'number' && typeof r.output_cost_per_token === 'number') { rate = r; break; }
  }
  let price = { in: null, cachedIn: null, cacheWrite: null, out: null, src: 'none' };
  if (id === 'unattributed') return { id, label: 'Unattributed model', lab: 'other', aa: null, price };
  if (rate) price = { in: rate.input_cost_per_token * 1e6, cachedIn: (rate.cache_read_input_token_cost ?? rate.input_cost_per_token) * 1e6, cacheWrite: (rate.cache_creation_input_token_cost ?? rate.input_cost_per_token) * 1e6, out: rate.output_cost_per_token * 1e6, src: 'litellm' };
  else if (aa && Number.isFinite(aa.priceInput) && Number.isFinite(aa.priceOutput)) {
    // Documented conservative fallback; use explicit cached prices whenever available.
    const read = ({ anthropic: .1, openai: .1, google: .1, deepseek: .1, xai: .25 })[lab] ?? 1;
    price = { in: aa.priceInput, cachedIn: aa.priceInput * read, cacheWrite: aa.priceInput * (lab === 'anthropic' ? 1.25 : 1), out: aa.priceOutput, src: 'aa' };
  }
  if (providerOnly) price.src = 'provider';
  for (const k of ['in','cachedIn','cacheWrite','out']) requireThat(isCost(price[k]), 'Model rates: invalid price');
  return { id, label: aa?.familyName ?? (id === 'antigravity-unknown' ? 'Antigravity (model not recorded)' : base), lab, aa: aa?.family ?? null, price };
}
function eventCost(e, price) {
  if (e.providerCost !== null) return e.providerCost;
  if ([price.in, price.cachedIn, price.cacheWrite, price.out].some(v => v === null)) return null;
  return (e.t[0] * price.in + e.t[1] * price.cachedIn + e.t[2] * price.cacheWrite + e.t[3] * price.out) / 1e6;
}
const roundCost = n => n === null ? null : Math.round(n * 1e9) / 1e9;

export async function collect({ home = os.homedir(), aaFile = path.join(here, '../data/models.js'), projects: includeProjects = false, noProjects = false, projectDenylist = DEFAULT_PROJECT_DENYLIST, tz = Intl.DateTimeFormat().resolvedOptions().timeZone, now = new Date(), warn = () => {} } = {}) {
  noProjects = noProjects || !includeProjects;
  requireThat(Array.isArray(projectDenylist) && projectDenylist.every(s => typeof s === 'string' && s.length > 0), 'Project denylist: expected nonempty strings');
  // Diagnostics are buffered until the final privacy barrier has passed.
  const warnings = new Set(), coverage = new Map();
  const warning = message => warnings.add(message);
  const note = (code, source, count = 1, modelIdx = null) => {
    const key = `${code}:${source}:${modelIdx}`;
    if (!coverage.has(key)) coverage.set(key, { code, source, modelIdx, count: 0 });
    coverage.get(key).count += count;
  };
  const settingsFile = path.join(home, '.t3/userdata/settings.json');
  let instances = {}, aliases = { ...DEFAULT_MODEL_ALIASES };
  if (fs.existsSync(settingsFile)) {
    const s = readJSON(settingsFile, 'T3 settings');
    requireThat(s.providerInstances && typeof s.providerInstances === 'object' && !Array.isArray(s.providerInstances), 'T3 settings: expected providerInstances');
    // Do not traverse or copy config/auth/secret objects.
    instances = Object.fromEntries(Object.entries(s.providerInstances).map(([id, v]) => [id, { label: v.displayName, driver: v.driver }]));
    const own = s.usageModelAliases ?? {};
    requireThat(own && typeof own === 'object' && !Array.isArray(own) && Object.entries(own).every(([a,b]) => safeId(a) && safeId(b)), 'T3 settings: invalid usage model aliases');
    aliases = { ...aliases, ...own };
  } else warning('T3 settings are missing; default instance labels will be used');
  const cache = await readCache(home, noProjects, warning);
  const oc = readOpenCode(home, noProjects, warning, note);
  const ag = readAntigravity(home, Object.keys(instances).filter(id => instances[id].driver === 'antigravity' && safeId(id)), warning, note);
  const t3 = readT3(home, noProjects, oc.events, warning, note, ag.covered);
  const events = [...cache.events, ...oc.events, ...ag.events, ...t3.events];
  requireThat(events.length > 0, 'No verified usage records found');
  // Sensitive basenames are omitted; infrequent names share one anonymous group.
  const projectDays = new Map(), homeName = path.basename(home).toLowerCase();
  for (const e of events) {
    const name = e.project?.toLowerCase();
    if (noProjects || !safeProject(e.project) || name.includes(homeName) || projectDenylist.some(x => name.includes(x.toLowerCase()))) e.project = null;
    if (e.project !== null) {
      if (!projectDays.has(e.project)) projectDays.set(e.project, new Set());
      projectDays.get(e.project).add(localBucket(e.ts, tz).day);
    }
  }
  for (const e of events) if (e.project !== null && projectDays.get(e.project).size === 1) e.project = '(other)';
  const { rates, aa } = loadPrices(home, aaFile, warning);
  const modelIds = [...new Set(events.map(e => e.model))].sort();
  const instanceIds = [...new Set(events.map(e => e.instance))].sort();
  const projects = [...new Set(events.map(e => e.project).filter(Boolean))].sort();
  const models = modelIds.map(id => resolvePrice(id, aliases, rates, aa, events.filter(e => e.model === id).every(e => e.providerCost !== null)));
  const instanceInfo = instanceIds.map(id => {
    const units = new Set(events.filter(e => e.instance === id).map(e => e.requestUnit ?? 'calls'));
    requireThat(units.size === 1, 'Usage instance: mixed request units');
    return { id, label: instances[id]?.label ?? LABELS[id] ?? id, driver: instances[id]?.driver ?? events.find(e => e.instance === id).driver, billing: BILLING[id] ?? 'unknown', requestUnit: [...units][0] };
  });
  const mi = new Map(modelIds.map((id,i) => [id,i])), ii = new Map(instanceIds.map((id,i) => [id,i])), pi = new Map(projects.map((id,i) => [id,i]));
  const days = new Map(), hours = new Map(), sessionDays = new Map(), sessions = new Set(), sources = new Map();
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', hourCycle: 'h23' });
  for (const e of events) {
    const parts = Object.fromEntries(formatter.formatToParts(e.ts).map(x => [x.type, x.value]));
    const day = `${parts.year}-${parts.month}-${parts.day}`, weekday = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(parts.weekday), hour = Number(parts.hour);
    const m = mi.get(e.model), i = ii.get(e.instance), p = e.project === null ? -1 : pi.get(e.project), cost = eventCost(e, models[m].price);
    if (cost === null) note('unpriced_model', e.source, 1, m);
    if (!days.has(day)) days.set(day, new Map());
    const key = `${m}:${i}:${p}`, group = days.get(day);
    if (!group.has(key)) group.set(key, [m,i,p,0,0,0,0,0,0,0]);
    const row = group.get(key); row[3] += e.requests; for (let n = 0; n < 5; n++) row[4+n] += e.t[n]; row[9] = row[9] === null || cost === null ? null : row[9] + cost;
    const hk = `${weekday}:${hour}`; if (!hours.has(hk)) hours.set(hk, [weekday,hour,0,0]); const hr = hours.get(hk); hr[2] += e.requests; hr[3] = hr[3] === null || cost === null ? null : hr[3] + cost;
    sessions.add(e.session); if (!sessionDays.has(day)) sessionDays.set(day, new Set()); sessionDays.get(day).add(e.session);
    if (!sources.has(e.source)) sources.set(e.source, { id: e.source, label: ({ 't3-usage-cache': 'T3 Code usage scan (Claude, Codex, Grok logs)', 'opencode-db': 'OpenCode message database (migration copies deduplicated)', 'antigravity-db': 'Antigravity conversation databases (usage metadata only; each call counted once)', 't3-turns': 'T3 Code per-turn usage (instances absent from usage scan)' })[e.source], rows: 0, first: day, last: day });
    const source = sources.get(e.source); source.rows++; if (day < source.first) source.first = day; if (day > source.last) source.last = day;
  }
  const dayList = [...days].sort(([a],[b]) => a.localeCompare(b)).map(([d,r]) => ({ d, r: [...r.values()].sort((a,b) => a[0]-b[0] || a[1]-b[1] || a[2]-b[2]).map(row => [...row.slice(0,9),roundCost(row[9])]) }));
  if (!cache.missingSource) note('cache_snapshot', 't3-usage-cache');
  if (cache.missingRaw) note('missing_raw_logs', 't3-usage-cache', cache.missingRaw);
  if (cache.missingSource) note('missing_source', 't3-usage-cache');
  note('current_standard_prices', 'pricing');
  note('service_tier_premiums_omitted', 'pricing');
  const unpriced = new Set([...coverage.values()].filter(x => x.code === 'unpriced_model').map(x => x.modelIdx));
  if (unpriced.size) warning(`Unpriced models: ${unpriced.size}; costs remain unknown`);
  const payload = { coverage: [...coverage.values()].sort((a,b) => `${a.code}:${a.source}:${a.modelIdx}`.localeCompare(`${b.code}:${b.source}:${b.modelIdx}`)), schema: 'aimf-usage/1', generatedAt: now.toISOString(), tz, range: { first: dayList[0].d, last: dayList.at(-1).d }, sources: [...sources.values()].sort((a,b) => a.id.localeCompare(b.id)), instances: instanceInfo, models, projects, days: dayList, hours: [...hours.values()].sort((a,b) => a[0]-b[0] || a[1]-b[1]).map(r => [...r.slice(0,3),roundCost(r[3])]), sessions: { count: sessions.size, byDay: [...sessionDays].sort(([a],[b]) => a.localeCompare(b)).map(([d,s]) => [d,s.size]) } };
  const validated = serializePayload(payload, { home });
  for (const message of warnings) warn(message);
  return { payload: validated, warnings: [...warnings], checks: { cacheSamples: cache.verified, cacheDuplicates: cache.duplicates, syntheticDropped: cache.synthetic, openCodeMigrationDuplicates: oc.duplicates, openCodeZeroUsageDropped: oc.zero, t3OverlapExcluded: t3.excluded, openCodeTurnsReconciled: t3.covered, t3MissingTelemetry: t3.absent, antigravityFiles: ag.files, antigravityCopiesCollapsed: ag.collapsed, antigravityUnreadable: ag.unreadable } };
}

// Copy only contract fields. Never spread a source record or settings object.
export function serializePayload(p, options) {
  const payload = {
    schema: p.schema, generatedAt: p.generatedAt, tz: p.tz,
    range: { first: p.range.first, last: p.range.last },
    sources: p.sources.map(s => ({ id: s.id, label: s.label, rows: s.rows, first: s.first, last: s.last })),
    instances: p.instances.map(i => ({ id: i.id, label: i.label, driver: i.driver, billing: i.billing, ...(i.requestUnit === undefined ? {} : { requestUnit: i.requestUnit }) })),
    models: p.models.map(m => ({ id: m.id, label: m.label, lab: m.lab, aa: m.aa, price: { in: m.price.in, cachedIn: m.price.cachedIn, cacheWrite: m.price.cacheWrite, out: m.price.out, src: m.price.src } })),
    projects: p.projects.map(s => s),
    days: p.days.map(d => ({ d: d.d, r: d.r.map(r => Array.from(r)) })),
    hours: p.hours.map(r => Array.from(r)),
    sessions: { count: p.sessions.count, byDay: p.sessions.byDay.map(r => Array.from(r)) },
    ...(p.coverage === undefined ? {} : { coverage: p.coverage.map(c => ({ code: c.code, source: c.source, modelIdx: c.modelIdx, count: c.count })) }),
  };
  validatePayload(payload, options);
  return payload;
}

// Strict allowlists also serve as a privacy barrier against accidentally adding raw fields.
export function validatePayload(p, { home = os.homedir() } = {}) {
  const keys = (obj, expected, label, optional = []) => requireThat(obj && typeof obj === 'object' && !Array.isArray(obj) && Object.keys(obj).every(k => [...expected, ...optional].includes(k)) && expected.every(k => Object.hasOwn(obj, k)), `${label}: invalid fields`);
  keys(p, ['schema','generatedAt','tz','range','sources','instances','models','projects','days','hours','sessions'], 'Payload', ['coverage']);
  requireThat(p.schema === 'aimf-usage/1' && typeof p.generatedAt === 'string' && !Number.isNaN(Date.parse(p.generatedAt)), 'Payload: invalid version/time');
  try { new Intl.DateTimeFormat('en', { timeZone: p.tz }).format(); } catch { fail('Payload: invalid timezone'); }
  const date = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0,10) === d;
  keys(p.range, ['first','last'], 'Range');
  requireThat(date(p.range.first) && date(p.range.last) && p.range.first <= p.range.last, 'Payload: invalid range');
  for (const field of ['sources','instances','models','projects','days','hours']) requireThat(Array.isArray(p[field]), 'Payload: expected arrays');
  const unique = (xs, label) => requireThat(new Set(xs).size === xs.length, `${label}: duplicate entries`);
  unique(p.sources.map(x => x.id), 'Sources'); unique(p.instances.map(x => x.id), 'Instances'); unique(p.models.map(x => x.id), 'Models'); unique(p.projects, 'Projects');
  for (const s of p.sources) { keys(s,['id','label','rows','first','last'],'Source'); requireThat(safeId(s.id) && safeLabel(s.label) && isCount(s.rows) && date(s.first) && date(s.last) && s.first <= s.last && s.first >= p.range.first && s.last <= p.range.last, 'Source: invalid values'); }
  for (const i of p.instances) { keys(i,['id','label','driver','billing'],'Instance',['requestUnit']); requireThat(i.requestUnit === undefined || ['calls','turns'].includes(i.requestUnit), 'Instance: invalid request unit'); requireThat(safeId(i.id) && safeId(i.driver) && safeLabel(i.label) && ['api','subscription','unknown'].includes(i.billing),'Instance: invalid values'); }
  for (const m of p.models) { keys(m,['id','label','lab','aa','price'],'Model'); keys(m.price,['in','cachedIn','cacheWrite','out','src'],'Price'); requireThat(safeId(m.id) && safeLabel(m.label) && safeId(m.lab) && (m.aa === null || safeId(m.aa)) && ['litellm','aa','provider','none'].includes(m.price.src) && ['in','cachedIn','cacheWrite','out'].every(k => isCost(m.price[k])), 'Model: invalid values'); }
  requireThat(p.projects.every(safeProject), 'Projects: expected folder basenames only');
  let prior = '', requests = 0;
  const costByDay = [], daily = new Map();
  for (const d of p.days) {
    keys(d,['d','r'],'Day'); requireThat(date(d.d) && d.d > prior && Array.isArray(d.r) && d.r.length > 0,'Day: invalid order/rows'); prior = d.d;
    const seen = new Set(); let dc = 0;
    for (const r of d.r) {
      requireThat(Array.isArray(r) && r.length === 10 && isCount(r[0]) && r[0] < p.models.length && isCount(r[1]) && r[1] < p.instances.length && Number.isInteger(r[2]) && r[2] >= -1 && r[2] < p.projects.length && r.slice(3,9).every(isCount) && r[3] > 0 && r[8] <= r[7] && isCost(r[9]), 'Day: invalid usage row');
      const k = r.slice(0,3).join(':'); requireThat(!seen.has(k),'Day: duplicate group'); seen.add(k); requests += r[3]; dc = dc === null || r[9] === null ? null : dc+r[9];
    }
    daily.set(d.d,d); costByDay.push(dc);
  }
  requireThat(p.days.length && p.days[0].d === p.range.first && p.days.at(-1).d === p.range.last,'Payload: range does not match days');
  const cells = new Set(); let hourRequests = 0, hourCost = 0;
  for (const r of p.hours) { requireThat(Array.isArray(r) && r.length === 4 && isCount(r[0]) && r[0] < 7 && isCount(r[1]) && r[1] < 24 && isCount(r[2]) && r[2] > 0 && isCost(r[3]),'Hours: invalid cell'); const k=r.slice(0,2).join(':'); requireThat(!cells.has(k),'Hours: duplicate cell'); cells.add(k); hourRequests += r[2]; hourCost = hourCost === null || r[3] === null ? null : hourCost+r[3]; }
  requireThat(hourRequests === requests,'Payload: day/hour requests differ');
  const dayCost = costByDay.reduce((a,b) => a === null || b === null ? null : a+b,0);
  requireThat((dayCost === null && hourCost === null) || (dayCost !== null && hourCost !== null && Math.abs(dayCost-hourCost)<1e-5),'Payload: day/hour costs differ');
  keys(p.sessions,['count','byDay'],'Sessions'); requireThat(isCount(p.sessions.count) && p.sessions.count > 0 && Array.isArray(p.sessions.byDay) && p.sessions.byDay.length === p.days.length,'Sessions: invalid counts');
  prior=''; let totalSessions=0, maxSessions=0;
  for (const r of p.sessions.byDay) { requireThat(Array.isArray(r) && r.length===2 && daily.has(r[0]) && r[0]>prior && isCount(r[1]) && r[1]>0 && r[1]<=p.sessions.count,'Sessions: invalid day'); prior=r[0]; totalSessions+=r[1]; maxSessions=Math.max(maxSessions,r[1]); }
  requireThat(p.sessions.count <= totalSessions && p.sessions.count >= maxSessions,'Sessions: inconsistent distinct counts');
  if (p.coverage !== undefined) {
    requireThat(Array.isArray(p.coverage), 'Coverage: expected array');
    const codes = ['cache_snapshot','missing_source','missing_raw_logs','incomplete_usage','partial_history','unreadable_history','missing_counters','antigravity_without_counters','unattributed_model','unreported_subagents','unpriced_model','current_standard_prices','service_tier_premiums_omitted'];
    const sources = ['t3-usage-cache','opencode-db','antigravity-db','t3-turns','pricing'], usage = sources.slice(0,4);
    const rules = {
      cache_snapshot: [['t3-usage-cache'], true], missing_source: [usage, true],
      missing_raw_logs: [['t3-usage-cache']], incomplete_usage: [['opencode-db','t3-turns']],
      partial_history: [['opencode-db']], unreadable_history: [['antigravity-db']], missing_counters: [['t3-turns']],
      antigravity_without_counters: [['t3-turns']], unattributed_model: [['t3-turns']],
      unreported_subagents: [['t3-turns']], unpriced_model: [usage, false, true],
      current_standard_prices: [['pricing'], true], service_tier_premiums_omitted: [['pricing'], true],
    };
    const seen = new Set();
    for (const c of p.coverage) {
      keys(c, ['code','source','modelIdx','count'], 'Coverage');
      requireThat(codes.includes(c.code) && sources.includes(c.source) && isCount(c.count) && c.count > 0 && (c.modelIdx === null || (isCount(c.modelIdx) && c.modelIdx < p.models.length)), 'Coverage: invalid values');
      const [allowedSources, scope, model] = rules[c.code];
      requireThat(allowedSources.includes(c.source) && (!scope || c.count === 1) && (model ? c.modelIdx !== null : c.modelIdx === null), 'Coverage: invalid code semantics');
      if (model) requireThat(p.sources.some(s => s.id === c.source) && p.days.some(d => d.r.some(r => r[0] === c.modelIdx && r[9] === null)), 'Coverage: unpriced model has no unknown-cost usage');
      const key = `${c.code}:${c.source}:${c.modelIdx}`;
      requireThat(!seen.has(key), 'Coverage: duplicate note'); seen.add(key);
    }
  }
  const homeName = path.basename(home).toLowerCase();
  const checkStrings = (x, field = '') => {
    if (typeof x === 'string') {
      requireThat(!x.includes('/Users/') && !x.toLowerCase().includes(homeName), 'Payload: private path/home name detected');
      // The contract itself uses slashes in schema, IANA zones and provider/model IDs.
      const protocol = field === 'schema' || field === 'tz' || (/^models\.\d+\.id$/.test(field) && /^[a-z0-9._-]+\/[a-zA-Z0-9][a-zA-Z0-9._:@+-]*$/.test(x));
      requireThat(!/[\\/]/.test(x) || protocol, 'Payload: path separator detected');
    } else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) checkStrings(v, field ? `${field}.${k}` : k);
  };
  checkStrings(p);
  return true;
}

export function encryptPayload(payload, key) {
  validatePayload(payload); requireThat(Buffer.isBuffer(key) && key.length === 32,'Encryption: expected a 32-byte key');
  const json=Buffer.from(JSON.stringify(payload));
  requireThat(json.length<=MAX_JSON_BYTES,'Encryption: payload exceeds 8 MiB');
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(AAD);
  const ct = Buffer.concat([cipher.update(gzipSync(json)),cipher.final(),cipher.getAuthTag()]);
  return { schema:'aimf-usage-enc/1',alg:'A256GCM',zip:'gzip',iv:iv.toString('base64url'),ct:ct.toString('base64url') };
}
export function decryptEnvelope(e, key) {
  requireThat(e && Object.keys(e).sort().join('|') === 'alg|ct|iv|schema|zip' && e.schema === 'aimf-usage-enc/1' && e.alg === 'A256GCM' && e.zip === 'gzip' && typeof e.iv === 'string' && typeof e.ct === 'string','Envelope: invalid format');
  requireThat(Buffer.isBuffer(key) && key.length === 32 && /^[\w-]+$/.test(e.iv) && /^[\w-]+$/.test(e.ct),'Envelope: invalid encoding/key');
  const iv=Buffer.from(e.iv,'base64url'),ct=Buffer.from(e.ct,'base64url'); requireThat(iv.length === 12 && ct.length > 16,'Envelope: invalid IV/ciphertext');
  try { const d=createDecipheriv('aes-256-gcm',key,iv); d.setAAD(AAD); d.setAuthTag(ct.subarray(-16)); const p=JSON.parse(gunzipSync(Buffer.concat([d.update(ct.subarray(0,-16)),d.final()]),{maxOutputLength:MAX_JSON_BYTES})); validatePayload(p); return p; } catch { fail('Envelope: decryption or validation failed'); }
}

const repo = fs.realpathSync(path.join(here, '..'));
const usageDir = fs.realpathSync(here);
const within = (file, dir) => file === dir || file.startsWith(dir + path.sep);
function lstat(file) { try { return fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }

// Resolve the nearest existing ancestor, including platform aliases such as /tmp.
export function canonicalDestination(file) {
  file = path.resolve(file);
  const leaf = lstat(file);
  requireThat(!leaf || (leaf.isFile() && !leaf.isSymbolicLink()), 'Private destination: expected a regular file');
  let ancestor = path.dirname(file), missing = [path.basename(file)];
  while (!lstat(ancestor)) { missing.unshift(path.basename(ancestor)); ancestor = path.dirname(ancestor); }
  requireThat(fs.statSync(ancestor).isDirectory(), 'Private destination: expected a directory');
  return path.join(fs.realpathSync(ancestor), ...missing);
}
function guardDestination(file, { config = false } = {}) {
  const canonical = canonicalDestination(file);
  requireThat(!within(canonical, repo) || (!config && path.dirname(canonical) === usageDir && canonical.endsWith('.local.json')), config ? 'Usage config must resolve outside the repository' : 'In-repo plaintext outputs must be in ignored usage/*.local.json');
  return canonical;
}
function configDestination(home) {
  // Do not follow owner-controlled symlinks below the canonical home directory.
  let dir = fs.realpathSync(home);
  for (const part of ['.config', 'ai-model-frontier']) {
    dir = path.join(dir, part);
    const stat = lstat(dir);
    requireThat(!stat || (stat.isDirectory() && !stat.isSymbolicLink()), 'Usage config: ancestor symlinks are refused');
  }
  const file = guardDestination(path.join(dir, 'usage.json'), { config: true });
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = fs.statSync(dir);
  requireThat(stat.isDirectory() && stat.uid === process.getuid(), 'Usage config: directory must be owned by this user');
  fs.chmodSync(dir, 0o700);
  return file;
}
export function writePrivate(file, value) {
  file = guardDestination(file);
  const parent = path.dirname(file);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const tmp = path.join(parent, `.aimf-${randomBytes(8).toString('hex')}.tmp`);
  let fd;
  try {
    fd = fs.openSync(tmp, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
    fs.writeFileSync(fd, value); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(tmp, file); // The temporary inode already has mode 0600.
    const parentFD = fs.openSync(parent, fs.constants.O_RDONLY);
    try { fs.fsyncSync(parentFD); } finally { fs.closeSync(parentFD); }
  } finally { if (fd !== undefined) fs.closeSync(fd); if (lstat(tmp)) fs.unlinkSync(tmp); }
}
function loadConfigFile(file) {
  file = guardDestination(file, { config: true });
  let save = !lstat(file);
  let config = { key: randomBytes(32).toString('base64url'), gistId: null, projectDenylist: [...DEFAULT_PROJECT_DENYLIST] };
  if (!save) {
    config = readJSON(file, 'Usage config');
    requireThat(config && typeof config === 'object' && !Array.isArray(config) && Object.keys(config).every(k => ['key','gistId','gistOwner','projectDenylist','pendingDeleteGistId','publication'].includes(k)) && typeof config.key === 'string' && /^[\w-]{43}$/.test(config.key) && Buffer.from(config.key,'base64url').length === 32 && (config.gistId === null || gistId(config.gistId)) && (config.gistOwner === undefined || ownerLogin(config.gistOwner)) && (config.pendingDeleteGistId === undefined || (gistId(config.pendingDeleteGistId) && config.pendingDeleteGistId.toLowerCase() !== config.gistId?.toLowerCase())), 'Usage config: invalid key/gist format');
    if (config.publication !== undefined) {
      const p = config.publication;
      requireThat(p && Object.keys(p).sort().join('|') === 'content|gistId|key|owner|state' && ['creating','verifying','promoted','cleanup-pending'].includes(p.state) && ownerLogin(p.owner) && typeof p.key === 'string' && /^[\w-]{43}$/.test(p.key) && typeof p.content === 'string' && (p.gistId === null || gistId(p.gistId)), 'Usage config: invalid publication journal');
      requireThat(p.state === 'creating' ? p.gistId === null && config.pendingDeleteGistId === undefined : p.state === 'promoted' ? p.gistId === config.gistId && p.key === config.key && p.owner === config.gistOwner : gistId(p.gistId) && p.gistId === config.pendingDeleteGistId, 'Usage config: inconsistent publication state');
    }
    if (config.projectDenylist === undefined) { config.projectDenylist = [...DEFAULT_PROJECT_DENYLIST]; save = true; }
    requireThat(Array.isArray(config.projectDenylist) && config.projectDenylist.every(s => typeof s === 'string' && s.length > 0 && s.length <= 200), 'Usage config: invalid project denylist');
  }
  if (save) writePrivate(file, JSON.stringify(config) + '\n'); else fs.chmodSync(file, 0o600);
  return { config, file };
}
// Low-level helper. Lifecycle commands call this only after taking the lock.
export function loadConfig(home = os.homedir()) { return loadConfigFile(configDestination(home)); }

function ownerAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    fail('Usage lock: cannot determine owner liveness');
  }
}
function lockOwner(file) {
  const stat = lstat(file);
  if (!stat) return null;
  requireThat(stat.isFile() && !stat.isSymbolicLink() && stat.uid === process.getuid(), 'Usage lock: unsafe owner file');
  let owner;
  try { owner = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; fail('Usage lock: invalid owner record'); }
  requireThat(Number.isSafeInteger(owner.pid) && owner.pid > 0 && /^[a-f0-9]{32}$/.test(owner.nonce) && Number.isSafeInteger(owner.createdAt) && owner.createdAt > 0, 'Usage lock: invalid owner record');
  return owner;
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function withConfigLock(file, fn, { timeoutMs = 120000 } = {}) {
  file = guardDestination(file, { config: true });
  const lockPath = file + '.lock', deadline = Date.now() + timeoutMs;
  const owner = { pid: process.pid, nonce: randomBytes(16).toString('hex'), createdAt: Date.now() };
  const temp = path.join(path.dirname(file), `.aimf-lock-${owner.nonce}.tmp`);
  let fd, lock;
  try {
    fd = fs.openSync(temp, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
    fs.writeFileSync(fd, JSON.stringify(owner)); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    while (!lock) {
      try {
        // A contender can see either no lock or the complete immutable record.
        fs.linkSync(temp, lockPath);
        lock = { file, active: true, nonce: owner.nonce };
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const stale = lockOwner(lockPath);
        if (stale && !ownerAlive(stale.pid)) {
          // rename alone is not compare-and-swap: a late reaper could move a new
          // generation. Elect exactly one reaper for this nonce using O_EXCL link.
          const claim = `${lockPath}.${stale.nonce}.reaping`;
          let elected = false;
          try { fs.linkSync(temp, claim); elected = true; }
          catch (e) { if (e.code !== 'EEXIST') throw e; }
          if (elected) {
            try {
              const current = lockOwner(lockPath);
              if (current?.nonce === stale.nonce && !ownerAlive(current.pid)) {
                const tombstone = `${lockPath}.${owner.nonce}.removed`;
                fs.renameSync(lockPath, tombstone);
                fs.unlinkSync(tombstone);
              }
            } finally { fs.unlinkSync(claim); }
          } else {
            const reaper = lockOwner(claim);
            requireThat(!reaper || ownerAlive(reaper.pid), 'Usage lock: stale recovery was interrupted; inspect the lock and recovery claim locally before retrying');
          }
        }
      }
      if (lock) break;
      requireThat(Date.now() < deadline, 'Usage lock: another collector is running; retry later');
      await pause(25);
    }
    try { return await fn(lock); }
    finally {
      lock.active = false;
      if (lockOwner(lockPath)?.nonce === owner.nonce) fs.unlinkSync(lockPath);
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (lstat(temp)) fs.unlinkSync(temp);
  }
}
function requireLock(lock, file) { requireThat(lock?.active === true && lock.file === guardDestination(file, { config: true }), 'Usage publication requires its config lock'); }
export function prepareLog(home=os.homedir()) {
  const file=path.join(home,'Library/Logs/aimf-usage.log');
  guardDestination(file, { config: true });
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const fd=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_APPEND|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
  try { requireThat(fs.fstatSync(fd).isFile(),'Usage log: expected a regular file'); fs.fchmodSync(fd,0o600); } finally { fs.closeSync(fd); }
  return file;
}
export function payloadHash(payload) { const {generatedAt,...stable}=payload; return createHash('sha256').update(JSON.stringify(stable)).digest('hex'); }
export function ghCall(args,input,runner=spawnSync,ghPath=process.env.AIMF_USAGE_GH ?? 'gh') {
  const r=runner(ghPath,args,{input:input===undefined?undefined:JSON.stringify(input),encoding:'utf8',maxBuffer:64*1024*1024,timeout:60000});
  // CLI errors may contain IDs or auth details: never echo stdout/stderr.
  requireThat(!r.error && r.status===0,'GitHub operation failed; check gh authentication locally');
  try { return JSON.parse(r.stdout); } catch { fail('GitHub returned an invalid response'); }
}
function ghHttpResponse(args, runner=spawnSync, ghPath=process.env.AIMF_USAGE_GH ?? 'gh') {
  const r = runner(ghPath, ['api','--include', ...args], { encoding:'utf8', maxBuffer:1024*1024, timeout:60000 });
  // Only the first header block is authoritative; the body and stderr are opaque.
  const output = typeof r.stdout === 'string' ? r.stdout : '';
  const end = /\r?\n\r?\n/.exec(output);
  const headers = end ? output.slice(0, end.index).split(/\r?\n/) : [];
  const match = /^HTTP\/\d+(?:\.\d+)? (\d{3})(?: [^\r\n]*)?$/.exec(headers[0] ?? '');
  const valid = match && headers.slice(1).every(h => /^[!#$%&'*+.^_`|~0-9A-Za-z-]+:[^\r\n]*$/.test(h));
  const status = !r.error && valid ? Number(match[1]) : null;
  const fields = new Map();
  if (status !== null) for (const h of headers.slice(1)) {
    const colon = h.indexOf(':'), name = h.slice(0, colon).toLowerCase();
    fields.set(name, [fields.get(name), h.slice(colon+1).trim()].filter(Boolean).join(','));
  }
  return { status, ok: !r.error && r.status === 0 && status !== null && status >= 200 && status < 300, fields };
}
export function ghHttpOutcome(args, runner=spawnSync, ghPath) {
  const { status, ok } = ghHttpResponse(args, runner, ghPath);
  return { status, ok };
}
function replaceConfig(config, next) {
  Object.keys(config).forEach(k => delete config[k]); Object.assign(config, next);
}
function storeConfig(config, file, next) {
  try { writePrivate(file, JSON.stringify(next) + '\n'); }
  finally {
    // rename may already have committed even if directory fsync throws. Disk is
    // authoritative; never roll back from an older in-memory snapshot.
    replaceConfig(config, loadConfigFile(file).config);
  }
}
function authenticatedOwner(runner, ghPath) {
  const user = ghCall(['api','user'], undefined, runner, ghPath);
  requireThat(ownerLogin(user.login), 'GitHub returned an invalid authenticated user');
  return user.login;
}
function deleteObligation(config, configFile, { runner, ghPath }) {
  const id = config.pendingDeleteGistId;
  if (!id) return;
  requireThat(id !== config.gistId, 'Pending deletion conflicts with the active gist');
  const outcome = ghHttpOutcome(['--method','DELETE',`gists/${id}`], runner, ghPath);
  let absent = false;
  if (outcome.status === 404) {
    try {
      // Authentication alone does not establish absence or authority. Require
      // the recorded account AND an independent GET of this exact obligation.
      const owner = authenticatedOwner(runner, ghPath);
      let expectedOwner = config.gistOwner;
      if (!expectedOwner && config.gistId) {
        // Older configs did not retain an owner. The still-active gist provides
        // a positive account binding without collecting telemetry or publishing.
        const active = ghCall(['api',`gists/${config.gistId}`], undefined, runner, ghPath);
        if (active.id === config.gistId && ownerLogin(active.owner?.login)) expectedOwner = active.owner.login;
      }
      if (expectedOwner && owner.toLowerCase() === expectedOwner.toLowerCase()) {
        const target = ghHttpResponse([`gists/${id}`], runner, ghPath);
        // A permission-hidden secret gist also yields 404. Only an explicit gist
        // grant establishes read authority. Missing scope evidence fails closed.
        const scopes = (target.fields.get('x-oauth-scopes') ?? '').split(',').map(x => x.trim());
        absent = target.status === 404 && scopes.includes('gist');
      }
    } catch { /* Unknown account/transport outcome retains the obligation. */ }
  }
  requireThat((outcome.ok && outcome.status === 204) || absent, 'Pending usage gist deletion failed; retry --publish or --recover to revoke the link');
  const fresh = loadConfigFile(configFile).config;
  requireThat(fresh.pendingDeleteGistId === id && fresh.gistId !== id, 'Pending usage gist obligation changed; retry recovery');
  const next = { ...fresh }; delete next.pendingDeleteGistId; delete next.publication;
  if (!next.gistId) delete next.gistOwner;
  storeConfig(config, configFile, next);
}
function findUnconfirmedCreation(publication, call) {
  // A durable intent contains the unique ciphertext before POST. If its reply
  // or ID journal is lost, locate only an exact match in this account's history.
  const pages = call(['api','gists','--paginate','--slurp']);
  requireThat(Array.isArray(pages) && pages.every(page => Array.isArray(page) && page.every(g => gistId(g.id))), 'GitHub returned an invalid gist history');
  const matches = new Set();
  for (const listed of pages.flat()) {
    if (!listed.files?.['aimf-usage.json']) continue;
    const g = call(['api',`gists/${listed.id}`]);
    requireThat(g.id === listed.id && ownerLogin(g.owner?.login) && g.owner.login.toLowerCase() === publication.owner.toLowerCase(), 'Creation recovery cannot verify gist ownership');
    const file = g.files?.['aimf-usage.json'];
    requireThat(file && !file.truncated && typeof file.content === 'string', 'Creation recovery cannot verify gist content');
    if (file.content === publication.content) matches.add(g.id);
  }
  requireThat(matches.size === 1, 'Unconfirmed usage gist creation; recovery could not identify exactly one ciphertext match; creation remains blocked');
  return [...matches][0];
}
export function finishPendingDeletion(config, configFile, { runner=spawnSync, ghPath, lock } = {}) {
  requireLock(lock, configFile);
  replaceConfig(config, loadConfigFile(configFile).config);
  const p = config.publication;
  if (p && ['creating','verifying'].includes(p.state)) {
    const call = (args, input) => ghCall(args, input, runner, ghPath);
    let id = p.gistId;
    if (p.state === 'creating') {
      requireThat(authenticatedOwner(runner, ghPath).toLowerCase() === p.owner.toLowerCase(), 'Creation recovery requires the original authenticated account');
      id = findUnconfirmedCreation(p, call);
    }
    storeConfig(config, configFile, { ...config, gistOwner: p.owner, pendingDeleteGistId: id, publication: { ...p, state: 'cleanup-pending', gistId: id } });
  }
  if (config.pendingDeleteGistId) {
    // A previous rename may have succeeded without its directory fsync. Commit
    // the observed state durably before deleting either identity it depends on.
    storeConfig(config, configFile, { ...config });
    deleteObligation(config, configFile, { runner, ghPath });
  }
  else if (config.publication?.state === 'promoted') {
    const next = { ...config }; delete next.publication; storeConfig(config, configFile, next);
  }
}

// Direct callers receive the same serialization and fresh-config guarantees as CLI.
export async function publishPayload(payload, config, configFile, options = {}) {
  if (options.lock) return publishLocked(payload, config, configFile, options);
  return withConfigLock(configFile, lock => {
    replaceConfig(config, loadConfigFile(configFile).config);
    return publishLocked(payload, config, configFile, { ...options, lock });
  });
}
function publishLocked(payload, config, configFile, { runner=spawnSync, rotate=false, ghPath, lock } = {}) {
  requireLock(lock, configFile);
  validatePayload(payload);
  const call=(args,input) => ghCall(args,input,runner,ghPath);
  const cleanup = () => finishPendingDeletion(config, configFile, { runner, ghPath, lock });
  cleanup();
  const oldId=config.gistId, key=rotate?randomBytes(32):Buffer.from(config.key,'base64url');
  if(oldId && !rotate) {
    const old=call(['api',`gists/${oldId}`]);
    requireThat(old.public===false,'Publish refused: usage gist must be secret');
    const file=old.files?.['aimf-usage.json']; requireThat(file && !file.truncated && typeof file.content==='string','Publish refused: existing envelope is missing or truncated');
    let oldPayload;
    try { oldPayload=decryptEnvelope(JSON.parse(file.content),key); }
    catch { fail('Publish refused: existing envelope cannot be authenticated; use --rotate to replace its gist'); }
    if(payloadHash(oldPayload)===payloadHash(payload)) return {uploaded:false};
  }
  const content=JSON.stringify(encryptPayload(payload,key)), body={files:{'aimf-usage.json':{content}}};
  if (oldId && !rotate) {
    const response=call(['api','--method','PATCH',`gists/${oldId}`,'--input','-'],body);
    requireThat(response.public===false && response.id===oldId,'GitHub returned an invalid secret gist');
    return {uploaded:true};
  }
  const owner=authenticatedOwner(runner,ghPath);
  requireThat(!config.gistOwner || owner.toLowerCase()===config.gistOwner.toLowerCase(), 'Publication requires the original authenticated account');
  if (oldId && !config.gistOwner) {
    const old = call(['api',`gists/${oldId}`]);
    requireThat(old.id === oldId && ownerLogin(old.owner?.login) && old.owner.login.toLowerCase() === owner.toLowerCase(), 'Publication requires the original gist owner');
  }
  const intent={state:'creating',gistId:null,key:key.toString('base64url'),content,owner};
  // Write-ahead intent must be durable before any POST. A failed preflight is
  // cancellable in this process, since no creation has been attempted yet.
  try { storeConfig(config,configFile,{...config,publication:intent}); }
  catch (error) {
    if (config.publication?.content === content) {
      const next={...config}; delete next.publication;
      try { storeConfig(config,configFile,next); } catch { /* Durable intent still blocks POST. */ }
    }
    throw error;
  }
  body.public=false;body.description='note';
  // On an ambiguous POST failure retain creating; never replay creation blindly.
  const response=call(['api','--method','POST','gists','--input','-'],body);
  requireThat(gistId(response.id) && response.id.toLowerCase()!==oldId?.toLowerCase(),'GitHub returned an invalid new gist; creation remains journaled');
  const verifying={...intent,state:'verifying',gistId:response.id};
  try {
    storeConfig(config,configFile,{...config,gistOwner:owner,pendingDeleteGistId:response.id,publication:verifying});
    requireThat(response.public===false,'Publish refused: created usage gist must be secret');
    requireThat(ownerLogin(response.owner?.login) && response.owner.login.toLowerCase()===owner.toLowerCase(),'GitHub returned an invalid gist owner');
    // Signed in as the owner, this list also holds their secret gists (public: false), so only a public entry refuses.
    const pages=call(['api',`users/${owner}/gists`,'--paginate','--slurp']);
    requireThat(Array.isArray(pages) && pages.every(page => Array.isArray(page) && page.every(g => gistId(g.id) && typeof g.public === 'boolean')), 'GitHub returned an invalid gist list');
    requireThat(!pages.flat().some(g => g.id.toLowerCase()===response.id.toLowerCase() && g.public),'Publish refused: created gist appears in the public list');
    const next={key:intent.key,gistId:response.id,gistOwner:owner,projectDenylist:[...config.projectDenylist],publication:{...verifying,state:'promoted'}};
    if(oldId) next.pendingDeleteGistId=oldId;
    storeConfig(config,configFile,next);
  } catch (error) {
    // A post-rename promotion error must never delete the active new gist.
    replaceConfig(config,loadConfigFile(configFile).config);
    if(config.publication?.state!=='promoted') {
      const next={...config,gistOwner:owner,pendingDeleteGistId:response.id,publication:{...verifying,state:'cleanup-pending'}};
      try { storeConfig(config,configFile,next); }
      catch {
        // Even if all ID writes fail, the write-ahead ciphertext can recover it.
        // Best-effort deletion is safe only while disk still names the old active.
        if(config.gistId!==response.id) {
          const outcome=ghHttpOutcome(['--method','DELETE',`gists/${response.id}`],runner,ghPath);
          if(outcome.ok && outcome.status===204) {
            const restored={...config};delete restored.publication;delete restored.pendingDeleteGistId;
            if (!restored.gistId) delete restored.gistOwner;
            try { storeConfig(config,configFile,restored); } catch { /* Intent remains fail closed. */ }
          }
        }
        throw error;
      }
      cleanup();
    }
    throw error;
  }
  cleanup();
  return {uploaded:true};
}

export function summary(payload) {
  const lines=[`${payload.range.first} → ${payload.range.last} (${payload.tz})`];
  const describe=(label,rs)=>{const totals=rs.reduce((a,r)=>{a[payload.instances[r[1]].requestUnit === 'turns' ? 'turns' : 'calls']+=r[3];a.tokens+=r[4]+r[5]+r[6]+r[7];if(r[9]===null)a.unknown=true;else a.cost+=r[9];return a;},{calls:0,turns:0,tokens:0,cost:0,unknown:false});return `${label}: ${[totals.calls ? `${totals.calls.toLocaleString('en-US')} API calls` : '', totals.turns ? `${totals.turns.toLocaleString('en-US')} turns` : ''].filter(Boolean).join(' + ')}; ${totals.tokens.toLocaleString('en-US')} tokens; ${totals.unknown?'known subtotal ':''}$${totals.cost.toFixed(2)}${totals.unknown?' (some costs unknown)':''}`;};
  const rows=payload.days.flatMap(d=>d.r);
  for(let i=0;i<payload.models.length;i++)lines.push(describe(payload.models[i].id,rows.filter(r=>r[0]===i)));
  for(let i=0;i<payload.instances.length;i++)lines.push(describe(payload.instances[i].label,rows.filter(r=>r[1]===i)));
  for(const s of payload.sources)lines.push(`${s.label}: ${s.rows.toLocaleString('en-US')} unique usage records`);
  const unknown=payload.models.filter((m,i)=>rows.some(r=>r[0]===i&&r[9]===null)).map(m=>m.id);
  lines.push(`Unpriced models: ${unknown.join(', ')||'none'}`,`Distinct sessions: ${payload.sessions.count}`);
  return lines.join('\n');
}
export async function main(args=process.argv.slice(2), { home=os.homedir(), aaFile=path.join(here,'../data/models.js'), runner=spawnSync, ghPath }={}) {
  let out=null,publish=false,link=false,rotate=false,projects=false,quiet=false,recover=false;
  for(let i=0;i<args.length;i++)switch(args[i]){case '--out':requireThat(args[i+1]&&!args[i+1].startsWith('--'),'--out requires a filename');out=path.resolve(args[++i]);break;case '--publish':publish=true;break;case '--link':link=true;break;case '--rotate':rotate=true;publish=true;break;case '--recover':recover=true;break;case '--projects':projects=true;break;case '--no-projects':projects=false;break;case '--quiet':quiet=true;break;case '--help':console.log('Usage: node usage/collect.mjs [--out file.local.json] [--publish | --rotate | --recover | --link] [--projects] [--quiet]\nDefault is local-only with project names off. --recover only retries pending revocation. --rotate publishes to a new gist and deletes the old one. --link deliberately prints a password-equivalent unlock link.');return;default:fail('Unknown command-line option');}
  requireThat(!(publish && link),'Use --link separately from --publish or --rotate; publishing never prints an unlock link');
  requireThat(!recover || (!publish && !link && !out), 'Use --recover separately from other operations');
  if(out) {
    requireThat(out.endsWith('.local.json'),'Plaintext output must use the .local.json suffix');
    out = guardDestination(out);
  }
  prepareLog(home);
  const configFile = configDestination(home);
  return withConfigLock(configFile, async lock => {
    // No config snapshot survives acquisition: read/create only while holding lock.
    const {config,file}=loadConfigFile(configFile);
    if (publish || recover) finishPendingDeletion(config,file,{runner,ghPath,lock});
    if (recover) { if (!quiet) console.log('Pending usage cleanup complete.'); return; }
    if(link){requireThat(config.gistId,'No usage gist configured; publish after review before requesting a link');console.log(`${SITE}#usage=${config.gistId}.${config.key}`);return;}
    const result=await collect({home,aaFile,projects,projectDenylist:config.projectDenylist,warn:message=>console.error(`Warning: ${message}`)});
    if(out)writePrivate(out,JSON.stringify(result.payload)+'\n');
    if(!quiet)console.log(summary(result.payload));
    if(publish){const published=await publishPayload(result.payload,config,file,{runner,rotate,ghPath,lock});if(!quiet)console.log(published.uploaded?'Encrypted usage uploaded.':'Usage unchanged; upload skipped.');}
  });
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error instanceof UsageError ? error.message : 'Usage collection failed: local file/database operation could not complete');process.exitCode=1;});
