/**
 * Builds the standard operation matrix for one key type: each (operation, size) pair becomes a
 * group holding a HashMap row next to its native baselines, so the printed ratio compares like
 * with like inside one process.
 *
 * The timed bodies are written out once per implementation kind (HashMap, Map, Map + key
 * function) instead of going through an adapter. A shared adapter call would make the call site
 * polymorphic across implementations and slow every row down by a different amount.
 */
import { config } from './config.ts';
import { freshCase, group, staticCase, type CaseDef } from './harness.ts';
import { clone, rngFor, shuffle, type KeySet, type Rng } from './keys.ts';
import { HashMap, type HashMapOptions } from './target.ts';

/** Lookups per timed call. Large enough to amortise call overhead, small enough to batch. */
export const LOOKUPS = 1024;
/** delete+insert pairs per timed call in the churn scenario. */
export const CHURN_PAIRS = 512;
/** Fresh-map cases build several maps per call when n is small, so a call does >= this many ops. */
const MIN_OPS_PER_CALL = 1024;

export type Op =
  | 'get-hit'
  | 'get-hit-seq'
  | 'get-miss'
  | 'get-50'
  | 'has-50'
  | 'set-fresh'
  | 'set-presized'
  | 'update'
  | 'churn'
  | 'delete-all'
  | 'clear';

export const ALL_OPS: Op[] = [
  'get-hit',
  'get-hit-seq',
  'get-miss',
  'get-50',
  'has-50',
  'set-fresh',
  'set-presized',
  'update',
  'churn',
  'delete-all',
  'clear',
];

const OP_TITLES: Record<Op, string> = {
  'get-hit': 'get, 100% hit, random order',
  'get-hit-seq': 'get, 100% hit, insertion order',
  'get-miss': 'get, 0% hit',
  'get-50': 'get, 50% hit',
  'has-50': 'has, 50% hit',
  'set-fresh': 'set n keys into a new map (default capacity, includes resizes); op = one set',
  'set-presized': 'set n keys into a presized map (no resizes); op = one set',
  update: 'set on existing keys (random order)',
  churn: 'steady state: delete one key + insert a new one, size stays n; op = one pair',
  'delete-all': 'delete every key of a full map (random order)',
  clear: 'clear() a map holding n entries; op = one clear',
};

interface ImplBase<K> {
  name: string;
  baseline?: boolean;
  note?: string;
  /** Restrict this implementation to some operations. */
  only?: Op[];
  /**
   * Hand every timed call newly made copies of its keys, built by this function in untimed setup
   * (lookup ops and set-fresh only). For strings, `flat` gives keys like those from JSON.parse, the
   * network or a database: V8 has not cached their hash yet, so a native Map must hash and compare
   * them, which it skips for string instances it has already seen.
   */
  fresh?: (key: K) => K;
}

export type Impl<K> =
  | (ImplBase<K> & {
      kind: 'hash';
      options?: HashMapOptions;
      /** `clone`: look up with structurally equal copies (the real use); `same`: the inserted refs. */
      lookup: 'clone' | 'same';
    })
  | (ImplBase<K> & {
      kind: 'map';
      /** Precompute a primitive key per entry outside the timed region (the floor), else identity. */
      derive?: (key: K) => unknown;
    })
  | (ImplBase<K> & {
      kind: 'map-fn';
      /** Called inside the timed region on every op, e.g. a stable stringify. */
      keyFn: (key: K) => string;
    });

export interface KeySuite<K> {
  /** Group label prefix, e.g. "int" or "user-record". */
  label: string;
  sizes: number[];
  generate: (n: number, rng: Rng) => KeySet<K>;
  impls: Impl<K>[];
  ops: Op[];
}

// ---- probe construction (untimed) ----

/**
 * Probe indices for lookups: values < n index `keys`, values >= n index `misses`. The array is a
 * whole number of LOOKUPS-sized windows and each window holds exactly round(LOOKUPS * hitRate)
 * hits, so every timed call returns the same hit count whatever the cursor position.
 */
export function probeIndices(
  n: number,
  hitRate: number,
  order: 'random' | 'insertion',
  rng: Rng,
): Int32Array {
  const windows = Math.max(1, Math.ceil(n / LOOKUPS));
  const out = new Int32Array(windows * LOOKUPS);
  const hitsPerWindow = Math.round(LOOKUPS * hitRate);
  let hitPerm: number[] = [];
  let missPerm: number[] = [];
  let seq = 0;
  for (let w = 0; w < windows; w++) {
    const win: number[] = [];
    for (let i = 0; i < LOOKUPS; i++) {
      if (i < hitsPerWindow) {
        if (order === 'insertion') {
          win.push(seq++ % n);
          continue;
        }
        if (hitPerm.length === 0) {
          hitPerm = shuffle(
            rng,
            Array.from({ length: n }, (_, j) => j),
          );
        }
        win.push(hitPerm.pop()!);
      } else {
        if (missPerm.length === 0) {
          missPerm = shuffle(
            rng,
            Array.from({ length: n }, (_, j) => n + j),
          );
        }
        win.push(missPerm.pop()!);
      }
    }
    if (order === 'random') {
      shuffle(rng, win);
    }
    out.set(win, w * LOOKUPS);
  }
  return out;
}

interface Dataset<K> {
  n: number;
  set: KeySet<K>;
  rng: Rng;
  probes: Map<string, Int32Array>;
}

function probes<K>(d: Dataset<K>, hitRate: number, order: 'random' | 'insertion'): Int32Array {
  const id = `${hitRate}:${order}`;
  let p = d.probes.get(id);
  if (!p) {
    p = probeIndices(d.n, hitRate, order, d.rng);
    d.probes.set(id, p);
  }
  return p;
}

function keyAt<K>(set: KeySet<K>, idx: number): K {
  const n = set.keys.length;
  return idx < n ? set.keys[idx]! : set.misses[idx - n]!;
}

/** The form of a key an implementation is handed for a lookup / delete. */
function lookupForm<K>(impl: Impl<K>, key: K): unknown {
  if (impl.kind === 'hash') {
    return impl.lookup === 'clone' ? clone(key) : key;
  }
  if (impl.kind === 'map') {
    return impl.derive ? impl.derive(key) : key;
  }
  return clone(key); // map-fn: the key function runs on a fresh copy, like a real lookup would
}

/** The form of a key an implementation stores on insert. */
function insertForm<K>(impl: Impl<K>, key: K): unknown {
  return impl.kind === 'map' && impl.derive ? impl.derive(key) : key;
}

function materialize<K>(impl: Impl<K>, set: KeySet<K>, idx: Int32Array): unknown[] {
  return Array.from(idx, (i) => lookupForm(impl, keyAt(set, i)));
}

// ---- timed bodies: HashMap ----

type HM = HashMap<unknown, number>;
type NM = Map<unknown, number>;
type SM = Map<string, number>;
type KeyFn = (key: unknown) => string;

function hashBuild(keys: unknown[], options: HashMapOptions | undefined): HM {
  const m = new HashMap<unknown, number>(options ?? {});
  for (let i = 0; i < keys.length; i++) {
    m.set(keys[i], i);
  }
  return m;
}

function hashGet(m: HM, probe: unknown[]): () => number {
  let cur = 0;
  const len = probe.length;
  return () => {
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
  };
}

function hashHas(m: HM, probe: unknown[]): () => number {
  let cur = 0;
  const len = probe.length;
  return () => {
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
  };
}

function hashUpdate(m: HM, probe: unknown[]): () => number {
  let cur = 0;
  const len = probe.length;
  return () => {
    for (let i = 0; i < LOOKUPS; i++) {
      m.set(probe[cur], i);
      if (++cur === len) {
        cur = 0;
      }
    }
    return m.size;
  };
}

function hashFill(
  keys: unknown[],
  reps: number,
  options: HashMapOptions | undefined,
): () => number {
  const n = keys.length;
  return () => {
    let total = 0;
    for (let r = 0; r < reps; r++) {
      const m = new HashMap<unknown, number>(options ?? {});
      for (let i = 0; i < n; i++) {
        m.set(keys[i], i);
      }
      total += m.size;
    }
    return total;
  };
}

function hashChurn(m: HM, del: unknown[], ins: unknown[], n: number): () => number {
  let h = 0;
  const len = del.length;
  return () => {
    for (let i = 0; i < CHURN_PAIRS; i++) {
      m.delete(del[h]);
      let j = h + n;
      if (j >= len) {
        j -= len;
      }
      m.set(ins[j], j);
      if (++h === len) {
        h = 0;
      }
    }
    return m.size;
  };
}

function hashDeleteAll(maps: HM[], del: unknown[]): number {
  let deleted = 0;
  for (const m of maps) {
    for (let i = 0; i < del.length; i++) {
      if (m.delete(del[i])) {
        deleted++;
      }
    }
  }
  return deleted;
}

function hashClear(maps: HM[]): number {
  let left = 0;
  for (const m of maps) {
    m.clear();
    left += m.size;
  }
  return left;
}

// ---- timed bodies: fresh key copies per call (state comes from an untimed setup) ----

/** Untimed setup for fresh lookups: copies of the next LOOKUPS probes, walking the probe array. */
function freshWindows(probe: unknown[], copy: (key: unknown) => unknown): () => unknown[] {
  let cur = 0;
  const len = probe.length; // a whole number of LOOKUPS windows, so cur stays window-aligned
  return () => {
    const out = new Array<unknown>(LOOKUPS);
    for (let i = 0; i < LOOKUPS; i++) {
      out[i] = copy(probe[cur]);
      if (++cur === len) {
        cur = 0;
      }
    }
    return out;
  };
}

function hashGetEach(m: HM, has: boolean): (probe: unknown[]) => number {
  return has
    ? (probe) => {
        let hits = 0;
        for (let i = 0; i < probe.length; i++) {
          if (m.has(probe[i])) {
            hits++;
          }
        }
        return hits;
      }
    : (probe) => {
        let hits = 0;
        for (let i = 0; i < probe.length; i++) {
          if (m.get(probe[i]) !== undefined) {
            hits++;
          }
        }
        return hits;
      };
}

function mapGetEach(m: NM, has: boolean): (probe: unknown[]) => number {
  return has
    ? (probe) => {
        let hits = 0;
        for (let i = 0; i < probe.length; i++) {
          if (m.has(probe[i])) {
            hits++;
          }
        }
        return hits;
      }
    : (probe) => {
        let hits = 0;
        for (let i = 0; i < probe.length; i++) {
          if (m.get(probe[i]) !== undefined) {
            hits++;
          }
        }
        return hits;
      };
}

function hashFillEach(options: HashMapOptions | undefined): (batches: unknown[][]) => number {
  return (batches) => {
    let total = 0;
    for (const keys of batches) {
      const m = new HashMap<unknown, number>(options ?? {});
      for (let i = 0; i < keys.length; i++) {
        m.set(keys[i], i);
      }
      total += m.size;
    }
    return total;
  };
}

function mapFillEach(batches: unknown[][]): number {
  let total = 0;
  for (const keys of batches) {
    const m = new Map<unknown, number>();
    for (let i = 0; i < keys.length; i++) {
      m.set(keys[i], i);
    }
    total += m.size;
  }
  return total;
}

/** Cases for an implementation with `fresh` set: lookups and set-fresh on newly made key copies. */
function buildFreshCase<K>(op: Op, impl: Impl<K>, d: Dataset<K>): CaseDef {
  const copy = impl.fresh as (key: unknown) => unknown;
  const options = { baseline: impl.baseline, note: impl.note };
  if (impl.kind === 'map-fn' || (impl.kind === 'map' && impl.derive)) {
    throw new Error(`${impl.name}: fresh keys need a plain HashMap or Map row`);
  }
  const lookup = LOOKUP_OPS[op];
  if (lookup) {
    const probe = materialize(impl, d.set, probes(d, lookup.rate, lookup.order));
    const setup = freshWindows(probe, copy);
    const run =
      impl.kind === 'hash'
        ? hashGetEach(hashBuild(d.set.keys, impl.options), lookup.has === true)
        : mapGetEach(mapBuild(d.set.keys), lookup.has === true);
    return freshCase(impl.name, LOOKUPS, setup, run, options);
  }
  if (op === 'set-fresh') {
    const reps = repsFor(d.n);
    const keys = d.set.keys as unknown[];
    const setup = (): unknown[][] => Array.from({ length: reps }, () => keys.map(copy));
    const run = impl.kind === 'hash' ? hashFillEach(impl.options) : mapFillEach;
    return freshCase(impl.name, reps * d.n, setup, run, options);
  }
  throw new Error(`${impl.name}: fresh keys are not supported for ${op}`);
}

// ---- timed bodies: native Map (primitive, identity or precomputed keys) ----

function mapBuild(keys: unknown[]): NM {
  const m = new Map<unknown, number>();
  for (let i = 0; i < keys.length; i++) {
    m.set(keys[i], i);
  }
  return m;
}

function mapGet(m: NM, probe: unknown[]): () => number {
  let cur = 0;
  const len = probe.length;
  return () => {
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
  };
}

function mapHas(m: NM, probe: unknown[]): () => number {
  let cur = 0;
  const len = probe.length;
  return () => {
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
  };
}

function mapUpdate(m: NM, probe: unknown[]): () => number {
  let cur = 0;
  const len = probe.length;
  return () => {
    for (let i = 0; i < LOOKUPS; i++) {
      m.set(probe[cur], i);
      if (++cur === len) {
        cur = 0;
      }
    }
    return m.size;
  };
}

function mapFill(keys: unknown[], reps: number): () => number {
  const n = keys.length;
  return () => {
    let total = 0;
    for (let r = 0; r < reps; r++) {
      const m = new Map<unknown, number>();
      for (let i = 0; i < n; i++) {
        m.set(keys[i], i);
      }
      total += m.size;
    }
    return total;
  };
}

function mapChurn(m: NM, del: unknown[], ins: unknown[], n: number): () => number {
  let h = 0;
  const len = del.length;
  return () => {
    for (let i = 0; i < CHURN_PAIRS; i++) {
      m.delete(del[h]);
      let j = h + n;
      if (j >= len) {
        j -= len;
      }
      m.set(ins[j], j);
      if (++h === len) {
        h = 0;
      }
    }
    return m.size;
  };
}

function mapDeleteAll(maps: NM[], del: unknown[]): number {
  let deleted = 0;
  for (const m of maps) {
    for (let i = 0; i < del.length; i++) {
      if (m.delete(del[i])) {
        deleted++;
      }
    }
  }
  return deleted;
}

function mapClear(maps: NM[]): number {
  let left = 0;
  for (const m of maps) {
    m.clear();
    left += m.size;
  }
  return left;
}

// ---- timed bodies: native Map + key function on every op (the stringify alternative) ----

function fnBuild(keys: unknown[], keyFn: KeyFn): SM {
  const m = new Map<string, number>();
  for (let i = 0; i < keys.length; i++) {
    m.set(keyFn(keys[i]), i);
  }
  return m;
}

function fnGet(m: SM, probe: unknown[], keyFn: KeyFn): () => number {
  let cur = 0;
  const len = probe.length;
  return () => {
    let hits = 0;
    for (let i = 0; i < LOOKUPS; i++) {
      if (m.get(keyFn(probe[cur])) !== undefined) {
        hits++;
      }
      if (++cur === len) {
        cur = 0;
      }
    }
    return hits;
  };
}

function fnHas(m: SM, probe: unknown[], keyFn: KeyFn): () => number {
  let cur = 0;
  const len = probe.length;
  return () => {
    let hits = 0;
    for (let i = 0; i < LOOKUPS; i++) {
      if (m.has(keyFn(probe[cur]))) {
        hits++;
      }
      if (++cur === len) {
        cur = 0;
      }
    }
    return hits;
  };
}

function fnUpdate(m: SM, probe: unknown[], keyFn: KeyFn): () => number {
  let cur = 0;
  const len = probe.length;
  return () => {
    for (let i = 0; i < LOOKUPS; i++) {
      m.set(keyFn(probe[cur]), i);
      if (++cur === len) {
        cur = 0;
      }
    }
    return m.size;
  };
}

function fnFill(keys: unknown[], reps: number, keyFn: KeyFn): () => number {
  const n = keys.length;
  return () => {
    let total = 0;
    for (let r = 0; r < reps; r++) {
      const m = new Map<string, number>();
      for (let i = 0; i < n; i++) {
        m.set(keyFn(keys[i]), i);
      }
      total += m.size;
    }
    return total;
  };
}

function fnChurn(m: SM, del: unknown[], ins: unknown[], n: number, keyFn: KeyFn): () => number {
  let h = 0;
  const len = del.length;
  return () => {
    for (let i = 0; i < CHURN_PAIRS; i++) {
      m.delete(keyFn(del[h]));
      let j = h + n;
      if (j >= len) {
        j -= len;
      }
      m.set(keyFn(ins[j]), j);
      if (++h === len) {
        h = 0;
      }
    }
    return m.size;
  };
}

function fnDeleteAll(maps: SM[], del: unknown[], keyFn: KeyFn): number {
  let deleted = 0;
  for (const m of maps) {
    for (let i = 0; i < del.length; i++) {
      if (m.delete(keyFn(del[i]))) {
        deleted++;
      }
    }
  }
  return deleted;
}

function fnClear(maps: SM[]): number {
  let left = 0;
  for (const m of maps) {
    m.clear();
    left += m.size;
  }
  return left;
}

// ---- case construction ----

const LOOKUP_OPS: Partial<
  Record<Op, { rate: number; order: 'random' | 'insertion'; has?: boolean }>
> = {
  'get-hit': { rate: 1, order: 'random' },
  'get-hit-seq': { rate: 1, order: 'insertion' },
  'get-miss': { rate: 0, order: 'random' },
  'get-50': { rate: 0.5, order: 'random' },
  'has-50': { rate: 0.5, order: 'random', has: true },
};

export function repsFor(n: number): number {
  return Math.max(1, Math.ceil(MIN_OPS_PER_CALL / n));
}

function presized(options: HashMapOptions | undefined, n: number): HashMapOptions {
  // capacity is rounded up to a power of two; divide by the load factor so n entries never resize.
  return { ...options, capacity: Math.ceil(n / (options?.loadFactor ?? 0.75)) };
}

function buildCase<K>(op: Op, impl: Impl<K>, d: Dataset<K>): CaseDef | undefined {
  if (impl.fresh) {
    return buildFreshCase(op, impl, d);
  }
  const { n, set } = d;
  const keys = set.keys;
  const options = { baseline: impl.baseline, note: impl.note };

  const lookup = LOOKUP_OPS[op];
  if (lookup) {
    const probe = materialize(impl, set, probes(d, lookup.rate, lookup.order));
    switch (impl.kind) {
      case 'hash': {
        const m = hashBuild(keys, impl.options);
        return staticCase(
          impl.name,
          LOOKUPS,
          lookup.has ? hashHas(m, probe) : hashGet(m, probe),
          options,
        );
      }
      case 'map': {
        const m = mapBuild(keys.map((k) => insertForm(impl, k)));
        return staticCase(
          impl.name,
          LOOKUPS,
          lookup.has ? mapHas(m, probe) : mapGet(m, probe),
          options,
        );
      }
      case 'map-fn': {
        const m = fnBuild(keys, impl.keyFn as KeyFn);
        const fn = lookup.has ? fnHas : fnGet;
        return staticCase(impl.name, LOOKUPS, fn(m, probe, impl.keyFn as KeyFn), options);
      }
    }
  }

  const reps = repsFor(n);
  switch (op) {
    case 'set-fresh':
    case 'set-presized': {
      const heapOptions = { ...options, heap: true };
      if (impl.kind === 'hash') {
        const opts = op === 'set-presized' ? presized(impl.options, n) : impl.options;
        return staticCase(impl.name, reps * n, hashFill(keys, reps, opts), heapOptions);
      }
      if (impl.kind === 'map') {
        const stored = keys.map((k) => insertForm(impl, k));
        return staticCase(impl.name, reps * n, mapFill(stored, reps), heapOptions);
      }
      return staticCase(impl.name, reps * n, fnFill(keys, reps, impl.keyFn as KeyFn), heapOptions);
    }

    case 'update': {
      const probe = materialize(impl, set, probes(d, 1, 'random'));
      if (impl.kind === 'hash') {
        return staticCase(
          impl.name,
          LOOKUPS,
          hashUpdate(hashBuild(keys, impl.options), probe),
          options,
        );
      }
      if (impl.kind === 'map') {
        const m = mapBuild(keys.map((k) => insertForm(impl, k)));
        return staticCase(impl.name, LOOKUPS, mapUpdate(m, probe), options);
      }
      const keyFn = impl.keyFn as KeyFn;
      return staticCase(impl.name, LOOKUPS, fnUpdate(fnBuild(keys, keyFn), probe, keyFn), options);
    }

    case 'churn': {
      // A pool of 2n keys; the live window [h, h + n) slides forward one key per pair.
      const pool = [...set.keys, ...set.misses];
      const del = pool.map((k) => lookupForm(impl, k));
      const ins = pool.map((k) => insertForm(impl, k));
      if (impl.kind === 'hash') {
        const m = hashBuild(keys, impl.options);
        return staticCase(impl.name, CHURN_PAIRS, hashChurn(m, del, ins, n), options);
      }
      if (impl.kind === 'map') {
        const m = mapBuild(keys.map((k) => insertForm(impl, k)));
        return staticCase(impl.name, CHURN_PAIRS, mapChurn(m, del, ins, n), options);
      }
      const keyFn = impl.keyFn as KeyFn;
      return staticCase(
        impl.name,
        CHURN_PAIRS,
        fnChurn(fnBuild(keys, keyFn), del, ins, n, keyFn),
        options,
      );
    }

    case 'delete-all': {
      const order = shuffle(
        d.rng,
        Array.from({ length: n }, (_, i) => i),
      );
      const del = order.map((i) => lookupForm(impl, keys[i]!));
      const fresh = { ...options, expect: reps * n };
      if (impl.kind === 'hash') {
        const setup = (): HM[] => Array.from({ length: reps }, () => hashBuild(keys, impl.options));
        return freshCase(impl.name, reps * n, setup, (maps) => hashDeleteAll(maps, del), fresh);
      }
      if (impl.kind === 'map') {
        const stored = keys.map((k) => insertForm(impl, k));
        const setup = (): NM[] => Array.from({ length: reps }, () => mapBuild(stored));
        return freshCase(impl.name, reps * n, setup, (maps) => mapDeleteAll(maps, del), fresh);
      }
      const keyFn = impl.keyFn as KeyFn;
      const setup = (): SM[] => Array.from({ length: reps }, () => fnBuild(keys, keyFn));
      return freshCase(impl.name, reps * n, setup, (maps) => fnDeleteAll(maps, del, keyFn), fresh);
    }

    case 'clear': {
      const fresh = { ...options, expect: 0 };
      if (impl.kind === 'hash') {
        const setup = (): HM[] => Array.from({ length: reps }, () => hashBuild(keys, impl.options));
        return freshCase(impl.name, reps, setup, hashClear, fresh);
      }
      if (impl.kind === 'map') {
        const stored = keys.map((k) => insertForm(impl, k));
        const setup = (): NM[] => Array.from({ length: reps }, () => mapBuild(stored));
        return freshCase(impl.name, reps, setup, mapClear, fresh);
      }
      const keyFn = impl.keyFn as KeyFn;
      const setup = (): SM[] => Array.from({ length: reps }, () => fnBuild(keys, keyFn));
      return freshCase(impl.name, reps, setup, fnClear, fresh);
    }

    default:
      return undefined;
  }
}

function expectedFor(op: Op, n: number): number | undefined {
  const lookup = LOOKUP_OPS[op];
  if (lookup) {
    return Math.round(LOOKUPS * lookup.rate);
  }
  switch (op) {
    case 'set-fresh':
    case 'set-presized':
      return repsFor(n) * n;
    case 'update':
    case 'churn':
      return n;
    default:
      return undefined; // delete-all and clear set a per-case expectation
  }
}

/**
 * Registers every (size, op) group for a key type. Data for one size is generated once, lazily,
 * and shared by that size's groups; it is dropped when the next size starts.
 */
export function keySuite<K>(suite: KeySuite<K>): void {
  let cached: Dataset<K> | undefined;
  const dataset = (n: number): Dataset<K> => {
    if (cached?.n !== n) {
      cached = undefined;
      const rng = rngFor(`${suite.label}:${n}`);
      cached = { n, set: suite.generate(n, rng), rng, probes: new Map() };
    }
    return cached;
  };

  for (const n of suite.sizes) {
    for (const op of suite.ops) {
      group(`${suite.label} ${op} n=${n}`, { n, series: `${suite.label} ${op}` }, () => {
        const d = dataset(n);
        const cases = suite.impls
          .filter((impl) => !impl.only || impl.only.includes(op))
          .map((impl) => buildCase(op, impl, d))
          .filter((c): c is CaseDef => c !== undefined);
        return { expect: expectedFor(op, n), info: OP_TITLES[op], cases };
      });
    }
  }
}

/** True when running a smoke pass (used by families to trim optional extras). */
export const smoke = config.smoke;
