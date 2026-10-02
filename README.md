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
  When the browser can't read artificialanalysis.ai's page ("Failed to fetch"), the button falls back to the site's own
  copy of the data (the one the deploy refreshed, so at most 12 hours old) and says so. The usual cause is on their side:
  some cached copies of their HTML pages are served without the `access-control-allow-origin` header for minutes at a
  time (the data files always have it), so a cross-origin read is refused until the cache turns over; an ad blocker or a
  VPN can do the same. The deploy's scraper runs in Node, which has no CORS rule, so the 12-hourly refresh is unaffected.
- `node scrape.mjs` refreshes the built-in data (`data/models.js`, `data/external.js`) and builds `AI Model Frontier.html`,
  a single self-contained copy that works offline. The Artificial Analysis scraper lives in `aa-data.js` (shared with the
  page), the independent benchmarks in `external.mjs`.
- **Publishing**: commit and push to `main`. `node publish.mjs` does it in one step, with fresh built-in data.
- To preview locally, open `index.html` directly or run `python3 -m http.server` here.
- `?celebrate` on the URL previews the celebration toast and confetti (the latest feed entries and benchmark updates).

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
  When the data (on opening the page, or after "Update data") brings entries you haven't seen, or an active benchmark's
  "last updated" date has moved on since you last looked, a toast and confetti announce them (no confetti with reduced
  motion). Updated benchmarks are tagged NEW in the metric lists for the visit. The first visit on a device just
  records what's there.
- **Coding agents**: the Artificial Analysis Coding Agent Index as a sortable table: the same model scores differently
  depending on the harness driving it (Claude Code, Codex, …).
- **Pareto frontier**: step or line, computed on what's visible. Styles: **Shade** (the default: tints the region the
  frontier beats), **Fade** (dims everything off the frontier), **Rings** (circles frontier points).
  Tick **all models** to compute the true frontier over every model; frontier models you haven't selected show as faint dots (click one to add it).
- **Labels**: Auto (model names + effort tags where they fit, the default), Auto+ (also the top effort next to each name),
  **Ladder** (names in a column to the right of the plot, each joined to its line by a thin leader, like slopalytics.com;
  effort tags stay by the dots), Models, Every dot, None. When nothing fits beside a dot, Auto looks further out and draws a
  leader line to the label instead of overlapping another one. The halo that keeps labels readable over lines is thinner
  and translucent on dark themes (thick dark halos made light text look bloated on phones); `?halo=thick|thin|none`
  on the URL tries the alternatives.
- **Spotlight** (Pinned): the models you've pinned (click a dot) stay at full strength and every other model, line and
  label dims. Saved with sets.
- The **axis pickers stay in view** while the page scrolls (on phones, under the header).
- **Grid** (normal / faint / off), **Axis text** (normal / faint) and **Glow** (a soft halo around dots and lines in each model's color).
- **Theme**: Auto (follows the device), light (Paper, White, Sepia) or dark (Graphite, Midnight, Black).
- **Models list**: Anthropic, OpenAI, Google and xAI (Grok) first and open; every other lab is in a collapsed
  "Other labs" group, each lab collapsible. Click a heading to open or close it, its count (e.g. 3/18) to select or clear
  the whole lab. Open/closed is remembered per device; searching opens everything.
- `mockups/` holds the HTML mock-ups used in design workshops (open them in a browser); the screenshots they
  reference aren't committed.
- **Lab colors**: Anthropic orange, OpenAI black (white on dark themes), Google blue, xAI green, then Alibaba, Meta, Z AI,
  DeepSeek, Xiaomi; other labs grey.
- **Hide older versions** (under the models list): leaves out a model once a newer version of it is out (Claude Opus 5
  once Opus 5.5 is; GPT-6 Sol once GPT-6.1 Sol is), a line that's a generation behind its brand (GPT-5.6 Terra, GPT-5.3
  Codex and GPT-5.5 Instant once GPT-6 is out; Claude 4.5 Haiku after Claude 5), and a line the lab has left behind for
  6 months (o3, gpt-oss, Llama 4). A model released in the last 60 days is never counted as a generation behind, and a
  brand that's still shipping keeps its recent models (Gemma 4 while Gemini 4 is out). Hover a model's name for the
  reason; the same models draw dashed. They stay selected, so unticking brings them back. Saved with sets.
- **Other labs**: only labs with a model on Artificial Analysis' own Intelligence Index chart are listed (Meta, Xiaomi,
  Alibaba, Z AI, StepFun, Kimi, DeepSeek, …), plus any lab you have something selected from; **All labs** (next to Hide
  older versions, or the "show all labs" link at the end of the list) brings in the long tail. Searching finds everyone.
- **Axis pickers**: searchable lists; hover a metric to see what it measures (from Artificial Analysis' evaluation pages,
  or the independent source's own page), how many models have it, and its current top 3. The chosen benchmark's
  description also sits under the chart title. On touch screens the description shows under each entry.
- **Last updated**: each metric in the pickers, Who leads what, the hover cards and the chart description shows when
  it last changed. Artificial Analysis doesn't date its evaluations, so for its metrics it's the newest model with a
  result (the day AA added it, from its changelog, or else the model's release date); retired benchmarks like AIME 2025
  stop moving. Independent benchmarks use their source's date (its own "updated" field, the newest result, the last
  commit to its data on GitHub, or the data file's date). The lists sort newest first within each section by default;
  **Default order** switches back to the usual grouping (remembered per device).
- **Active only** (on by default, in the pickers and Who leads what): lists only benchmarks still run on the current
  frontier, i.e. with a result for today's top model on the Intelligence Index and at least 3 of the top 5 families.
  Retired ones (AIME 2025, IFBench, GPQA Diamond once new models stopped getting it, WeirdML v2, …) are hidden, with a
  "Show all" link at the end of the list; searching still finds them, and the charted one stays listed. The hover card
  says which frontier models a benchmark is missing. **Updated within** (3 months, 6 months, a year) also leaves out
  benchmarks whose newest result is older than that, and **Grade** leaves out those with a report card below C or B.
- **Report cards**: every benchmark gets a letter grade (A–F) in the pickers, the hover card and under the chart title,
  computed from: whether the test set is private (0–2), saturation in the current scores (0–3: top three current models
  bunched within 2 points, or a top score over 95%, scores 0; a spread over 5 points with the top under 80% scores 3),
  whether it's still run on the frontier (0–1), independence from the frontier labs (0–2), currency of the dataset (0–1),
  and ±1 for audit findings. A = 9–10, B = 7–8, C = 5–6, D = 3–4, F = 0–2. The hover card lists each line of the score
  and a one-line verdict. The facts behind it (who made it, test-set privacy, audits) are in `BENCH_META` in
  `index.html`, drawn from these meta-evaluations of benchmarks:
  [BetterBench](https://betterbench.stanford.edu/) (Stanford; 46 quality criteria on 24 benchmarks),
  [Epoch AI's Benchmarking Hub](https://epoch.ai/benchmarks) (independent re-runs; retires saturated benchmarks),
  [When AI Benchmarks Plateau](https://arxiv.org/abs/2602.16763) (EvalEval; a saturation index for 60 benchmarks),
  [Stanford AI Index 2026, ch. 2](https://hai.stanford.edu/assets/files/ai_index_report_2026_chapter_2_technical.pdf),
  [Measuring what Matters](https://arxiv.org/abs/2511.04703) (construct validity of 445 benchmarks),
  [The Leaderboard Illusion](https://arxiv.org/abs/2504.20879) (an audit of LMArena),
  expert re-grading of [HLE and CritPt physics](https://arxiv.org/abs/2609.13009) and
  [SciCode-Verified](https://arxiv.org/abs/2608.04975), FutureHouse's [HLE audit](https://www.futurehouse.org/research/hle-exam),
  and Artificial Analysis' own index changelogs
  ([v4.1](https://artificialanalysis.ai/articles/artificial-analysis-intelligence-index-v4-1),
  [v4.2](https://artificialanalysis.ai/articles/artificial-analysis-intelligence-index-v4-2),
  [v4.3](https://artificialanalysis.ai/articles/artificial-analysis-intelligence-index-v4-3)), which say which
  benchmarks were dropped as saturated.
- **Who leads what**: every benchmark grouped by the model (or lab) that leads it among current models, with the top
  score and the lead over #2; hover for the top 3, click to chart it. Respects "Open weights only".
- **Good zone**: shades one reading of "good" for the trade-off. **Quadrant** (better than the median model shown on
  both axes), **Near frontier** (within 3 points, or 5%, of the best score at that cost or less), **Top tier** (within
  10% of the best score; the cheapest one is ringed), **Sweet spot** (the frontier's knee: the frontier model furthest
  above the straight line between its two ends; past it, extra spend buys less), **Beats pinned** (everything better
  than your pinned model on both axes), **Diagonal** (bands toward the better-on-both corner). Styles: Tint, Hatch,
  Outline, Gradient. The legend says how many models are in the zone.
- **Shape: Diamond** turns the chart 45° (like dunksandthrees' EPM charts): better on both is straight up, the left
  corner is best on X, the right corner best on Y. Ticks and axis titles run along the two lower edges.
- **By effort level** (under the chart): one row per selected model, a dot per reasoning effort, on cost per task, total
  cost, tokens per task, total tokens, time per task or whatever is on an axis, linear or log, sorted best first, with
  the values under the dots (like the dot rows on slopalytics.com). Letters in the dots are the effort levels.
- **Subscription math** (under that): pick the plan you pay for (ChatGPT, Claude, Google AI, SuperGrok, Copilot, Cursor,
  T3 Chat, Perplexity, or a custom fee) and the table shows, model by model, how many Intelligence Index tasks a month the
  same money buys at API list prices, with your plan's provider highlighted. The fee also drives the metric **Tasks a month
  on your plan** (Cost group, either axis), next to the new **Tasks per dollar** and **Index points per dollar**. Plans
  meter usage by session and week rather than by task, and measured API-equivalent use of a plan run to its caps is far
  above the fee (SemiAnalysis' June 2026 stress test; ccusage logs), so the table is a yardstick, not a bill. Prices are
  the providers' published monthly fees as of early October 2026 (openai.com/chatgpt/pricing, claude.com/pricing,
  gemini.google/subscriptions, x.ai, github.com/features/copilot/plans, cursor.com/pricing); edit the fee if yours differs.
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
