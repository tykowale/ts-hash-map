/**
 * The same groups as the single-type families, measured after the library has seen every key
 * shape in this process. Each family file runs in its own process with one key type, so its
 * `getHashCode` / `isEqual` / `HashMap` call sites stay monomorphic, which flatters a
 * `typeof`-specialised fast path. A real app has ints, strings, records and tuples flowing through
 * the same library code, and sometimes a map with its own `hashFn`/`equalsFn`.
 *
 * Before any group is registered, `pollute()` builds HashMaps over every key shape the suite
 * generates (ints, sparse ints, floats, short and long strings, UUIDs, records, record shapes,
 * tuples, nested objects, Dates, mixed, bigints) plus one map with a custom `hashFn`/`equalsFn`,
 * and runs set, get on equal clones, has, delete and iteration on each, enough calls for V8 to
 * optimise the library with that feedback. The groups then use the same labels, seeds and
 * baselines as `int-keys`, `string-keys`, `object-keys` and `array-keys`, so
 * `polluted/int get-hit n=1000` is directly comparable with `int-keys/int get-hit n=1000`.
 *
 * Native Map rows are not polluted the same way (Map is a builtin with no type feedback of its
 * own), so a polluted HashMap/baseline ratio is the cost of the polluted library, not of both.
 */
import stringify from 'fast-json-stable-stringify';
import { config, sizes } from '../lib/config.ts';
import { runFamily } from '../lib/harness.ts';
import {
  clone,
  dates,
  flat,
  floats,
  mixed,
  nested,
  rngFor,
  shapedRecords,
  smallInts,
  sparseInts,
  strings,
  tuples,
  users,
  uuids,
  wideRecords,
  type KeySet,
  type UserKey,
} from '../lib/keys.ts';
import { keySuite, type Impl } from '../lib/scenarios.ts';
import { doNotOptimize } from '../lib/sink.ts';
import { HashMap, type HashMapOptions } from '../lib/target.ts';

// ---- pollution (untimed, once, before any group is built) ----

const POLLUTE_N = config.smoke ? 64 : 2_000;
const POLLUTE_ROUNDS = config.smoke ? 2 : 6;

interface Shape {
  name: string;
  set: KeySet<unknown>;
  options?: HashMapOptions;
}

function shapes(): Shape[] {
  const rng = rngFor('polluted:warmup');
  const n = POLLUTE_N;
  const bigints: KeySet<unknown> = {
    keys: Array.from({ length: n }, (_, i) => BigInt(i) * 1_000_003n),
    misses: Array.from({ length: n }, (_, i) => BigInt(n + i) * 1_000_003n),
  };
  return [
    { name: 'int', set: smallInts(n, rng) },
    { name: 'sparse-int', set: sparseInts(n, rng) },
    { name: 'float', set: floats(n, rng) },
    { name: 'string-8', set: strings(n, rng, 8) },
    { name: 'string-100', set: strings(n, rng, 100) },
    { name: 'uuid', set: uuids(n, rng) },
    { name: 'user-record', set: users(n, rng) },
    { name: 'record-shapes', set: shapedRecords(n, rng) },
    { name: 'record-16', set: wideRecords(n, rng) },
    { name: 'tuple', set: tuples(n, rng) },
    { name: 'nested', set: nested(n, rng) },
    { name: 'date', set: dates(n, rng) },
    { name: 'mixed', set: mixed(n, rng) },
    { name: 'bigint', set: bigints },
    {
      name: 'custom hash/eq',
      set: users(n, rng),
      options: {
        hashFn: (u) => (u as UserKey).id,
        equalsFn: (a, b) => (a as UserKey).id === (b as UserKey).id,
      },
    },
  ];
}

/** An equal key that is not the same reference (a flat copy for strings, a clone for objects). */
const copy = (k: unknown): unknown => (typeof k === 'string' ? flat(k) : clone(k));

/**
 * One round on one shape: insert every key, look up equal copies (fresh flat copies for strings),
 * probe misses, delete half, iterate. Returns a checksum; any wrong answer throws, so a broken
 * warmup cannot pass for pollution.
 */
function exercise(shape: Shape): number {
  const { keys, misses } = shape.set;
  const m = new HashMap<unknown, number>(shape.options ?? {});
  for (let i = 0; i < keys.length; i++) {
    m.set(keys[i], i);
  }
  let hits = 0;
  for (let i = 0; i < keys.length; i++) {
    if (m.get(copy(keys[i])) === i) {
      hits++;
    }
    if (m.has(copy(misses[i]))) {
      hits = Number.NaN;
    }
  }
  for (let i = 0; i < keys.length; i += 2) {
    m.delete(copy(keys[i]));
  }
  let visited = 0;
  for (const [, v] of m) {
    visited += v & 1;
  }
  for (const k of m.keys()) {
    doNotOptimize(k);
  }
  m.forEach((v) => doNotOptimize(v));
  const expectedLeft = Math.floor(keys.length / 2);
  if (hits !== keys.length || m.size !== expectedLeft || visited !== expectedLeft) {
    throw new Error(
      `polluted warmup: ${shape.name} got hits=${hits} size=${m.size}, expected ${keys.length}/${expectedLeft}`,
    );
  }
  return hits + m.size;
}

function pollute(): void {
  const all = shapes();
  let total = 0;
  for (let r = 0; r < POLLUTE_ROUNDS; r++) {
    for (const shape of all) {
      total += exercise(shape);
    }
  }
  doNotOptimize(total);
}

pollute();

// ---- the measured groups: same labels, seeds and baselines as the single-type families ----

const SIZES = sizes([10, 1_000]);

const intImpls: Impl<number>[] = [
  { kind: 'map', name: 'Map', baseline: true },
  { kind: 'hash', name: 'HashMap', lookup: 'same' },
];
keySuite({ label: 'int', sizes: SIZES, generate: smallInts, impls: intImpls, ops: ['get-hit'] });

const uuidImpls: Impl<string>[] = [
  { kind: 'map', name: 'Map (fresh strings)', baseline: true, fresh: flat },
  { kind: 'hash', name: 'HashMap (fresh strings)', lookup: 'same', fresh: flat },
];
keySuite({
  label: 'uuid-fresh',
  sizes: SIZES,
  generate: uuids,
  impls: uuidImpls,
  ops: ['get-hit'],
});

const userImpls: Impl<UserKey>[] = [
  { kind: 'map-fn', name: 'Map + stable-stringify', keyFn: stringify, baseline: true },
  { kind: 'hash', name: 'HashMap (equal clone)', lookup: 'clone' },
];
keySuite({
  label: 'user-record',
  sizes: SIZES,
  generate: users,
  impls: userImpls,
  ops: ['get-hit', 'set-fresh'],
});

const tupleImpls: Impl<[number, number]>[] = [
  { kind: 'map-fn', name: 'Map + stable-stringify', keyFn: stringify, baseline: true },
  { kind: 'hash', name: 'HashMap (equal clone)', lookup: 'clone' },
];
keySuite({ label: 'tuple', sizes: SIZES, generate: tuples, impls: tupleImpls, ops: ['get-hit'] });

await runFamily('polluted');
