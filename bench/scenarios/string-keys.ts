/**
 * String keys. The hash is an O(length) `h * 31 + c` loop run on every operation (nothing is
 * cached), so cost scales with key length; misses use keys of the same length.
 *
 * Two lookup modes, in separate groups:
 * - same instance: every get and set reuses the string instances that were inserted. V8 caches a
 *   string's hash after its first use, so in the timed region a native Map never hashes or
 *   content-compares a key (a pointer match), while HashMap still runs its hash loop.
 * - fresh (`<label>-fresh` groups): each timed call gets flat copies of its keys made in untimed
 *   setup, like keys that come from JSON.parse, the network or a database. Map must hash each one
 *   and compare it by content against the stored key.
 */
import { PRIMITIVE_SIZES, sizes } from '../lib/config.ts';
import { runFamily } from '../lib/harness.ts';
import { flat, strings, uuids, type KeySet, type Rng } from '../lib/keys.ts';
import { keySuite, type Impl, type Op } from '../lib/scenarios.ts';

const sameImpls: Impl<string>[] = [
  { kind: 'map', name: 'Map (same instance)', baseline: true, note: 'V8 cached hash' },
  { kind: 'hash', name: 'HashMap (same instance)', lookup: 'same' },
];

const freshImpls: Impl<string>[] = [
  { kind: 'map', name: 'Map (fresh strings)', baseline: true, fresh: flat },
  { kind: 'hash', name: 'HashMap (fresh strings)', lookup: 'same', fresh: flat },
];

const ops: Op[] = ['get-hit', 'get-miss', 'get-50', 'set-fresh', 'update', 'churn'];

const LOOKUP_OPS: Op[] = ['get-hit', 'get-miss', 'get-50'];

function stringSuites(
  label: string,
  generate: (n: number, rng: Rng) => KeySet<string>,
  freshOps: Op[],
): void {
  keySuite({ label, sizes: sizes(PRIMITIVE_SIZES), generate, impls: sameImpls, ops });
  keySuite({
    label: `${label}-fresh`,
    sizes: sizes(PRIMITIVE_SIZES),
    generate,
    impls: freshImpls,
    ops: freshOps,
  });
}

stringSuites('string-8', (n, rng) => strings(n, rng, 8), LOOKUP_OPS);
stringSuites('uuid', uuids, [...LOOKUP_OPS, 'set-fresh']);
stringSuites('string-100', (n, rng) => strings(n, rng, 100), [...LOOKUP_OPS, 'set-fresh']);

await runFamily('string-keys');
