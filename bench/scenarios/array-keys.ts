/**
 * `[x, y]` tuple keys, the most common structural key (grid coordinates, composite ids). Lookups
 * use equal clones; the baseline is a Map keyed by stable-stringify on every op, and the floor is
 * a Map keyed by a precomputed `${x},${y}` string.
 */
import stringify from 'fast-json-stable-stringify';
import { STRUCTURAL_SIZES, sizes } from '../lib/config.ts';
import { runFamily } from '../lib/harness.ts';
import { tuples } from '../lib/keys.ts';
import { keySuite, type Impl } from '../lib/scenarios.ts';

type Tuple = [number, number];

const impls: Impl<Tuple>[] = [
  { kind: 'map-fn', name: 'Map + stable-stringify', keyFn: stringify, baseline: true },
  { kind: 'hash', name: 'HashMap (equal clone)', lookup: 'clone' },
  {
    kind: 'map-fn',
    name: 'Map + `${x},${y}`',
    keyFn: (t) => {
      const [x, y] = t;
      return `${x},${y}`;
    },
    note: 'hand-written key',
  },
  {
    kind: 'map',
    name: 'Map (precomputed string)',
    derive: (t) => `${t[0]},${t[1]}`,
    only: ['get-hit', 'get-miss'],
    note: 'floor',
  },
];

keySuite({
  label: 'tuple',
  sizes: sizes(STRUCTURAL_SIZES),
  generate: tuples,
  impls,
  ops: ['get-hit', 'get-miss', 'set-fresh', 'update', 'churn'],
});

await runFamily('array-keys');
