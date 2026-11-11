/**
 * Collision scenarios built from this library's own hash (see bench/README.md). They document
 * hash-flooding exposure and catch regressions in chain handling; they are not a Map comparison
 * (V8 hashes differently), so each group's baseline is HashMap with well-spread keys of the same
 * type and count. A linear chain shows up as ~8x per-op growth per size step (64 -> 512 -> 4096).
 */
import { config, sizes } from '../lib/config.ts';
import { freshCase, group, runFamily, staticCase } from '../lib/harness.ts';
import {
  collidingInts,
  collidingStrings,
  rngFor,
  shuffle,
  sparseInts,
  strings,
} from '../lib/keys.ts';
import { HashMap, type HashMapOptions } from '../lib/target.ts';

type HM = HashMap<unknown, number>;

/** Reads private fields, as the collision tests do, to explain a slowdown with numbers. */
function chainStats(m: HM): string {
  const internals = m as unknown as {
    table: Array<{ next: unknown } | undefined>;
    capacity: number;
  };
  let used = 0;
  let longest = 0;
  for (const head of internals.table) {
    let len = 0;
    for (let node: { next: unknown } | undefined = head; node; node = node.next as typeof head) {
      len++;
    }
    if (len > 0) {
      used++;
    }
    longest = Math.max(longest, len);
  }
  return `capacity ${internals.capacity}, ${used} buckets used, longest chain ${longest}`;
}

function build(keys: unknown[], options: HashMapOptions): HM {
  const m = new HashMap<unknown, number>(options);
  keys.forEach((k, i) => m.set(k, i));
  return m;
}

function getAll(m: HM, probe: unknown[]): () => number {
  return () => {
    let hits = 0;
    for (let i = 0; i < probe.length; i++) {
      if (m.get(probe[i]) !== undefined) {
        hits++;
      }
    }
    return hits;
  };
}

function fill(keys: unknown[], options: HashMapOptions): () => number {
  return () => {
    const m = new HashMap<unknown, number>(options);
    for (let i = 0; i < keys.length; i++) {
      m.set(keys[i], i);
    }
    return m.size;
  };
}

function deleteAll(m: HM, del: unknown[]): number {
  let deleted = 0;
  for (let i = 0; i < del.length; i++) {
    if (m.delete(del[i])) {
      deleted++;
    }
  }
  return deleted;
}

interface Workload {
  label: string;
  bad: (n: number) => unknown[];
  good: (n: number) => unknown[];
  options?: HashMapOptions;
  goodName: string;
}

const constantHash: HashMapOptions = { hashFn: () => 0 };

const WORKLOADS: Workload[] = [
  {
    label: 'colliding ints (i << 16)',
    bad: collidingInts,
    good: (n) => sparseInts(n, rngFor(`adv-int:${n}`)).keys,
    goodName: 'HashMap (random ints)',
  },
  {
    label: 'colliding strings (Aa/BB)',
    bad: collidingStrings,
    good: (n) => {
      const len = collidingStrings(n)[0]!.length;
      return strings(n, rngFor(`adv-str:${n}`), len).keys;
    },
    goodName: 'HashMap (random strings, same length)',
  },
  {
    label: 'constant hashFn (() => 0)',
    bad: (n) => sparseInts(n, rngFor(`adv-const:${n}`)).keys,
    good: (n) => sparseInts(n, rngFor(`adv-const:${n}`)).keys,
    options: constantHash,
    goodName: 'HashMap (default hash)',
  },
];

for (const w of WORKLOADS) {
  for (const n of sizes([64, 512, 4096], [64, 512])) {
    const prep = () => {
      const rng = rngFor(`adv:${w.label}:${n}`);
      const bad = w.bad(n);
      const good = w.good(n);
      return {
        bad,
        good,
        badProbe: shuffle(rng, bad.slice()),
        goodProbe: shuffle(rng, good.slice()),
        badOpts: w.options ?? {},
      };
    };

    group(`${w.label} get n=${n}`, { n, series: `${w.label} get` }, () => {
      const d = prep();
      const badMap = build(d.bad, d.badOpts);
      return {
        expect: n,
        info: `get every key, random order; ${chainStats(badMap)}`,
        cases: [
          staticCase(w.goodName, n, getAll(build(d.good, {}), d.goodProbe), { baseline: true }),
          staticCase('HashMap (colliding)', n, getAll(badMap, d.badProbe)),
        ],
      };
    });

    group(`${w.label} set n=${n}`, { n, series: `${w.label} set` }, () => {
      const d = prep();
      return {
        expect: n,
        info: 'build n keys from empty; op = one set',
        cases: [
          staticCase(w.goodName, n, fill(d.good, {}), { baseline: true }),
          staticCase('HashMap (colliding)', n, fill(d.bad, d.badOpts)),
        ],
      };
    });

    group(`${w.label} delete n=${n}`, { n, series: `${w.label} delete` }, () => {
      const d = prep();
      return {
        expect: n,
        info: 'delete every key of a full map, random order',
        cases: [
          freshCase(
            w.goodName,
            n,
            () => build(d.good, {}),
            (m) => deleteAll(m, d.goodProbe),
            { baseline: true },
          ),
          freshCase(
            'HashMap (colliding)',
            n,
            () => build(d.bad, d.badOpts),
            (m) => deleteAll(m, d.badProbe),
          ),
        ],
      };
    });
  }
}

// High load factor: the table stays small, so chains average ~8 nodes.
const LF_N = config.smoke ? 512 : 4096;
group(`loadFactor 8 get n=${LF_N}`, { n: LF_N }, () => {
  const keys = sparseInts(LF_N, rngFor('adv-lf')).keys;
  const probe = shuffle(rngFor('adv-lf-probe'), keys.slice());
  const dense = build(keys, { loadFactor: 8 });
  return {
    expect: LF_N,
    info: `loadFactor 8: ${chainStats(dense)}`,
    cases: [
      staticCase('HashMap (loadFactor 0.75)', LF_N, getAll(build(keys, {}), probe), {
        baseline: true,
      }),
      staticCase('HashMap (loadFactor 8)', LF_N, getAll(dense, probe)),
    ],
  };
});

await runFamily('adversarial');
