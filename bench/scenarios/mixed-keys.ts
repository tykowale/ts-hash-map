/**
 * One map holding several key types at once (ints, strings, records, tuples, Dates). Real apps do
 * this, and it is the one place where getHashCode / isEqual see every type at the same call site,
 * so it is deliberately run in its own process apart from the single-type families.
 */
import stringify from 'fast-json-stable-stringify';
import { STRUCTURAL_SIZES, sizes } from '../lib/config.ts';
import { runFamily } from '../lib/harness.ts';
import {
  dates,
  shuffle,
  smallInts,
  strings,
  tuples,
  users,
  type KeySet,
  type Rng,
} from '../lib/keys.ts';
import { keySuite, type Impl } from '../lib/scenarios.ts';

function mixed(n: number, rng: Rng): KeySet<unknown> {
  const per = Math.ceil(n / 5);
  const parts: KeySet<unknown>[] = [
    smallInts(per, rng),
    strings(per, rng, 12),
    users(per, rng),
    tuples(per, rng),
    dates(per, rng),
  ];
  const keys = shuffle(
    rng,
    parts.flatMap((p) => p.keys),
  ).slice(0, n);
  const misses = shuffle(
    rng,
    parts.flatMap((p) => p.misses),
  ).slice(0, n);
  return { keys, misses };
}

const impls: Impl<unknown>[] = [
  { kind: 'map-fn', name: 'Map + stable-stringify', keyFn: stringify, baseline: true },
  { kind: 'hash', name: 'HashMap (equal clone)', lookup: 'clone' },
];

keySuite({
  label: 'mixed',
  sizes: sizes(STRUCTURAL_SIZES),
  generate: mixed,
  impls,
  ops: ['get-hit', 'get-miss', 'set-fresh', 'churn'],
});

await runFamily('mixed-keys');
