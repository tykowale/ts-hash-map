/**
 * getHashCode(key) and isEqual(a, clone) alone, per key shape, so a Map-level regression can be
 * traced to hashing, equality or the table. stable-stringify is the reference: it is the per-op
 * cost of the "stringify and use a native Map" alternative. These are internal functions, so they
 * are always loaded from <root>/src, even with --dist.
 */
import stringify from 'fast-json-stable-stringify';
import { group, runFamily, staticCase, type CaseDef } from '../lib/harness.ts';
import {
  clone,
  dates,
  floats,
  nested,
  randomString,
  rngFor,
  smallInts,
  strings,
  tuples,
  users,
  uuids,
  type Rng,
} from '../lib/keys.ts';
import { loadInternals, type EqualsFn, type HashFn } from '../lib/target.ts';

/** Distinct keys per timed call; each call hashes all of them once. */
const K = 256;

function wideRecord(rng: Rng, props: number): Record<string, number | string> {
  const o: Record<string, number | string> = {};
  for (let i = 0; i < props; i++) {
    o[`field${i}`] = i % 2 ? randomString(rng, 6) : Math.floor(rng() * 1e6);
  }
  return o;
}

function objectSet(rng: Rng, members: number): Set<{ id: number; name: string }> {
  return new Set(
    Array.from({ length: members }, () => ({
      id: Math.floor(rng() * 1e9),
      name: randomString(rng, 6),
    })),
  );
}

function cyclic(rng: Rng): Record<string, unknown> {
  const o: Record<string, unknown> = { id: Math.floor(rng() * 1e9), name: randomString(rng, 8) };
  o.self = o;
  return o;
}

interface Shape {
  name: string;
  make: (rng: Rng) => unknown[];
  /** stringify can't represent this shape faithfully (Set, cycles, bigint), so skip it. */
  noStringify?: boolean;
  /** isEqual rows are only meaningful for structural shapes. */
  structural?: boolean;
  /**
   * Builds the equals pair from `make`'s keys; default: a structuredClone of each (same property
   * order). The hash group hashes `pair(keys)`, and every pair must hash alike.
   */
  pair?: (keys: unknown[]) => unknown[];
  /** Name of the isEqual row comparing a key to its pair. */
  pairLabel?: string;
}

/** The same record with its properties in reverse insertion order. */
function reversedProps(key: unknown): unknown {
  return Object.fromEntries(Object.entries(key as Record<string, unknown>).toReversed());
}

const SHAPES: Shape[] = [
  { name: 'int', make: (r) => smallInts(K, r).keys },
  { name: 'float', make: (r) => floats(K, r).keys },
  {
    name: 'bigint',
    make: (r) => smallInts(K, r).keys.map((i) => BigInt(i) * 1_000_000_007n),
    noStringify: true,
  },
  { name: 'string-8', make: (r) => strings(K, r, 8).keys },
  { name: 'uuid', make: (r) => uuids(K, r).keys },
  { name: 'string-1000', make: (r) => strings(K, r, 1000).keys },
  { name: 'user-record (5 props)', make: (r) => users(K, r).keys, structural: true },
  {
    name: 'record (32 props)',
    make: (r) => Array.from({ length: K }, () => wideRecord(r, 32)),
    structural: true,
  },
  { name: 'tuple [x, y]', make: (r) => tuples(K, r).keys, structural: true },
  {
    name: 'array (100 numbers)',
    make: (r) =>
      Array.from({ length: K }, () => Array.from({ length: 100 }, () => Math.floor(r() * 1e6))),
    structural: true,
  },
  { name: 'nested (depth 3)', make: (r) => nested(K, r).keys, structural: true },
  { name: 'Date', make: (r) => dates(K, r).keys, structural: true },
  {
    name: 'Set of 10 objects',
    make: (r) => Array.from({ length: K }, () => objectSet(r, 10)),
    noStringify: true,
    structural: true,
  },
  {
    name: 'cyclic object (worst case)',
    make: (r) => Array.from({ length: K }, () => cyclic(r)),
    noStringify: true,
    structural: true,
  },
  {
    name: 'user-record, reordered props',
    // a = normal-order user records, b = the same records with properties in reverse order, so
    // isEqual cannot take its same-position key fast path
    make: (r) => users(K, r).keys,
    pair: (keys) => keys.map(reversedProps),
    pairLabel: 'isEqual(a, reordered copy)',
    structural: true,
  },
];

function hashAll(hash: HashFn, keys: unknown[]): () => number {
  return () => {
    let acc = 0;
    for (let i = 0; i < keys.length; i++) {
      acc = (acc + hash(keys[i])) | 0;
    }
    return acc;
  };
}

function stringifyAll(keys: unknown[]): () => number {
  return () => {
    let len = 0;
    for (let i = 0; i < keys.length; i++) {
      len += stringify(keys[i]).length;
    }
    return len;
  };
}

function equalAll(eq: EqualsFn, a: unknown[], b: unknown[]): () => number {
  return () => {
    let same = 0;
    for (let i = 0; i < a.length; i++) {
      if (eq(a[i], b[i])) {
        same++;
      }
    }
    return same;
  };
}

function stringifyEqualAll(a: unknown[], b: unknown[]): () => number {
  return () => {
    let same = 0;
    for (let i = 0; i < a.length; i++) {
      if (stringify(a[i]) === stringify(b[i])) {
        same++;
      }
    }
    return same;
  };
}

const internals = await loadInternals();
if (!internals) {
  console.log(
    'hash-equals: target has no src/hash.ts getHashCode / src/is-equal.ts isEqual; skipping',
  );
} else {
  const { getHashCode, isEqual } = internals;
  for (const shape of SHAPES) {
    group(`hash ${shape.name}`, {}, () => {
      const made = shape.make(rngFor(`hash:${shape.name}`));
      const keys = shape.pair ? shape.pair(made) : made;
      if (shape.pair) {
        // the pair must hash like the original, or HashMap would never find it
        for (let i = 0; i < keys.length; i++) {
          if (getHashCode(keys[i]) !== getHashCode(made[i])) {
            throw new Error(`${shape.name}: key ${i} hashes differently from its pair`);
          }
        }
      }
      const expected = hashAll(getHashCode, keys)();
      const cases: CaseDef[] = [];
      if (!shape.noStringify) {
        cases.push(
          staticCase('stable-stringify', K, stringifyAll(keys), {
            baseline: true,
            expect: stringifyAll(keys)(),
          }),
        );
      }
      cases.push(
        staticCase('getHashCode', K, hashAll(getHashCode, keys), {
          expect: expected,
        }),
      );
      return { info: 'op = hash one key', cases };
    });

    if (shape.structural) {
      group(`equals ${shape.name}`, {}, () => {
        const a = shape.make(rngFor(`eq:${shape.name}`));
        const b = shape.pair ? shape.pair(a) : a.map((k) => clone(k));
        const cases: CaseDef[] = [];
        if (!shape.noStringify) {
          cases.push(
            staticCase('stringify(a) === stringify(b)', K, stringifyEqualAll(a, b), {
              baseline: true,
            }),
          );
        }
        cases.push(
          staticCase(shape.pairLabel ?? 'isEqual(a, clone)', K, equalAll(isEqual, a, b)),
          staticCase('isEqual(a, a)', K, equalAll(isEqual, a, a), { note: '=== fast path' }),
        );
        return { expect: K, info: 'op = compare one pair of equal keys', cases };
      });
    }
  }
}

await runFamily('hash-equals');
