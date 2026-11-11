/**
 * Mixed read/write patterns on one map at a steady size, the shapes most application code has:
 *
 * - `<key> upsert zipf n=<n>`: a counter, `m.set(k, (m.get(k) ?? 0) + 1)`, over a seeded Zipf
 *   (s = 1) stream of the n keys, so a few hot keys take most of the traffic. Every op is a double
 *   lookup of the same key; this is the only workload where caching the last lookup could pay off.
 *   The map starts holding every key at 0, so its size stays n and every get hits.
 * - `<key> get90-set10 n=<n>`: 90% get / 10% set on existing keys in random order, exactly 922 gets
 *   and 102 sets per 1024-op call.
 *
 * op = one upsert, or one get or set. Structural keys are looked up with equal clones; the
 * stringify baseline computes the key string once per upsert, as hand-written code would.
 */
import stringify from 'fast-json-stable-stringify';
import { sizes } from '../lib/config.ts';
import { group, runFamily, staticCase, type CaseDef } from '../lib/harness.ts';
import {
  clone,
  rngFor,
  shuffle,
  smallInts,
  tuples,
  zipf,
  type KeySet,
  type Rng,
} from '../lib/keys.ts';
import { LOOKUPS, probeIndices } from '../lib/scenarios.ts';
import { HashMap } from '../lib/target.ts';

/** Upsert stream length, in LOOKUPS-sized calls: long enough that a call is not one hot window. */
const STREAM_WINDOWS = 16;
const ZIPF_S = 1;
const GETS_PER_CALL = Math.round(LOOKUPS * 0.9);

type KeyFn = (key: unknown) => string;
type HM = HashMap<unknown, number>;
type NM = Map<unknown, number>;
type SM = Map<string, number>;

interface Row {
  name: string;
  kind: 'hash' | 'map' | 'map-fn';
  keyFn?: KeyFn;
  baseline?: boolean;
  note?: string;
}

interface Kind {
  label: string;
  generate: (n: number, rng: Rng) => KeySet<unknown>;
  /** Look up with structurally equal clones (structural keys) or the inserted values. */
  clone: boolean;
  rows: Row[];
}

const tupleKey: KeyFn = (t) => {
  const [x, y] = t as [number, number];
  return `${x},${y}`;
};

const KINDS: Kind[] = [
  {
    label: 'int',
    generate: smallInts,
    clone: false,
    rows: [
      { name: 'Map', kind: 'map', baseline: true },
      { name: 'HashMap', kind: 'hash' },
    ],
  },
  {
    label: 'tuple',
    generate: tuples,
    clone: true,
    rows: [
      { name: 'Map + stable-stringify', kind: 'map-fn', keyFn: stringify, baseline: true },
      { name: 'HashMap (equal clone)', kind: 'hash' },
      { name: 'Map + `${x},${y}`', kind: 'map-fn', keyFn: tupleKey, note: 'hand-written key' },
    ],
  },
];

// ---- timed bodies, written out per implementation ----

function hashUpsert(m: HM, stream: unknown[]): () => number {
  let cur = 0;
  const len = stream.length;
  return () => {
    let found = 0;
    for (let i = 0; i < LOOKUPS; i++) {
      const k = stream[cur];
      const v = m.get(k);
      if (v !== undefined) {
        found++;
      }
      m.set(k, (v ?? 0) + 1);
      if (++cur === len) {
        cur = 0;
      }
    }
    return found;
  };
}

function mapUpsert(m: NM, stream: unknown[]): () => number {
  let cur = 0;
  const len = stream.length;
  return () => {
    let found = 0;
    for (let i = 0; i < LOOKUPS; i++) {
      const k = stream[cur];
      const v = m.get(k);
      if (v !== undefined) {
        found++;
      }
      m.set(k, (v ?? 0) + 1);
      if (++cur === len) {
        cur = 0;
      }
    }
    return found;
  };
}

function fnUpsert(m: SM, stream: unknown[], keyFn: KeyFn): () => number {
  let cur = 0;
  const len = stream.length;
  return () => {
    let found = 0;
    for (let i = 0; i < LOOKUPS; i++) {
      const k = keyFn(stream[cur]);
      const v = m.get(k);
      if (v !== undefined) {
        found++;
      }
      m.set(k, (v ?? 0) + 1);
      if (++cur === len) {
        cur = 0;
      }
    }
    return found;
  };
}

function hashMix(m: HM, probe: unknown[], isSet: Uint8Array): () => number {
  let cur = 0;
  const len = probe.length;
  return () => {
    let hits = 0;
    for (let i = 0; i < LOOKUPS; i++) {
      if (isSet[cur] === 1) {
        m.set(probe[cur], i);
      } else if (m.get(probe[cur]) !== undefined) {
        hits++;
      }
      if (++cur === len) {
        cur = 0;
      }
    }
    return hits;
  };
}

function mapMix(m: NM, probe: unknown[], isSet: Uint8Array): () => number {
  let cur = 0;
  const len = probe.length;
  return () => {
    let hits = 0;
    for (let i = 0; i < LOOKUPS; i++) {
      if (isSet[cur] === 1) {
        m.set(probe[cur], i);
      } else if (m.get(probe[cur]) !== undefined) {
        hits++;
      }
      if (++cur === len) {
        cur = 0;
      }
    }
    return hits;
  };
}

function fnMix(m: SM, probe: unknown[], isSet: Uint8Array, keyFn: KeyFn): () => number {
  let cur = 0;
  const len = probe.length;
  return () => {
    let hits = 0;
    for (let i = 0; i < LOOKUPS; i++) {
      if (isSet[cur] === 1) {
        m.set(keyFn(probe[cur]), i);
      } else if (m.get(keyFn(probe[cur])) !== undefined) {
        hits++;
      }
      if (++cur === len) {
        cur = 0;
      }
    }
    return hits;
  };
}

// ---- setup ----

/** A map of each row's kind holding every key with value 0. */
function prefilled(row: Row, keys: unknown[]): HM | NM | SM {
  if (row.kind === 'hash') {
    const m = new HashMap<unknown, number>();
    keys.forEach((k) => m.set(k, 0));
    return m;
  }
  if (row.kind === 'map') {
    return new Map(keys.map((k): [unknown, number] => [k, 0]));
  }
  const keyFn = row.keyFn!;
  return new Map(keys.map((k): [string, number] => [keyFn(k), 0]));
}

function upsertCase(row: Row, keys: unknown[], stream: unknown[]): CaseDef {
  const m = prefilled(row, keys);
  const options = { baseline: row.baseline, note: row.note };
  const run =
    row.kind === 'hash'
      ? hashUpsert(m as HM, stream)
      : row.kind === 'map'
        ? mapUpsert(m, stream)
        : fnUpsert(m as SM, stream, row.keyFn!);
  return staticCase(row.name, LOOKUPS, run, options);
}

function mixCase(row: Row, keys: unknown[], probe: unknown[], isSet: Uint8Array): CaseDef {
  const m = prefilled(row, keys);
  const options = { baseline: row.baseline, note: row.note };
  const run =
    row.kind === 'hash'
      ? hashMix(m as HM, probe, isSet)
      : row.kind === 'map'
        ? mapMix(m, probe, isSet)
        : fnMix(m as SM, probe, isSet, row.keyFn!);
  return staticCase(row.name, LOOKUPS, run, options);
}

/** Exactly LOOKUPS - GETS_PER_CALL sets in every LOOKUPS-sized window, at shuffled positions. */
function setMask(length: number, rng: Rng): Uint8Array {
  const out = new Uint8Array(length);
  for (let w = 0; w < length; w += LOOKUPS) {
    const win = Array.from({ length: LOOKUPS }, (_, i) => (i < GETS_PER_CALL ? 0 : 1));
    out.set(shuffle(rng, win), w);
  }
  return out;
}

for (const kind of KINDS) {
  for (const n of sizes([1_000], [10, 100])) {
    const copy = kind.clone ? clone : (k: unknown) => k;

    group(`${kind.label} upsert zipf n=${n}`, { n, series: `${kind.label} upsert zipf` }, () => {
      const rng = rngFor(`read-write:${kind.label}:upsert:${n}`);
      const { keys } = kind.generate(n, rng);
      const draw = zipf(n, ZIPF_S, rng);
      // One structurally equal copy per stream position, like a key parsed from each event.
      const stream = Array.from({ length: STREAM_WINDOWS * LOOKUPS }, () => copy(keys[draw()]));
      return {
        expect: LOOKUPS,
        info: `m.set(k, (m.get(k) ?? 0) + 1) over a Zipf(s=${ZIPF_S}) stream; op = one upsert`,
        cases: kind.rows.map((row) => upsertCase(row, keys, stream)),
      };
    });

    group(`${kind.label} get90-set10 n=${n}`, { n, series: `${kind.label} get90-set10` }, () => {
      const rng = rngFor(`read-write:${kind.label}:mix:${n}`);
      const { keys } = kind.generate(n, rng);
      const idx = probeIndices(n, 1, 'random', rng);
      const probe = Array.from(idx, (i) => copy(keys[i]));
      const isSet = setMask(idx.length, rng);
      return {
        expect: GETS_PER_CALL,
        info: `${GETS_PER_CALL} gets + ${LOOKUPS - GETS_PER_CALL} sets on existing keys per call; op = one get or set`,
        cases: kind.rows.map((row) => mixCase(row, keys, probe, isSet)),
      };
    });
  }
}

await runFamily('read-write');
