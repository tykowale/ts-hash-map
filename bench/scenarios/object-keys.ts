/**
 * Flat record keys and Date keys. Lookups use structurally equal clones built ahead of time: the
 * library's reason to exist is that a *different* object with the same contents finds the entry,
 * and `isEqual` short-circuits on `===`, so looking up with the inserted reference would skip the
 * deep comparison users actually pay for. The same-reference row is kept to show that gap.
 *
 * The baseline is what users would write without this library: a native Map keyed by
 * fast-json-stable-stringify(key), with the stringify call inside the timed region on every op.
 *
 * Shape variety comes last, so it cannot change the feedback the single-shape groups above see:
 * `record-shapes` mixes four record shapes with optional fields in one map, and `record-16` is a
 * single 16-field shape. A fast path that only pays off for one hidden class, or for five fields,
 * shows up here.
 */
import stringify from 'fast-json-stable-stringify';
import { STRUCTURAL_SIZES, sizes } from '../lib/config.ts';
import { runFamily } from '../lib/harness.ts';
import {
  dates,
  shapedRecords,
  users,
  wideRecords,
  type ShapedRecord,
  type UserKey,
  type WideRecord,
} from '../lib/keys.ts';
import { keySuite, type Impl } from '../lib/scenarios.ts';

const userImpls: Impl<UserKey>[] = [
  { kind: 'map-fn', name: 'Map + stable-stringify', keyFn: stringify, baseline: true },
  { kind: 'hash', name: 'HashMap (equal clone)', lookup: 'clone' },
  {
    kind: 'hash',
    name: 'HashMap (same reference)',
    lookup: 'same',
    only: ['get-hit'],
    note: 'skips isEqual via ===',
  },
  {
    kind: 'hash',
    name: 'HashMap (custom hash/eq on id)',
    lookup: 'clone',
    options: {
      hashFn: (u) => (u as UserKey).id,
      equalsFn: (a, b) => (a as UserKey).id === (b as UserKey).id,
    },
  },
  {
    kind: 'map-fn',
    name: 'Map + JSON.stringify',
    keyFn: (u) => JSON.stringify(u),
    only: ['get-hit', 'set-fresh'],
    note: 'key-order sensitive',
  },
  {
    kind: 'map',
    name: 'Map (precomputed stringify)',
    derive: stringify,
    only: ['get-hit'],
    note: 'floor: key string built outside the timed region',
  },
  {
    kind: 'map',
    name: 'Map (by id)',
    derive: (u) => u.id,
    only: ['get-hit', 'set-fresh'],
    note: 'what the custom hash/eq pair can approach',
  },
  {
    kind: 'map',
    name: 'Map (identity)',
    only: ['get-hit', 'set-fresh', 'delete-all'],
    note: 'reference keys, not semantically equivalent',
  },
];

keySuite({
  label: 'user-record',
  sizes: sizes(STRUCTURAL_SIZES),
  generate: users,
  impls: userImpls,
  ops: ['get-hit', 'get-miss', 'set-fresh', 'update', 'churn', 'delete-all'],
});

const dateImpls: Impl<Date>[] = [
  { kind: 'map-fn', name: 'Map + stable-stringify', keyFn: stringify, baseline: true },
  { kind: 'hash', name: 'HashMap (equal clone)', lookup: 'clone' },
  { kind: 'map', name: 'Map (by getTime)', derive: (d) => d.getTime(), note: 'precomputed floor' },
  { kind: 'map', name: 'Map (identity)', note: 'reference keys, not semantically equivalent' },
];

keySuite({
  label: 'date',
  sizes: sizes(STRUCTURAL_SIZES),
  generate: dates,
  impls: dateImpls,
  ops: ['get-hit', 'set-fresh'],
});

const shapeImpls = <K>(): Impl<K>[] => [
  { kind: 'map-fn', name: 'Map + stable-stringify', keyFn: stringify, baseline: true },
  { kind: 'hash', name: 'HashMap (equal clone)', lookup: 'clone' },
  {
    kind: 'map',
    name: 'Map (precomputed stringify)',
    derive: stringify,
    only: ['get-hit'],
    note: 'floor: key string built outside the timed region',
  },
];

keySuite<ShapedRecord>({
  label: 'record-shapes',
  sizes: sizes(STRUCTURAL_SIZES),
  generate: shapedRecords,
  impls: shapeImpls(),
  ops: ['get-hit', 'get-miss', 'set-fresh', 'churn'],
});

keySuite<WideRecord>({
  label: 'record-16',
  sizes: sizes(STRUCTURAL_SIZES),
  generate: wideRecords,
  impls: shapeImpls(),
  ops: ['get-hit', 'get-miss', 'set-fresh'],
});

await runFamily('object-keys');
