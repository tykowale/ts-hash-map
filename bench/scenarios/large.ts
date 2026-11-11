/**
 * Opt-in large tier: int, fresh UUID strings and tuples at 1M entries, user records at 100k. The
 * default sizes stop at 100k primitive and 10k structural keys, which fit in cache and make little
 * GC pressure; table layout and per-node allocation mostly pay off (or cost) at this scale.
 *
 * Not part of the default run: `npm run bench -- --large` adds it, `npm run bench:large` runs it
 * alone (a few minutes and a few GB of heap). Smoke mode always includes it, at smoke sizes, so its
 * verification checks run in CI. Same labels, seeds and baselines as the single-type families, so
 * `large/int get-hit n=1000000` matches `int-keys/int get-hit` run with `--sizes 1000000`.
 */
import stringify from 'fast-json-stable-stringify';
import { sizes } from '../lib/config.ts';
import { runFamily } from '../lib/harness.ts';
import { flat, smallInts, tuples, users, uuids, type UserKey } from '../lib/keys.ts';
import { keySuite, type Impl, type Op } from '../lib/scenarios.ts';

const OPS: Op[] = ['get-hit', 'set-fresh', 'churn'];
const MILLION = sizes([1_000_000]);

const intImpls: Impl<number>[] = [
  { kind: 'map', name: 'Map', baseline: true },
  { kind: 'hash', name: 'HashMap', lookup: 'same' },
];
keySuite({ label: 'int', sizes: MILLION, generate: smallInts, impls: intImpls, ops: OPS });

// Fresh strings: lookups and set-fresh get flat copies made in untimed setup (see string-keys).
// churn is not supported with fresh copies, so it runs on the inserted instances.
const uuidImpls: Impl<string>[] = [
  { kind: 'map', name: 'Map (fresh strings)', baseline: true, fresh: flat },
  { kind: 'hash', name: 'HashMap (fresh strings)', lookup: 'same', fresh: flat },
];
keySuite({
  label: 'uuid-fresh',
  sizes: MILLION,
  generate: uuids,
  impls: uuidImpls,
  ops: ['get-hit', 'set-fresh'],
});
keySuite({
  label: 'uuid',
  sizes: MILLION,
  generate: uuids,
  impls: [
    { kind: 'map', name: 'Map (same instance)', baseline: true, note: 'V8 cached hash' },
    { kind: 'hash', name: 'HashMap (same instance)', lookup: 'same' },
  ],
  ops: ['churn'],
});

const tupleImpls: Impl<[number, number]>[] = [
  { kind: 'map-fn', name: 'Map + stable-stringify', keyFn: stringify, baseline: true },
  { kind: 'hash', name: 'HashMap (equal clone)', lookup: 'clone' },
];
keySuite({ label: 'tuple', sizes: MILLION, generate: tuples, impls: tupleImpls, ops: OPS });

const userImpls: Impl<UserKey>[] = [
  { kind: 'map-fn', name: 'Map + stable-stringify', keyFn: stringify, baseline: true },
  { kind: 'hash', name: 'HashMap (equal clone)', lookup: 'clone' },
];
keySuite({
  label: 'user-record',
  sizes: sizes([100_000]),
  generate: users,
  impls: userImpls,
  ops: OPS,
});

await runFamily('large');
