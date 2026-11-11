/**
 * Iteration over n entries. HashMap walks a doubly linked insertion-order list; entries() and
 * for..of also allocate a [k, v] tuple per step, keys()/values() allocate an iterator result.
 * The "after deletes" groups iterate a map that grew to 2n and then lost half its entries.
 */
import { PRIMITIVE_SIZES, sizes } from '../lib/config.ts';
import { group, runFamily, staticCase } from '../lib/harness.ts';
import { rngFor, shuffle, smallInts } from '../lib/keys.ts';
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

await runFamily('iteration');
