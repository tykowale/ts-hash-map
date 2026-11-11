# Benchmarks

Microbenchmarks for `HashMap`. Each one runs next to the native alternatives in the same process.
For structural keys the main comparison is a native `Map` keyed by `fast-json-stable-stringify(key)`,
because that is what people write when they don't use this library.

```bash
npm run bench                                   # every family, full sizes (about 5 minutes)
npm run bench -- --family int-keys,iteration    # some families only (npm run bench -- --list)
npm run bench -- --filter "get-hit n=1000$"     # only groups whose "family/group" id matches (regex)
npm run bench:smoke                             # tiny sizes, ~1 ms per case: checks every case runs
npm run bench:json                              # full run, also writes bench/results/latest.json
npm run bench -- --out bench/results/head.json  # pick the JSON path yourself
npm run bench -- --dist                         # benchmark the built dist/index.mjs (npm run build first)
npm run bench:compare -- base.json head.json    # compare two result files
npm run bench:branches -- --base origin/v2             # benchmark this checkout against another branch
npm run bench:memory                            # retained heap per entry and per small map
npm run bench -- --large                        # also the opt-in large tier (1M entries)
npm run bench:large                             # only the large tier
npm run bench -- --preset hill                  # the fixed hill-climbing subset (lib/presets.ts)
npm run bench:branches -- --base HEAD --preset hill --summary  # one accept/reject line
npm run bench:ratios -- bench/results/latest.json  # library rows, worst HashMap/baseline first
npm run bench:profile -- --workload user-record --n 1000 --op get-hit  # CPU profile + flame graph
```

Other flags: `--time <ms>` sets the minimum measured CPU time per case (default 250).
`--sizes 10,1000,1000000` replaces each family's default size list.
You can also run one family file directly:
`node --expose-gc --import tsx bench/scenarios/int-keys.ts --filter churn`.

## Layout

| Path                         | What it does                                                                                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run.ts`                     | Runs each family file in its **own Node process** and merges their JSON.                                                                                                           |
| `scenarios/int-keys.ts`      | Small ints (they hash to themselves), sparse int32s, floats (float hash path), strided ints (`id*1024`, `id*4+1`, ms timestamps).                                                  |
| `scenarios/string-keys.ts`   | 8-char strings, UUIDs, 100-char strings. Hashing cost grows with length.                                                                                                           |
| `scenarios/object-keys.ts`   | Flat 5-field records, Dates, a custom `hashFn`/`equalsFn` pair, four record shapes in one map, a 16-field record.                                                                  |
| `scenarios/array-keys.ts`    | `[x, y]` tuples.                                                                                                                                                                   |
| `scenarios/nested-keys.ts`   | Depth-3 objects with an array inside.                                                                                                                                              |
| `scenarios/mixed-keys.ts`    | One map holding ints, strings, records, tuples and Dates together.                                                                                                                 |
| `scenarios/polluted.ts`      | int, fresh UUID, record and tuple rows after the library has seen every key shape and a custom `hashFn`/`equalsFn` map in the same process.                                        |
| `scenarios/small-maps.ts`    | Whole small-map lifecycles (n = 1, 4, 16) and gets spread over 10k live 4-entry maps.                                                                                              |
| `scenarios/read-write.ts`    | A Zipf upsert counter and a 90/10 get/set mix at a steady size.                                                                                                                    |
| `scenarios/iteration.ts`     | `for..of`, `keys()`/`values()`, `forEach`, `keys().toArray()`, iteration after deletes, and record/tuple keys.                                                                     |
| `scenarios/construction.ts`  | `new HashMap(entries)`, clear + refill, a loadFactor sweep, growing from capacity 1, a single resize.                                                                              |
| `scenarios/adversarial.ts`   | Hash collisions built from this library's own hash function.                                                                                                                       |
| `scenarios/hash-equals.ts`   | `getHashCode` and `isEqual` on their own, for each key shape.                                                                                                                      |
| `scenarios/large.ts`         | Opt-in (`--large`): int, UUID and tuple keys at 1M entries, records at 100k.                                                                                                       |
| `memory.ts`                  | Retained bytes per entry, and per map for 0-16-entry maps.                                                                                                                         |
| `compare.ts` / `branches.ts` | Compare results, or compare branches.                                                                                                                                              |
| `ratios.ts`                  | Ranks library rows of a result file by HashMap/baseline ratio, worst first.                                                                                                        |
| `profile/`                   | CPU profiler: HashMap-only workloads (`workloads.ts`), the profiled process (`driver.ts`), the profile reader (`cpuprofile.ts`), the CLI (`run.ts`).                               |
| `lib/`                       | Seeded key generators (`keys.ts`), the mitata wrapper (`harness.ts`), the op matrix (`scenarios.ts`), statistics (`stats.ts`), output (`report.ts`), named subsets (`presets.ts`). |

## Methodology

**Harness.** The suite uses [mitata](https://github.com/evanwashere/mitata) 1.0.34, pinned, through
its `measure()` API. mitata handles warmup, chooses how many samples to take, batches fast
calls, can run a GC before every sample, and tracks heap use. It also provides `do_not_optimize`.
mitata reports percentiles but not confidence intervals, so `lib/stats.ts` computes those itself.
tinybench is the fallback if mitata stops being maintained, or if we adopt CodSpeed (see below).

**What a timed call does.** Every timed body runs a loop over a key array prepared beforehand.
Lookups do 1024 per call, churn does 512 delete+insert pairs per call, and a build does all n
keys. Results are reported **per op**. No timed body builds inputs, except where building the key is
the baseline being measured (stringify, `${x},${y}`), and every body returns a checksum that goes into `do_not_optimize`, so V8 can't remove the work as
unused. Lookups move a cursor through a precomputed probe array that is at least n long. That
means a 100k-entry map is probed across the whole table, not with the same 1024 cache-hot keys.

**Verification.** Before and after each case is measured, the harness makes one untimed call and
checks what it returns: the hit count for gets (1024, 512 or 0), the final size for set, update
and churn (n), the number of deletes for delete-all (n), and 0 for clear. If a check fails, or
mitata's rule says the case was probably optimized away (average < 1.42x a no-op), the run exits
non-zero. A broken benchmark therefore fails instead of reporting a fast, meaningless number.
Smoke mode runs these checks too, so CI tests whether the benchmarks are _correct_, not just
whether they compile.

**Structural keys use equal clones.** `isEqual` returns early on `===`, so a lookup with the very
object you inserted skips the deep comparison. Structural HashMap rows look up with clones; only the rows labelled
same reference/identity use inserted references. Lookup and delete keys are `structuredClone`
copies made before timing starts. The "HashMap (same reference)" row shows how big that gap is.

**Baselines in each group**:

- `Map`: the same primitive keys. For primitive keys this is the baseline.
- `Map + stable-stringify`: calls `stringify(key)` inside the timed region on every set, get and
  delete. This is the baseline for structural keys, because it is what users would do otherwise.
- `Map (precomputed …)` / `Map (by id)`: a floor where the key string is built outside timing.
- `Map (identity)`: object references as keys. This is a lower bound, _not semantically
  equivalent_, because an equal clone would miss.
- `HashMap (custom hash/eq on id)`: shows how much faster a cheap `hashFn`/`equalsFn` pair is.

**String keys: same instance vs fresh strings.** V8 caches a string's hash inside the string the
first time it is hashed, and `Map` compares two references to one string by pointer. The
`Map (same instance)` / `HashMap (same instance)` rows reuse the inserted string instances for
every get and set, so in the timed region `Map` never hashes or compares a key's contents, while
HashMap runs its O(length) hash loop on every op. That is the best case for `Map`: there HashMap
is several times slower (about 6x on UUID gets), and more for long strings. The `<label>-fresh`
groups (`uuid-fresh`, `string-8-fresh`, `string-100-fresh`) instead give each timed call flat
copies of its keys, made in untimed setup, like keys that arrive from `JSON.parse`, the network
or a database. `Map` then has to hash each key and compare it by content, and HashMap is
roughly as fast or faster (about 0.5x-0.9x of `Map` on gets in our runs). Which row applies
depends on whether your code reuses the string instances it inserted.

**Processes and JIT.** `getHashCode` and `isEqual` branch on the key's type. If int, string and
object keys all ran in one process, those call sites would turn megamorphic, and whichever family
ran first would affect the rest. So `run.ts` starts a new `node --expose-gc --import tsx` process
for each family. `mixed-keys` puts several types in one map on purpose. Inside a process, the
timed loops are written out separately for HashMap, Map and Map + key function. That keeps one
implementation's type feedback from slowing another's call site. We don't force optimization;
the target is steady-state TurboFan code after mitata's warmup. Construction and resize costs
have their own groups, so they never leak into lookup numbers.

**GC.** Each case starts with a full GC (mitata's default `once` mode) and runs on a process
started with `--expose-gc`. We tried mitata's inner GC, which runs a full GC before _every_ sample,
and turned it off. On Node 24 it made allocation-heavy builds bimodal and 2-4x slower than in
steady state. On large structural heaps the GC time also used up the time budget, leaving only
10-40 samples with RME above 10%. Without it, RME drops below 1% for the same cases. Garbage from
the timed loop is collected by ordinary scavenges, and GC pauses that land in a sample show up in
**p99**, which is printed next to the median. Insert and construction rows show heap bytes
allocated per op. `CaseOptions.gcInner` still exists if one case needs it.

**Determinism.** All inputs come from a seeded mulberry32 PRNG (`lib/keys.ts`), keyed by
scenario label and size. Two runs measure exactly the same keys in exactly the same order.

### Workload matrix

| Dimension     | Values                                                                                                                                                                                                                                                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sizes         | Primitive keys 10 / 1k / 100k. Structural keys 10 / 1k / 10k. Adversarial 64 / 512 / 4096. Small maps 1 / 4 / 16. Polluted 10 / 1k. Read/write and structural iteration 1k. Large tier 1M (records 100k). Smoke uses 10 / 100.                                                                                                      |
| Operations    | get at 100% hit (random order and insertion order), 0% hit, 50% hit; has at 50% hit; set n keys into a new map, with the default capacity and presized; update existing keys; steady-state churn (delete one, insert one, size stays n); delete all; clear; a whole small-map lifecycle; a Zipf upsert counter; a 90/10 get/set mix |
| Key types     | small / sparse / strided ints, ms timestamps, floats, 8 and 100 char strings, UUIDs, 5-field records, four record shapes in one map, 16-field records, `[x, y]` tuples, depth-3 nested objects, Dates, mixed                                                                                                                        |
| Hash/equality | the above plus bigint, 32-prop records, 100-element arrays, a Set of 10 objects, a cyclic object, records with properties in reordered order                                                                                                                                                                                        |

`set-fresh` vs `set-presized` shows what resizing costs. The presized map gets
`capacity: ceil(n / loadFactor)`, so it never resizes.

**Feedback pollution (`polluted`).** Every other family runs one key type per process, so
`getHashCode`, `isEqual` and the `HashMap` methods only ever see one shape and V8 specialises them
for it. That flatters `typeof` and prototype fast paths. `polluted.ts` first builds HashMaps over
every key shape the suite generates (ints, floats, strings, UUIDs, records of several shapes,
tuples, nested objects, Dates, mixed, bigints) plus one map with a custom `hashFn`/`equalsFn`, and
runs set, get, has, delete and iteration on each, enough rounds for V8 to optimise the library
with that feedback. The warmup checks its own answers. The measured groups then use the same
labels, seeds and baselines as the single-type families (`polluted/int get-hit n=1000` measures the
same keys as `int-keys/int get-hit n=1000`), so the two rows side by side show what pollution
costs. A change that wins only on the monomorphic row is not a win.

**Small maps (`small-maps`).** `<key> lifecycle n=<n>` times a whole short-lived map: `new HashMap()`,
n sets, n hits, ceil(n/2) misses, then the map is dropped; op = one lifecycle, and the result
check counts the hits and misses. This is where constructor cost (capacity normalisation, the
initial table) shows; n=16 includes the default table's one resize at 13 entries.
`<key> get-hit 10000 maps x 4` keeps 10k 4-entry maps alive and spreads gets at random across
them. `bench:memory` has the matching bytes-per-map table.

**Strided ints.** Int32 keys hash to themselves and the bucket is `hash & (capacity - 1)`, so
the dense `int` keys (0..n-1) map one to one onto buckets. `strided-int` (`id * 1024`) has ten
zero low bits and lands in a handful of buckets; `tagged-int` (`id * 4 + 1`) leaves three
quarters of the buckets empty; `timestamp-ms` (above 2^31) takes the float hash path. These rows
decide whether the hash needs a spread step.

**Read/write mixes (`read-write`).** `upsert zipf` is the counter pattern
`m.set(k, (m.get(k) ?? 0) + 1)` over a seeded Zipf (s = 1) stream, a double lookup of the same key;
`get90-set10` is 922 gets and 102 sets on existing keys per 1024-op call. Both start from a map
holding every key, so the size stays n and every get hits. Tuple lookups use equal clones; the
stringify baseline computes the key string once per upsert.

**Shape variety.** `object-keys/record-shapes` puts four record shapes (with optional fields) into
one map and `object-keys/record-16` uses one 16-field shape, so a record fast path cannot rely on
one hidden class or on five fields. They run after the single-shape groups, so they don't change
those groups' feedback.

**Structural iteration.** `iteration/user-record …` and `iteration/tuple …` walk n=1k maps with
object keys (`for..of` entries, `keys()`, `values()`) against a native Map holding the same key
objects. They run after the int groups.

**Large tier (`large`, opt-in).** int, fresh UUID and tuple keys at 1M entries (get-hit,
set-fresh, churn; UUID churn uses the inserted instances, because fresh copies only apply to
lookups and set-fresh) and user records at 100k. It needs a few minutes and a few GB of heap, so
`npm run bench` skips it; `--large` adds it, `npm run bench:large` runs it alone, and smoke mode
always includes it at smoke sizes so CI checks it. `bench:memory -- --large` adds 1M entries to
the memory table. Use it in the guard tier, not for every screen.

### Adversarial

These cases document collision behaviour and catch regressions in chain handling. They don't
compare against Map; each group's baseline is HashMap with well-spread keys of the same type.

- **Colliding ints, `i << 16`.** Ints hash to themselves and the bucket is `hash & (capacity - 1)`,
  so every key sits in bucket 0 until capacity passes 2^16.
- **`Aa`/`BB` strings.** The string hash is `h * 31 + c`, and `"Aa"` and `"BB"` hash the same, so
  every string made by joining k of those blocks shares one hash.
- **`hashFn: () => 0`.** The worst case a custom hash function can cause.
- **`loadFactor: 8`.** Chains average about 8 nodes.

Each group header prints the capacity, the number of buckets in use and the longest chain. The
scaling table at the end of the family shows per-op growth between sizes. About 1x per step means
O(1) per op. About 8x per step (64 → 512 → 4096) means a linear chain.

### Memory

`npm run bench:memory` builds one map per process (5 processes per cell; the median is reported).
It measures `heapUsed` after two `gc()` calls before and after the build. Keys are created inside
the measured window, so whatever the map keeps alive counts, keys included. A second column
measures again after half the entries are deleted. The table never shrinks, so bytes per _live_
entry go up.

The small-maps table holds 10k live maps of 0, 1, 2, 4, 8, 12, 13 and 16 int entries per process
(int keys and values cost no heap) and reports retained bytes per map, for `Map` and `HashMap`.
The empty row is the constructor's fixed cost, and 12 vs 13 shows the default table's first
resize. `--small-maps off` skips it and `--small-maps only` prints only it.

## Reading the output

```
• object-keys/user-record get-hit n=1000
  get, 100% hit, random order
                                    median/op    ±95%        p75        p99  samples  vs Map + stable-stringify
  Map + stable-stringify             697.3 ns    0.1%   700.7 ns   767.3 ns      344  baseline
  HashMap (equal clone)              289.1 ns    0.1%   291.9 ns   318.0 ns      838  0.41x
  HashMap (same reference)           160.8 ns    0.2%   162.8 ns   189.1 ns     1504  0.23x      skips isEqual via ===
  HashMap (custom hash/eq on id)      11.3 ns    0.6%    11.8 ns    13.9 ns      325  0.016x
  Map (identity)                      3.80 ns    2.0%    4.06 ns    4.33 ns      984  0.0054x    reference keys, not semantically equivalent
```

(Excerpt from an Apple M5 on Node 24.15. Your numbers will differ; the ratios are what
carry over.)

- **median/op** is the main number: the median sample divided by ops per call. Means are not
  used, and neither are ops/sec figures computed from total time.
- **±95%** is the relative margin of error of the median, from a distribution-free
  order-statistic CI over mitata's samples. A row is flagged `noisy` when it is above 5%; re-run it
  or raise `--time`.
- **vs …** is this row's median divided by the group baseline's median, from the same process
  and run. This ratio cancels most machine and thermal effects, and it is the number to quote.
  Below 1 means faster than the baseline.
- **heap/op** is mitata's allocation estimate per op, shown for insert and construction rows.

JSON (`--out`) holds the git SHA, Node, V8 and CPU details, the config, and for each case:
median, CI, RME, p75, p99, avg, min, max, sample count, heap per op, the ratio to the baseline,
and 200 quantiles of the per-op samples. mitata's generated `debug` source is left out.

## Comparing branches

```bash
npm run bench:branches -- --base origin/v2 --runs 3 --family int-keys,object-keys
```

1. Checks out `--base` (default `origin/v2`, falling back to `v2`) as a detached git worktree at `../ts-hash-map-bench-base`.
   It needs no `npm ci`, because the library has no runtime dependencies and the scenarios import
   the target's `src/` directly. `--dist` installs and builds both sides first.
2. Runs **this checkout's scenarios** against base, head, base, head, … (`--runs` times each),
   each run in new processes. Both sides use the same benchmark code, so a change to the
   benchmarks can't show up as a library change. Alternating spreads thermal and background drift
   evenly between the two sides.
3. Calls `compare.ts`, which compares the two sides run by run. Separate processes drift (CPU
   clocks, JIT decisions, memory layout), and that drift moves every row of a run, the native
   `Map` rows included. A case is `SLOWER` or `faster` only when the whole 95% CI of its change
   is beyond ±5% (`--threshold`). Cases where either side has an RME above 5% are marked `noisy`
   and not judged. So:
   - A row with an in-process baseline (HashMap vs Map) is judged on its **HashMap/baseline
     ratio**. Each side's value is the geometric mean over its runs of
     median(row) / median(baseline), both from the same process, and the change is head / base.
     The CI is a **joint two-level bootstrap** (2000 resamples, `lib/stats.ts`): runs are
     resampled, then within each drawn run the row's samples and its baseline's samples are
     resampled together, and the ratio of ratios is taken per replicate. The interval therefore
     includes the baseline's own noise and the spread between processes. With 2+ runs per side,
     every head run's ratio must also be beyond every base run's ratio, otherwise it is
     `overlap`. The row shows both ratios, for example `vs Map: 0.81x -> 0.95x`.
   - Baseline rows (native `Map`, stringify) never get a `SLOWER`/`faster` verdict, because that
     code is the same on both branches. A baseline that moved beyond the threshold is printed as
     `drift`, and so is every row judged against it: re-run, or add more alternations.
   - Rows in a group without a baseline are judged on raw medians, with the same `overlap` rule
     on per-run medians.

**Calibrate first with an A/A run.** Compare the branch with itself
(`npm run bench:branches -- --base HEAD --runs 3`, which benchmarks the last commit's library
code on both sides, or two `--out` runs of the same checkout). Any
`SLOWER`/`faster`/`drift` there is pure noise and tells you how much process-to-process drift your
machine has. If an A/A run flags cases, raise `--threshold` above that level before trusting an
A/B result.

**`--summary`** (on `bench:compare` and `bench:branches`) adds one objective for hill climbing:
the geometric mean over every library row with a baseline of the per-row change in
HashMap/baseline ratio (head vs base), with a bootstrap 95% CI, the worst single row, and a
verdict line:

- `FAIL`: the geomean CI lies entirely above 0, or some row is `SLOWER` (runs agree) by more than
  `--max-regression` (default 3%).
- `PASS`: not `FAIL`, and the geomean improved by at least `--accept` (default 2%) with its CI
  entirely below 0.
- `INCONCLUSIVE`: otherwise. Re-run with more `--runs`; don't accept on it.

### Hill climbing

`--preset hill` (`lib/presets.ts`) is a fixed subset of 38 groups across key types, with
`--time 150`: about 35 s on an Apple M5, so a 3-run `bench:branches` confirm takes about 4 minutes. Besides the core get/set/churn rows it holds
`int clear`, `date` and `string-100` gets, small-map lifecycles at n = 4 and 16 (int, user-record),
the polluted int and user-record gets, the upsert and 90/10 rows (int, tuple) and strided-int
get-hit at n=100k. It sets the families, the filter and the time (an
explicit `--time` still wins) and cannot be combined with `--family`/`--filter`. Only compare a
preset run with another run of the same preset: JIT feedback carries over between groups inside
a family process, so a subset is not comparable with a full run. To grow the subset, append a
`family/group` regex to the preset's `groups`; its family is added automatically.

```bash
npm run bench:branches -- --base HEAD --runs 3 --preset hill         # A/A once: calibrate noise
npm run bench:profile -- --workload int --n 1000 --op get-hit --no-inline  # 1. find the hot frame
npm run bench -- --preset hill --out bench/results/try.json          # 2. quick screen
npm run bench:branches -- --base HEAD --runs 3 --threshold 2 --preset hill --summary  # 3. confirm
```

Accept a change on `PASS` (plus the target row `faster` with runs agreeing, and `npm test`
passing), and re-profile the workload to check the frame shrank.

To do it by hand, run `npm run bench -- --root ../other-checkout --out base.json` and
`npm run bench -- --out head.json`, then `npm run bench:compare -- base.json head.json`. Pass
`--base a.json,b.json --head c.json,d.json` to merge several runs per side.

Tips for numbers you can trust:

- Plug in power and close heavy apps (browsers, IDE indexers, video calls).
- macOS can't pin cores. On Linux, use `taskset -c 2` and the `performance` CPU governor.
- Never benchmark under `vitest --coverage`, `--inspect` or a debugger.
- Record the Node version (the JSON does this). V8 upgrades move the numbers, so only compare runs
  made on the same Node version.

## Profiling

`bench:profile` CPU-profiles HashMap alone (no native baselines, no mitata) on the same keys the
scenarios use: workloads are named after the scenario labels (`int`, `uuid-fresh`, `user-record`,
`tuple`, `mixed`, …), built with the same `lib/keys.ts` generators and seeds, and ops reuse the
scenario op names (`get-hit`, `get-miss`, `set-fresh`, `churn`, `delete-all`, `clear`,
`for-of`, …). `--list` prints them all.

```bash
npm run bench:profile -- --workload user-record --n 1000 --op get-hit
npm run bench:profile -- --workload tuple --n 1000 --op churn --seconds 5 --no-inline
npm run bench:profile -- --workload int --n 100000 --op get-hit --dist        # the built dist/
npm run bench:profile -- --matrix --workloads int,user-record --ops get-hit,churn
npm run bench:profile:smoke                                                   # what CI runs
```

Each run is its own `node --cpu-prof` process (sampling every 250 µs, `--interval`). Like a bench
case, a workload is split into untimed setup and a timed loop, and its checksum is verified
before and after timing. The timed loop runs inside a function named `TIMED_ROOT` and per-call
setup inside `UNTIMED_SETUP`, so the reader keeps only timed work (plus GC and `(program)`
samples between the first and last timed sample). It writes to `bench/results/profiles/`
(gitignored):

- `<workload>_<n>_<op>.cpuprofile`: open it in Chrome DevTools or speedscope.
- `<workload>_<n>_<op>.txt`: ns/op, GC share, and the top self-time and total-time frames
  (`--top`, default 25), with source lines from this repo's `.ts` files.
- `<workload>_<n>_<op>.svg`: a flame graph of the timed work; hover a box for its share.

`--no-inline` runs with `--no-turbo-inlining`, so hot callees keep their own frames (slower
overall, but self time lands on the function that owns it). `--trace-deopt` also saves V8's
opt/deopt log, `--node-flag` passes any other flag, and `--root <dir>` profiles another
checkout. `--matrix` profiles workloads x scenario sizes x ops (default: the core ops everywhere,
plus iteration and construction ops on `int` and `user-record`; `--workloads`, `--ops`,
`--sizes` narrow it) into a dated folder with `summary.md` and `results.jsonl`.

`bench:ratios` ranks the library rows of a result file by HashMap/baseline ratio, worst first,
as a Markdown table (`--filter`, `--top`; `--all` includes adversarial groups whose baseline is
HashMap itself). It is a quick way to pick hill-climbing targets.

## CI

CI runs `npm run bench:smoke` (which includes the opt-in large tier at smoke sizes) and `npm run bench:profile:smoke` on Node 22 and 24 and uploads the
smoke JSON as an artifact for reference. The profile smoke verifies every workload x op at tiny
sizes in-process, then profiles two short runs end to end. The job fails when a case throws, fails its result check, or looks optimized out. It
**never** fails because of timings. GitHub-hosted runners are shared VMs with no guaranteed CPU,
and wall-clock numbers there are too noisy to gate on. If gating is ever wanted, the realistic
option is CodSpeed's CPU simulation mode, which counts instructions deterministically and is free
for open source. It supports tinybench, vitest bench and benchmark.js but not mitata, so the
scenarios would need porting. Treat it as an aid, not the final word.
