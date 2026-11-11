/**
 * Deterministic data generators. Every random input in the suite comes from a seeded PRNG so a
 * run is reproducible: the same seed gives the same keys, probe order and collisions every time.
 */

export type Rng = () => number;

/** mulberry32: small, fast, good enough for shuffling benchmark inputs. Returns [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeds are derived from a label so each scenario gets its own stream without coordination. */
export function rngFor(label: string): Rng {
  let h = 2166136261;
  for (let i = 0; i < label.length; i++) {
    h = Math.imul(h ^ label.charCodeAt(i), 16777619);
  }
  return mulberry32(h);
}

export function randomInt(rng: Rng, maxExclusive: number): number {
  return Math.floor(rng() * maxExclusive);
}

/** In-place Fisher-Yates shuffle. */
export function shuffle<T>(rng: Rng, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1);
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
  return items;
}

/** `n` present keys plus `n` absent keys of the same shape, all distinct. */
export interface KeySet<K> {
  keys: K[];
  misses: K[];
}

/** Draws distinct values until it has `2n`, then splits them into present and absent keys. */
function distinct<K>(n: number, draw: () => K, id: (k: K) => unknown = (k) => k): KeySet<K> {
  const seen = new Set<unknown>();
  const all: K[] = [];
  while (all.length < 2 * n) {
    const k = draw();
    const kid = id(k);
    if (!seen.has(kid)) {
      seen.add(kid);
      all.push(k);
    }
  }
  return { keys: all.slice(0, n), misses: all.slice(n) };
}

// ---- primitive keys ----

/** 0..n-1 in random order; misses are n..2n-1. */
export function smallInts(n: number, rng: Rng): KeySet<number> {
  const keys = shuffle(
    rng,
    Array.from({ length: n }, (_, i) => i),
  );
  const misses = shuffle(
    rng,
    Array.from({ length: n }, (_, i) => n + i),
  );
  return { keys, misses };
}

/** Random int32 values spread over the whole range (hash to themselves, low bits vary). */
export function sparseInts(n: number, rng: Rng): KeySet<number> {
  return distinct(n, () => (randomInt(rng, 2 ** 32) - 2 ** 31) | 0);
}

/**
 * Multiples of 1024 (`id * 1024`, ids 0..2n-1 shuffled): ints whose low ten bits are all zero, like
 * ids from a strided allocator. Ints hash to themselves and the bucket is `hash & (capacity - 1)`,
 * so without a spread step these share a few buckets until capacity passes 2^10 * n.
 */
export function stridedInts(n: number, rng: Rng): KeySet<number> {
  const { keys, misses } = smallInts(n, rng);
  return { keys: keys.map((id) => id * 1024), misses: misses.map((id) => id * 1024) };
}

/**
 * Millisecond timestamps of events about 1 s apart from 2020-01-01 (random 1..2000 ms gaps), in
 * random order. They are integers above 2^31, so they take the float hash path, not the int32 one.
 */
export function timestampsMs(n: number, rng: Rng): KeySet<number> {
  const all: number[] = [];
  let t = Date.UTC(2020, 0, 1);
  for (let i = 0; i < 2 * n; i++) {
    t += 1 + randomInt(rng, 2000);
    all.push(t);
  }
  shuffle(rng, all);
  return { keys: all.slice(0, n), misses: all.slice(n) };
}

/**
 * Tagged ids `id * 4 + tag` with the tag fixed at 1 (one kind of entity per map), so the low two
 * bits never vary and three quarters of the buckets stay empty without a spread step.
 */
export function taggedInts(n: number, rng: Rng): KeySet<number> {
  const { keys, misses } = smallInts(n, rng);
  return { keys: keys.map((id) => id * 4 + 1), misses: misses.map((id) => id * 4 + 1) };
}

/** Non-integer doubles: these take the Float64Array bit-mixing hash path. */
export function floats(n: number, rng: Rng): KeySet<number> {
  return distinct(n, () => rng() * 1e6 + 0.5);
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * Built from char codes so the result is a flat string. Appending with `+=` would produce a V8
 * cons-string rope, which real keys (from JSON, the network, a database) almost never are.
 */
/** Copies a string into flat storage (template literals of 13+ chars build cons-string ropes). */
export function flat(s: string): string {
  return s.split('').join('');
}

export function randomString(rng: Rng, length: number): string {
  const codes = new Array<number>(length);
  for (let i = 0; i < length; i++) {
    codes[i] = ALPHABET.charCodeAt(randomInt(rng, ALPHABET.length));
  }
  return String.fromCharCode(...codes);
}

/** Fixed-length random strings; misses have the same length so hashing costs the same. */
export function strings(n: number, rng: Rng, length: number): KeySet<string> {
  return distinct(n, () => randomString(rng, length));
}

const HEX = '0123456789abcdef';

/** A UUID-v4-shaped string from the seeded PRNG (crypto.randomUUID is not reproducible). */
export function uuid(rng: Rng): string {
  const codes = new Array<number>(36);
  for (let i = 0; i < 36; i++) {
    let c: string;
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      c = '-';
    } else if (i === 14) {
      c = '4';
    } else if (i === 19) {
      c = HEX[8 + randomInt(rng, 4)]!;
    } else {
      c = HEX[randomInt(rng, 16)]!;
    }
    codes[i] = c.charCodeAt(0);
  }
  return String.fromCharCode(...codes);
}

export function uuids(n: number, rng: Rng): KeySet<string> {
  return distinct(n, () => uuid(rng));
}

// ---- structural keys ----

const ROLES = ['admin', 'editor', 'viewer', 'owner', 'guest'];

/** A flat 5-field record, like the User shape the old object bench used, but every field varies. */
export interface UserKey {
  id: number;
  name: string;
  email: string;
  role: string;
  active: boolean;
}

export function makeUser(rng: Rng, id: number): UserKey {
  const name = randomString(rng, 6 + randomInt(rng, 6));
  return {
    id,
    name,
    email: flat(`${name}@${randomString(rng, 5)}.com`),
    role: ROLES[randomInt(rng, ROLES.length)]!,
    active: rng() < 0.5,
  };
}

/** ids are random and distinct, so the hash of the whole record varies, not just one field. */
export function users(n: number, rng: Rng): KeySet<UserKey> {
  return distinct(
    n,
    () => makeUser(rng, randomInt(rng, 2 ** 31)),
    (u) => u.id,
  );
}

/**
 * Records of four shapes in one map, picked at random per key: the same leading fields, then
 * optional ones present or not, so a map sees several hidden classes instead of one.
 *   { id, name, role }
 *   { id, name, role, email }
 *   { id, name, role, email, active }
 *   { id, name, role, nickname?, active } (nickname on about half)
 */
export type ShapedRecord = {
  id: number;
  name: string;
  role: string;
  email?: string;
  nickname?: string;
  active?: boolean;
};

export function shapedRecords(n: number, rng: Rng): KeySet<ShapedRecord> {
  return distinct(
    n,
    (): ShapedRecord => {
      const id = randomInt(rng, 2 ** 31);
      const name = randomString(rng, 6 + randomInt(rng, 6));
      const role = ROLES[randomInt(rng, ROLES.length)]!;
      switch (randomInt(rng, 4)) {
        case 0:
          return { id, name, role };
        case 1:
          return { id, name, role, email: flat(`${name}@${randomString(rng, 5)}.com`) };
        case 2:
          return {
            id,
            name,
            role,
            email: flat(`${name}@${randomString(rng, 5)}.com`),
            active: rng() < 0.5,
          };
        default: {
          const r: ShapedRecord = { id, name, role };
          if (rng() < 0.5) {
            r.nickname = randomString(rng, 5);
          }
          r.active = rng() < 0.5;
          return r;
        }
      }
    },
    (r) => r.id,
  );
}

/** A 16-field flat record: 8 numbers (one a distinct id), 6 strings, 2 booleans. */
export type WideRecord = Record<string, number | string | boolean>;

export function wideRecords(n: number, rng: Rng): KeySet<WideRecord> {
  return distinct(
    n,
    (): WideRecord => {
      const r: WideRecord = { id: randomInt(rng, 2 ** 31) };
      for (let i = 1; i < 8; i++) {
        r[`n${i}`] = randomInt(rng, 1e6);
      }
      for (let i = 0; i < 6; i++) {
        r[`s${i}`] = randomString(rng, 4 + randomInt(rng, 8));
      }
      r.b0 = rng() < 0.5;
      r.b1 = rng() < 0.5;
      return r;
    },
    (r) => r.id,
  );
}

/** `[x, y]` coordinate tuples: the most common structural key. */
export function tuples(n: number, rng: Rng): KeySet<[number, number]> {
  const side = Math.ceil(Math.sqrt(4 * n)) + 1;
  return distinct(
    n,
    (): [number, number] => [randomInt(rng, side), randomInt(rng, side)],
    ([x, y]) => x * side + y,
  );
}

/** Depth-3 object with an array inside. */
export interface NestedKey {
  tenant: string;
  resource: { kind: string; id: number; owner: { org: string; tags: string[] } };
  version: number;
}

export function nested(n: number, rng: Rng): KeySet<NestedKey> {
  return distinct(
    n,
    (): NestedKey => ({
      tenant: randomString(rng, 8),
      resource: {
        kind: ROLES[randomInt(rng, ROLES.length)]!,
        id: randomInt(rng, 2 ** 31),
        owner: {
          org: randomString(rng, 6),
          tags: [randomString(rng, 4), randomString(rng, 4), randomString(rng, 4)],
        },
      },
      version: randomInt(rng, 10),
    }),
    (k) => `${k.tenant}:${k.resource.id}`,
  );
}

export function dates(n: number, rng: Rng): KeySet<Date> {
  const start = Date.UTC(2020, 0, 1);
  return distinct(
    n,
    () => new Date(start + randomInt(rng, 2 ** 40)),
    (d) => d.getTime(),
  );
}

/** One key set holding ints, 12-char strings, records, tuples and Dates in equal parts, shuffled. */
export function mixed(n: number, rng: Rng): KeySet<unknown> {
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

/**
 * A seeded Zipf(s) sampler over ranks 0..n-1 (rank 0 most frequent): P(rank k) is proportional to
 * 1 / (k + 1)^s. Uses an inverted CDF with binary search, so draws are exact and reproducible.
 */
export function zipf(n: number, s: number, rng: Rng): () => number {
  const cdf = new Float64Array(n);
  let total = 0;
  for (let k = 0; k < n; k++) {
    total += 1 / (k + 1) ** s;
    cdf[k] = total;
  }
  return () => {
    const u = rng() * total;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (cdf[mid]! < u) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  };
}

/** A deep copy that is structurally equal but shares no references with the original. */
export function clone<K>(key: K): K {
  return typeof key === 'object' && key !== null ? structuredClone(key) : key;
}

// ---- adversarial keys (see bench/README.md, "Adversarial") ----

/**
 * Integers hash to themselves and the bucket is `hash & (capacity - 1)`, so multiples of 2^16 all
 * land in bucket 0 until the table grows past 65,536 buckets.
 */
export function collidingInts(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i << 16);
}

/**
 * The string hash is Java's `h * 31 + c`, so "Aa" and "BB" hash alike and every concatenation of
 * k blocks drawn from {"Aa", "BB"} shares one hash. Returns the first `n` of those 2^k strings.
 */
export function collidingStrings(n: number): string[] {
  let out = [''];
  while (out.length < n) {
    out = out.flatMap((s) => [`${s}Aa`, `${s}BB`]);
  }
  return out.slice(0, n).map(flat);
}
