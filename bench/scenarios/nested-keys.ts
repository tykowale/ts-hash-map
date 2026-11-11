/**
 * Depth-3 object keys with an array inside: every hash and every equality check recurses.
 * Lookups use equal clones (structuredClone, built before timing).
 */
import stringify from 'fast-json-stable-stringify';
import { STRUCTURAL_SIZES, sizes } from '../lib/config.ts';
import { runFamily } from '../lib/harness.ts';
import { nested, type NestedKey } from '../lib/keys.ts';
import { keySuite, type Impl } from '../lib/scenarios.ts';

const impls: Impl<NestedKey>[] = [
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
    kind: 'map',
    name: 'Map (identity)',
    only: ['get-hit', 'set-fresh'],
    note: 'reference keys, not semantically equivalent',
  },
];

keySuite({
  label: 'nested',
  sizes: sizes(STRUCTURAL_SIZES),
  generate: nested,
  impls,
  ops: ['get-hit', 'get-miss', 'set-fresh', 'update', 'churn'],
});

await runFamily('nested-keys');
