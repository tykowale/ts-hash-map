/**
 * Many small maps instead of one big one: per-request lookups, per-entity attribute maps, group-by
 * buckets. Here the constructor and the first few inserts are most of the cost, which the
 * single-map families (n >= 10, built once) never measure.
 *
 * - `<key> lifecycle n=<n>`, n in {1, 4, 16}: `new HashMap()`, n sets, n hits (equal clones for
 *   structural keys, fresh flat copies for `uuid-fresh`), ceil(n/2) misses, then the map is
 *   dropped. op = one whole map lifecycle. n=16 crosses the default capacity's resize threshold
 *   (16 * 0.75 = 12), so it includes one 16 -> 32 resize.
 * - `<key> get-hit <M> maps x 4`: M live maps of 4 entries each, gets spread at random across all
 *   of them, so each lookup lands on a different map's table (cache misses on map objects, not on
 *   one table). op = one get.
 *
 * Baselines match the single-map families: native Map for int and fresh UUID strings, Map +
 * stable-stringify (on every set and get) for records and tuples.
 */
import stringify from 'fast-json-stable-stringify';
import { config, sizes } from '../lib/config.ts';
import { freshCase, group, runFamily, staticCase, type CaseDef } from '../lib/harness.ts';
import {
  clone,
  flat,
  rngFor,
  shuffle,
  smallInts,
  tuples,
  users,
  uuids,
  type KeySet,
  type Rng,
} from '../lib/keys.ts';
import { LOOKUPS, probeIndices } from '../lib/scenarios.ts';
import { HashMap } from '../lib/target.ts';

/** Lifecycles per timed call: enough that a call does about this many key operations. */
const MIN_KEY_OPS = 1024;
const SPREAD_MAPS = config.smoke ? 100 : 10_000;
const SPREAD_ENTRIES = 4;

type KeyFn = (key: unknown) => string;

interface Kind {
  label: string;
  generate: (n: number, rng: Rng) => KeySet<unknown>;
  /** How HashMap and the baseline see lookup keys. */
  lookup: 'same' | 'clone' | 'fresh';
  /** Baseline: a native Map keyed by the key itself, or by keyFn(key) on every op. */
  keyFn?: KeyFn;
  baselineName: string;
  hashName: string;
}

const KINDS: Kind[] = [
  {
    label: 'int',
    generate: smallInts,
    lookup: 'same',
    baselineName: 'Map',
    hashName: 'HashMap',
  },
  {
    label: 'uuid-fresh',
    generate: uuids,
    lookup: 'fresh',
    baselineName: 'Map (fresh strings)',
    hashName: 'HashMap (fresh strings)',
  },
  {
    label: 'user-record',
    generate: users,
    lookup: 'clone',
    keyFn: stringify,
    baselineName: 'Map + stable-stringify',
    hashName: 'HashMap (equal clone)',
  },
  {
    label: 'tuple',
    generate: tuples,
    lookup: 'clone',
    keyFn: stringify,
    baselineName: 'Map + stable-stringify',
    hashName: 'HashMap (equal clone)',
  },
];

// ---- lifecycle ----

/** One map's worth of work: keys to insert, then present keys and absent keys to look up. */
interface Work {
  ins: unknown[];
  hit: unknown[];
  miss: unknown[];
}

function lifecycleReps(n: number): number {
  return Math.max(1, Math.ceil(MIN_KEY_OPS / (n + Math.ceil(n / 2) + n)));
}

/** `reps` independent small key sets, each with its own lookup order. */
function works(kind: Kind, n: number, reps: number): Work[] {
  const rng = rngFor(`small-maps:${kind.label}:${n}`);
  const misses = Math.ceil(n / 2);
  const { keys, misses: absent } = kind.generate(reps * n, rng);
  const copy = kind.lookup === 'clone' ? clone : (k: unknown) => k;
  return Array.from({ length: reps }, (_, r) => {
    const ins = keys.slice(r * n, (r + 1) * n);
    return {
      ins,
      hit: shuffle(rng, ins.slice()).map(copy),
      miss: absent.slice(r * misses, (r + 1) * misses).map(copy),
    };
  });
}

/** Fresh flat copies of every string a lifecycle touches, built in untimed setup. */
const flatCopy = (k: unknown): unknown => flat(k as string);

function freshWorks(base: Work[]): () => Work[] {
  return () =>
    base.map((w) => ({
      ins: w.ins.map(flatCopy),
      hit: w.hit.map(flatCopy),
      miss: w.miss.map(flatCopy),
    }));
}

function hashLifecycle(ws: Work[]): number {
  let found = 0;
  for (let r = 0; r < ws.length; r++) {
    const w = ws[r]!;
    const m = new HashMap<unknown, number>();
    for (let i = 0; i < w.ins.length; i++) {
      m.set(w.ins[i], i);
    }
    for (let i = 0; i < w.hit.length; i++) {
      if (m.get(w.hit[i]) !== undefined) {
        found++;
      }
    }
    for (let i = 0; i < w.miss.length; i++) {
      if (m.get(w.miss[i]) === undefined) {
        found++;
      }
    }
  }
  return found;
}

function mapLifecycle(ws: Work[]): number {
  let found = 0;
  for (let r = 0; r < ws.length; r++) {
    const w = ws[r]!;
    const m = new Map<unknown, number>();
    for (let i = 0; i < w.ins.length; i++) {
      m.set(w.ins[i], i);
    }
    for (let i = 0; i < w.hit.length; i++) {
      if (m.get(w.hit[i]) !== undefined) {
        found++;
      }
    }
    for (let i = 0; i < w.miss.length; i++) {
      if (m.get(w.miss[i]) === undefined) {
        found++;
      }
    }
  }
  return found;
}

function fnLifecycle(ws: Work[], keyFn: KeyFn): number {
  let found = 0;
  for (let r = 0; r < ws.length; r++) {
    const w = ws[r]!;
    const m = new Map<string, number>();
    for (let i = 0; i < w.ins.length; i++) {
      m.set(keyFn(w.ins[i]), i);
    }
    for (let i = 0; i < w.hit.length; i++) {
      if (m.get(keyFn(w.hit[i])) !== undefined) {
        found++;
      }
    }
    for (let i = 0; i < w.miss.length; i++) {
      if (m.get(keyFn(w.miss[i])) === undefined) {
        found++;
      }
    }
  }
  return found;
}

function lifecycleCases(kind: Kind, n: number, reps: number): CaseDef[] {
  const base = works(kind, n, reps);
  const heap = { heap: true };
  if (kind.lookup === 'fresh') {
    const setup = freshWorks(base);
    return [
      freshCase(kind.baselineName, reps, setup, mapLifecycle, { baseline: true }),
      freshCase(kind.hashName, reps, setup, hashLifecycle),
    ];
  }
  const keyFn = kind.keyFn;
  const baseline = keyFn
    ? staticCase(kind.baselineName, reps, () => fnLifecycle(base, keyFn), {
        ...heap,
        baseline: true,
      })
    : staticCase(kind.baselineName, reps, () => mapLifecycle(base), { ...heap, baseline: true });
  return [baseline, staticCase(kind.hashName, reps, () => hashLifecycle(base), heap)];
}

for (const kind of KINDS) {
  for (const n of sizes([1, 4, 16], [1, 4, 16])) {
    const label = `${kind.label} lifecycle`;
    group(`${label} n=${n}`, { n, series: label }, () => {
      const reps = lifecycleReps(n);
      return {
        expect: reps * (n + Math.ceil(n / 2)),
        info: `op = one map: new, ${n} sets, ${n} hits, ${Math.ceil(n / 2)} misses, dropped`,
        cases: lifecycleCases(kind, n, reps),
      };
    });
  }
}

// ---- many live maps, gets spread across them ----

interface Spread {
  /** Map index and key (in the implementation's lookup form) of each probe. */
  at: Int32Array;
  probe: unknown[];
}

function hashSpreadGet(maps: HashMap<unknown, number>[], s: Spread): () => number {
  let cur = 0;
  const len = s.probe.length;
  return () => {
    let hits = 0;
    for (let i = 0; i < LOOKUPS; i++) {
      if (maps[s.at[cur]!]!.get(s.probe[cur]) !== undefined) {
        hits++;
      }
      if (++cur === len) {
        cur = 0;
      }
    }
    return hits;
  };
}

function mapSpreadGet(maps: Map<unknown, number>[], s: Spread): () => number {
  let cur = 0;
  const len = s.probe.length;
  return () => {
    let hits = 0;
    for (let i = 0; i < LOOKUPS; i++) {
      if (maps[s.at[cur]!]!.get(s.probe[cur]) !== undefined) {
        hits++;
      }
      if (++cur === len) {
        cur = 0;
      }
    }
    return hits;
  };
}

function fnSpreadGet(maps: Map<string, number>[], s: Spread, keyFn: KeyFn): () => number {
  let cur = 0;
  const len = s.probe.length;
  return () => {
    let hits = 0;
    for (let i = 0; i < LOOKUPS; i++) {
      if (maps[s.at[cur]!]!.get(keyFn(s.probe[cur])) !== undefined) {
        hits++;
      }
      if (++cur === len) {
        cur = 0;
      }
    }
    return hits;
  };
}

for (const kind of KINDS.filter((k) => k.label === 'int' || k.label === 'user-record')) {
  const name = `${kind.label} get-hit ${SPREAD_MAPS} maps x ${SPREAD_ENTRIES}`;
  group(name, { n: SPREAD_MAPS * SPREAD_ENTRIES, series: `${kind.label} spread get-hit` }, () => {
    const total = SPREAD_MAPS * SPREAD_ENTRIES;
    const rng = rngFor(`small-maps:spread:${kind.label}:${SPREAD_MAPS}`);
    const { keys } = kind.generate(total, rng);
    // probeIndices over all `total` keys with a 100% hit rate; key i lives in map floor(i / 4).
    const idx = probeIndices(total, 1, 'random', rng);
    const at = Int32Array.from(idx, (i) => Math.floor(i / SPREAD_ENTRIES));
    const copy = kind.lookup === 'clone' ? clone : (k: unknown) => k;
    const spread: Spread = { at, probe: Array.from(idx, (i) => copy(keys[i])) };
    const slices = Array.from({ length: SPREAD_MAPS }, (_, j) =>
      keys.slice(j * SPREAD_ENTRIES, (j + 1) * SPREAD_ENTRIES),
    );
    const hashMaps = slices.map((ks) => {
      const m = new HashMap<unknown, number>();
      ks.forEach((k, i) => m.set(k, i));
      return m;
    });
    const keyFn = kind.keyFn;
    const baseline = keyFn
      ? staticCase(
          kind.baselineName,
          LOOKUPS,
          fnSpreadGet(
            slices.map((ks) => new Map(ks.map((k, i) => [keyFn(k), i]))),
            spread,
            keyFn,
          ),
          { baseline: true },
        )
      : staticCase(
          kind.baselineName,
          LOOKUPS,
          mapSpreadGet(
            slices.map((ks) => new Map(ks.map((k, i) => [k, i]))),
            spread,
          ),
          { baseline: true },
        );
    return {
      expect: LOOKUPS,
      info: `get, 100% hit, each probe on a random one of ${SPREAD_MAPS} live ${SPREAD_ENTRIES}-entry maps`,
      cases: [baseline, staticCase(kind.hashName, LOOKUPS, hashSpreadGet(hashMaps, spread))],
    };
  });
}

await runFamily('small-maps');
