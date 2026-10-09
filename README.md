# AI Model Frontier

Interactive charts built from the [Artificial Analysis](https://artificialanalysis.ai) data.

**Live site: https://cornishandy.github.io/ai-model-frontier/**

- **Deploys**: a GitHub Actions workflow (`.github/workflows/deploy.yml`) re-scrapes all the data and deploys the site
  on every push to `main` and every 30 minutes (:17 and :47 past each hour UTC). GitHub's schedule is best effort:
  scheduled runs have been starting 4–8 hours late, and under load some may be dropped. The fresh data goes into the
  deployed site only, nothing is committed. If the scrape fails on a scheduled or manual run, the run fails and the previous
  deployment stays up. If it fails on a push, the copy committed in `data/` is deployed with the new code.
  Run it by hand from the repo's Actions tab ("Deploy site" → Run workflow).
  GitHub pauses scheduled workflows after 60 days without repo activity; re-enable it in the Actions tab if that happens.
- **Update data** button (top right) pulls the latest numbers straight from artificialanalysis.ai
  in the browser and saves them locally. It only runs when you press it (the deployed site refreshes on its own schedule).
  Their HTML pages are usually served without the `access-control-allow-origin` header, so a browser isn't allowed to
  read them directly; the button then reads them through the Jina Reader service (`r.jina.ai`), which adds the header.
  That copy only supplies the names and keys of the encrypted data files: the files themselves come straight from
  artificialanalysis.ai (they always allow cross-origin reads), and AES-GCM rejects any key that doesn't belong to them,
  so the relay can't alter the numbers. The keys change every 10–20 minutes, so the relay is asked for a fresh copy
  (`X-No-Cache`). If that fails too (relay down or rate-limited, an ad blocker, a VPN), the button falls back to the
  site's own copy, if that's newer, and says so. The deploy's scraper runs in Node, which has no CORS rule,
  so it reads the pages directly.
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
- **Labels**: Auto (model names + effort tags where they fit, the default), Auto+ (each model's top dot also gets its effort
  tag, placed like the other effort tags),
  **Ladder** (names in a column to the right of the plot, each joined to its line by a thin leader, like slopalytics.com;
  effort tags stay by the dots), Models, Every dot, None. When nothing fits beside a dot, Auto looks further out and draws a
  leader line to the label instead of overlapping another one. The halo that keeps labels readable over lines is thinner
  and translucent on dark themes (thick dark halos made light text look bloated on phones); `?halo=thick|thin|none`
  on the URL tries the alternatives.
- **Values** (X / Y / Both) writes each dot's axis values beside it, placed to avoid other labels (with a leader line
  when it has to move). Tick **frontier only** to write them only on the Pareto frontier's dots (with Pareto Off, the
  frontier of the models shown; never on faint unselected frontier dots).
- **Lines** through each model's effort levels: Off, Solid, Dashed or Dotted; older versions step one style lighter
  (dashed, dotted, thin dashes). **Mark** puts a Hash, Ring or Square on one effort level of every line (or None).
- **1.0 =** (beside each axis' scale): shows that axis relative to a reference, with ticks like 0.5×, 1×, 2×.
  **Sweet spot** is the frontier's knee on the current scales: the shown frontier model farthest toward better-on-both
  from the straight line joining the frontier's two ends (past it, each step buys less). If the frontier doesn't bend,
  the chart says so instead of picking one, and it warns when the bend is slight. **Best** is the best shown value, **Median** the middle one, **Pinned** the first
  pinned model still on the chart. Under **A model on the chart**, any dot's model and effort can be 1.0 on its own,
  whatever you pin (saved as `model:<family>:<effort>`, so `?xRel=model:claude-opus-5-5:xhigh` works too); right-click a
  dot for **Use as 1.0 on both axes / on X / on Y**, or a model in the list to use any of its efforts on both axes. If that
  model later leaves the chart, 1.0 keeps using its own value (the note says so, and says when 1.0 is beyond the
  chart's edge). The note above the chart names the reference model and its values; hover cards keep the
  raw values and add the ratio.
- **Pin and compare**: click a dot to pin it, then hover another: the hover card compares the two (the axes,
  Intelligence Index, cost, tokens and time per task, with the ratio in green when the hovered model is better).
- **Right-click** a dot, a Ladder name, or a model or lab in the list: show or hide that family or its lab, only it, all
  but it, highlight it, reset or clear the selection. In **Ladder** labels, clicking a name highlights its line.
  `/` jumps to the model search (Esc leaves it).
- **Spotlight** (Pinned): the models you've pinned (click a dot) stay at full strength and every other model, line and
  label dims. Saved with sets.
- The **axis pickers stay in view** while the page scrolls (on phones, under the header).
- **Grid** (normal / faint / off), **Axis text** (normal / faint) and **Glow** (a soft halo around dots and lines in each model's color).
- **Options layout**: five sections (Frontier, Labels, Guides, Look, Index). Click a filter's name to fold it down to its
  current choice, and click that choice (or the name) to open it again; a section's name folds all its filters, and
  Alt-click folds or opens every one. Folds are remembered per device; Grid, Axis text, Glow and Shape start folded.
  `?tb=b` shows the sections as cards instead. In the sidebar, **Saved sets**, **Efforts shown** and **Models** fold
  from their headings, leaving a one-line summary.
- **Full width** (the ⤢ button in the header, or `?wide=1`): the chart takes the whole window and the models list opens
  as a drawer from the **Models** button. Remembered per device.
- **Theme**: Auto (follows the device), light (Paper, White, Sepia, Solarized Light, Catppuccin Latte, Gruvbox Light, Rosé Pine Dawn,
  Sage, Mint, Lavender, Lilac, Colorblind-safe, High contrast) or dark (Graphite, Midnight, Black, Solarized Dark, Nord, Dracula, Gruvbox Dark, Catppuccin Mocha,
  Tokyo Night, One Dark, Rosé Pine, Monokai, Everforest, High contrast). Paper/White/Sepia and Graphite/Midnight/Black only change
  the surfaces; the others also recolor the labs (keeping each lab's hue) and the effort ramp. `?theme=nord` previews one.
- **Models list**: Anthropic, OpenAI, Google and xAI (Grok) first and open; every other lab is in a collapsed
  "Other labs" group, each lab collapsible. Click a heading to open or close it, its count (e.g. 3/18) to select or clear
  the whole lab. Open/closed is remembered per device; searching opens everything.
- `mockups/` holds the HTML mock-ups used in design workshops (open them in a browser); the screenshots they
  reference aren't committed.
- **Lab colors**: Anthropic orange, OpenAI black (white on dark themes), Google blue, xAI green, then Alibaba, Meta, Z AI,
  DeepSeek, Xiaomi; other labs grey. Within a lab, each model line gets its own color from a band around the lab's hue,
  stepped apart in lightness and hue for each theme (with a color-blind check), so Claude Opus, Sonnet, Fable and Haiku are
  easy to tell apart; older versions share their line's color and draw dashed. `?famColors=shades` shows the old
  lightness-only shades, `?famColors=wide` a wider hue band.
- **Size picks** (Small / Medium / Large, beside the Models heading) add or remove the current small, mid-size or flagship
  models of the big labs, leaving the rest of the selection alone.
- **Hide older versions** (under the models list): leaves out a model once a newer version of it is out (Claude Opus 5
  once Opus 5.5 is; GPT-6 Sol once GPT-6.1 Sol is), a line that's a generation behind its brand (GPT-5.6 Terra, GPT-5.3
  Codex and GPT-5.5 Instant once GPT-6 is out; Claude 4.5 Haiku after Claude 5), and a line the lab has left behind for
  6 months (o3, gpt-oss, Llama 4). A model released in the last 60 days is never counted as a generation behind, and a
  brand that's still shipping keeps its recent models. Google's Gemma models (small, open weights, far behind
  Gemini) always count as older. Hover a model's name for the
  reason; the same models draw dashed. They stay selected, so unticking brings them back. Saved with sets.
- **Other labs**: only labs with a model on Artificial Analysis' own Intelligence Index chart that rank at or above
  DeepSeek by their best current model are listed (Meta, Xiaomi, Alibaba, Z AI, StepFun, Kimi, DeepSeek), plus any lab
  you have something selected from; **All labs** (next to Hide older versions, or the "show all labs" link at the end of
  the list) brings in the rest (MiniMax, NVIDIA, Mistral and the long tail). Searching finds everyone.
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
  says which frontier models a benchmark is missing. **Grade** also leaves out those with a report card below C, below B,
  or below A.
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
- **Your index** (in the options, and "Score from" under Subscription math): rebuilds the score and its cost per task
  from only the benchmarks you trust: AA's 10 index benchmarks as published (the default), Grade A only, Grade B or
  better, Grade C or better (graded benchmarks still run on the frontier), or everything the axis picker lists (its
  Active only and Grade filters). The score is a weighted average on 0–100 (percentages as they are, GDPval and Briefcase
  Elo scaled the way AA scales GDPval, AA-Omniscience from −100…100, other Elo boards from lowest to highest; AA's weight
  where it has one, 10% otherwise), and a model needs results covering 3/4 of the weight. Artificial Analysis publishes
  each index evaluation's own cost and tokens per task (kept in the data as `evals`, with the index weights as
  `indexWeights`), so **Cost per task (…)** averages those over the picked benchmarks it has costs for. Most benchmarks
  outside the index are run at only one or two effort levels, so **fill gaps** (on by default) estimates a missing
  result from the same model at the nearest effort level, scaled by their Intelligence Index, and draws those dots faded.
  The metrics **Your index** and **Cost per task (…)** go on either axis; Tasks per dollar, Index points per dollar,
  Tasks a month on your plan and the subscription table all use them.
- **Subscription math** (under that): pick the plan you pay for (ChatGPT, Claude, Google AI, SuperGrok, Copilot, Cursor,
  T3 Chat, Perplexity, or a custom fee) and see, model by model, how many tasks a month the same money buys at API list
  prices. A chart plots the score against tasks a month (log scale, with the frontier: the best score at each budget,
  and guides at 1, 10 and 100 a day), or shows ranked rows; models from your plan's provider are solid, the rest faded.
  The table sorts by any column; Labs and Effort chips filter both (alt-click or long-press to show only one), as does
  "Only on my plan", and **Models** switches between the models on the chart and every current model. The fee also drives
  the metric **Tasks a month on your plan** (Cost group, either axis), next to **Tasks per dollar** and **Index points
  per dollar**. Plans
  meter usage by session and week rather than by task, and measured API-equivalent use of a plan run to its caps is far
  above the fee (SemiAnalysis' June 2026 stress test; ccusage logs), so the table is a yardstick, not a bill. Prices are
  the providers' published monthly fees as of early October 2026 (openai.com/chatgpt/pricing, claude.com/pricing,
  gemini.google/subscriptions, x.ai, github.com/features/copilot/plans, cursor.com/pricing); edit the fee if yours differs.
- **Guides**: hover (or pin by clicking) draws the rectangle from the point to both axes
  with the exact values chipped on each axis. Modes: hover / pinned / frontier / all; **X & Y / X / Y** draws the lines
  to both axes or only one. **Pinned area** sets how the box between a pinned (or hovered) dot's guides and the axes is
  drawn: None (just the guide lines), Tint, Hatch or Gradient (fading from the dot), in the dot's colour or grey.
- **Good zone** styles: None (no area: only the zone's own guide lines, label and count; for Beats pinned, two lines from
  each pin toward the better edges), Tint, Hatch, Outline, Gradient; colour Theme, Grey, or Model (each pinned model's own
  colour for Beats pinned, the sweet spot's for Sweet spot).
- **Saved sets**: models + efforts + axes + display options, stored in localStorage;
  export/import as JSON. Built-in presets included.
- Effort filter chips (alt/⌘-click to solo one effort), table view, SVG/PNG export.
- **Color**: by lab, effort or open-vs-closed, or by value: **X value**, **Y value** or **Both** (how far toward the
  better-on-both corner), on the axis' own scale so colors match the distances you see. Palettes: Viridis, Cividis (the
  safest for color-blind readers), Magma, Plasma, One hue (the theme's accent) and Vs. median (diverging: one color on the
  better side of the median, another on the worse side, grey at it). The strongest color is always the better end, and a
  color bar runs along the axis.

## Your usage (T3 Code)

A card under Subscription math shows what your own use of each model in T3 Code would cost at API list prices: today, the
last 7 and 30 days, this month (with the month-end pace), all time, per model / provider (/ project, if you opt in), day
by day with spikes marked, what your subscriptions bought, an activity grid, and a relative index (1.0 = the period's
daily average, your plan budget, the previous period, the top or median model, or a model you pick). The site and this repo are public, so the numbers never appear here in plain text:

- `usage/collect.mjs` runs on the Mac (by hand, or hourly from the LaunchAgent template in `usage/`). It reads T3 Code's
  local usage records read-only and keeps only aggregates: per day × model × provider, tokens, request counts and
  API-equivalent cost, an all-time weekday × hour grid, and session counts. It never keeps prompts, messages, titles,
  file paths or IDs; project folder names only with `--projects`.
- It gzips and encrypts that (AES-256-GCM, a random key kept in `~/.config/ai-model-frontier/usage.json`, mode 0600) and
  uploads only the ciphertext to a secret GitHub gist. `--rotate` makes a new key and gist and deletes the old one.
- The page decrypts it in the browser. It learns the gist and key once, from an unlock link printed by
  `node usage/collect.mjs --link` (the part after `#` never reaches a server), and keeps them in this browser's storage
  only, not in saved sets or sync. **Forget on this device** removes them. Anyone with the link can read the numbers,
  so treat it like a password.
- Antigravity is read from its own conversation files, counting each call once (T3 Code's Tokens tab counts most calls
  three times, because Antigravity stores each one three times). A few models have no API price.
  Details and commands: `usage/README.md`.

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
