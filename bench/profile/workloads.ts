/**
 * HashMap-only workloads for the CPU profiler (no native baselines, no mitata). Workload names,
 * key generators, seeds and sizes are the scenario families' own, so a profile of
 * `user-record n=1000 get-hit` profiles the same keys as the `object-keys/user-record get-hit
 * n=1000` group.
 *
 * Every op is split like a bench case: untimed `prepare` (once) and `setup` (before every call,
 * e.g. building the map that `clear` or `delete-all` empties), and a timed `run` that returns a
 * checksum. The checksum is checked against `expect` before and after the timed loop, so a broken
 * workload fails instead of profiling nothing.
 *
 * `runTimed` runs the calls inside a function named TIMED_ROOT and the setups inside one named
 * UNTIMED_SETUP, so the profile reader (cpuprofile.ts) can keep exactly the timed work.
 */
import { PRIMITIVE_SIZES, STRUCTURAL_SIZES } from '../lib/config.ts';
import {
  clone,
  dates,
  flat,
  floats,
  mixed,
  nested,
  rngFor,
  shapedRecords,
  shuffle,
  smallInts,
  sparseInts,
  stridedInts,
  strings,
  taggedInts,
  timestampsMs,
  tuples,
  users,
  uuids,
  wideRecords,
  type KeySet,
  type Rng,
} from '../lib/keys.ts';
import { CHURN_PAIRS, LOOKUPS, probeIndices, repsFor } from '../lib/scenarios.ts';
import { doNotOptimize } from '../lib/sink.ts';
import { HashMap } from '../lib/target.ts';

type HM = HashMap<unknown, number>;

export interface Workload {
  generate: (n: number, rng: Rng) => KeySet<unknown>;
  /**
   * How lookups and deletes see a key: `clone` (structurally equal copies, the real use), `same`
   * (the inserted instances), or `fresh` (flat string copies made in untimed setup before every
   * call, like keys from JSON.parse or the network).
   */
  lookup: 'clone' | 'same' | 'fresh';
  /** The scenario family's default sizes. */
  sizes: number[];
}

const primitive = (
  generate: Workload['generate'],
  lookup: 'same' | 'fresh' = 'same',
): Workload => ({ generate, lookup, sizes: PRIMITIVE_SIZES });
const structural = (generate: Workload['generate']): Workload => ({
  generate,
  lookup: 'clone',
  sizes: STRUCTURAL_SIZES,
});

const string8 = (n: number, rng: Rng) => strings(n, rng, 8);
const string100 = (n: number, rng: Rng) => strings(n, rng, 100);

/** Named after the scenario labels (the first word of each group name). */
export const WORKLOADS: Record<string, Workload> = {
  int: primitive(smallInts),
  'sparse-int': primitive(sparseInts),
  float: primitive(floats),
  'strided-int': primitive(stridedInts),
  'tagged-int': primitive(taggedInts),
  'timestamp-ms': primitive(timestampsMs),
  'string-8': primitive(string8),
  uuid: primitive(uuids),
  'string-100': primitive(string100),
  'string-8-fresh': primitive(string8, 'fresh'),
  'uuid-fresh': primitive(uuids, 'fresh'),
  'string-100-fresh': primitive(string100, 'fresh'),
  'user-record': structural(users),
  date: structural(dates),
  'record-shapes': structural(shapedRecords),
  'record-16': structural(wideRecords),
  tuple: structural(tuples),
  nested: structural(nested),
  mixed: structural(mixed),
};

/** Lookup ops share the scenario op names; the rest name the iteration/construction groups. */
export const LOOKUP_OPS = ['get-hit', 'get-hit-seq', 'get-miss', 'get-50', 'has-50'] as const;
export const OPS = [
  ...LOOKUP_OPS,
  'update',
  'set-fresh',
  'set-presized',
  'churn',
  'delete-all',
  'clear',
  'clear-refill',
  'from-entries',
  'grow-from-1',
  'for-of',
  'for-of-after-delete',
  'keys-values',
  'for-each',
] as const;
export type ProfileOp = (typeof OPS)[number];

export function isOp(op: string): op is ProfileOp {
  return (OPS as readonly string[]).includes(op);
}

/** One op on one dataset, split into untimed and timed parts like a bench case. */
interface Plan {
  /** Logical operations per call. */
  ops: number;
  /** Expected checksum of every call. */
  expect: number;
  setup?: () => unknown;
  run: (state: unknown) => number;
}

const LOOKUP_SPEC: Record<
  (typeof LOOKUP_OPS)[number],
  { rate: number; order: 'random' | 'insertion'; has: boolean }
> = {
  'get-hit': { rate: 1, order: 'random', has: false },
  'get-hit-seq': { rate: 1, order: 'insertion', has: false },
  'get-miss': { rate: 0, order: 'random', has: false },
  'get-50': { rate: 0.5, order: 'random', has: false },
  'has-50': { rate: 0.5, order: 'random', has: true },
};

function build(keys: unknown[], options: { capacity?: number } = {}): HM {
  const m = new HashMap<unknown, number>(options);
  for (let i = 0; i < keys.length; i++) {
    m.set(keys[i], i);
  }
  return m;
}

const freshCopy = (k: unknown): unknown => flat(k as string);

/** Sum of 0..n-1, the checksum of iterating values 0..n-1. */
const triangle = (n: number): number => (n * (n - 1)) / 2;

function plan(w: Workload, op: ProfileOp, n: number, rng: Rng): Plan {
  const set = w.generate(n, rng);
  const { keys } = set;
  const keyAt = (i: number): unknown => (i < n ? keys[i] : set.misses[i - n]);
  const lookupForm = (k: unknown): unknown => (w.lookup === 'clone' ? clone(k) : k);
  const reps = repsFor(n);

  if (op in LOOKUP_SPEC) {
    const spec = LOOKUP_SPEC[op as keyof typeof LOOKUP_SPEC];
    const probe = Array.from(probeIndices(n, spec.rate, spec.order, rng), (i) =>
      lookupForm(keyAt(i)),
    );
    const m = build(keys);
    const expect = Math.round(LOOKUPS * spec.rate);
    let cur = 0;
    const len = probe.length; // a whole number of LOOKUPS windows
    if (w.lookup === 'fresh') {
      return {
        ops: LOOKUPS,
        expect,
        setup: () => {
          const out = new Array<unknown>(LOOKUPS);
          for (let i = 0; i < LOOKUPS; i++) {
            out[i] = freshCopy(probe[cur]);
            if (++cur === len) {
              cur = 0;
            }
          }
          return out;
        },
        run: spec.has
          ? (state) => {
              const p = state as unknown[];
              let hits = 0;
              for (let i = 0; i < p.length; i++) {
                if (m.has(p[i])) {
                  hits++;
                }
              }
              return hits;
            }
          : (state) => {
              const p = state as unknown[];
              let hits = 0;
              for (let i = 0; i < p.length; i++) {
                if (m.get(p[i]) !== undefined) {
                  hits++;
                }
              }
              return hits;
            },
      };
    }
    return {
      ops: LOOKUPS,
      expect,
      run: spec.has
        ? () => {
            let hits = 0;
            for (let i = 0; i < LOOKUPS; i++) {
              if (m.has(probe[cur])) {
                hits++;
              }
              if (++cur === len) {
                cur = 0;
              }
            }
            return hits;
          }
        : () => {
            let hits = 0;
            for (let i = 0; i < LOOKUPS; i++) {
              if (m.get(probe[cur]) !== undefined) {
                hits++;
              }
              if (++cur === len) {
                cur = 0;
              }
            }
            return hits;
          },
    };
  }

  switch (op) {
    case 'update': {
      const probe = Array.from(probeIndices(n, 1, 'random', rng), (i) => lookupForm(keyAt(i)));
      const m = build(keys);
      let cur = 0;
      return {
        ops: LOOKUPS,
        expect: n,
        run: () => {
          for (let i = 0; i < LOOKUPS; i++) {
            m.set(probe[cur], i);
            if (++cur === probe.length) {
              cur = 0;
            }
          }
          return m.size;
        },
      };
    }
    case 'set-fresh':
    case 'set-presized':
    case 'grow-from-1': {
      const options =
        op === 'set-presized'
          ? { capacity: Math.ceil(n / 0.75) }
          : op === 'grow-from-1'
            ? { capacity: 1 }
            : {};
      const fill = (batches: unknown[][]): number => {
        let total = 0;
        for (const ks of batches) {
          total += build(ks, options).size;
        }
        return total;
      };
      if (w.lookup === 'fresh' && op === 'set-fresh') {
        return {
          ops: reps * n,
          expect: reps * n,
          setup: () => Array.from({ length: reps }, () => keys.map(freshCopy)),
          run: (state) => fill(state as unknown[][]),
        };
      }
      const batches = Array.from({ length: reps }, () => keys);
      return { ops: reps * n, expect: reps * n, run: () => fill(batches) };
    }
    case 'from-entries': {
      const entries = keys.map((k, i): [unknown, number] => [k, i]);
      return {
        ops: reps * n,
        expect: reps * n,
        run: () => {
          let total = 0;
          for (let r = 0; r < reps; r++) {
            total += new HashMap<unknown, number>(entries).size;
          }
          return total;
        },
      };
    }
    case 'churn': {
      // A pool of 2n keys; the live window [h, h + n) slides forward one key per pair.
      const pool = [...keys, ...set.misses];
      const del = pool.map(lookupForm);
      const m = build(keys);
      let h = 0;
      return {
        ops: CHURN_PAIRS,
        expect: n,
        run: () => {
          for (let i = 0; i < CHURN_PAIRS; i++) {
            m.delete(del[h]);
            let j = h + n;
            if (j >= pool.length) {
              j -= pool.length;
            }
            m.set(pool[j], j);
            if (++h === pool.length) {
              h = 0;
            }
          }
          return m.size;
        },
      };
    }
    case 'delete-all': {
      const del = shuffle(
        rng,
        Array.from({ length: n }, (_, i) => i),
      ).map((i) => lookupForm(keys[i]));
      return {
        ops: reps * n,
        expect: reps * n,
        setup: () => Array.from({ length: reps }, () => build(keys)),
        run: (state) => {
          let deleted = 0;
          for (const m of state as HM[]) {
            for (let i = 0; i < del.length; i++) {
              if (m.delete(del[i])) {
                deleted++;
              }
            }
          }
          return deleted;
        },
      };
    }
    case 'clear': {
      // op = one clear() of a map holding n entries
      const maps = reps;
      return {
        ops: maps,
        expect: 0,
        setup: () => Array.from({ length: maps }, () => build(keys)),
        run: (state) => {
          let left = 0;
          for (const m of state as HM[]) {
            m.clear();
            left += m.size;
          }
          return left;
        },
      };
    }
    case 'clear-refill': {
      const m = build(keys);
      return {
        ops: n,
        expect: n,
        run: () => {
          m.clear();
          for (let i = 0; i < keys.length; i++) {
            m.set(keys[i], i);
          }
          return m.size;
        },
      };
    }
    case 'for-of':
    case 'for-of-after-delete':
    case 'keys-values':
    case 'for-each': {
      const m = build(keys);
      if (op === 'for-of-after-delete') {
        // grow to 2n, then delete the n extra keys, like iteration/... after deleting half
        for (let i = 0; i < n; i++) {
          m.set(set.misses[i], -1);
        }
        for (const k of shuffle(rng, set.misses.slice())) {
          m.delete(lookupForm(k));
        }
      }
      const expect = triangle(n);
      if (op === 'keys-values') {
        return {
          ops: 2 * n,
          expect: expect + n,
          run: () => {
            let s = 0;
            for (const k of m.keys()) {
              if (k !== undefined) {
                s++;
              }
            }
            for (const v of m.values()) {
              s += v;
            }
            return s;
          },
        };
      }
      if (op === 'for-each') {
        return {
          ops: n,
          expect,
          run: () => {
            let s = 0;
            m.forEach((v) => {
              s += v;
            });
            return s;
          },
        };
      }
      return {
        ops: n,
        expect,
        run: () => {
          let s = 0;
          for (const [, v] of m) {
            s += v;
          }
          return s;
        },
      };
    }
    default:
      throw new Error(`op ${op} has no plan`);
  }
}

export interface WorkloadSpec {
  workload: string;
  n: number;
  op: ProfileOp;
}

export interface TimedResult extends WorkloadSpec {
  calls: number;
  ops: number;
  timedMs: number;
  nsPerOp: number;
}

export function getWorkload(name: string): Workload {
  const w = WORKLOADS[name];
  if (!w) {
    throw new Error(`unknown workload: ${name}; available: ${Object.keys(WORKLOADS).join(', ')}`);
  }
  return w;
}

function check(p: Plan, spec: WorkloadSpec, when: string): void {
  const actual = p.run(p.setup ? UNTIMED_SETUP(p.setup) : undefined);
  if (actual !== p.expect) {
    throw new Error(
      `${spec.workload} n=${spec.n} ${spec.op}: verification failed ${when}: got ${actual}, expected ${p.expect}`,
    );
  }
}

// The two function names below are what cpuprofile.ts looks for. Keep them, and keep each in its
// own function declaration so the profiler sees the frames.

/** Untimed per-call setup: excluded from ns/op and from the profile tables. */
function UNTIMED_SETUP(setup: () => unknown): unknown {
  return setup();
}

/** The timed loop: calls `run` until `seconds` of timed work have accumulated. */
function TIMED_ROOT(p: Plan, seconds: number): { calls: number; timedMs: number } {
  const budget = seconds * 1000;
  let timedMs = 0;
  let calls = 0;
  if (p.setup) {
    const setup = p.setup;
    while (timedMs < budget) {
      const state = UNTIMED_SETUP(setup);
      const t0 = performance.now();
      doNotOptimize(p.run(state));
      timedMs += performance.now() - t0;
      calls++;
    }
  } else {
    // No setup: time batches of calls, so the clock reads stay negligible.
    while (timedMs < budget) {
      const t0 = performance.now();
      for (let i = 0; i < 16; i++) {
        doNotOptimize(p.run(undefined));
      }
      timedMs += performance.now() - t0;
      calls += 16;
    }
  }
  return { calls, timedMs };
}

/** Builds the workload (untimed), verifies it, runs it for `seconds`, and verifies it again. */
export function runTimed(spec: WorkloadSpec, seconds: number): TimedResult {
  const w = getWorkload(spec.workload);
  const p = plan(w, spec.op, spec.n, rngFor(`${spec.workload}:${spec.n}`));
  check(p, spec, 'before timing');
  const { calls, timedMs } = TIMED_ROOT(p, seconds);
  check(p, spec, 'after timing');
  const ops = calls * p.ops;
  return { ...spec, calls, ops, timedMs, nsPerOp: (timedMs * 1e6) / ops };
}
