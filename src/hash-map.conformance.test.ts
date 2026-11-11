import { describe, expect, test, vi } from 'vitest';
import { HashMap } from './hash-map';

/**
 * Map API conformance tests. Where HashMap claims to implement `Map`, these tests
 * assert native `Map` semantics, often differentially (same ops on `new Map()`).
 * Iteration ORDER is intentionally not compared: HashMap does not promise insertion order.
 */

// Small deterministic PRNG so the differential tests are reproducible.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const symA = Symbol('a');
const symA2 = Symbol('a'); // same description, distinct identity
const symB = Symbol('b');

// Primitive keys whose identity semantics should match native Map exactly.
// NaN is deliberately covered separately below.
const primitiveKeys: unknown[] = [
  0, 1, 2, -1, 1.5, 16, 17, 32, 1e9, 2 ** 40, Infinity, -Infinity,
  '', '0', '1', '2', 'a', 'true', 'null', 'undefined',
  true, false,
  null, undefined,
  1n, 0n, 2n ** 64n,
  symA, symA2, symB,
];

/** Asserts that a HashMap holds exactly the same entries as a native Map (order-insensitive). */
function expectSameContents(hm: HashMap<unknown, unknown>, native: Map<unknown, unknown>) {
  expect(hm.size).toBe(native.size);
  let count = 0;
  for (const [k, v] of hm) {
    count++;
    expect(native.has(k)).toBe(true);
    expect(native.get(k)).toBe(v);
  }
  expect(count).toBe(native.size);
  for (const [k, v] of native) {
    expect(hm.has(k)).toBe(true);
    expect(hm.get(k)).toBe(v);
  }
}

describe('HashMap Map conformance', () => {
  describe('return values', () => {
    test('set returns the same map instance', () => {
      const map = new HashMap<string, number>();
      expect(map.set('a', 1)).toBe(map);
      // updating an existing key also returns this
      expect(map.set('a', 2)).toBe(map);
    });

    test('set is chainable', () => {
      const map = new HashMap<string, number>();
      map.set('a', 1).set('b', 2).set('c', 3).set('a', 4);
      expect(map.size).toBe(3);
      expect(map.get('a')).toBe(4);
      expect(map.get('b')).toBe(2);
      expect(map.get('c')).toBe(3);
    });

    test('delete returns true for present key and false thereafter', () => {
      const map = new HashMap<string, number>([['a', 1]]);
      expect(map.delete('a')).toBe(true);
      expect(map.delete('a')).toBe(false);
    });

    test('a deleted key can be re-added with a new value', () => {
      const map = new HashMap<string, number>([['a', 1], ['b', 2]]);
      map.delete('a');
      expect(map.set('a', 3)).toBe(map);
      expect(map.size).toBe(2);
      expect(map.get('a')).toBe(3);
      expect(map.get('b')).toBe(2);
    });

    test('delete returns false on an empty map', () => {
      expect(new HashMap<string, number>().delete('nope')).toBe(false);
    });

    test('clear returns undefined', () => {
      const map = new HashMap<string, number>([['a', 1]]);
      expect(map.clear()).toBeUndefined();
      expect(new HashMap().clear()).toBeUndefined();
    });

    test('forEach returns undefined', () => {
      const map = new HashMap<string, number>([['a', 1]]);
      expect(map.forEach(() => 'ignored')).toBeUndefined();
    });
  });

  describe('undefined and null', () => {
    test('undefined can be used as a key', () => {
      const map = new HashMap<unknown, string>();
      map.set(undefined, 'u');
      expect(map.has(undefined)).toBe(true);
      expect(map.get(undefined)).toBe('u');
      expect(map.size).toBe(1);
      expect([...map.keys()]).toEqual([undefined]);
    });

    test('null can be used as a key', () => {
      const map = new HashMap<unknown, string>();
      map.set(null, 'n');
      expect(map.has(null)).toBe(true);
      expect(map.get(null)).toBe('n');
      expect([...map.keys()]).toEqual([null]);
    });

    test('null and undefined are distinct keys', () => {
      const map = new HashMap<unknown, string>();
      map.set(null, 'n').set(undefined, 'u');
      expect(map.size).toBe(2);
      expect(map.get(null)).toBe('n');
      expect(map.get(undefined)).toBe('u');
      expect(map.delete(null)).toBe(true);
      expect(map.has(null)).toBe(false);
      expect(map.has(undefined)).toBe(true);
    });

    test('null/undefined keys are distinct from 0, "", false and "null"/"undefined"', () => {
      const map = new HashMap<unknown, string>();
      map.set(null, 'n').set(undefined, 'u');
      for (const k of [0, -0, '', false, 'null', 'undefined', NaN]) {
        expect(map.has(k)).toBe(false);
      }
    });

    test('has() is true for a key whose value is undefined', () => {
      const map = new HashMap<string, undefined>();
      map.set('k', undefined);
      expect(map.has('k')).toBe(true);
      expect(map.size).toBe(1);
    });

    test('get distinguishes missing key vs stored undefined via has()', () => {
      const map = new HashMap<string, number | undefined>();
      map.set('stored', undefined);
      expect(map.get('stored')).toBeUndefined();
      expect(map.get('missing')).toBeUndefined();
      expect(map.has('stored')).toBe(true);
      expect(map.has('missing')).toBe(false);
    });

    test('null values are stored and returned as null', () => {
      const map = new HashMap<string, null>([['k', null]]);
      expect(map.get('k')).toBeNull();
      expect(map.has('k')).toBe(true);
    });

    test('stored undefined value appears in iteration and can be deleted', () => {
      const map = new HashMap<string, undefined>([['k', undefined]]);
      expect([...map.entries()]).toEqual([['k', undefined]]);
      expect([...map.values()]).toEqual([undefined]);
      expect(map.delete('k')).toBe(true);
      expect(map.size).toBe(0);
    });

    test('overwriting a defined value with undefined keeps the key present', () => {
      const map = new HashMap<string, number | undefined>([['k', 1]]);
      map.set('k', undefined);
      expect(map.has('k')).toBe(true);
      expect(map.get('k')).toBeUndefined();
      expect(map.size).toBe(1);
    });

    test('undefined key with undefined value', () => {
      const map = new HashMap<unknown, unknown>();
      map.set(undefined, undefined);
      expect(map.has(undefined)).toBe(true);
      expect(map.size).toBe(1);
      expect(map.delete(undefined)).toBe(true);
      expect(map.has(undefined)).toBe(false);
    });
  });

  describe('SameValueZero key semantics', () => {
    test('NaN can be used as a key and retrieved', () => {
      const map = new HashMap<number, string>();
      map.set(NaN, 'nan');
      expect(map.has(NaN)).toBe(true);
      expect(map.get(NaN)).toBe('nan');
    });

    test('setting NaN twice keeps a single entry (size 1)', () => {
      const map = new HashMap<number, string>();
      map.set(NaN, 'a').set(NaN, 'b');
      expect(map.size).toBe(1);
      expect([...map.values()]).toEqual(['b']);
    });

    test('NaN key can be deleted', () => {
      const map = new HashMap<number, string>([[NaN, 'nan']]);
      expect(map.delete(NaN)).toBe(true);
      expect(map.size).toBe(0);
    });

    test('NaN from different computations is the same key', () => {
      const map = new HashMap<number, string>([[Number('not a number'), 'x']]);
      expect(map.get(0 / 0)).toBe('x');
    });

    test('NaN key does not collide with other keys', () => {
      const map = new HashMap<unknown, string>([[NaN, 'nan']]);
      for (const k of [0, 'NaN', undefined, null]) {
        expect(map.has(k)).toBe(false);
      }
    });

    test('+0 and -0 are the same key', () => {
      const map = new HashMap<number, string>();
      map.set(-0, 'neg');
      expect(map.has(0)).toBe(true);
      expect(map.get(0)).toBe('neg');
      map.set(0, 'pos');
      expect(map.size).toBe(1);
      expect(map.get(-0)).toBe('pos');
      expect(map.delete(0)).toBe(true);
      expect(map.has(-0)).toBe(false);
    });

    test('-0 and +0 are the same key in the constructor', () => {
      const map = new HashMap<number, string>([[0, 'a'], [-0, 'b']]);
      expect(map.size).toBe(1);
      expect(map.get(0)).toBe('b');
    });

    test('-0 key is normalised to +0 when read back (like native Map)', () => {
      const native = new Map<number, string>([[-0, 'x']]);
      expect(Object.is([...native.keys()][0], 0)).toBe(true);
      const map = new HashMap<number, string>([[-0, 'x']]);
      expect(Object.is([...map.keys()][0], 0)).toBe(true);
    });
  });

  describe('key type distinctness', () => {
    test.each<[string, unknown, unknown]>([
      ['"1" vs 1', '1', 1],
      ['"0" vs 0', '0', 0],
      ['"" vs 0', '', 0],
      ['true vs "true"', true, 'true'],
      ['false vs "false"', false, 'false'],
      ['true vs 1', true, 1],
      ['false vs 0', false, 0],
      ['1n vs 1', 1n, 1],
      ['1n vs "1"', 1n, '1'],
      ['0n vs 0', 0n, 0],
      ['0n vs false', 0n, false],
      ['Symbol("a") vs Symbol("a")', symA, symA2],
      ['Symbol("a") vs "Symbol(a)"', symA, 'Symbol(a)'],
      ['null vs "null"', null, 'null'],
      ['undefined vs "undefined"', undefined, 'undefined'],
      ['Infinity vs "Infinity"', Infinity, 'Infinity'],
      ['1 vs 1.5', 1, 1.5],
      ['1 vs 17 (same bucket at cap 16)', 1, 17],
    ])('%s are distinct keys', (_label, a, b) => {
      const map = new HashMap<unknown, string>();
      map.set(a, 'A');
      expect(map.has(b)).toBe(false);
      map.set(b, 'B');
      expect(map.size).toBe(2);
      expect(map.get(a)).toBe('A');
      expect(map.get(b)).toBe('B');
      expect(map.delete(a)).toBe(true);
      expect(map.get(b)).toBe('B');
      expect(map.has(a)).toBe(false);
    });

    test('the same symbol instance is the same key', () => {
      const map = new HashMap<symbol, number>();
      map.set(symA, 1).set(symA, 2);
      expect(map.size).toBe(1);
      expect(map.get(symA)).toBe(2);
    });

    test('Symbol.for returns the same registered key', () => {
      const map = new HashMap<symbol, number>([[Symbol.for('reg'), 1]]);
      expect(map.get(Symbol.for('reg'))).toBe(1);
    });

    test('bigint keys compare by value', () => {
      const map = new HashMap<bigint, string>();
      map.set(10n, 'ten').set(BigInt(10), 'TEN').set(2n ** 100n, 'big');
      expect(map.size).toBe(2);
      expect(map.get(10n)).toBe('TEN');
      expect(map.get(2n ** 100n)).toBe('big');
      expect(map.has(-10n)).toBe(false);
    });

    test('all primitive keys coexist in one map', () => {
      const map = new HashMap<unknown, number>();
      primitiveKeys.forEach((k, i) => map.set(k, i));
      expect(map.size).toBe(primitiveKeys.length);
      primitiveKeys.forEach((k, i) => expect(map.get(k)).toBe(i));
    });
  });

  describe('size accuracy', () => {
    test('size tracks every operation type', () => {
      const map = new HashMap<string, number>();
      expect(map.size).toBe(0);
      map.set('a', 1);
      expect(map.size).toBe(1);
      map.set('a', 2); // update
      expect(map.size).toBe(1);
      map.set('b', 3);
      expect(map.size).toBe(2);
      map.get('a');
      map.has('zzz');
      map.getOrDefault('zzz', 0);
      expect(map.size).toBe(2);
      expect(() => map.getOrThrow('zzz')).toThrow();
      expect(map.size).toBe(2);
      map.delete('zzz'); // miss
      expect(map.size).toBe(2);
      map.delete('a');
      expect(map.size).toBe(1);
      map.delete('a'); // repeated delete
      expect(map.size).toBe(1);
      map.clear();
      expect(map.size).toBe(0);
      map.clear(); // clear on empty
      expect(map.size).toBe(0);
    });

    test('size equals number of iterated entries across a resize', () => {
      const map = new HashMap<number, number>();
      for (let i = 0; i < 100; i++) {
        map.set(i, i);
        expect(map.size).toBe(i + 1);
      }
      expect([...map].length).toBe(100);
      for (let i = 0; i < 100; i += 2) map.delete(i);
      expect(map.size).toBe(50);
      expect([...map.keys()].length).toBe(50);
    });

    test('size cannot be overwritten by consumers', () => {
      const map = new HashMap<string, number>([['a', 1]]);
      try {
        (map as any).size = 100;
      } catch {
        // native Map throws TypeError in strict mode; either throwing or ignoring is acceptable
      }
      expect(map.size).toBe(1);
    });
  });

  describe('identity / brand', () => {
    test('instanceof HashMap', () => {
      expect(new HashMap()).toBeInstanceOf(HashMap);
    });

    test('distinct instances do not share storage', () => {
      const a = new HashMap<string, number>();
      const b = new HashMap<string, number>();
      a.set('x', 1);
      expect(b.has('x')).toBe(false);
      expect(b.size).toBe(0);
    });

    test('has a string Symbol.toStringTag', () => {
      const map = new HashMap();
      expect(typeof map[Symbol.toStringTag]).toBe('string');
      expect(['Map', 'HashMap']).toContain(map[Symbol.toStringTag]);
    });

    test('Object.prototype.toString reports a Map-like tag', () => {
      const tag = Object.prototype.toString.call(new HashMap());
      expect(['[object Map]', '[object HashMap]']).toContain(tag);
    });

    test('Symbol.iterator is the same behaviour as entries()', () => {
      const map = new HashMap<number, string>([[1, 'a'], [2, 'b'], [3, 'c']]);
      expect([...map[Symbol.iterator]()]).toEqual([...map.entries()]);
    });
  });

  describe('forEach', () => {
    test('callback receives (value, key, map)', () => {
      const map = new HashMap<string, number>([['a', 1], ['b', 2]]);
      const calls: Array<[number, string, unknown]> = [];
      map.forEach((value, key, m) => calls.push([value, key, m]));
      expect(calls).toHaveLength(2);
      for (const [value, key, m] of calls) {
        expect(m).toBe(map);
        expect(map.get(key)).toBe(value);
      }
      expect(calls.map(c => c[1]).sort()).toEqual(['a', 'b']);
    });

    test('callback is called with exactly three arguments', () => {
      const map = new HashMap<string, number>([['a', 1]]);
      const lengths: number[] = [];
      map.forEach(function (this: unknown, ...args: unknown[]) {
        lengths.push(args.length);
      });
      expect(lengths).toEqual([3]);
    });

    test('thisArg is bound inside a regular function callback', () => {
      const map = new HashMap<string, number>([['a', 1], ['b', 2]]);
      const ctx = { seen: [] as number[] };
      map.forEach(function (this: typeof ctx, value) {
        this.seen.push(value);
      }, ctx);
      expect(ctx.seen.sort()).toEqual([1, 2]);
    });

    test('thisArg is undefined when not supplied (strict mode)', () => {
      const map = new HashMap<string, number>([['a', 1]]);
      let captured: unknown = 'sentinel';
      map.forEach(function (this: unknown) {
        captured = this;
      });
      expect(captured).toBeUndefined();
    });

    test('forEach on an empty map never calls the callback', () => {
      const cb = vi.fn();
      new HashMap().forEach(cb);
      expect(cb).not.toHaveBeenCalled();
    });

    test('forEach on a cleared map never calls the callback', () => {
      const cb = vi.fn();
      const map = new HashMap<number, number>([[1, 1]]);
      map.clear();
      map.forEach(cb);
      expect(cb).not.toHaveBeenCalled();
    });

    test('forEach visits keys with undefined values', () => {
      const map = new HashMap<string, undefined>([['a', undefined]]);
      const cb = vi.fn();
      map.forEach(cb);
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith(undefined, 'a', map);
    });

    test('errors thrown by the callback propagate', () => {
      const map = new HashMap<string, number>([['a', 1]]);
      expect(() => map.forEach(() => {
        throw new RangeError('boom');
      })).toThrow(RangeError);
    });

    test('forEach visits the same entries as native Map', () => {
      const entries: Array<[unknown, number]> = primitiveKeys.map((k, i) => [k, i]);
      const seen = new Map<unknown, number>();
      new HashMap<unknown, number>(entries).forEach((v, k) => seen.set(k, v));
      expect(seen).toEqual(new Map(entries));
    });
  });

  describe('constructor overloads', () => {
    test('no args -> empty', () => {
      const map = new HashMap();
      expect(map.size).toBe(0);
      expect([...map]).toEqual([]);
    });

    test('empty entries array -> empty', () => {
      const map = new HashMap<string, number>([]);
      expect(map.size).toBe(0);
      expect([...map]).toEqual([]);
    });

    test('options only -> empty, but options are honoured', () => {
      const map = new HashMap<string, number>({ hashFn: () => 0 });
      expect(map.size).toBe(0);
      map.set('a', 1).set('b', 2);
      expect(map.get('a')).toBe(1);
      expect(map.get('b')).toBe(2);
    });

    test('empty options object behaves like defaults', () => {
      const map = new HashMap<string, number>({});
      map.set('a', 1);
      expect(map.get('a')).toBe(1);
    });

    test('entries + options', () => {
      const hashFn = vi.fn(() => 7);
      const map = new HashMap<string, number>([['a', 1], ['b', 2]], { hashFn });
      expect(hashFn).toHaveBeenCalled();
      expect(map.size).toBe(2);
      expect(map.get('b')).toBe(2);
    });

    test('entries + undefined options', () => {
      const map = new HashMap<string, number>([['a', 1]], undefined as any);
      expect(map.get('a')).toBe(1);
    });

    test('duplicate keys in initial entries: last wins, size counts unique', () => {
      const entries: Array<[string, number]> = [['a', 1], ['b', 2], ['a', 3], ['a', 4], ['b', 5]];
      const map = new HashMap<string, number>(entries);
      const native = new Map<string, number>(entries);
      expect(map.size).toBe(2);
      expect(map.get('a')).toBe(4);
      expect(map.get('b')).toBe(5);
      expectSameContents(map as HashMap<unknown, unknown>, native as Map<unknown, unknown>);
    });

    test('structurally-equal object keys in initial entries collapse (last wins)', () => {
      const map = new HashMap<object, number>([[{ id: 1 }, 1], [{ id: 1 }, 2]]);
      expect(map.size).toBe(1);
      expect(map.get({ id: 1 })).toBe(2);
    });

    test('constructor does not mutate the input array', () => {
      const entries: Array<[string, number]> = [['a', 1], ['a', 2]];
      const copy = JSON.parse(JSON.stringify(entries));
      new HashMap(entries);
      expect(entries).toEqual(copy);
    });

    test('later mutation of the input array does not affect the map', () => {
      const entries: Array<[string, number]> = [['a', 1]];
      const map = new HashMap<string, number>(entries);
      entries.push(['b', 2]);
      expect(map.size).toBe(1);
      expect(map.has('b')).toBe(false);
    });

    test.each([1, 2, 3, 5, 100])('capacity option %p still works for many inserts', (capacity) => {
      const map = new HashMap<number, number>({ capacity });
      for (let i = 0; i < 64; i++) map.set(i, i);
      expect(map.size).toBe(64);
      expect([...map.keys()].length).toBe(64);
      for (let i = 0; i < 64; i++) expect(map.get(i)).toBe(i);
    });

    test('capacity option 0 still stores and retrieves entries', () => {
      const map = new HashMap<number, number>({ capacity: 0 });
      for (let i = 0; i < 5; i++) map.set(i, i);
      expect(map.size).toBe(5);
      expect(map.get(3)).toBe(3);
      expect([...map.keys()].sort()).toEqual([0, 1, 2, 3, 4]);
    });
  });

  describe('getOrDefault', () => {
    test.each<[string, unknown]>([
      ['0', 0],
      ['-0', -0],
      ['empty string', ''],
      ['false', false],
      ['null', null],
      ['undefined', undefined],
      ['0n', 0n],
    ])('returns stored falsy value %s instead of the default', (_label, stored) => {
      const map = new HashMap<string, unknown>([['k', stored]]);
      expect(map.getOrDefault('k', 'DEFAULT')).toBe(stored);
    });

    test('returns stored NaN value instead of the default', () => {
      const map = new HashMap<string, number>([['k', NaN]]);
      expect(map.getOrDefault('k', 5)).toBeNaN();
    });

    test('returns the default (by identity) for a missing key', () => {
      const def = { d: true };
      const map = new HashMap<string, object>();
      expect(map.getOrDefault('missing', def)).toBe(def);
    });

    test('a falsy default is returned for a missing key', () => {
      const map = new HashMap<string, number | undefined>();
      expect(map.getOrDefault('missing', 0)).toBe(0);
      expect(map.getOrDefault('missing', undefined)).toBeUndefined();
    });

    test('does not insert the default', () => {
      const map = new HashMap<string, number>();
      map.getOrDefault('missing', 1);
      expect(map.has('missing')).toBe(false);
      expect(map.size).toBe(0);
    });

    test('returns the current value after update and default after delete', () => {
      const map = new HashMap<string, number>([['k', 1]]);
      map.set('k', 2);
      expect(map.getOrDefault('k', -1)).toBe(2);
      map.delete('k');
      expect(map.getOrDefault('k', -1)).toBe(-1);
    });
  });

  describe('getOrThrow', () => {
    test('throws an Error instance with the documented message', () => {
      const map = new HashMap<string, number>();
      let caught: unknown;
      try {
        map.getOrThrow('missing');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe('Element not found');
    });

    test.each<[string, unknown]>([
      ['undefined', undefined],
      ['null', null],
      ['0', 0],
      ['false', false],
      ['empty string', ''],
    ])('does not throw for stored value %s and returns it', (_label, stored) => {
      const map = new HashMap<string, unknown>([['k', stored]]);
      expect(() => map.getOrThrow('k')).not.toThrow();
      expect(map.getOrThrow('k')).toBe(stored);
    });

    test('throws after the key is deleted and after clear', () => {
      const map = new HashMap<string, number>([['a', 1], ['b', 2]]);
      map.delete('a');
      expect(() => map.getOrThrow('a')).toThrow('Element not found');
      expect(map.getOrThrow('b')).toBe(2);
      map.clear();
      expect(() => map.getOrThrow('b')).toThrow(Error);
    });

    test('works for null and undefined keys', () => {
      const map = new HashMap<unknown, string>([[null, 'n'], [undefined, 'u']]);
      expect(map.getOrThrow(null)).toBe('n');
      expect(map.getOrThrow(undefined)).toBe('u');
    });
  });

  describe('after clear()', () => {
    test('map is empty and iteration yields nothing', () => {
      const map = new HashMap<number, number>();
      for (let i = 0; i < 50; i++) map.set(i, i);
      map.clear();
      expect(map.size).toBe(0);
      expect([...map]).toEqual([]);
      expect([...map.keys()]).toEqual([]);
      expect([...map.values()]).toEqual([]);
      expect([...map.entries()]).toEqual([]);
      for (let i = 0; i < 50; i++) expect(map.has(i)).toBe(false);
    });

    test('map can be reused after clear', () => {
      const map = new HashMap<string, number>([['a', 1], ['b', 2]]);
      map.clear();
      expect(map.set('a', 10)).toBe(map);
      expect(map.size).toBe(1);
      expect(map.get('a')).toBe(10);
      expect(map.has('b')).toBe(false);
      expect(map.delete('a')).toBe(true);
      expect(map.size).toBe(0);
    });

    test('map can grow past the resize threshold again after clear', () => {
      const map = new HashMap<number, number>();
      for (let round = 0; round < 3; round++) {
        for (let i = 0; i < 200; i++) map.set(i, i + round);
        expect(map.size).toBe(200);
        for (let i = 0; i < 200; i++) expect(map.get(i)).toBe(i + round);
        map.clear();
        expect(map.size).toBe(0);
      }
    });

    test('a live iterator observes clear()', () => {
      const map = new HashMap<number, number>([[1, 1], [2, 2]]);
      const it = map.entries();
      map.clear();
      expect(it.next().done).toBe(true);
    });
  });

  describe('differential vs native Map (primitive keys)', () => {
    test.each([1, 2, 3, 42, 1337])('random op sequence with seed %p matches native Map', (seed) => {
      const rand = mulberry32(seed);
      const hm = new HashMap<unknown, unknown>({ capacity: 2 });
      const native = new Map<unknown, unknown>();
      const pick = () => primitiveKeys[Math.floor(rand() * primitiveKeys.length)];

      for (let step = 0; step < 400; step++) {
        const r = rand();
        const key = pick();
        if (r < 0.5) {
          const value = Math.floor(rand() * 5) === 0 ? undefined : step;
          expect(hm.set(key, value)).toBe(hm);
          native.set(key, value);
        } else if (r < 0.8) {
          expect(hm.delete(key)).toBe(native.delete(key));
        } else if (r < 0.98) {
          expect(hm.has(key)).toBe(native.has(key));
          expect(hm.get(key)).toBe(native.get(key));
        } else {
          expect(hm.clear()).toBe(native.clear());
        }
        expect(hm.size).toBe(native.size);
      }
      expectSameContents(hm, native);
    });

    test('get/has for every primitive key matches native on a populated map', () => {
      const half = primitiveKeys.filter((_, i) => i % 2 === 0);
      const hm = new HashMap<unknown, number>(half.map((k, i) => [k, i]));
      const native = new Map<unknown, number>(half.map((k, i) => [k, i]));
      for (const k of [...primitiveKeys, -0, 'missing', 99n]) {
        expect(hm.has(k)).toBe(native.has(k));
        expect(hm.get(k)).toBe(native.get(k));
      }
    });

    test('integer-like keys that collide in low bits match native Map', () => {
      const keys = Array.from({ length: 64 }, (_, i) => i * 1024); // all map to bucket 0 at small capacities
      const hm = new HashMap<number, number>({ capacity: 4 });
      const native = new Map<number, number>();
      keys.forEach(k => { hm.set(k, k); native.set(k, k); });
      keys.filter((_, i) => i % 3 === 0).forEach(k => {
        expect(hm.delete(k)).toBe(native.delete(k));
      });
      expectSameContents(hm as HashMap<unknown, unknown>, native as Map<unknown, unknown>);
    });
  });
});
