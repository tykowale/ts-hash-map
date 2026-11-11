/**
 * Number keys. Small ints hash to themselves (the fast path); sparse int32 values spread over the
 * whole range; floats go through the Float64Array bit-mixing path.
 */
import { PRIMITIVE_SIZES, sizes } from '../lib/config.ts';
import { runFamily } from '../lib/harness.ts';
import { floats, smallInts, sparseInts } from '../lib/keys.ts';
import { ALL_OPS, keySuite, type Impl } from '../lib/scenarios.ts';

const impls: Impl<number>[] = [
  { kind: 'map', name: 'Map', baseline: true },
  { kind: 'hash', name: 'HashMap', lookup: 'same' },
];

keySuite({ label: 'int', sizes: sizes(PRIMITIVE_SIZES), generate: smallInts, impls, ops: ALL_OPS });

keySuite({
  label: 'sparse-int',
  sizes: sizes(PRIMITIVE_SIZES),
  generate: sparseInts,
  impls,
  ops: ['get-hit', 'get-miss', 'set-fresh'],
});

keySuite({
  label: 'float',
  sizes: sizes(PRIMITIVE_SIZES),
  generate: floats,
  impls,
  ops: ['get-hit', 'get-miss', 'set-fresh'],
});

await runFamily('int-keys');
