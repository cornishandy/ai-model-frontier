// Post-deploy notification only. No deploy step depends on this result.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
export const SPEED_FIELDS = ['outputSpeed', 'ttft', 'e2eMean'];
export function missingSpeedFields(models) {
  return SPEED_FIELDS.filter(k => !models.some(m => !m.deprecated && Number.isFinite(m[k]))).sort();
}
export function missingSetChanged(previous, current) {
  return JSON.stringify([...new Set(previous)].sort()) !== JSON.stringify([...new Set(current)].sort());
}
export async function previousMissingSpeedFields() { return null; }
export async function checkSpeedFields(models, getPrevious = previousMissingSpeedFields) {
  const current = missingSpeedFields(models), previous = await getPrevious();
  if (previous === null) return { current, pending: true, changed: false };
  return { current, pending: false, changed: missingSetChanged(previous, current) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const {default:os} = await import('node:os');
  const {default:path} = await import('node:path');
  const data = JSON.parse(fs.readFileSync(process.env.SPEED_COMPARISON_PATH || path.join(os.tmpdir(),'aimf-speed-comparison.json'), 'utf8'));
  const result = {current:data.current, pending:data.previous === null,
    changed:data.previous !== null && missingSetChanged(data.previous,data.current)};
  if (result.pending) console.log('Previous missing speed set unknown; starting baseline. Missing now:', result.current);
  else if (result.changed) { console.error('Missing speed fields changed:', result.current); process.exitCode = 1; }
  else console.log('Missing speed fields unchanged:', result.current);
}
