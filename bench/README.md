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
npm run bench:memory                            # retained heap per entry (separate processes)
```

Other flags: `--time <ms>` sets the minimum measured CPU time per case (default 250).
`--sizes 10,1000,1000000` replaces each family's default size list.
You can also run one family file directly:
`node --expose-gc --import tsx bench/scenarios/int-keys.ts --filter churn`.

## Layout

| Path                         | What it does                                                                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run.ts`                     | Runs each family file in its **own Node process** and merges their JSON.                                                                             |
| `scenarios/int-keys.ts`      | Small ints (they hash to themselves), sparse int32s, floats (float hash path).                                                                       |
| `scenarios/string-keys.ts`   | 8-char strings, UUIDs, 100-char strings. Hashing cost grows with length.                                                                             |
| `scenarios/object-keys.ts`   | Flat 5-field records, Dates, a custom `hashFn`/`equalsFn` pair.                                                                                      |
| `scenarios/array-keys.ts`    | `[x, y]` tuples.                                                                                                                                     |
| `scenarios/nested-keys.ts`   | Depth-3 objects with an array inside.                                                                                                                |
| `scenarios/mixed-keys.ts`    | One map holding ints, strings, records, tuples and Dates together.                                                                                   |
| `scenarios/iteration.ts`     | `for..of`, `keys()`/`values()`, `forEach`, `keys().toArray()`, plus iteration after deletes.                                                         |
| `scenarios/construction.ts`  | `new HashMap(entries)`, clear + refill, a loadFactor sweep, growing from capacity 1, a single resize.                                                |
| `scenarios/adversarial.ts`   | Hash collisions built from this library's own hash function.                                                                                         |
| `scenarios/hash-equals.ts`   | `getHashCode` and `isEqual` on their own, for each key shape.                                                                                        |
| `memory.ts`                  | Retained bytes per entry.                                                                                                                            |
| `compare.ts` / `branches.ts` | Compare results, or compare branches.                                                                                                                |
| `lib/`                       | Seeded key generators (`keys.ts`), the mitata wrapper (`harness.ts`), the op matrix (`scenarios.ts`), statistics (`stats.ts`), output (`report.ts`). |

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

| Dimension     | Values                                                                                                                                                                                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sizes         | Primitive keys 10 / 1k / 100k. Structural keys 10 / 1k / 10k. Adversarial 64 / 512 / 4096. Smoke uses 10 / 100.                                                                                                                                            |
| Operations    | get at 100% hit (random order and insertion order), 0% hit, 50% hit; has at 50% hit; set n keys into a new map, with the default capacity and presized; update existing keys; steady-state churn (delete one, insert one, size stays n); delete all; clear |
| Key types     | small / sparse ints, floats, 8 and 100 char strings, UUIDs, 5-field records, `[x, y]` tuples, depth-3 nested objects, Dates, mixed                                                                                                                         |
| Hash/equality | the above plus bigint, 32-prop records, 100-element arrays, a Set of 10 objects, a cyclic object, records with properties in reordered order                                                                                                               |

`set-fresh` vs `set-presized` shows what resizing costs. The presized map gets
`capacity: ceil(n / loadFactor)`, so it never resizes.

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
3. Calls `compare.ts`, which merges each side's samples per case and prints the head/base ratio of
   medians with a bootstrap 95% CI (2000 resamples). A case is `SLOWER` or `faster` only when the
   whole CI is beyond ±5% (`--threshold`). Cases where either side has an RME above 5% are marked
   `noisy` and not judged. That CI covers noise _within_ runs, not variation between processes
   (CPU clocks, JIT decisions, memory layout), and that drift moves every row of a run, the
   native `Map` rows included. So:
   - A row with an in-process baseline (HashMap vs Map) is judged on its **HashMap/baseline
     ratio**: the raw CI is divided by how far the baseline moved. With 2+ runs per side, every
     head run's ratio must also be beyond every base run's ratio, otherwise it is `overlap`. The
     row shows both ratios, for example `vs Map: 0.81x -> 0.95x`.
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

To do it by hand, run `npm run bench -- --root ../other-checkout --out base.json` and
`npm run bench -- --out head.json`, then `npm run bench:compare -- base.json head.json`. Pass
`--base a.json,b.json --head c.json,d.json` to merge several runs per side.

Tips for numbers you can trust:

- Plug in power and close heavy apps (browsers, IDE indexers, video calls).
- macOS can't pin cores. On Linux, use `taskset -c 2` and the `performance` CPU governor.
- Never benchmark under `vitest --coverage`, `--inspect` or a debugger.
- Record the Node version (the JSON does this). V8 upgrades move the numbers, so only compare runs
  made on the same Node version.

## CI

CI runs `npm run bench:smoke` on Node 22 and 24 and uploads the JSON as an artifact for
reference. The job fails when a case throws, fails its result check, or looks optimized out. It
**never** fails because of timings. GitHub-hosted runners are shared VMs with no guaranteed CPU,
and wall-clock numbers there are too noisy to gate on. If gating is ever wanted, the realistic
option is CodSpeed's CPU simulation mode, which counts instructions deterministically and is free
for open source. It supports tinybench, vitest bench and benchmark.js but not mitata, so the
scenarios would need porting. Treat it as an aid, not the final word.
