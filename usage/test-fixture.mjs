import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Every harness owns and removes only its unique child of the chosen scratch root.
export function makeScratch(prefix = 'aimf-usage-test-') {
  const base = process.env.AIMF_TEST_SCRATCH || os.tmpdir();
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  const dir = fs.mkdtempSync(path.join(base, prefix));
  fs.chmodSync(dir, 0o700);
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

export function browserPayload() {
  return {
    schema: 'aimf-usage/1', generatedAt: '2026-10-07T12:00:00.000Z', tz: 'UTC',
    range: { first: '2026-10-07', last: '2026-10-07' },
    sources: [{ id: 't3-turns', label: 'Synthetic turn fixture', rows: 1, first: '2026-10-07', last: '2026-10-07' }],
    instances: [{ id: 'antigravity', label: 'Antigravity', driver: 'antigravity', billing: 'subscription', requestUnit: 'turns' }],
    models: [{ id: 'unattributed', label: 'Unattributed model', lab: 'other', aa: null, price: { in: null, cachedIn: null, cacheWrite: null, out: null, src: 'none' } }],
    projects: [], days: [{ d: '2026-10-07', r: [[0,0,-1,1,10,90,0,10,7,null]] }],
    hours: [[3,12,1,null]], sessions: { count: 1, byDay: [['2026-10-07',1]] },
    coverage: [{ code: 'unpriced_model', source: 't3-turns', modelIdx: 0, count: 1 }],
  };
}
