/**
 * Construction, resize and clear costs, kept apart from lookups so cold-start work never leaks
 * into steady-state numbers.
 */
import { PRIMITIVE_SIZES, config, sizes } from '../lib/config.ts';
import { freshCase, group, runFamily, staticCase } from '../lib/harness.ts';
import { rngFor, smallInts, sparseInts } from '../lib/keys.ts';
import { HashMap, type HashMapOptions } from '../lib/target.ts';

const MIN_OPS = 1024;
const reps = (n: number): number => Math.max(1, Math.ceil(MIN_OPS / n));

function hashFromEntries(entries: Array<[number, number]>, r: number, options?: HashMapOptions) {
  return () => {
    let total = 0;
    for (let i = 0; i < r; i++) {
      total += (options ? new HashMap(entries, options) : new HashMap(entries)).size;
    }
    return total;
  };
}
function mapFromEntries(entries: Array<[number, number]>, r: number) {
  return () => {
    let total = 0;
    for (let i = 0; i < r; i++) {
      total += new Map(entries).size;
    }
    return total;
  };
}
function hashFill(keys: number[], r: number, options: HashMapOptions) {
  return () => {
    let total = 0;
    for (let i = 0; i < r; i++) {
      const m = new HashMap<number, number>(options);
      for (let j = 0; j < keys.length; j++) {
        m.set(keys[j]!, j);
      }
      total += m.size;
    }
    return total;
  };
}
function mapFill(keys: number[], r: number) {
  return () => {
    let total = 0;
    for (let i = 0; i < r; i++) {
      const m = new Map<number, number>();
      for (let j = 0; j < keys.length; j++) {
        m.set(keys[j]!, j);
      }
      total += m.size;
    }
    return total;
  };
}
function hashGetAll(m: HashMap<number, number>, keys: number[]) {
  return () => {
    let hits = 0;
    for (let i = 0; i < keys.length; i++) {
      if (m.get(keys[i]!) !== undefined) {
        hits++;
      }
    }
    return hits;
  };
}
function mapGetAll(m: Map<number, number>, keys: number[]) {
  return () => {
    let hits = 0;
    for (let i = 0; i < keys.length; i++) {
      if (m.get(keys[i]!) !== undefined) {
        hits++;
      }
    }
    return hits;
  };
}

const heavy = { heap: true };

// new HashMap(entries) vs new Map(entries)
for (const n of sizes(PRIMITIVE_SIZES)) {
  group(`from entries n=${n}`, { n, series: 'from entries' }, () => {
    const { keys } = smallInts(n, rngFor(`entries:${n}`));
    const entries = keys.map((k, i): [number, number] => [k, i]);
    const r = reps(n);
    return {
      expect: r * n,
      info: 'new X(entriesArray); op = one entry',
      cases: [
        staticCase('new Map(entries)', r * n, mapFromEntries(entries, r), {
          ...heavy,
          baseline: true,
        }),
        staticCase('new HashMap(entries)', r * n, hashFromEntries(entries, r), heavy),
        staticCase(
          'new HashMap(entries, { capacity })',
          r * n,
          hashFromEntries(entries, r, { capacity: Math.ceil(n / 0.75) }),
          heavy,
        ),
      ],
    };
  });
}

// clear() then refill on a map that was already large vs filling a fresh map
for (const n of sizes(PRIMITIVE_SIZES)) {
  group(`clear + refill n=${n}`, { n, series: 'clear + refill' }, () => {
    const { keys } = smallInts(n, rngFor(`refill:${n}`));
    const r = reps(n);
    const fillHash = (m: HashMap<number, number>): number => {
      m.clear();
      for (let j = 0; j < keys.length; j++) {
        m.set(keys[j]!, j);
      }
      return m.size;
    };
    const fillMap = (m: Map<number, number>): number => {
      m.clear();
      for (let j = 0; j < keys.length; j++) {
        m.set(keys[j]!, j);
      }
      return m.size;
    };
    const hashSetup = () =>
      Array.from({ length: r }, () => new HashMap(keys.map((k, i): [number, number] => [k, i])));
    const mapSetup = () =>
      Array.from({ length: r }, () => new Map(keys.map((k, i): [number, number] => [k, i])));
    return {
      expect: r * n,
      info: 'clear() a full map, then set n keys again (capacity is kept); op = one set',
      cases: [
        freshCase('Map', r * n, mapSetup, (ms) => ms.reduce((a, m) => a + fillMap(m), 0), {
          baseline: true,
        }),
        freshCase('HashMap', r * n, hashSetup, (ms) => ms.reduce((a, m) => a + fillHash(m), 0)),
        staticCase('HashMap (fresh map, for reference)', r * n, hashFill(keys, r, {}), heavy),
      ],
    };
  });
}

// load factor sweep: chain length vs table size
const LF_N = config.smoke ? 100 : 10_000;
for (const op of ['set', 'get'] as const) {
  group(`loadFactor sweep ${op} n=${LF_N}`, { n: LF_N }, () => {
    const { keys } = sparseInts(LF_N, rngFor(`lf:${LF_N}`));
    const cases = [];
    if (op === 'set') {
      cases.push(staticCase('Map', LF_N, mapFill(keys, 1), { ...heavy, baseline: true }));
      for (const loadFactor of [0.5, 0.75, 1, 2]) {
        cases.push(
          staticCase(
            `HashMap loadFactor ${loadFactor}`,
            LF_N,
            hashFill(keys, 1, { loadFactor }),
            heavy,
          ),
        );
      }
    } else {
      cases.push(
        staticCase('Map', LF_N, mapGetAll(new Map(keys.map((k, i) => [k, i])), keys), {
          baseline: true,
        }),
      );
      for (const loadFactor of [0.5, 0.75, 1, 2]) {
        const m = new HashMap<number, number>({ loadFactor });
        keys.forEach((k, i) => m.set(k, i));
        cases.push(staticCase(`HashMap loadFactor ${loadFactor}`, LF_N, hashGetAll(m, keys)));
      }
    }
    return {
      expect: LF_N,
      info:
        op === 'set'
          ? 'build n sparse-int keys from empty; op = one set'
          : 'get every key once (insertion order); op = one get',
      cases,
    };
  });
}

// resize-heavy: start at capacity 1 and grow to n
const GROW_N = config.smoke ? 1_000 : 100_000;
group(`grow from capacity 1 n=${GROW_N}`, { n: GROW_N }, () => {
  const { keys } = smallInts(GROW_N, rngFor('grow'));
  return {
    expect: GROW_N,
    info: '17 doublings from capacity 1 vs the default 16 vs presized; op = one set',
    cases: [
      staticCase('Map', GROW_N, mapFill(keys, 1), { ...heavy, baseline: true }),
      staticCase('HashMap { capacity: 1 }', GROW_N, hashFill(keys, 1, { capacity: 1 }), heavy),
      staticCase('HashMap (default 16)', GROW_N, hashFill(keys, 1, {}), heavy),
      staticCase(
        'HashMap (presized)',
        GROW_N,
        hashFill(keys, 1, { capacity: Math.ceil(GROW_N / 0.75) }),
        heavy,
      ),
    ],
  };
});

// a single resize in isolation: default capacity 16 resizes when the 13th entry goes in
group('single resize (12 vs 13 entries)', {}, () => {
  const k12 = Array.from({ length: 12 }, (_, i) => i);
  const k13 = Array.from({ length: 13 }, (_, i) => i);
  const r = 256;
  return {
    info: 'op = build one map; the 13-entry build includes one 16 -> 32 resize',
    cases: [
      staticCase('Map 12', r, mapFill(k12, r), { ...heavy, baseline: true, expect: 12 * r }),
      staticCase('HashMap 12 (no resize)', r, hashFill(k12, r, {}), { ...heavy, expect: 12 * r }),
      staticCase('HashMap 13 (one resize)', r, hashFill(k13, r, {}), { ...heavy, expect: 13 * r }),
    ],
  };
});

await runFamily('construction');
