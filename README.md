# AI Model Frontier

Interactive charts built from the [Artificial Analysis](https://artificialanalysis.ai) data.

**Live site: https://cornishandy.github.io/ai-model-frontier/** (GitHub Pages serves `index.html` from `main`).

- **Update data** button (top right) pulls the latest numbers straight from artificialanalysis.ai
  in the browser and saves them locally. It also updates automatically when opened if the data is
  more than 12 hours old, and re-checks hourly while left open. So the site stays current without republishing.
- `node scrape.mjs` refreshes the built-in data (`data/models.js`) and builds `AI Model Frontier.html`,
  a single self-contained copy that works offline. The scraping code lives in `aa-data.js`, shared by both.
- **Publishing**: commit and push to `main`. `node publish.mjs` does it in one step, with fresh built-in data.
- To preview locally, open `index.html` directly or run `python3 -m http.server` here.

- **Scraper**: the site ships its data as encrypted "manifests" in the Next.js payload
  (AES-256-GCM, key in the page, IV = sha256(key)[:12], gzipped JSON). `scrape.mjs`
  pulls `/` and `/models`, decrypts every manifest, and merges model records.
- **Axes**: Intelligence Index or individual benchmarks vs. cost to run the index, price,
  tokens used, speed, latency. Linear/log per axis.
- **Pareto frontier**: step or line, computed on what's visible; frontier points are ringed.
  Tick **all models** to compute the true frontier over every model; frontier models you haven't selected show as faint dots (click one to add it).
- **Labels**: Auto (model names + effort tags where they fit, the default), Auto+ (also the top effort next to each name), Models, Every dot, None.
- **Grid** (normal / faint / off) and **Axis text** (normal / faint).
- **Guides**: hover (or pin by clicking) draws the rectangle from the point to both axes
  with the exact values chipped on each axis. Modes: hover / pinned / frontier / all.
- **Saved sets**: models + efforts + axes + display options, stored in localStorage;
  export/import as JSON. Built-in presets included.
- Effort filter chips (alt/⌘-click to solo one effort), connect effort levels per model,
  color by lab / effort / open-vs-closed, table view, SVG/PNG export, light/dark.

## Syncing between devices

Saved sets and the current view sync through a private (secret) GitHub gist:
https://gist.github.com/cornishandy/a339af8bc76faf44020b123eed68f4f1 (its ID is `SYNC_GIST` in `index.html`).

- Every device reads it automatically when the page opens, and again whenever you switch back to the tab.
- To save changes from a device, click **Allow saving…** under Saved sets and paste a GitHub token that has only
  the `gist` permission (https://github.com/settings/tokens/new?scopes=gist). Without one, the device is read-only.
- The newest save wins. The theme isn't synced.
