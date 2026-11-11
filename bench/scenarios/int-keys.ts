/**
 * Number keys. Small ints hash to themselves (the fast path); sparse int32 values spread over the
 * whole range; floats go through the Float64Array bit-mixing path.
 *
 * Strided ints have structure in their low bits, which is where the bucket index comes from
 * (`hash & (capacity - 1)`, and int32s hash to themselves): `strided-int` is `id * 1024`,
 * `tagged-int` is `id * 4 + 1`, and `timestamp-ms` holds millisecond timestamps (above 2^31, so
 * they take the float hash path). Dense `int` keys are a perfect bijection onto the buckets; these
 * show what happens when keys are not.
 */
import { PRIMITIVE_SIZES, sizes } from '../lib/config.ts';
import { runFamily } from '../lib/harness.ts';
import {
  floats,
  smallInts,
  sparseInts,
  stridedInts,
  taggedInts,
  timestampsMs,
} from '../lib/keys.ts';
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

for (const [label, generate] of [
  ['strided-int', stridedInts],
  ['tagged-int', taggedInts],
  ['timestamp-ms', timestampsMs],
] as const) {
  keySuite({
    label,
    sizes: sizes(PRIMITIVE_SIZES),
    generate,
    impls,
    ops: ['get-hit', 'get-miss', 'churn'],
  });
}

await runFamily('int-keys');
