import { beforeEach, describe, expect, test, vi } from 'vitest';
import { HashMap } from './hash-map';
import { getHashCode } from './hash';

// Small deterministic PRNG so churn tests are reproducible.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const capacityOf = (map: HashMap<unknown, unknown>): number => (map as any).capacity;
const tableOf = (map: HashMap<unknown, unknown>): Array<unknown> => (map as any).table;

/** Counts nodes by walking every bucket chain directly. */
function countNodes(map: HashMap<unknown, unknown>): number {
  let count = 0;
  for (const head of tableOf(map)) {
    let node: any = head;
    while (node !== undefined) {
      count++;
      node = node.next;
    }
  }
  return count;
}

/** Every table property name must be an integer index in [0, capacity). */
function indicesInRange(map: HashMap<unknown, unknown>): boolean {
  const cap = capacityOf(map);
  return Object.keys(tableOf(map)).every((k) => {
    const i = Number(k);
    return Number.isInteger(i) && i >= 0 && i < cap && String(i) === k;
  });
}

// Array.from visits holes too, so the result is dense (0 for empty buckets).
function chainLengths(map: HashMap<unknown, unknown>): number[] {
  return Array.from(tableOf(map), (head) => {
    let n = 0;
    let node: any = head;
    while (node !== undefined) {
      n++;
      node = node.next;
    }
    return n;
  });
}

const constantHash = () => 42;

describe('HashMap collisions and resizing', () => {
  describe('single-bucket chain (constant hashFn)', () => {
    let map: HashMap<string, number>;
    const keys = ['a', 'b', 'c', 'd', 'e'];

    beforeEach(() => {
      map = new HashMap<string, number>({ hashFn: constantHash });
      keys.forEach((k, i) => map.set(k, i));
    });

    test('all keys live in exactly one bucket', () => {
      const nonEmpty = chainLengths(map as any).filter((n) => n > 0);
      expect(nonEmpty).toEqual([keys.length]);
    });

    test('every key is retrievable and has() is true', () => {
      keys.forEach((k, i) => {
        expect(map.get(k)).toBe(i);
        expect(map.has(k)).toBe(true);
      });
      expect(map.size).toBe(5);
    });

    test('absent keys sharing the bucket are not found', () => {
      expect(map.get('z')).toBeUndefined();
      expect(map.has('z')).toBe(false);
      expect(map.delete('z')).toBe(false);
      expect(map.size).toBe(5);
    });

    // Insertion prepends, so 'e' is the chain head and 'a' is the tail.
    test.each([
      ['head', 'e'],
      ['middle', 'c'],
      ['tail', 'a'],
    ])('deleting the %s of the chain (%s) keeps the rest intact', (_pos, victim) => {
      expect(map.delete(victim)).toBe(true);
      expect(map.size).toBe(4);
      expect(map.has(victim)).toBe(false);
      expect(map.get(victim)).toBeUndefined();
      expect(map.delete(victim)).toBe(false);
      keys.filter((k) => k !== victim).forEach((k) => expect(map.get(k)).toBe(keys.indexOf(k)));
      expect(countNodes(map as any)).toBe(4);
    });

    test.each(keys)('re-inserting %s after delete works and increments size', (k) => {
      map.delete(k);
      map.set(k, 100);
      expect(map.size).toBe(5);
      expect(map.get(k)).toBe(100);
      expect(countNodes(map as any)).toBe(5);
    });

    test.each(keys)('updating %s in the chain replaces value without growing', (k) => {
      expect(map.set(k, -1)).toBe(map);
      expect(map.size).toBe(5);
      expect(map.get(k)).toBe(-1);
      expect(countNodes(map as any)).toBe(5);
      keys.filter((o) => o !== k).forEach((o) => expect(map.get(o)).toBe(keys.indexOf(o)));
    });

    test('deleting every key in arbitrary order empties the chain', () => {
      for (const k of ['c', 'a', 'e', 'b', 'd']) {
        expect(map.delete(k)).toBe(true);
      }
      expect(map.size).toBe(0);
      expect(countNodes(map as any)).toBe(0);
      expect([...map]).toEqual([]);
    });

    test('iteration yields every chained entry exactly once', () => {
      const entries = [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
      expect(entries).toEqual(keys.map((k, i) => [k, i]));
    });

    test('a long single chain survives multiple resizes', () => {
      const m = new HashMap<number, number>({ hashFn: constantHash, capacity: 2 });
      for (let i = 0; i < 500; i++) m.set(i, i * 2);
      expect(m.size).toBe(500);
      expect(capacityOf(m as any)).toBeGreaterThanOrEqual(1024);
      for (let i = 0; i < 500; i++) expect(m.get(i)).toBe(i * 2);
      expect(m.has(500)).toBe(false);
      expect(chainLengths(m as any).filter((n) => n > 0)).toEqual([500]);
    });
  });

  describe('unusual hashFn return values', () => {
    // Values whose index (hash & mask) must still land in range.
    const hashes: Array<[string, number]> = [
      ['negative', -1],
      ['large negative', -2147483648],
      ['very large', 2 ** 40 + 7],
      ['MAX_SAFE_INTEGER', Number.MAX_SAFE_INTEGER],
      ['beyond int32', 4294967297],
      ['non-integer float', 3.75],
      ['negative float', -0.5],
      ['Infinity', Infinity],
      ['-Infinity', -Infinity],
      ['negative zero', -0],
    ];

    test.each(hashes)('%s hash (%p): set/get/has/delete work', (_label, h) => {
      const map = new HashMap<string, number>({ hashFn: () => h });
      map.set('x', 1).set('y', 2);
      expect(map.get('x')).toBe(1);
      expect(map.get('y')).toBe(2);
      expect(map.has('missing')).toBe(false);
      const table = tableOf(map);
      const used = table.map((n, i) => (n ? i : -1)).filter((i) => i >= 0);
      expect(used.length).toBe(1);
      expect(used[0]).toBeGreaterThanOrEqual(0);
      expect(used[0]).toBeLessThan(capacityOf(map));
      expect(indicesInRange(map as any)).toBe(true);
      expect(map.delete('x')).toBe(true);
      expect(map.get('x')).toBeUndefined();
      expect(map.size).toBe(1);
    });

    test.each(hashes)('%s hash (%p): survives resizes', (_label, h) => {
      const map = new HashMap<number, number>({ hashFn: () => h, capacity: 2 });
      for (let i = 0; i < 40; i++) map.set(i, i);
      expect(map.size).toBe(40);
      for (let i = 0; i < 40; i++) expect(map.get(i)).toBe(i);
      expect(indicesInRange(map as any)).toBe(true);
    });

    test('distinct negative hashes spread across buckets and stay in range', () => {
      const map = new HashMap<number, number>({ hashFn: (k) => -(k as number) - 1 });
      for (let i = 0; i < 1000; i++) map.set(i, i);
      for (let i = 0; i < 1000; i++) expect(map.get(i)).toBe(i);
      expect(indicesInRange(map as any)).toBe(true);
      expect(countNodes(map as any)).toBe(1000);
    });

    test('float hashes that differ only in fraction share a bucket but stay distinct', () => {
      const map = new HashMap<number, string>({ hashFn: (k) => (k as number) / 10 });
      [1, 2, 3, 4, 5, 6, 7, 8, 9].forEach((k) => map.set(k, `v${k}`));
      [1, 2, 3, 4, 5, 6, 7, 8, 9].forEach((k) => expect(map.get(k)).toBe(`v${k}`));
      expect(map.size).toBe(9);
    });

    test('NaN hash: keys can still be found, updated and deleted', () => {
      const map = new HashMap<string, number>({ hashFn: () => NaN });
      map.set('x', 1);
      map.set('x', 2);
      expect(map.size).toBe(1);
      expect(map.get('x')).toBe(2);
      expect(map.delete('x')).toBe(true);
    });
  });

  describe('default-hash collisions', () => {
    test('"Aa" and "BB" share a Java-style string hash', () => {
      expect(getHashCode('Aa')).toBe(getHashCode('BB'));
    });

    test('colliding strings are stored as distinct keys', () => {
      const map = new HashMap<string, string>();
      map.set('Aa', 'first').set('BB', 'second');
      expect(map.size).toBe(2);
      expect(map.get('Aa')).toBe('first');
      expect(map.get('BB')).toBe('second');
      expect(map.delete('Aa')).toBe(true);
      expect(map.get('BB')).toBe('second');
      expect(map.has('Aa')).toBe(false);
    });

    test('2^n colliding strings built from Aa/BB blocks are all distinct', () => {
      // Every concatenation of 'Aa'/'BB' blocks of equal length collides.
      let words = [''];
      for (let i = 0; i < 8; i++) words = words.flatMap((w) => [w + 'Aa', w + 'BB']);
      expect(new Set(words.map((w) => getHashCode(w))).size).toBe(1);
      const map = new HashMap<string, number>();
      words.forEach((w, i) => map.set(w, i));
      expect(map.size).toBe(256);
      words.forEach((w, i) => expect(map.get(w)).toBe(i));
      expect(map.has('AaAaAaAaAaAaAaAax')).toBe(false);
      words.filter((_, i) => i % 2 === 0).forEach((w) => expect(map.delete(w)).toBe(true));
      expect(map.size).toBe(128);
      words.forEach((w, i) => expect(map.has(w)).toBe(i % 2 === 1));
    });

    test('integer keys whose values differ by a multiple of capacity share a bucket', () => {
      const map = new HashMap<number, number>({ capacity: 16, loadFactor: 100 });
      [0, 16, 32, 48, 64].forEach((k) => map.set(k, k));
      expect(chainLengths(map as any)[0]).toBe(5);
      [0, 16, 32, 48, 64].forEach((k) => expect(map.get(k)).toBe(k));
      expect(map.get(80)).toBeUndefined();
    });

    test('number keys and colliding string keys do not get confused', () => {
      const h = getHashCode('Aa');
      const map = new HashMap<unknown, string>();
      map.set(h, 'number').set('Aa', 'string').set('BB', 'string2');
      expect(map.size).toBe(3);
      expect(map.get(h)).toBe('number');
      expect(map.get('Aa')).toBe('string');
      expect(map.get(String(h))).toBeUndefined();
    });
  });

  describe('capacity option', () => {
    test.each([
      [1, 1],
      [2, 2],
      [3, 4],
      [5, 8],
      [16, 16],
      [17, 32],
      [100, 128],
      [1000, 1024],
      [2.5, 4],
    ])('capacity %p rounds up to %p', (input, expected) => {
      const map = new HashMap({ capacity: input });
      expect(capacityOf(map as any)).toBe(expected);
      expect(tableOf(map as any).length).toBe(expected);
    });

    test('capacity 1 with default loadFactor grows on the very first insert', () => {
      const map = new HashMap<string, number>({ capacity: 1 });
      // 1 > 1 * 0.75, so the first insert already resizes to 2
      map.set('a', 1);
      expect(capacityOf(map as any)).toBe(2);
      map.set('b', 2);
      expect(capacityOf(map as any)).toBe(4);
      map.set('c', 3);
      expect(capacityOf(map as any)).toBe(4);
      expect([map.get('a'), map.get('b'), map.get('c')]).toEqual([1, 2, 3]);
    });

    test('capacity 1 with loadFactor 1 keeps capacity until the second insert', () => {
      const map = new HashMap<string, number>({ capacity: 1, loadFactor: 1 });
      map.set('a', 1);
      expect(capacityOf(map as any)).toBe(1);
      map.set('b', 2);
      expect(capacityOf(map as any)).toBe(2);
      expect(map.get('a')).toBe(1);
      expect(map.get('b')).toBe(2);
    });

    test('capacity 0 still produces a usable map', () => {
      const map = new HashMap<string, number>({ capacity: 0 });
      map.set('a', 1).set('b', 2);
      expect(map.get('a')).toBe(1);
      expect(map.get('b')).toBe(2);
      expect(capacityOf(map as any)).toBeGreaterThanOrEqual(1);
    });

    test('a large initial capacity avoids resizing', () => {
      const map = new HashMap<number, number>({ capacity: 2048 });
      for (let i = 0; i < 1536; i++) map.set(i, i);
      expect(capacityOf(map as any)).toBe(2048);
      map.set(1536, 1536);
      expect(capacityOf(map as any)).toBe(4096);
    });

    test('capacity is respected when initial values are also provided', () => {
      const map = new HashMap<number, number>(
        [
          [1, 1],
          [2, 2],
        ],
        { capacity: 64 },
      );
      expect(capacityOf(map as any)).toBe(64);
      expect(map.size).toBe(2);
    });
  });

  describe('loadFactor option', () => {
    test.each([
      // [loadFactor, capacity, inserts that fit before resize]
      [0.25, 16, 4],
      [0.5, 16, 8],
      [0.75, 16, 12],
      [1, 16, 16],
      [2, 16, 32],
      [4, 8, 32],
    ])('loadFactor %p with capacity %p resizes after %p entries', (lf, cap, fit) => {
      const map = new HashMap<number, number>({ capacity: cap, loadFactor: lf });
      for (let i = 0; i < fit; i++) map.set(i, i);
      expect(capacityOf(map as any)).toBe(cap);
      map.set(fit, fit);
      expect(capacityOf(map as any)).toBe(cap * 2);
      for (let i = 0; i <= fit; i++) expect(map.get(i)).toBe(i);
    });

    test('loadFactor > 1 produces chains longer than one and everything is found', () => {
      const map = new HashMap<number, number>({ capacity: 4, loadFactor: 8 });
      for (let i = 0; i < 32; i++) map.set(i, i);
      expect(capacityOf(map as any)).toBe(4);
      expect(Math.max(...chainLengths(map as any))).toBe(8);
      for (let i = 0; i < 32; i++) expect(map.get(i)).toBe(i);
      expect(map.has(32)).toBe(false);
    });

    test('a very small loadFactor grows aggressively but stays correct', () => {
      const map = new HashMap<number, number>({ capacity: 1, loadFactor: 0.01 });
      for (let i = 0; i < 100; i++) map.set(i, i);
      expect(map.size).toBe(100);
      expect(capacityOf(map as any)).toBeGreaterThan(100 / 0.01 - 1);
      for (let i = 0; i < 100; i++) expect(map.get(i)).toBe(i);
    });
  });

  describe('resize mechanics', () => {
    test('resize triggers exactly when size > capacity * loadFactor', () => {
      const map = new HashMap<number, number>();
      const seen: Array<[number, number]> = [];
      for (let i = 1; i <= 200; i++) {
        const before = capacityOf(map);
        map.set(i, i);
        const after = capacityOf(map);
        if (after !== before) seen.push([map.size, after]);
        expect(map.size).toBeLessThanOrEqual(after * 0.75);
      }
      expect(seen).toEqual([
        [13, 32],
        [25, 64],
        [49, 128],
        [97, 256],
        [193, 512],
      ]);
    });

    test('set() returns the map itself even when the insert triggers a resize', () => {
      const map = new HashMap<number, number>({ capacity: 1, loadFactor: 1 });
      map.set(0, 0);
      expect(map.set(1, 1)).toBe(map);
      expect(capacityOf(map as any)).toBe(2);
    });

    test('keys deleted before a resize do not reappear after it', () => {
      const map = new HashMap<number, number>({ hashFn: constantHash, capacity: 4, loadFactor: 1 });
      [1, 2, 3, 4].forEach((k) => map.set(k, k));
      map.delete(2);
      map.delete(4);
      [5, 6, 7].forEach((k) => map.set(k, k)); // size 5 > 4 -> resize
      expect(capacityOf(map as any)).toBe(8);
      expect(map.size).toBe(5);
      expect(countNodes(map as any)).toBe(5);
      expect(map.has(2)).toBe(false);
      expect(map.has(4)).toBe(false);
      expect([...map.keys()].sort()).toEqual([1, 3, 5, 6, 7]);
    });

    test('updating an existing key never triggers a resize', () => {
      const map = new HashMap<number, number>();
      for (let i = 0; i < 12; i++) map.set(i, i);
      for (let r = 0; r < 50; r++) map.set(r % 12, r);
      expect(capacityOf(map as any)).toBe(16);
      expect(map.size).toBe(12);
    });

    test('size and all entries are preserved after each successive resize', () => {
      const map = new HashMap<string, number>({ capacity: 2 });
      let lastCap = capacityOf(map);
      let resizes = 0;
      for (let i = 0; i < 3000; i++) {
        map.set(`k${i}`, i);
        const cap = capacityOf(map);
        if (cap !== lastCap) {
          expect(cap).toBe(lastCap * 2);
          resizes++;
          lastCap = cap;
          expect(map.size).toBe(i + 1);
          expect(countNodes(map as any)).toBe(i + 1);
          for (let j = 0; j <= i; j++) expect(map.get(`k${j}`)).toBe(j);
        }
      }
      expect(resizes).toBe(11);
    });

    test('every node sits in the bucket its hash maps to after resizing', () => {
      const map = new HashMap<number, number>({ capacity: 2 });
      for (let i = -500; i < 500; i++) map.set(i * 7, i);
      const cap = capacityOf(map);
      tableOf(map).forEach((head, idx) => {
        let node: any = head;
        while (node) {
          expect(node.hash & (cap - 1)).toBe(idx);
          node = node.next;
        }
      });
    });

    test('capacity is always a power of two after resizes', () => {
      const map = new HashMap<number, number>({ capacity: 3, loadFactor: 0.6 });
      for (let i = 0; i < 1000; i++) {
        map.set(i, i);
        const cap = capacityOf(map);
        expect(cap & (cap - 1)).toBe(0);
      }
    });

    test('deleting never shrinks capacity', () => {
      const map = new HashMap<number, number>();
      for (let i = 0; i < 100; i++) map.set(i, i);
      const cap = capacityOf(map);
      for (let i = 0; i < 100; i++) map.delete(i);
      expect(map.size).toBe(0);
      expect(capacityOf(map as any)).toBe(cap);
    });

    test('delete then re-add across resize boundaries', () => {
      const map = new HashMap<number, number>();
      for (let i = 0; i < 12; i++) map.set(i, i);
      expect(capacityOf(map as any)).toBe(16);
      // drop below, re-add up to the threshold: no resize
      for (let i = 0; i < 6; i++) map.delete(i);
      for (let i = 100; i < 106; i++) map.set(i, i);
      expect(map.size).toBe(12);
      expect(capacityOf(map as any)).toBe(16);
      // one more crosses the boundary
      map.set(0, 0);
      expect(capacityOf(map as any)).toBe(32);
      expect(map.size).toBe(13);
      for (let i = 1; i < 6; i++) expect(map.has(i)).toBe(false);
      [0, 6, 7, 8, 9, 10, 11, 100, 101, 102, 103, 104, 105].forEach((k) =>
        expect(map.get(k)).toBe(k),
      );
      // delete and re-add the same keys after the resize
      [6, 100, 0].forEach((k) => expect(map.delete(k)).toBe(true));
      [6, 100, 0].forEach((k) => map.set(k, -k));
      expect(map.size).toBe(13);
      [6, 100, 0].forEach((k) => expect(map.get(k)).toBe(-k));
    });

    test('clear() keeps the current (grown) capacity and the map is reusable', () => {
      const map = new HashMap<number, number>();
      for (let i = 0; i < 100; i++) map.set(i, i);
      const cap = capacityOf(map);
      expect(cap).toBe(256);
      map.clear();
      expect(map.size).toBe(0);
      expect(capacityOf(map as any)).toBe(cap);
      expect(tableOf(map as any).length).toBe(cap);
      expect(countNodes(map as any)).toBe(0);
      for (let i = 0; i < 100; i++) expect(map.has(i)).toBe(false);
      for (let i = 0; i < 192; i++) map.set(i, i * 3);
      expect(capacityOf(map as any)).toBe(cap);
      map.set(192, 0);
      expect(capacityOf(map as any)).toBe(cap * 2);
      for (let i = 0; i < 192; i++) expect(map.get(i)).toBe(i * 3);
    });

    test('initial values that exceed the threshold resize during construction', () => {
      const init: Array<[number, number]> = Array.from({ length: 100 }, (_, i) => [i, i]);
      const map = new HashMap(init, { capacity: 4 });
      expect(map.size).toBe(100);
      expect(capacityOf(map as any)).toBe(256);
      init.forEach(([k, v]) => expect(map.get(k)).toBe(v));
    });

    test('iteration after resizes yields every entry exactly once', () => {
      const map = new HashMap<number, number>({ capacity: 1 });
      for (let i = 0; i < 777; i++) map.set(i, i);
      const keys = [...map.keys()].sort((a, b) => a - b);
      expect(keys).toEqual(Array.from({ length: 777 }, (_, i) => i));
      expect([...map.values()].length).toBe(777);
    });
  });

  describe('large scale', () => {
    test('50k integer keys', () => {
      const n = 50_000;
      const map = new HashMap<number, number>();
      for (let i = 0; i < n; i++) map.set(i, i * 2);
      expect(map.size).toBe(n);
      for (let i = 0; i < n; i++) expect(map.get(i)).toBe(i * 2);
      for (let i = n; i < n + 1000; i++) expect(map.has(i)).toBe(false);
      for (let i = -1000; i < 0; i++) expect(map.has(i)).toBe(false);
      expect(capacityOf(map as any)).toBe(131072);
    });

    test('10k string keys', () => {
      const n = 10_000;
      const map = new HashMap<string, number>();
      for (let i = 0; i < n; i++) map.set(`key-${i}`, i);
      expect(map.size).toBe(n);
      for (let i = 0; i < n; i++) expect(map.get(`key-${i}`)).toBe(i);
      for (let i = 0; i < 1000; i++) expect(map.has(`key-${n + i}`)).toBe(false);
      expect(map.has('key-')).toBe(false);
      expect(countNodes(map as any)).toBe(n);
    });

    test('5k structurally-equal object keys found by fresh literals', () => {
      const n = 5_000;
      const map = new HashMap<{ id: number; tag: string }, number>();
      for (let i = 0; i < n; i++) map.set({ id: i, tag: `t${i % 7}` }, i);
      expect(map.size).toBe(n);
      for (let i = 0; i < n; i++) expect(map.get({ id: i, tag: `t${i % 7}` })).toBe(i);
      for (let i = 0; i < 500; i++) expect(map.has({ id: i, tag: `t${(i + 1) % 7}` })).toBe(false);
      for (let i = 0; i < n; i += 2) expect(map.delete({ id: i, tag: `t${i % 7}` })).toBe(true);
      expect(map.size).toBe(n / 2);
    });

    test('2k array keys', () => {
      const map = new HashMap<number[], number>();
      for (let i = 0; i < 2000; i++) map.set([i, i * 2, i % 3], i);
      expect(map.size).toBe(2000);
      for (let i = 0; i < 2000; i++) expect(map.get([i, i * 2, i % 3])).toBe(i);
      expect(map.has([1, 2])).toBe(false);
    });
  });

  describe('churn (interleaved insert/delete)', () => {
    test.each([
      ['default hash', undefined, 1],
      ['constant hash', constantHash, 2],
      ['low-entropy hash', (k: unknown) => (k as number) % 3, 3],
    ])('%s: size and contents match a native Map reference', (_label, hashFn, seed) => {
      const rand = mulberry32(seed);
      const map = new HashMap<number, number>({ hashFn, capacity: 2 });
      const ref = new Map<number, number>();
      const ops = hashFn === undefined ? 20_000 : 3_000;
      for (let i = 0; i < ops; i++) {
        const key = Math.floor(rand() * 500);
        const r = rand();
        if (r < 0.5) {
          map.set(key, i);
          ref.set(key, i);
        } else if (r < 0.85) {
          expect(map.delete(key)).toBe(ref.delete(key));
        } else {
          expect(map.get(key)).toBe(ref.get(key));
          expect(map.has(key)).toBe(ref.has(key));
        }
        expect(map.size).toBe(ref.size);
      }
      expect(countNodes(map as any)).toBe(ref.size);
      for (let k = 0; k < 500; k++) {
        expect(map.get(k)).toBe(ref.get(k));
      }
      expect(new Map(map)).toEqual(ref);
    });

    test('fill, drain and refill repeatedly keeps size invariants', () => {
      const map = new HashMap<string, number>();
      for (let round = 0; round < 5; round++) {
        for (let i = 0; i < 1000; i++) map.set(`r${round}-${i}`, i);
        expect(map.size).toBe(1000);
        for (let i = 0; i < 1000; i++) expect(map.delete(`r${round}-${i}`)).toBe(true);
        expect(map.size).toBe(0);
        expect(countNodes(map as any)).toBe(0);
      }
      expect(capacityOf(map as any)).toBe(2048);
    });
  });

  describe('custom equalsFn / hashFn interplay', () => {
    const lowerHash = (v: unknown) => getHashCode(String(v).toLowerCase());
    const ciEquals = (a: unknown, b: unknown) =>
      String(a).toLowerCase() === String(b).toLowerCase();

    test('case-insensitive keys with a matching hashFn', () => {
      const map = new HashMap<string, number>({ hashFn: lowerHash, equalsFn: ciEquals });
      map.set('Hello', 1);
      expect(map.get('HELLO')).toBe(1);
      expect(map.has('hello')).toBe(true);
      map.set('hElLo', 2);
      expect(map.size).toBe(1);
      expect(map.get('Hello')).toBe(2);
      // the originally stored key is kept on update (Map semantics)
      expect([...map.keys()]).toEqual(['Hello']);
      expect(map.delete('HeLLo')).toBe(true);
      expect(map.size).toBe(0);
    });

    test('case-insensitive keys survive resizes', () => {
      const map = new HashMap<string, number>({
        hashFn: lowerHash,
        equalsFn: ciEquals,
        capacity: 2,
      });
      for (let i = 0; i < 300; i++) map.set(`Key${i}`, i);
      for (let i = 0; i < 300; i++) map.set(`KEY${i}`, i + 1);
      expect(map.size).toBe(300);
      for (let i = 0; i < 300; i++) expect(map.get(`key${i}`)).toBe(i + 1);
    });

    test('equalsFn without a consistent hashFn cannot match differently-hashed keys', () => {
      // Documents the hash/equals contract: equal keys must hash equally.
      const map = new HashMap<string, number>({ equalsFn: ciEquals });
      map.set('Hello', 1);
      expect(map.get('Hello')).toBe(1);
      expect(map.get('HELLO')).toBeUndefined();
    });

    test('equalsFn is invoked with the stored key and the lookup key', () => {
      const calls: Array<[unknown, unknown]> = [];
      const equalsFn = vi.fn((a: unknown, b: unknown) => {
        calls.push([a, b]);
        return a === b;
      });
      const map = new HashMap<string, number>({ hashFn: constantHash, equalsFn });
      map.set('stored', 1);
      equalsFn.mockClear();
      calls.length = 0;
      map.get('lookup');
      map.has('lookup');
      map.delete('lookup');
      map.set('lookup', 2);
      expect(calls.length).toBeGreaterThanOrEqual(4);
      for (const pair of calls) {
        expect([...pair].sort()).toEqual(['lookup', 'stored']);
      }
    });

    test('equalsFn is not called when hashes differ (hash short-circuit)', () => {
      const equalsFn = vi.fn((a: unknown, b: unknown) => a === b);
      // identity hash on small ints, all in the same bucket via loadFactor/capacity
      const map = new HashMap<number, number>({
        hashFn: (k) => k as number,
        equalsFn,
        capacity: 1,
        loadFactor: 100,
      });
      for (let i = 0; i < 10; i++) map.set(i, i);
      equalsFn.mockClear();
      expect(map.get(3)).toBe(3);
      expect(equalsFn).toHaveBeenCalledTimes(1);
      expect(equalsFn.mock.calls[0]).toEqual([3, 3]);
      equalsFn.mockClear();
      expect(map.has(99)).toBe(false);
      expect(equalsFn).not.toHaveBeenCalled();
    });

    test('equalsFn is called for every same-hash node until a match', () => {
      const equalsFn = vi.fn((a: unknown, b: unknown) => a === b);
      const map = new HashMap<number, number>({ hashFn: constantHash, equalsFn });
      for (let i = 0; i < 5; i++) map.set(i, i);
      equalsFn.mockClear();
      expect(map.has(99)).toBe(false);
      expect(equalsFn).toHaveBeenCalledTimes(5);
    });

    test('equalsFn is never called on an empty bucket', () => {
      const equalsFn = vi.fn(() => true);
      const map = new HashMap<number, number>({ equalsFn });
      map.get(1);
      map.has(2);
      map.delete(3);
      map.set(4, 4);
      expect(equalsFn).not.toHaveBeenCalled();
    });

    test('an always-true equalsFn with constant hash collapses everything into one entry', () => {
      const map = new HashMap<number, string>({ hashFn: constantHash, equalsFn: () => true });
      map.set(1, 'a').set(2, 'b').set(3, 'c');
      expect(map.size).toBe(1);
      expect(map.get(999)).toBe('c');
      expect([...map.keys()]).toEqual([1]);
    });

    test('an always-false equalsFn makes every set a new entry and nothing findable', () => {
      const map = new HashMap<number, string>({ equalsFn: () => false });
      map.set(1, 'a').set(1, 'b');
      expect(map.size).toBe(2);
      expect(map.has(1)).toBe(false);
      expect(map.delete(1)).toBe(false);
    });

    test('hashFn is called once per operation', () => {
      const hashFn = vi.fn((v: unknown) => getHashCode(v));
      const map = new HashMap<string, number>({ hashFn });
      map.set('a', 1);
      map.get('a');
      map.has('a');
      map.delete('a');
      expect(hashFn).toHaveBeenCalledTimes(4);
    });

    test('hashFn is not re-invoked during resize (cached hash is used)', () => {
      const hashFn = vi.fn((v: unknown) => v as number);
      const map = new HashMap<number, number>({ hashFn, capacity: 1 });
      for (let i = 0; i < 100; i++) map.set(i, i);
      expect(hashFn).toHaveBeenCalledTimes(100);
    });
  });
});
