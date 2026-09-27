# AI Model Frontier

Interactive charts built from the [Artificial Analysis](https://artificialanalysis.ai) data.

**Live site: https://cornishandy.github.io/ai-model-frontier/**

- **Deploys**: a GitHub Actions workflow (`.github/workflows/deploy.yml`) re-scrapes all the data and deploys the site
  on every push to `main` and every 12 hours (00:17 and 12:17 UTC). The fresh data goes into the deployed site only,
  nothing is committed; if a source is down, the copy committed in `data/` is deployed instead.
  Run it by hand from the repo's Actions tab ("Deploy site" → Run workflow).
  GitHub pauses scheduled workflows after 60 days without repo activity; re-enable it in the Actions tab if that happens.
- **Update data** button (top right) pulls the latest numbers straight from artificialanalysis.ai
  in the browser and saves them locally. It only runs when you press it (the deployed site already refreshes every 12 hours).
- `node scrape.mjs` refreshes the built-in data (`data/models.js`, `data/external.js`) and builds `AI Model Frontier.html`,
  a single self-contained copy that works offline. The Artificial Analysis scraper lives in `aa-data.js` (shared with the
  page), the independent benchmarks in `external.mjs`.
- **Publishing**: commit and push to `main`. `node publish.mjs` does it in one step, with fresh built-in data.
- To preview locally, open `index.html` directly or run `python3 -m http.server` here.
- `?celebrate` on the URL previews the "new on Artificial Analysis" toast and confetti.

- **Scraper**: the site ships its data as encrypted "manifests" in the Next.js payload
  (AES-256-GCM, key in the page, IV = sha256(key)[:12], gzipped JSON). `scrape.mjs`
  pulls `/` and `/models`, decrypts every manifest, and merges model records, the site's changelog and its Coding Agent Index.
- **Axes**: any metric on either axis: the Intelligence Index, every per-model benchmark Artificial Analysis publishes
  (knowledge & reasoning, coding & terminal, agents & tool use, work & documents), the independent benchmarks below,
  cost, price, tokens per task, speed, latency. Scales: linear, square root (spreads out the cheap end without log's
  distortion), log, and logit for percentage benchmarks (stretches the top end, where frontier models bunch up near 100%;
  greyed out on an axis showing anything else).
- **Independent benchmarks** (`external.mjs`, matched to Artificial Analysis models by name; where a source doesn't say
  which reasoning effort it ran, the value goes on the model's default effort and the tooltip says so):
  [WeirdML v3 and v2](https://htihle.github.io/weirdml.html) (Håvard Tveit Ihle),
  [LLM Chess](https://maxim-saplin.github.io/llm_chess/) (Maxim Saplin),
  [Kaggle Game Arena chess](https://www.kaggle.com/benchmarks/kaggle/chess-text) (Google DeepMind & Kaggle),
  [dubesor chess](https://dubesor.de/chess/chess-leaderboard),
  [ARC-AGI-2](https://arcprize.org/leaderboard) (score and cost per task; ARC Prize Foundation),
  [SimpleBench](https://simple-bench.com),
  [LMArena Text](https://lmarena.ai/leaderboard/text).
- **What's new**: the Artificial Analysis changelog (models added, articles), with "+ Chart" to plot a new model.
  When a data update brings entries you haven't seen, a toast and confetti announce them (no confetti with reduced motion);
  the first visit on a device just records what's there.
- **Coding agents**: the Artificial Analysis Coding Agent Index as a sortable table: the same model scores differently
  depending on the harness driving it (Claude Code, Codex, …).
- **Pareto frontier**: step or line, computed on what's visible. Styles: **Shade** (the default: tints the region the
  frontier beats), **Fade** (dims everything off the frontier), **Rings** (circles frontier points).
  Tick **all models** to compute the true frontier over every model; frontier models you haven't selected show as faint dots (click one to add it).
- **Labels**: Auto (model names + effort tags where they fit, the default), Auto+ (also the top effort next to each name), Models, Every dot, None.
- **Grid** (normal / faint / off), **Axis text** (normal / faint) and **Glow** (a soft halo around dots and lines in each model's color).
- **Theme**: Auto (follows the device), light (Paper, White, Sepia) or dark (Graphite, Midnight, Black).
- **Models list**: Anthropic, OpenAI, Google and xAI (Grok) first and open; every other lab is in a collapsed
  "Other labs" group, each lab collapsible. Click a heading to open or close it, its count (e.g. 3/18) to select or clear
  the whole lab. Open/closed is remembered per device; searching opens everything.
- **Lab colors**: Anthropic orange, OpenAI black (white on dark themes), Google blue, xAI green, then Alibaba, Meta, Z AI,
  DeepSeek, Xiaomi; other labs grey.
- **Hide older versions** (under the models list): leaves out a model once a newer version of it is out, e.g. Claude Opus 5
  once Opus 5.5 is. They stay selected, so unticking brings them back. Saved with sets.
- **Guides**: hover (or pin by clicking) draws the rectangle from the point to both axes
  with the exact values chipped on each axis. Modes: hover / pinned / frontier / all.
- **Saved sets**: models + efforts + axes + display options, stored in localStorage;
  export/import as JSON. Built-in presets included.
- Effort filter chips (alt/⌘-click to solo one effort), connect effort levels per model,
  color by lab / effort / open-vs-closed, table view, SVG/PNG export.

## Syncing between devices

Saved sets (not the current view or theme) sync through a private (secret) GitHub gist:
https://gist.github.com/cornishandy/a339af8bc76faf44020b123eed68f4f1 (its ID is `SYNC_GIST` in `index.html`).
GitHub Pages can't store anything, so the gist is the shared copy every device reads from and saves to.

- The page reads the gist once when it opens. After that nothing happens until you press **Sync**, which downloads
  the other devices' changes and uploads this device's. A note beside it says when this device has unsynced changes.
- Merging is per set: a set you changed on this device since its last sync keeps your version; everything else
  (including sets deleted elsewhere) follows the gist.
- Saving needs a GitHub token with only the `gist` permission (https://github.com/settings/tokens/new?scopes=gist),
  entered once per device; pressing Sync with unsynced changes asks for one. Reading needs no token.
- **Send to phone** (shown once a device has a token) shares a link carrying that token, e.g. by AirDrop or a message
  to yourself; opening it on the other device lets it save too. The token sits after `#`, so it never reaches a server.
