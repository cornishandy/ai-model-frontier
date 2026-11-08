// The live site's data file is the only persistent publication history.
import { createHash } from 'node:crypto';
export function fingerprint(data) {
  const clean = (v) => Array.isArray(v) ? v.map(clean) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().filter(k => !['scrapedAt', 'publication'].includes(k)).map(k => [k, clean(v[k])])) : v;
  return createHash('sha256').update(JSON.stringify(clean(data))).digest('hex');
}
export function parseLive(text) {
  const match = text.match(/^\s*window\.AA_DATA\s*=\s*([\s\S]*?);?\s*$/);
  const data = match && JSON.parse(match[1]);
  if (!data?.models?.length || !data.index || !data.scrapedAt) throw Error('Invalid live dataset');
  return data;
}
export async function readLive(url, {fetcher = fetch, attempts = 3, pause = ms => new Promise(r => setTimeout(r, ms))} = {}) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetcher(`${url}?publication=${Date.now()}-${i}`, {signal: AbortSignal.timeout(15000), cache: 'no-store'});
      if (!res.ok) throw Error(`Live read HTTP ${res.status}`);
      return parseLive(await res.text());
    } catch (e) { if (i === attempts - 1) return null; await pause(1000 * (i + 1)); }
  }
}
export function knownState(state) {
  return state?.status === 'known' && typeof state.fingerprint === 'string' &&
    Array.isArray(state.missingSpeedFields) && state.missingSpeedFields.every(k => ['outputSpeed','ttft','e2eMean'].includes(k));
}
export function publicationState(data, previous, missing, now = new Date().toISOString()) {
  const hash = fingerprint(data), old = previous?.publication;
  if (knownState(old) && old.fingerprint === hash) return old;
  return {status:'known', fingerprint:hash, date:data.scrapedAt || now,
    missingSpeedFields:missing, currentBoard:null, priorBoard:knownState(old) ? old.currentBoard : null};
}
export async function readFailurePolicy(event, {fetcher = fetch, repo = process.env.GITHUB_REPOSITORY, token = process.env.GITHUB_TOKEN, now = Date.now()} = {}) {
  if (event === 'push') return 'unknown';
  // Successful Deploy site runs read live data before deploying after this change.
  // Before it, the latest successful main deploy's START is our best available last-good-read time.
  // API failure means within six hours: skip quietly, without inventing another store.
  try {
    if (!repo || !token) return 'skip';
    const res = await fetcher(`https://api.github.com/repos/${repo}/actions/workflows/deploy.yml/runs?branch=main&status=completed&per_page=100`, {
      headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(15000)});
    if (!res.ok) return 'skip';
    for (const run of (await res.json()).workflow_runs || []) {
      // Quiet skips are green too: only a run with an actual successful deploy is a last-good read.
      const jobs = await fetcher(`${run.url}/jobs`, {headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(15000)});
      if (!jobs.ok) return 'skip';
      const deployed = (await jobs.json()).jobs?.some(j => j.steps?.some(s => s.name === 'Run actions/deploy-pages@v4' && s.conclusion === 'success'));
      if (!deployed) continue;
      const start = Date.parse(run.run_started_at);
      return Number.isFinite(start) && now - start >= 6 * 3600000 ? 'fail' : 'skip';
    }
    return 'skip';
  } catch { return 'skip'; }
}
