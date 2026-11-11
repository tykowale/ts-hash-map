/**
 * Iteration over n entries. HashMap walks a doubly linked insertion-order list; entries() and
 * for..of also allocate a [k, v] tuple per step, keys()/values() allocate an iterator result.
 * The "after deletes" groups iterate a map that grew to 2n and then lost half its entries.
 *
 * The `user-record` and `tuple` groups iterate maps with structural keys. Today HashMap stores the
 * key in its node, so the walk is the same as for ints; a design that keeps keys elsewhere (D1 in
 * the perf plan) would have to translate each one back, and these rows would show it. The
 * baseline is a native Map holding the same key objects.
 */
import { PRIMITIVE_SIZES, sizes } from '../lib/config.ts';
import { group, runFamily, staticCase } from '../lib/harness.ts';
import { rngFor, shuffle, smallInts, tuples, users, type UserKey } from '../lib/keys.ts';
import { HashMap } from '../lib/target.ts';

type Pair = { hash: HashMap<number, number>; map: Map<number, number>; expected: number };

/** Builds both maps with the same entries; `deleteHalf` grows to 2n first, then deletes n. */
function build(n: number, deleteHalf: boolean): Pair {
  const rng = rngFor(`iteration:${n}:${deleteHalf}`);
  const { keys, misses } = smallInts(n, rng);
  const hash = new HashMap<number, number>();
  const map = new Map<number, number>();
  const all = deleteHalf ? [...keys, ...misses] : keys;
  for (const k of all) {
    hash.set(k, k);
    map.set(k, k);
  }
  if (deleteHalf) {
    for (const k of shuffle(rng, misses.slice())) {
      hash.delete(k);
      map.delete(k);
    }
  }
  // sum of key + value over live entries
  let expected = 0;
  for (const k of keys) {
    expected += 2 * k;
  }
  return { hash, map, expected };
}

function forOfHash(m: HashMap<number, number>): () => number {
  return () => {
    let s = 0;
    for (const [k, v] of m) {
      s += k + v;
    }
    return s;
  };
}
function forOfMap(m: Map<number, number>): () => number {
  return () => {
    let s = 0;
    for (const [k, v] of m) {
      s += k + v;
    }
    return s;
  };
}
function keysValuesHash(m: HashMap<number, number>): () => number {
  return () => {
    let s = 0;
    for (const k of m.keys()) {
      s += k;
    }
    for (const v of m.values()) {
      s += v;
    }
    return s;
  };
}
function keysValuesMap(m: Map<number, number>): () => number {
  return () => {
    let s = 0;
    for (const k of m.keys()) {
      s += k;
    }
    for (const v of m.values()) {
      s += v;
    }
    return s;
  };
}
function forEachHash(m: HashMap<number, number>): () => number {
  return () => {
    let s = 0;
    m.forEach((v, k) => {
      s += k + v;
    });
    return s;
  };
}
function forEachMap(m: Map<number, number>): () => number {
  return () => {
    let s = 0;
    m.forEach((v, k) => {
      s += k + v;
    });
    return s;
  };
}
function toArrayHash(m: HashMap<number, number>): () => number {
  return () =>
    2 *
    m
      .keys()
      .toArray()
      .reduce((a, b) => a + b, 0);
}
function toArrayMap(m: Map<number, number>): () => number {
  return () =>
    2 *
    m
      .keys()
      .toArray()
      .reduce((a, b) => a + b, 0);
}

const VARIANTS = [
  { name: 'for..of entries', hash: forOfHash, map: forOfMap, opsPerEntry: 1 },
  { name: 'keys() + values()', hash: keysValuesHash, map: keysValuesMap, opsPerEntry: 2 },
  { name: 'forEach', hash: forEachHash, map: forEachMap, opsPerEntry: 1 },
  { name: 'keys().toArray()', hash: toArrayHash, map: toArrayMap, opsPerEntry: 1 },
];

for (const deleteHalf of [false, true]) {
  for (const n of sizes(PRIMITIVE_SIZES)) {
    for (const v of VARIANTS) {
      if (deleteHalf && v.name !== 'for..of entries') {
        continue;
      }
      const label = `${v.name}${deleteHalf ? ' after deleting half' : ''}`;
      group(`${label} n=${n}`, { n, series: label }, () => {
        const { hash, map, expected } = build(n, deleteHalf);
        const ops = n * v.opsPerEntry;
        return {
          expect: expected,
          info: 'op = one entry visited',
          cases: [
            staticCase('Map', ops, v.map(map), { baseline: true }),
            staticCase('HashMap', ops, v.hash(hash)),
          ],
        };
      });
    }
  }
}

// ---- structural keys: the same walk, with object keys (after the int groups, so their feedback
// stays monomorphic) ----

type Tuple = [number, number];

interface StructuralKind<K> {
  label: string;
  generate: (n: number) => K[];
  /** A number read off the key, so the checksum touches every key. */
  weight: (key: K) => number;
}

const USER: StructuralKind<UserKey> = {
  label: 'user-record',
  generate: (n) => users(n, rngFor(`iteration:user-record:${n}`)).keys,
  weight: (u) => u.id,
};
const TUPLE: StructuralKind<Tuple> = {
  label: 'tuple',
  generate: (n) => tuples(n, rngFor(`iteration:tuple:${n}`)).keys,
  weight: (t) => t[0] + t[1],
};

// Written out per kind and implementation (no shared adapter), like the int bodies above.
function userEntriesHash(m: HashMap<UserKey, number>): () => number {
  return () => {
    let s = 0;
    for (const [k, v] of m) {
      s += k.id + v;
    }
    return s;
  };
}
function userEntriesMap(m: Map<UserKey, number>): () => number {
  return () => {
    let s = 0;
    for (const [k, v] of m) {
      s += k.id + v;
    }
    return s;
  };
}
function userKeysHash(m: HashMap<UserKey, number>): () => number {
  return () => {
    let s = 0;
    for (const k of m.keys()) {
      s += k.id;
    }
    return s;
  };
}
function userKeysMap(m: Map<UserKey, number>): () => number {
  return () => {
    let s = 0;
    for (const k of m.keys()) {
      s += k.id;
    }
    return s;
  };
}
function tupleEntriesHash(m: HashMap<Tuple, number>): () => number {
  return () => {
    let s = 0;
    for (const [k, v] of m) {
      s += k[0] + k[1] + v;
    }
    return s;
  };
}
function tupleEntriesMap(m: Map<Tuple, number>): () => number {
  return () => {
    let s = 0;
    for (const [k, v] of m) {
      s += k[0] + k[1] + v;
    }
    return s;
  };
}
function tupleKeysHash(m: HashMap<Tuple, number>): () => number {
  return () => {
    let s = 0;
    for (const k of m.keys()) {
      s += k[0] + k[1];
    }
    return s;
  };
}
function tupleKeysMap(m: Map<Tuple, number>): () => number {
  return () => {
    let s = 0;
    for (const k of m.keys()) {
      s += k[0] + k[1];
    }
    return s;
  };
}
function valuesHash(m: HashMap<unknown, number>): () => number {
  return () => {
    let s = 0;
    for (const v of m.values()) {
      s += v;
    }
    return s;
  };
}
function valuesMap(m: Map<unknown, number>): () => number {
  return () => {
    let s = 0;
    for (const v of m.values()) {
      s += v;
    }
    return s;
  };
}

type Bodies<K> = {
  name: string;
  hash: (m: HashMap<K, number>) => () => number;
  map: (m: Map<K, number>) => () => number;
  expected: (keys: K[], weight: (key: K) => number) => number;
};

const sumValues = (n: number): number => (n * (n - 1)) / 2;
const sumWeights = <K>(keys: K[], weight: (key: K) => number): number =>
  keys.reduce((a, k) => a + weight(k), 0);

function structuralGroups<K>(kind: StructuralKind<K>, bodies: Bodies<K>[]): void {
  for (const n of sizes([1_000])) {
    for (const b of bodies) {
      const label = `${kind.label} ${b.name}`;
      group(`${label} n=${n}`, { n, series: label }, () => {
        const keys = kind.generate(n);
        const hash = new HashMap<K, number>();
        const map = new Map<K, number>();
        keys.forEach((k, i) => {
          hash.set(k, i);
          map.set(k, i);
        });
        return {
          expect: b.expected(keys, kind.weight),
          info: 'op = one entry visited; values are 0..n-1',
          cases: [
            staticCase('Map (same key objects)', n, b.map(map), { baseline: true }),
            staticCase('HashMap', n, b.hash(hash)),
          ],
        };
      });
    }
  }
}

const valuesBodies = {
  name: 'values()',
  hash: valuesHash,
  map: valuesMap,
  expected: (keys: unknown[]) => sumValues(keys.length),
};

structuralGroups(USER, [
  {
    name: 'for..of entries',
    hash: userEntriesHash,
    map: userEntriesMap,
    expected: (keys, w) => sumWeights(keys, w) + sumValues(keys.length),
  },
  { name: 'keys()', hash: userKeysHash, map: userKeysMap, expected: sumWeights },
  valuesBodies,
]);
structuralGroups(TUPLE, [
  {
    name: 'for..of entries',
    hash: tupleEntriesHash,
    map: tupleEntriesMap,
    expected: (keys, w) => sumWeights(keys, w) + sumValues(keys.length),
  },
  { name: 'keys()', hash: tupleKeysHash, map: tupleKeysMap, expected: sumWeights },
  valuesBodies,
]);

await runFamily('iteration');
