# Private local usage collector

Requires Node 26 and no npm packages. Run from this checkout:

```sh
node usage/collect.mjs
node usage/collect.mjs --out usage/check.local.json
node usage/test.mjs
```

The default command reads local usage sources, prints aggregates, and leaves project
names off (`projects: []`, project indexes −1). `--projects` explicitly opts in to
basenames. The 0600 config at `~/.config/ai-model-frontier/usage.json` holds a random
32-byte key, `gistId`, and `projectDenylist` (initially `taxes`, `medical`, `secret`,
`interview`; matching is case-insensitive substring matching). Add sensitive folder
names there. Denied names are omitted; folders active on only one local day fold
into `(other)`. `--no-projects` remains an explicit off switch.

The config, manual local outputs and `~/Library/Logs/aimf-usage.log` have mode 0600.
Keep plaintext inspection files outside the public repository, or in the ignored
`usage/*.local.json` pattern. `--quiet` suppresses the summary; constant warnings
with counts and sanitized failures still go to stderr. Warnings are buffered until final privacy validation
passes; rejected source metadata never reaches the log. Neither flag changes
the underlying sources.

After reviewing the results, the owner can explicitly run:

```sh
node usage/collect.mjs --publish
node usage/collect.mjs --link
node usage/collect.mjs --rotate --quiet
node usage/collect.mjs --link
```

`--publish` invokes `gh` to create a **secret** gist or update its `aimf-usage.json`.
Node builds the request with JSON boolean `public: false`, description `note`, and
ciphertext on stdin, never in argv. Creation must return `public: false`; its ID
must also be absent from every page of the owner's public gist list. A failed
privacy check attempts deletion before aborting. A private write-ahead intent is
saved before POST, including the unique encrypted content and authenticated owner. The accepted ID is saved before verification;
failed cleanup remains tracked and blocks later publication.
Public existing gists are refused. The key is never sent to GitHub.

Encryption uses gzip, AES-256-GCM, a fresh random 12-byte IV, an appended 16-byte
tag, and associated data `aimf-usage-enc/1|A256GCM|gzip`. Decryption refuses other
algorithms/compression and caps JSON at 8 MiB before parsing. Existing envelopes
must authenticate before a normal update; pre-amendment envelopes need `--rotate`.
The upload comparison ignores only `generatedAt`, so unchanged data needs no write.

`--rotate` publishes with a new key to a **new gist**, stores the new config, then
deletes the old gist to revoke its revisions. It never overwrites the old gist.
If creation or privacy checking fails, the old active key/gist remains usable.
The private config has a small `publication` journal: `creating` → `verifying`
→ `promoted`, or `cleanup-pending` when the candidate must be revoked.
`pendingDeleteGistId` retains the exact revocation obligation. Each transition
uses a 0600 temporary file, file fsync, atomic rename and directory fsync. After
any write error the on-disk state is reloaded; a promotion whose rename succeeded
is retained, with both identities tracked. Recovery durably re-saves that state
before deleting an old gist. It never rolls back by deleting the active new gist.

Pending recovery runs under the lock **before collecting telemetry** on
`--publish`/`--rotate`. `node usage/collect.mjs --recover --quiet` recovers only
publication cleanup, even if telemetry is broken; it never creates a gist. An
interrupted verification revokes the candidate and keeps the old active key/gist.
If the POST reply or first ID write was lost, recovery searches the original
account's gist history for exactly the unique ciphertext saved in `creating`,
then journals and revokes that candidate. Zero or multiple matches fail closed
and block another POST; an unconfirmed creation requires local reconciliation.
A death between recording intent and sending POST cannot be distinguished from
an unacknowledged remote request, so recovery does not blindly replay creation.
The old link stays usable until confirmed revocation; rotation is never local-only.

DELETE succeeds only on HTTP 204. DELETE 404 clears an obligation only after the
original account authenticates, GET of that **same** gist also returns 404, the
response explicitly grants the `gist` OAuth scope, and the persisted obligation
still matches. Readable gists, another account, reduced/missing scope evidence,
auth errors and transport failures retain the obligation. Legacy configs can
bind the account through a readable active gist; an unknown owner fails closed.
Fine-grained tokens without OAuth scope evidence cannot clear a 404 obligation;
a successful DELETE 204 still works. GitHub documents
[permission-related 404 responses](https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api)
and the [granted-scope response header](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps).
HTTP parsing reads only the status line and headers through the first blank line;
body text and stderr never supply a status.

All CLI lifecycle operations take an interprocess lock next to the config before
reading/creating it, and keep it through collection, every gh call, replacement
and cleanup. A complete 0600 owner record (PID, random nonce and epoch creation
time) is written/fsynced to a unique temporary file and published atomically with
`link`: EEXIST means held. Liveness uses only `kill(pid, 0)`; ESRCH is dead and
EPERM is alive. A live reused PID is conservatively held, with no formatted
process times or locale/timezone dependence. Dead-owner recovery elects one
reaper per dead nonce with an exclusive hard link, rechecks that nonce/liveness,
then atomically renames the lock to a unique tombstone. This election prevents a
late stale contender from renaming the replacement generation. Release removes
only the owner's nonce. Waiting is bounded to two minutes with a constant retry
error. If a reaper dies while holding its recovery claim, the collector stops
with an explicit local-inspection error; it does not guess or steal that claim.
Config is always re-read after acquisition.

Config directories are canonical, user-owned and mode 0700. Ancestor symlinks
below the canonical home directory are refused. Output checks resolve existing
ancestors, so aliases cannot bypass the repository guard. Config/key can never
resolve into this repository; plaintext can do so only in ignored
`usage/*.local.json`. Final-component symlinks, including dangling links, are
refused. These checks do not defend against a compromised process running as the
same user changing ancestors after validation.

`--publish` and `--rotate` never print the key, gist ID or unlock link. `--link` is a
separate manual command and deliberately prints the password-equivalent unlock
link. Anyone possessing it can decrypt the data. AirDrop or a local QR is preferred;
do not put the link in logs, commits, SMS, email or public messages. Combining
`--link` with a publishing command is refused.

## Verification

```sh
node usage/test.mjs
node usage/browser-test.cjs
```

The Node tests use synthetic WAL databases, separate real collector processes,
and an executable fake `gh`; they perform no external network requests. Each
harness creates its own mode-0700 OS temporary directory and removes it on success
or failure. Set `AIMF_TEST_SCRATCH` to choose the scratch parent; no fixtures or
plaintext are written under the checkout.

Browser tests generate a synthetic payload and independent random test key in
memory. Install Playwright and Chromium/WebKit separately; the default module is
`playwright`, or set `AIMF_TEST_PLAYWRIGHT` to an existing installation. For example:

```sh
AIMF_TEST_PLAYWRIGHT=/path/to/node_modules/playwright node usage/browser-test.cjs
```

An optional `AIMF_TEST_ARTIFACT_DIR` explicitly selects existing
`usage-real.local.json`, `usage-real.enc.json`, and `usage-real.testkey` for a
compatibility check; ordinary tests require none of those files and never read
production config. A localhost test page checks AAD round trips, reloads, wrong
keys, tampering, incompatible AAD, pinned metadata and the decompression cap in
Chromium light/dark and WebKit iPhone contexts. Keys/envelopes stay in memory,
never process arguments or diagnostic output.

## Counting and privacy rules

- The v5 T3 cache supplies Claude, Codex subscription, Codex API and Grok history.
  All 11 columns, dictionaries, source roots and token bounds are checked. Samples
  for every source/model/flag are checked against raw usage records on every run.
  Grok raw per-model turn counters supply `modelCalls` (a cached row can contain
  many requests) and verify cost ticks divided by 10,000,000,000.
- Claude input is already uncached. Codex input includes cache reads **and writes**,
  so both are subtracted. Output already includes reasoning. Claude's cache does
  not preserve thinking counters; its informational reasoning column stays zero.
- Cached dedupe keys prevent duplicate Claude blocks/Grok turns. Codex duplicate
  fingerprints across files of the same session are collapsed; separate sessions
  and genuine calls within a file at the same millisecond are retained. The cache already suppresses inherited
  fork prefixes. Binary flags are retained, not interpreted as inherited copies.
- OpenCode's new `session_message/session_v2` records win over matching legacy
  `message/session` records by message ID; conflicting copies abort. Input and
  cache counters are disjoint. OpenCode output excludes reasoning, which is added
  once to output. Completed metered messages are requests; zero-token/zero-cost
  error placeholders and unfinished messages are omitted.
- Antigravity usage comes from its own conversation files, the ones T3 Code's
  usage page reads: `~/.gemini/antigravity{,-cli,-ide,-backup}`, `~/.config/antigravity`
  and each Antigravity instance's T3 profile (`providers/antigravity/<sha256 of the
  instance id>/antigravity-acp`), `conversations/*.db` when that folder exists.
  Only the `steps.metadata`, `gen_metadata.data` and `trajectory_metadata_blob.data`
  protobuf blobs are read, through the same WAL-only read-only snapshot, and only
  their counters, model names and times are decoded. Antigravity stores each call
  up to three times (a step, a generation, and an identical retry copy), and T3
  Code's page adds all three; here identical counters within one conversation are
  one call (a side listing them twice counts twice), and the same conversation file
  name in several folders counts once. A step's model (the one asked for) names the
  call, then the generation's; calls with neither are `antigravity-unknown`,
  unpriced. `gemini-pro-agent`/`gemini-pro-default` price as Gemini 3.1 Pro unless
  T3's `usageModelAliases` says otherwise. Unreadable or non-WAL files are skipped
  with an `unreadable_history` note; symlinks are not followed. When Antigravity
  calls are found, T3's Antigravity turns are excluded (they would count the same
  use again); otherwise those turns remain the fallback.
- When OpenCode has completed metered messages, its combined history is
  authoritative and all T3 OpenCode turns are excluded. Each recorded T3 turn is
  reconciled against message tokens in its time window; mismatches warn about
  coverage rather than adding overlapping aggregate usage. If no OpenCode history
  is available, T3 per-turn usage supplies the fallback. T3 counters include cache
  reads/writes in input and reasoning in output. Only complete `main_agent` turns
  are accepted, and unreported subagent usage warns. Context-window `tokenUsage`
  snapshots are never used. Historical models come from the turn/attempt/run's
  captured `modelSelection.model`, never the provider session's mutable current
  model. Missing captured selection uses `unattributed` with unknown cost, even
  if a settings alias or rate tries to price it. Fallback Antigravity turns without
  telemetry are omitted with a warning, rather than priced as zero.
- `instances[].requestUnit` is `calls` for native per-call logs and verified Grok
  `modelCalls`, or `turns` for T3 aggregate fallback. A turn may contain many calls;
  its count must not enter API request comparisons or cost-per-request metrics.
  The summary lists calls and turns separately. `days[].r[3]` follows its instance
  unit; mixed-unit `hours[][2]` is activity, not an API call total.
- Encrypted `coverage[]` notes use fixed codes, source IDs, model indexes and
  counts: unpriced models, partial native history, unreadable Antigravity files,
  missing telemetry (including fallback Antigravity turns), unreported subagents, incomplete records, missing raw files,
  cache snapshot freshness, current standard rates and omitted tier premiums.
  A missing source may appear here even when it has no metered `sources[]` row.
  See the shared schema's “Additive fields (U1 round 3)” section.
- Projects come from raw Claude `cwd`, Codex's **first** session metadata `cwd`,
  Grok's URL-encoded session directory, and database project roots. Only their
  basenames survive. Using Claude `cwd` preserves names with dashes. No prompts,
  content, titles, raw paths, session IDs or authentication configuration are
  written to the payload, config, logs or repository. IDs used for joins/dedupe
  exist only in memory. An explicit serializer copies only schema fields;
  validation rejects accidental extras and private paths/home names. Schema,
  IANA timezone and provider/model IDs retain
  their required protocol slashes; all other strings reject path separators.
- Day/hour buckets use the Mac's IANA timezone, including DST. Sessions are
  distinct activity sessions, with distinct counts per active local day.

## Database consistency

Both live `~/.t3/userdata/statev2.sqlite` and
`~/.local/share/opencode/opencode.db` were checked read-only in Round 3 and report
WAL. The collector requires WAL and fails closed for rollback-journal sources.
It opens read-only with `query_only=ON`, starts a consistent read transaction,
fetches just the required metadata rows, then COMMITs and closes **before** JSON
processing, token normalization, deduplication, pricing or reconciliation.

In supported WAL mode the reader does not block T3's writer commits; it releases
its snapshot immediately after fetching, so processing cannot hold back
checkpoints. SQLite may use/create `-wal`/`-shm` coordination sidecars, so read-only
is a promise of no SQL/main-database mutations, not no filesystem coordination.
Concurrent synthetic writers and a post-read checkpoint are tested. See
[SQLite WAL concurrency and read-only databases](https://www.sqlite.org/wal.html).
No `immutable=1`, detached main-file copy, or live journal-mode changes are used.

## Pricing

Explicit provider-reported cost wins, including an explicit zero. OpenCode model
IDs retain their provider prefix so routes using provider cost do not collide
with cache models priced from list rates. Alias resolution precedes exact,
provider-prefixed and punctuation-normalized LiteLLM rate lookup. Prices are USD
per million tokens. Missing LiteLLM cache rates use the ordinary input price.

AA fallback matches the site's exact normalized family slug (Grok's `-build` is
removed). Cache reads use 0.1× input for Anthropic/OpenAI/Google/DeepSeek and 0.25×
for xAI; other labs use 1×. Cache writes use 1.25× for Anthropic, 1× otherwise.
These are estimates of ordinary caching discounts, not verified historical bills.
Explicit LiteLLM prices always take precedence. Costs use current standard list
rates across the historical range; fast/priority tiers, long-context surcharges,
Claude 1-hour cache premiums and subscription fees are not reconstructed.

Unknown models, including `codex-auto-review` unless an explicit alias/rate is
provided, keep their tokens and requests with `cost: null` and a warning. Its
underlying billed model is not specified by the raw logs, so no parent-model
price is invented. A grouped row/hour containing unknown cost stays null.

## Scheduling template

`com.cornishandy.aimf-usage.plist` is an **uninstalled** template. Replace
`__REPO_PATH__` and `__HOME__` with absolute paths. Its node and gh paths are pinned
as `/opt/homebrew/bin/node` and `/opt/homebrew/bin/gh` (`AIMF_USAGE_GH`); edit those
absolute paths if the executables live elsewhere. It uses an hourly StartInterval,
RunAtLoad, and only `--publish --quiet`. The log is
`~/Library/Logs/aimf-usage.log`. Umask 077 and the collector's startup permission
check keep it 0600. Before any separately authorized installation, prepare it:

```sh
mkdir -p "$HOME/Library/Logs"
touch "$HOME/Library/Logs/aimf-usage.log"
chmod 600 "$HOME/Library/Logs/aimf-usage.log"
```

Installing would authorize recurring encrypted uploads; authenticate gh locally
first. The collector does not install or schedule anything. The template never
runs `--link`, `--projects`, or `--out`. Logs contain aggregate counts and sanitized
errors, never the config or unlock link.

Optional future privacy choices: coarser hour buckets, decoy re-encryption on a
fixed schedule, or a passphrase layer around the random key. None is enabled.
