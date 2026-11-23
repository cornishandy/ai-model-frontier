#!/usr/bin/env node
// Portable read-only verifier (--check) for catalog integrity, 63-key snapshot() coverage,
// 29-theme token contrast, real annular 2x PNG pixel contrast (surface + shaded zone),
// geometry clearances, and 320px SI-28 footers.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PM = require(path.join(ROOT, 'plan-math.js'));

const CHECK_MODE = process.argv.includes('--check');
if (!CHECK_MODE) {
  console.error('Usage: node scripts/gen-facts.mjs --check');
  process.exit(1);
}

const CLOCK = '2026-11-23T05:00:00Z';
const EXPECTED_CAT_SHA_PREFIX = '4af5bdbd';
const TEST_HOOK = `
  subClockOverride = ${JSON.stringify(CLOCK)};
  window.__AIMF_TEST = {
    svgString: (opts) => svgString(opts),
    setSelection: (ids) => { S.selected = new Set(ids.filter((id) => BY_ID.has(id))); save(); renderList(); render(); },
    setProfile: (next) => { subProfile = PM.sanitizeProfile(next, PLAN_CAT, PM.PUBLIC_DEFAULT_ESTIMATES); saveSubProfile(); render(); },
  };
`;

function resolvePlaywright() {
  const candidates = [];
  if (process.env.PLAYWRIGHT_PATH) candidates.push(process.env.PLAYWRIGHT_PATH);
  candidates.push('playwright');
  const home = os.homedir();
  candidates.push(path.join(home, 'Library/Caches/aaii-ladder/pw/node_modules/playwright'));
  const npxRoot = path.join(home, '.npm/_npx');
  if (fs.existsSync(npxRoot)) {
    for (const dir of fs.readdirSync(npxRoot)) {
      candidates.push(path.join(npxRoot, dir, 'node_modules/playwright'));
    }
  }
  for (const cand of candidates) {
    try { return require(cand); } catch {}
  }
  throw new Error('Playwright not found; set PLAYWRIGHT_PATH or install playwright.');
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// Pure-Node PNG RGBA decoder (zero external packages) for real 2x PNG pixel contrast checks
function decodePng(buf) {
  let off = 8, width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`Unsupported PNG format bitDepth=${bitDepth} colorType=${colorType}`);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const px = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)];
    const rs = y * (stride + 1) + 1, ds = y * stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[rs + x];
      const a = x >= bpp ? px[ds + x - bpp] : 0;
      const b = y > 0 ? px[ds - stride + x] : 0;
      const c = (x >= bpp && y > 0) ? px[ds - stride + x - bpp] : 0;
      px[ds + x] = (ft === 0 ? v : ft === 1 ? v + a : ft === 2 ? v + b : ft === 3 ? v + Math.floor((a + b) / 2) : v + paeth(a, b, c)) & 0xff;
    }
  }
  return { width, height, bpp, px };
}

function rgbLum(r, g, b) {
  const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.7152 * 0 + 0.0722 * lin(b);
}
function contrastRgb(a, b) {
  const l1 = rgbLum(a[0], a[1], a[2]), l2 = rgbLum(b[0], b[1], b[2]);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
function compositeOver(fg, bg) {
  const a = fg[3] ?? 1;
  return [
    Math.round(fg[0] * a + bg[0] * (1 - a)),
    Math.round(fg[1] * a + bg[1] * (1 - a)),
    Math.round(fg[2] * a + bg[2] * (1 - a)),
  ];
}
function bestContrastInRect(png, rect, bgRgb, dpr = 2) {
  const x0 = Math.max(0, Math.floor(rect.x * dpr));
  const y0 = Math.max(0, Math.floor(rect.y * dpr));
  const x1 = Math.min(png.width - 1, Math.ceil((rect.x + rect.width) * dpr));
  const y1 = Math.min(png.height - 1, Math.ceil((rect.y + rect.height) * dpr));
  let best = 1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * png.width + x) * png.bpp;
      const cr = contrastRgb([png.px[i], png.px[i + 1], png.px[i + 2]], bgRgb);
      if (cr > best) best = cr;
    }
  }
  return best;
}
// Per-bead rendered pixel contrast: samples a 3x3 device-pixel core at EACH individual <circle> bead center
// in .lane2-bead-ring and requires >= 80% of beads to hit >= minCr independently. Because a connecting line or
// effort hash can intersect at most 2 beads, hiding .lane2-bead-ring (opacity: 0) is guaranteed to FAIL.
function checkBeadRingContrast(png, beads, bgRgb, minCr = 3.0, dpr = 2) {
  assert.ok(Array.isArray(beads) && beads.length >= 10, `Expected >=10 beads, got ${beads?.length}`);
  const crs = beads.map((b) => {
    const cx = Math.round(b.x * dpr), cy = Math.round(b.y * dpr);
    let best = 1;
    for (let y = Math.max(0, cy - 1); y <= Math.min(png.height - 1, cy + 1); y++) {
      for (let x = Math.max(0, cx - 1); x <= Math.min(png.width - 1, cx + 1); x++) {
        const i = (y * png.width + x) * png.bpp;
        const cr = contrastRgb([png.px[i], png.px[i + 1], png.px[i + 2]], bgRgb);
        if (cr > best) best = cr;
      }
    }
    return best;
  });
  const passing = crs.filter((c) => c >= minCr).length;
  const sorted = crs.slice().sort((a, b) => a - b);
  return { passing, total: crs.length, ratio: passing / crs.length, p20: sorted[Math.floor(sorted.length * 0.2)] };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8' };
function startServer(rootDir) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
      const full = path.resolve(rootDir, rel);
      if (!full.startsWith(rootDir) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
        res.writeHead(404); res.end('Not found'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
      fs.createReadStream(full).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, url: `http://127.0.0.1:${srv.address().port}` }));
  });
}

async function injectHook(page) {
  await page.route('https://api.github.com/gists/**', (r) => r.abort());
  await page.route('**/index.html*', async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace('  // ---------- boot ----------', TEST_HOOK + '\n  // ---------- boot ----------');
    await route.fulfill({ response, body });
  });
}

async function main() {
  let passed = 0;

  // 1. Catalog SHA & schema v3 check (strictly read-only)
  const catPath = path.join(ROOT, 'data/plan-allowances.js');
  const catBuf = fs.readFileSync(catPath);
  const catSha = sha256(catBuf);
  assert.equal(catSha.slice(0, 8), EXPECTED_CAT_SHA_PREFIX, `Catalog SHA mismatch: ${catSha.slice(0, 8)}`);
  const sbCat = { window: {} };
  vm.runInNewContext(catBuf.toString('utf8'), sbCat);
  const CAT = sbCat.window.PLAN_ALLOWANCES;
  assert.equal(CAT.schemaVersion, 3);
  assert.equal(CAT.accounting.totalCompiledRows, 58);
  passed++;

  // 2. Live index.html snapshot() 63-key coverage check + zero production test hooks
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const snapMatch = html.match(/function snapshot\(\)\s*\{\s*return\s*\{([\s\S]*?)\};\s*\}/);
  assert.ok(snapMatch, 'Missing snapshot() in index.html');
  const liveKeys = [...snapMatch[1].matchAll(/([a-zA-Z0-9_]+)\s*:/g)].map(x => x[1]);
  const cov = PM.validateSnapshotCoverage(liveKeys);
  assert.deepEqual(cov, { totalTyped: 63, publicCount: 62, localCount: 1 });
  assert.equal(/window\.__AIMF_SUB\b/.test(html), false, 'Production index.html must not expose window.__AIMF_SUB');
  assert.equal(/qp\.get\(['"]now['"]\)/.test(html), false, 'Production index.html must not accept ?now= clock override');
  passed++;

  // 3. Browser token contrast (29 theme states), real annular 2x PNG pixel contrast (surface + shaded zone),
  //    geometry clearances, & 320px SI-28 footers
  const { chromium } = resolvePlaywright();
  const { srv, url } = await startServer(ROOT);
  const browser = await chromium.launch({ headless: true });

  try {
    // 3a. All 29 theme states token & pill/chip contrast
    const pTheme = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
    await injectHook(pTheme);
    await pTheme.goto(`${url}/index.html?noAutoUpdate=1`, { waitUntil: 'networkidle' });
    await pTheme.click('#plansBtn');
    const explicitThemes = await pTheme.evaluate(() => [...document.querySelectorAll('#themeSel option')].map(o => o.value).filter(v => v !== 'system'));
    assert.equal(explicitThemes.length, 27, `Expected 27 explicit host themes, got ${explicitThemes.length}`);

    const themeStates = [
      { label: 'system (light)', theme: 'system', scheme: 'light' },
      { label: 'system (dark)', theme: 'system', scheme: 'dark' },
      ...explicitThemes.map(t => ({ label: t, theme: t, scheme: 'light' })),
    ];
    let minInk = Infinity, minInk2 = Infinity, minActivePill = Infinity, minInactivePill = Infinity, minActiveChip = Infinity;
    for (const st of themeStates) {
      await pTheme.emulateMedia({ colorScheme: st.scheme });
      await pTheme.evaluate((t) => {
        if (t === 'system') document.documentElement.removeAttribute('data-theme');
        else document.documentElement.setAttribute('data-theme', t);
      }, st.theme);
      const res = await pTheme.evaluate(() => {
        const cv = document.createElement('canvas'); cv.width = 1; cv.height = 1;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        const toRgba = (cssVal) => {
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = cssVal;
          ctx.fillRect(0, 0, 1, 1);
          const d = ctx.getImageData(0, 0, 1, 1).data;
          return [d[0], d[1], d[2], d[3] / 255];
        };
        const probe = (expr) => {
          const d = document.createElement('div');
          d.style.color = expr;
          document.body.append(d);
          const c = getComputedStyle(d).color;
          d.remove();
          return toRgba(c);
        };
        const activePill = document.querySelector('#priceSeg button[aria-pressed="true"]');
        const inactivePill = document.querySelector('#priceSeg button[aria-pressed="false"]');
        const activeChip = document.querySelector('#useChips button[aria-pressed="true"]');
        const track = document.querySelector('#priceSeg');
        return {
          surface: probe('var(--surface)'),
          page: probe('var(--page)'),
          ink: probe('var(--ink)'),
          ink2: probe('var(--ink-2)'),
          trackBg: toRgba(getComputedStyle(track).backgroundColor),
          apFg: toRgba(getComputedStyle(activePill).color),
          apBg: toRgba(getComputedStyle(activePill).backgroundColor),
          ipFg: toRgba(getComputedStyle(inactivePill).color),
          acFg: toRgba(getComputedStyle(activeChip).color),
          acBg: toRgba(getComputedStyle(activeChip).backgroundColor),
        };
      });
      const surf = res.surface, page = res.page, ink = res.ink, ink2 = res.ink2;
      const trackRgb = compositeOver(res.trackBg, surf);
      const apBg = compositeOver(res.apBg, trackRgb);
      const acBg = compositeOver(res.acBg, surf);
      minInk = Math.min(minInk, contrastRgb(ink, surf));
      minInk2 = Math.min(minInk2, contrastRgb(ink2, surf), contrastRgb(ink2, page));
      minActivePill = Math.min(minActivePill, contrastRgb(res.apFg, apBg));
      minInactivePill = Math.min(minInactivePill, contrastRgb(res.ipFg, trackRgb));
      minActiveChip = Math.min(minActiveChip, contrastRgb(res.acFg, acBg));
    }
    assert.ok(minInk >= 3.0, `Min --ink contrast ${minInk.toFixed(2)} < 3.0`);
    assert.ok(minInk2 >= 4.5, `Min --ink-2 contrast ${minInk2.toFixed(2)} < 4.5`);
    assert.ok(minActivePill >= 4.5, `Min active Price pill contrast ${minActivePill.toFixed(2)} < 4.5`);
    assert.ok(minInactivePill >= 4.5, `Min inactive Price pill contrast ${minInactivePill.toFixed(2)} < 4.5`);
    assert.ok(minActiveChip >= 4.5, `Min active chip contrast ${minActiveChip.toFixed(2)} < 4.5`);
    await pTheme.close();
    passed++;

    // 3b. Real 2x PNG pixel contrast across Light, Dark, Everforest, Dawn:
    //     active pill, per-bead ring, and ≈ label physically inside the shaded polygon AND separately on unshaded --surface
    for (const th of ['light', 'dark', 'everforest', 'dawn']) {
      const pPix = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
      await injectHook(pPix);
      await pPix.goto(`${url}/index.html?noAutoUpdate=1&theme=${th}`, { waitUntil: 'networkidle' });
      await pPix.evaluate(() => {
        const sel = document.getElementById('setSelect');
        sel.value = '★ AA default selection';
        sel.dispatchEvent(new Event('change'));
      });
      await pPix.waitForTimeout(80);
      const geomShade = await pPix.evaluate(() => {
        const cv = document.createElement('canvas'); cv.width = 1; cv.height = 1;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        const toRgba = (cssVal) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = cssVal; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
        const probe = (v) => { const d = document.createElement('div'); d.style.color = v; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return toRgba(c); };
        const card = document.getElementById('chartCard');
        const cr = card.getBoundingClientRect();
        const svg = document.getElementById('chart');
        const sr = svg.getBoundingClientRect();
        const rel = (r) => r ? { x: r.x - cr.x, y: r.y - cr.y, width: r.width, height: r.height } : null;
        const shadePolyEl = document.querySelector('#chart polygon[fill-opacity="0.045"]');
        const polyPts = shadePolyEl ? shadePolyEl.getAttribute('points').trim().split(/\s+/).map(s => {
          const [px, py] = s.split(',').map(Number);
          return [px + sr.left - cr.left, py + sr.top - cr.top];
        }) : [];
        const ptInPoly = (x, y, poly) => {
          let inside = false;
          for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const [xi, yi] = poly[i], [xj, yj] = poly[j];
            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi)) inside = !inside;
          }
          return inside;
        };
        const pill = document.querySelector('#priceSeg button[aria-pressed="true"]');
        const rings = [...document.querySelectorAll('#chart g.lane2-bead-ring')];
        let shadedBeads = null;
        for (const ring of rings) {
          const beads = [...ring.querySelectorAll('circle')].map((c) => {
            const br = c.getBoundingClientRect();
            return { x: (br.left + br.right) / 2 - cr.x, y: (br.top + br.bottom) / 2 - cr.y };
          });
          const insideCnt = beads.filter(b => ptInPoly(b.x, b.y, polyPts)).length;
          if (insideCnt >= Math.ceil(beads.length * 0.8)) { shadedBeads = beads; break; }
        }
        const lbls = [...document.querySelectorAll('#chart text.lbl-lane2')];
        let shadedLblRect = null;
        for (const l of lbls) {
          const r = rel(l.getBoundingClientRect());
          if (r && ptInPoly(r.x + r.width / 2, r.y + r.height / 2, polyPts)) { shadedLblRect = r; break; }
        }
        return {
          surfaceRgb: probe('var(--surface)'),
          inkRgb: probe('var(--ink)'),
          pillBgRgb: toRgba(getComputedStyle(pill).backgroundColor),
          pillRect: rel(pill.getBoundingClientRect()),
          polyCount: polyPts.length,
          shadedBeads,
          shadedLblRect,
        };
      });
      assert.ok(geomShade.polyCount >= 4, `Expected rendered shaded polygon on ${th}`);
      assert.ok(geomShade.shadedBeads && geomShade.shadedBeads.length >= 10, `Expected Lane-2 bead ring physically inside shaded polygon on ${th}`);
      assert.ok(geomShade.shadedLblRect, `Expected Lane-2 ≈ label physically inside shaded polygon on ${th}`);
      const pngShade = decodePng(await pPix.locator('#chartCard').screenshot({ type: 'png' }));
      const surfRgb = geomShade.surfaceRgb;
      const shadedRgb = compositeOver([geomShade.inkRgb[0], geomShade.inkRgb[1], geomShade.inkRgb[2], 0.045], surfRgb);
      const pillBg = compositeOver(geomShade.pillBgRgb, surfRgb);
      const pillCr = bestContrastInRect(pngShade, geomShade.pillRect, pillBg, 2);
      const ringShade = checkBeadRingContrast(pngShade, geomShade.shadedBeads, shadedRgb, 3.0, 2);
      const lblCrShade = bestContrastInRect(pngShade, geomShade.shadedLblRect, shadedRgb, 2);
      assert.ok(pillCr >= 4.5, `${th} rendered Plan $ pill contrast ${pillCr.toFixed(2)} < 4.5`);
      assert.ok(ringShade.ratio >= 0.8, `${th} rendered bead ring contrast (physically in shaded zone): only ${ringShade.passing}/${ringShade.total} beads >= 3.0 (p20=${ringShade.p20.toFixed(2)})`);
      assert.ok(lblCrShade >= 4.5, `${th} rendered ≈ label contrast (physically in shaded zone) ${lblCrShade.toFixed(2)} < 4.5`);

      // Separately sample unshaded surface (frontStyle=rings: full opacity, zero shaded polygon)
      await pPix.goto(`${url}/index.html?noAutoUpdate=1&theme=${th}&frontStyle=rings`, { waitUntil: 'networkidle' });
      await pPix.evaluate(() => {
        const sel = document.getElementById('setSelect');
        sel.value = '★ AA default selection';
        sel.dispatchEvent(new Event('change'));
        // Re-apply rings so surface is genuinely unshaded at full opacity
        document.querySelector('#frontStyleSeg button[data-v="rings"]')?.click();
      });
      await pPix.waitForTimeout(80);
      const geomSurf = await pPix.evaluate(() => {
        const card = document.getElementById('chartCard');
        const cr = card.getBoundingClientRect();
        const rel = (r) => r ? { x: r.x - cr.x, y: r.y - cr.y, width: r.width, height: r.height } : null;
        const hasShade = !!document.querySelector('#chart polygon[fill-opacity="0.045"]');
        const ring = document.querySelector('#chart g.lane2-bead-ring');
        const lbl = document.querySelector('#chart text.lbl-lane2');
        const beads = ring ? [...ring.querySelectorAll('circle')].map((c) => {
          const br = c.getBoundingClientRect();
          return { x: (br.left + br.right) / 2 - cr.x, y: (br.top + br.bottom) / 2 - cr.y };
        }) : null;
        return { hasShade, beads, lblRect: rel(lbl?.getBoundingClientRect()) };
      });
      assert.equal(geomSurf.hasShade, false, `Expected unshaded surface on ${th} frontStyle=fade`);
      assert.ok(geomSurf.beads && geomSurf.beads.length >= 10 && geomSurf.lblRect, `Expected Lane-2 bead ring & label on unshaded ${th}`);
      const pngSurf = decodePng(await pPix.locator('#chartCard').screenshot({ type: 'png' }));
      const ringSurf = checkBeadRingContrast(pngSurf, geomSurf.beads, surfRgb, 3.0, 2);
      const lblCrSurf = bestContrastInRect(pngSurf, geomSurf.lblRect, surfRgb, 2);
      assert.ok(ringSurf.ratio >= 0.8, `${th} rendered bead ring contrast (unshaded surface): only ${ringSurf.passing}/${ringSurf.total} beads >= 3.0 (p20=${ringSurf.p20.toFixed(2)})`);
      assert.ok(lblCrSurf >= 4.5, `${th} rendered ≈ label contrast (unshaded surface) ${lblCrSurf.toFixed(2)} < 4.5`);
      await pPix.close();
      passed++;
    }

    // 3c. Geometry clearances & DOM ordering (asserting sqs.length > 0!) + 320px SI-28 export checks (2, 3, and 4 reasons)
    const pGeom = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
    await injectHook(pGeom);
    await pGeom.goto(`${url}/index.html?noAutoUpdate=1&colorBy=x&dual=ring&markStyle=square&markEffort=high`, { waitUntil: 'networkidle' });
    await pGeom.evaluate(() => {
      const sel = document.getElementById('setSelect');
      sel.value = '★ AA default selection';
      sel.dispatchEvent(new Event('change'));
    });
    const geomCheck = await pGeom.evaluate(() => {
      const sqs = [...document.querySelectorAll('#chart rect.effort-square')];
      const rings = [...document.querySelectorAll('#chart g.lane2-bead-ring')];
      const firstRing = rings[0];
      const firstSq = sqs[0];
      const sqBeforeRing = Boolean(firstSq && firstRing && (firstSq.compareDocumentPosition(firstRing) & Node.DOCUMENT_POSITION_FOLLOWING));
      const exp320On = window.__AIMF_TEST.svgString({ width: 320, pubEst: true });
      const exp320Off = window.__AIMF_TEST.svgString({ width: 320, pubEst: false });
      const exp320R3 = window.__AIMF_TEST.svgString({
        width: 320, pubEst: false,
        extraOmitted: [{ id: 'kimi', name: 'Kimi K3', short: 'Kimi K3', effort: 'high', price: { reasonCode: 'no_plan', shortReason: 'No Kimi plan selected', reason: 'No Kimi plan selected' } }],
      });
      const exp320R4 = window.__AIMF_TEST.svgString({
        width: 320, pubEst: false,
        extraOmitted: [
          { id: 'kimi', name: 'Kimi K3', short: 'Kimi K3', effort: 'high', price: { reasonCode: 'no_plan', shortReason: 'No Kimi plan selected', reason: 'No Kimi plan selected' } },
          { id: 'fable-old', name: 'Claude Fable 5.1', short: 'Fable 5.1', effort: 'high', price: { reasonCode: 'expired_promo', shortReason: 'Claude Pro offer ended Nov 16', reason: 'Claude Pro offer ended Nov 16' } },
        ],
      });
      return {
        sqCount: sqs.length,
        ringCount: rings.length,
        sqBeforeRing,
        onClips: exp320On.labelAudit.clippedTexts.length,
        offClips: exp320Off.labelAudit.clippedTexts.length,
        r3Fits: exp320R3.footerRes.fits,
        r3Conserved: exp320R3.footerRes.representedRows + exp320R3.footerRes.hiddenRows === exp320R3.footerRes.totalOmittedRows,
        r4Fits: exp320R4.footerRes.fits,
        r4Conserved: exp320R4.footerRes.representedRows + exp320R4.footerRes.hiddenRows === exp320R4.footerRes.totalOmittedRows,
        r4Text: exp320R4.footerRes.text,
      };
    });
    assert.ok(geomCheck.sqCount > 0, 'Expected effort-square marks on ★ AA default selection');
    assert.ok(geomCheck.ringCount > 0, 'Expected Lane-2 bead rings on ★ AA default selection');
    assert.equal(geomCheck.sqBeforeRing, true, 'Effort marks must DOM-precede bead rings');
    assert.equal(geomCheck.onClips, 0, '320px export (est ON) clipped text');
    assert.equal(geomCheck.offClips, 0, '320px export (est OFF) clipped text');
    assert.equal(geomCheck.r3Fits && geomCheck.r3Conserved, true, '320px 3-reason footer check failed');
    assert.equal(geomCheck.r4Fits && geomCheck.r4Conserved, true, '320px 4-reason footer check failed');
    assert.equal(/see chart list/i.test(geomCheck.r4Text), false, 'Standalone PNG footer must not say see chart list');
    await pGeom.close();
    passed++;

    console.log(`PASS gen-facts --check (read-only): catalog=${catSha.slice(0, 8)} snapshot=63/63 themes=29 checks=${passed}/${passed}`);
  } finally {
    await browser.close();
    srv.close();
  }
}

main().catch((err) => {
  console.error('FAIL gen-facts --check:', err?.stack || err);
  process.exit(1);
});
