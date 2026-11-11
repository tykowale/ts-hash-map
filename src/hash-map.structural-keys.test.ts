import { describe, expect, it, test } from 'vitest';
import { HashMap } from './hash-map';
import { getHashCode } from './hash';
import { isEqual } from './is-equal';

// Small seeded PRNG so "random" data is deterministic across runs.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Asserts that `b` is treated as the very same key as `a` by a HashMap. */
function expectSameKey(a: unknown, b: unknown) {
  const map = new HashMap<unknown, string>();
  map.set(a, 'first');
  expect(map.has(b)).toBe(true);
  expect(map.get(b)).toBe('first');
  map.set(b, 'second');
  expect(map.size).toBe(1);
  expect(map.get(a)).toBe('second');
  expect(map.delete(b)).toBe(true);
  expect(map.size).toBe(0);
  expect(map.has(a)).toBe(false);
}

/** Asserts that `a` and `b` are treated as distinct keys by a HashMap. */
function expectDistinctKeys(a: unknown, b: unknown) {
  const map = new HashMap<unknown, string>();
  map.set(a, 'a');
  expect(map.has(b)).toBe(false);
  expect(map.get(b)).toBeUndefined();
  expect(map.delete(b)).toBe(false);
  map.set(b, 'b');
  expect(map.size).toBe(2);
  expect(map.get(a)).toBe('a');
  expect(map.get(b)).toBe('b');
}

/** hash/equals contract: isEqual(a, b) => getHashCode(a) === getHashCode(b). */
function expectContract(a: unknown, b: unknown) {
  if (isEqual(a, b)) {
    expect(getHashCode(a)).toBe(getHashCode(b));
  }
  if (isEqual(b, a)) {
    expect(getHashCode(b)).toBe(getHashCode(a));
  }
}

describe('HashMap structural (value-equality) keys', () => {
  describe('plain objects', () => {
    it.each([
      ['two props', { a: 1, b: 2 }, { b: 2, a: 1 }],
      ['three props', { x: 'x', y: true, z: null }, { z: null, x: 'x', y: true }],
      ['nested objects reordered', { o: { p: 1, q: 2 }, r: 3 }, { r: 3, o: { q: 2, p: 1 } }],
      ['nested arrays of objects', { list: [{ a: 1, b: 2 }] }, { list: [{ b: 2, a: 1 }] }],
      ['numeric-like keys', { 2: 'b', 1: 'a', x: 'c' }, { x: 'c', 1: 'a', 2: 'b' }],
      ['empty objects', {}, {}],
      ['function-valued props with identical source', { f: () => 1 }, { f: () => 1 }],
    ])('same key regardless of property insertion order: %s', (_, a, b) => {
      expectSameKey(a, b);
      expectContract(a, b);
    });

    it.each([
      ['different value', { a: 1 }, { a: 2 }],
      ['different key name', { a: 1 }, { b: 1 }],
      ['extra prop', { a: 1 }, { a: 1, b: 2 }],
      ['type-different value', { a: 1 }, { a: '1' }],
      ['null vs undefined value', { a: null }, { a: undefined }],
      ['nested difference', { o: { p: 1 } }, { o: { p: 2 } }],
      ['swapped values', { a: 1, b: 2 }, { a: 2, b: 1 }],
      ['0 vs false', { a: 0 }, { a: false }],
      ['empty string vs null', { a: '' }, { a: null }],
    ])('distinct keys: %s', (_, a, b) => {
      expectDistinctKeys(a, b);
      expectContract(a, b);
    });

    it('treats -0 and +0 property values as the same key (SameValueZero)', () => {
      expectSameKey({ n: 0 }, { n: -0 });
    });

    test('treats NaN property values as equal (SameValueZero)', () => {
      expectSameKey({ v: NaN }, { v: NaN });
    });
  });

  describe('objects with undefined-valued props', () => {
    it('{a: undefined} and {} are distinct keys', () => {
      expectDistinctKeys({ a: undefined }, {});
      expectContract({ a: undefined }, {});
    });

    it('{a: undefined} and {b: undefined} are distinct keys in the map', () => {
      expectDistinctKeys({ a: undefined }, { b: undefined });
    });

    test('{a: undefined} vs {b: undefined} respects the hash/equals contract', () => {
      expect(isEqual({ a: undefined }, { b: undefined })).toBe(false);
    });

    it('{a: undefined} matches a fresh {a: undefined}', () => {
      expectSameKey({ a: undefined, b: 1 }, { b: 1, a: undefined });
    });
  });

  describe('arrays', () => {
    it.each([
      [
        [1, 2, 3],
        [1, 2, 3],
      ],
      [[], []],
      [
        [[1, 2], [3]],
        [[1, 2], [3]],
      ],
      [
        [{ a: 1, b: 2 }, 'x'],
        [{ b: 2, a: 1 }, 'x'],
      ],
      [
        [null, undefined, 0, ''],
        [null, undefined, 0, ''],
      ],
    ])('same key for equal arrays %j', (a, b) => {
      expectSameKey(a, b);
      expectContract(a, b);
    });

    it.each([
      [
        [1, 2],
        [2, 1],
      ],
      [
        [1, 2],
        [1, 2, 3],
      ],
      [[1], [[1]]],
      [
        [1, 2, 3],
        [3, 2, 1],
      ],
      [
        [[1, 2], [3]],
        [[1], [2, 3]],
      ],
      [[null], [undefined]],
      [[0], [false]],
      [[], [undefined]],
    ])('order/length/content matters: %j vs %j', (a, b) => {
      expectDistinctKeys(a, b);
      expectContract(a, b);
    });

    it('sparse array and array with explicit undefined are consistent between hash and equals', () => {
      // eslint-disable-next-line no-sparse-arrays
      const sparse = [, 1];
      const dense = [undefined, 1];
      expectContract(sparse, dense);
      const map = new HashMap<unknown, number>([[sparse, 1]]);
      // whatever the library decides, map lookup must agree with isEqual
      expect(map.has(dense)).toBe(isEqual(dense, sparse));
    });

    it('two sparse arrays with holes in the same places are the same key', () => {
      // eslint-disable-next-line no-sparse-arrays
      expectSameKey([1, , 3], [1, , 3]);
    });

    it('arrays with different lengths but holes are distinct', () => {
      expectDistinctKeys(new Array(2), new Array(3));
    });

    test('array containing NaN can be looked up with a fresh array', () => {
      expectSameKey([NaN], [NaN]);
    });
  });

  describe('objects vs arrays with the same indices', () => {
    it("{0: 'a'} and ['a'] are distinct keys in the map", () => {
      expectDistinctKeys({ 0: 'a' }, ['a']);
    });

    test("{0: 'a'} vs ['a'] respects the hash/equals contract", () => {
      expect(isEqual({ 0: 'a' }, ['a'])).toBe(false);
      expect(isEqual(['a'], { 0: 'a' })).toBe(false);
    });
  });

  describe('empty containers of different types', () => {
    test.each([
      ['{} vs []', {}, []],
      ['{} vs new Map()', {}, new Map()],
      ['new Map() vs new Set()', new Map(), new Set()],
      ['{} vs new Date(0)', {}, new Date(0)],
      ['new Set([1]) vs new Date(1)', new Set([1]), new Date(1)],
      ['[] vs new Set()', [], new Set()],
    ])('%s are distinct keys', (_, a, b) => {
      expectDistinctKeys(a, b);
    });
  });

  describe('Date keys', () => {
    it('same timestamp is the same key', () => {
      expectSameKey(new Date('2024-01-01T00:00:00Z'), new Date(Date.UTC(2024, 0, 1)));
    });

    it.each([
      [new Date(0), new Date(1)],
      [new Date('2024-01-01'), new Date('2024-01-02')],
      [new Date(1), new Date(1 + 2 ** 32)], // same low 32 bits
    ])('different timestamps are distinct keys (%s vs %s)', (a, b) => {
      expectDistinctKeys(a, b);
    });

    it('a Date is not the same key as its numeric timestamp', () => {
      expectDistinctKeys(new Date(42), 42);
    });

    it('nested dates compare by time', () => {
      expectSameKey({ at: new Date(1000), id: 1 }, { id: 1, at: new Date(1000) });
      expectDistinctKeys({ at: new Date(1000) }, { at: new Date(1001) });
    });

    test('invalid Date can be found again', () => {
      const map = new HashMap<Date, number>();
      map.set(new Date('invalid'), 1);
      expect(map.get(new Date('invalid'))).toBe(1);
    });
  });

  describe('RegExp keys', () => {
    it('same source and flags is the same key', () => {
      expectSameKey(/ab+c/gi, new RegExp('ab+c', 'gi'));
    });

    it.each([
      [/a/g, /a/i],
      [/a/, /a/g],
      [/a/, /b/],
      [/a/m, /a/s],
    ])('%s and %s are distinct keys', (a, b) => {
      expectDistinctKeys(a, b);
    });

    it('a RegExp is not the same key as its string form', () => {
      expectDistinctKeys(/a/g, '/a/g');
    });
  });

  describe('Set keys', () => {
    it('Sets with the same primitive members in different order are one key', () => {
      expectSameKey(new Set([1, 2, 3]), new Set([3, 1, 2]));
      expectSameKey(new Set(['a', 'b']), new Set(['b', 'a']));
    });

    it('Sets with different members are distinct', () => {
      expectDistinctKeys(new Set([1, 2]), new Set([1, 3]));
      expectDistinctKeys(new Set([1, 2]), new Set([1, 2, 3]));
    });

    it('Set nested inside an object', () => {
      expectSameKey({ tags: new Set(['x', 'y']) }, { tags: new Set(['y', 'x']) });
    });

    test('Sets with structurally equal object members are one key', () => {
      expectSameKey(new Set([{ id: 1 }]), new Set([{ id: 1 }]));
    });
  });

  describe('Map keys', () => {
    it('Maps with the same entries in the same order are one key', () => {
      expectSameKey(
        new Map([
          ['a', 1],
          ['b', 2],
        ]),
        new Map([
          ['a', 1],
          ['b', 2],
        ]),
      );
    });

    it('Maps with different values are distinct', () => {
      expectDistinctKeys(new Map([['a', 1]]), new Map([['a', 2]]));
    });

    test('Maps with the same entries in different insertion order are one key', () => {
      const a = new Map([
        ['a', 1],
        ['b', 2],
      ]);
      const b = new Map([
        ['b', 2],
        ['a', 1],
      ]);
      expect(isEqual(a, b)).toBe(true);
      expect(getHashCode(a)).toBe(getHashCode(b));
      expectSameKey(a, b);
    });

    test('Maps with structurally equal object keys are one key', () => {
      expectSameKey(new Map([[{ id: 1 }, 'x']]), new Map([[{ id: 1 }, 'x']]));
    });
  });

  describe('class instances and prototypes', () => {
    class Point {
      constructor(
        public x: number,
        public y: number,
      ) {}
      norm() {
        return Math.hypot(this.x, this.y);
      }
    }

    it('two instances of the same class with equal fields are one key', () => {
      expectSameKey(new Point(1, 2), new Point(1, 2));
      expectDistinctKeys(new Point(1, 2), new Point(2, 1));
    });

    it('class instance vs plain object: map lookup agrees with isEqual and the hash contract', () => {
      // Prototype handling is a library policy (currently ignored); whatever it is, map, hash, and equals must agree.
      const p = new Point(1, 2);
      const o = { x: 1, y: 2 };
      expectContract(p, o);
      const map = new HashMap<unknown, number>([[p, 1]]);
      expect(map.has(o)).toBe(isEqual(o, p));
    });

    it('null-prototype objects work as keys and match equal null-prototype objects', () => {
      const a = Object.assign(Object.create(null), { a: 1, b: 2 });
      const b = Object.assign(Object.create(null), { b: 2, a: 1 });
      expectSameKey(a, b);
      const c = Object.assign(Object.create(null), { a: 1, b: 3 });
      expectDistinctKeys(a, c);
    });

    it('null-prototype object vs plain object: map lookup agrees with isEqual', () => {
      const a = Object.assign(Object.create(null), { a: 1 });
      const map = new HashMap<unknown, number>([[a, 1]]);
      expectContract(a, { a: 1 });
      expect(map.has({ a: 1 })).toBe(isEqual({ a: 1 }, a));
    });
  });

  describe('symbol-keyed properties', () => {
    const s = Symbol('s');

    it('map lookup agrees with isEqual when only symbol props differ', () => {
      const a = { id: 1, [s]: 'one' };
      const b = { id: 1, [s]: 'two' };
      expectContract(a, b);
      const map = new HashMap<unknown, number>([[a, 1]]);
      expect(map.has(b)).toBe(isEqual(b, a));
    });

    it('string props still distinguish keys that also carry symbol props', () => {
      expectDistinctKeys({ id: 1, [s]: 'x' }, { id: 2, [s]: 'x' });
    });

    it('a symbol-keyed object can be found by its own reference', () => {
      const a = { [s]: 1, n: 1 };
      const map = new HashMap<unknown, number>([[a, 7]]);
      expect(map.get(a)).toBe(7);
    });
  });

  describe('circular references', () => {
    function selfRef(name: string) {
      const o: any = { name };
      o.self = o;
      return o;
    }

    it('a self-referencing object can be used as a key and found by reference', () => {
      const a = selfRef('a');
      const map = new HashMap<unknown, number>([[a, 1]]);
      expect(map.get(a)).toBe(1);
      expect(map.size).toBe(1);
    });

    it('two structurally identical self-referencing objects are one key', () => {
      expectSameKey(selfRef('a'), selfRef('a'));
    });

    it('self-referencing objects with different data are distinct keys', () => {
      expectDistinctKeys(selfRef('a'), selfRef('b'));
    });

    it('mutually referencing pairs are one key when structurally identical', () => {
      const make = () => {
        const x: any = { n: 1 };
        const y: any = { n: 2 };
        x.peer = y;
        y.peer = x;
        return x;
      };
      expectSameKey(make(), make());
    });

    it('self-containing arrays are one key when structurally identical', () => {
      const a: any[] = [1];
      a.push(a);
      const b: any[] = [1];
      b.push(b);
      expectSameKey(a, b);
    });

    test('object reusing the same sub-object twice matches an equal tree of copies', () => {
      const shared = { v: 1 };
      const dag = { a: shared, b: shared };
      const tree = { a: { v: 1 }, b: { v: 1 } };
      expect(isEqual(dag, tree)).toBe(true);
      expect(getHashCode(dag)).toBe(getHashCode(tree));
      expectSameKey(dag, tree);
    });

    test('previously visited but unequal sub-objects are not treated as equal', () => {
      const x = { v: 1 };
      const y = { v: 2 };
      const a = [x, y, x];
      const y2 = { v: 2 };
      const b = [{ v: 1 }, y2, y2]; // third slot: x ({v:1}) vs y2 ({v:2}) -- genuinely different
      expect(isEqual(a, b)).toBe(false);
      expectDistinctKeys(a, b);
    });

    test('array reusing the same element object twice matches an equal array of copies', () => {
      const x = { v: 1 };
      expectSameKey([x, x], [{ v: 1 }, { v: 1 }]);
    });
  });

  describe('mixing primitive and object keys', () => {
    const keys: Array<[string, unknown]> = [
      ['number 1', 1],
      ["string '1'", '1'],
      ['true', true],
      ['bigint 1n', BigInt(1)],
      ['[1]', [1]],
      ['{v: 1}', { v: 1 }],
      ["Set(['x'])", new Set(['x'])],
      ['Date(5)', new Date(5)],
      ['/1/', /1/],
      ['null', null],
      ['undefined', undefined],
      ['0', 0],
      ["''", ''],
      ["Symbol.for('k')", Symbol.for('k')],
      ['[[1]]', [[1]]],
      ['{v: [1]}', { v: [1] }],
    ];

    it('all keys coexist with independent values', () => {
      const map = new HashMap<unknown, string>();
      for (const [label, key] of keys) map.set(key, label);
      expect(map.size).toBe(keys.length);
      for (const [label, key] of keys) expect(map.get(key)).toBe(label);
    });

    it.each(keys)('%s can be deleted without disturbing the others', (label, key) => {
      const map = new HashMap<unknown, string>(keys.map(([l, k]) => [k, l]));
      expect(map.delete(key)).toBe(true);
      expect(map.has(key)).toBe(false);
      expect(map.size).toBe(keys.length - 1);
      for (const [l, k] of keys) if (l !== label) expect(map.get(k)).toBe(l);
    });

    it('keys are found via fresh structurally-equal copies', () => {
      const map = new HashMap<unknown, string>(keys.map(([l, k]) => [k, l]));
      expect(map.get([1])).toBe('[1]');
      expect(map.get({ v: 1 })).toBe('{v: 1}');
      expect(map.get(new Set(['x']))).toBe("Set(['x'])");
      expect(map.get(new Date(5))).toBe('Date(5)');
      expect(map.get(/1/)).toBe('/1/');
      expect(map.get([[1]])).toBe('[[1]]');
      expect(map.get({ v: [1] })).toBe('{v: [1]}');
    });
  });

  describe('deep nesting', () => {
    function nestObj(depth: number, leaf: unknown): unknown {
      let v: unknown = leaf;
      for (let i = 0; i < depth; i++) v = { level: i, child: v };
      return v;
    }
    function nestArr(depth: number, leaf: unknown): unknown {
      let v: unknown = leaf;
      for (let i = 0; i < depth; i++) v = [i, v];
      return v;
    }

    it.each([1, 10, 50, 200])('objects nested %i deep are one key', (depth) => {
      expectSameKey(nestObj(depth, 'leaf'), nestObj(depth, 'leaf'));
    });

    it('objects nested 50 deep differing only at the leaf are distinct', () => {
      expectDistinctKeys(nestObj(50, 'a'), nestObj(50, 'b'));
    });

    it('arrays nested 50 deep are one key and differ by leaf', () => {
      expectSameKey(nestArr(50, 1), nestArr(50, 1));
      expectDistinctKeys(nestArr(50, 1), nestArr(50, 2));
    });

    it('nesting depth matters', () => {
      expectDistinctKeys(nestArr(10, 1), nestArr(11, 1));
    });
  });

  describe('mutating a key after insertion', () => {
    it('size is unchanged and iteration yields the (mutated) stored reference', () => {
      const key = { id: 1 };
      const map = new HashMap<{ id: number }, string>([[key, 'v']]);
      key.id = 2;
      expect(map.size).toBe(1);
      const stored = [...map.keys()];
      expect(stored).toHaveLength(1);
      expect(stored[0]).toBe(key);
      expect([...map.values()]).toEqual(['v']);
    });

    it('lookup by the original shape fails because the stored key no longer equals it (expected)', () => {
      const key = { id: 1 };
      const map = new HashMap<{ id: number }, string>([[key, 'v']]);
      key.id = 2;
      expect(map.has({ id: 1 })).toBe(false);
      expect(map.get({ id: 1 })).toBeUndefined();
    });

    it('lookup by the mutated reference uses the new hash and misses the stale bucket entry (expected)', () => {
      const key = { id: 1 };
      const map = new HashMap<{ id: number }, string>([[key, 'v']]);
      key.id = 2;
      expect(getHashCode({ id: 1 })).not.toBe(getHashCode({ id: 2 }));
      expect(map.has(key)).toBe(false);
      expect(map.has({ id: 2 })).toBe(false);
    });

    it('re-setting the mutated key creates a second entry; size accounting stays consistent', () => {
      const key = { id: 1 };
      const map = new HashMap<{ id: number }, string>([[key, 'v1']]);
      key.id = 2;
      map.set(key, 'v2');
      expect(map.size).toBe(2);
      expect([...map.keys()].length).toBe(2);
      expect(map.get({ id: 2 })).toBe('v2');
      map.clear();
      expect(map.size).toBe(0);
      expect([...map]).toEqual([]);
    });

    it('mutating back to the original shape makes the key reachable again', () => {
      const key = { id: 1 };
      const map = new HashMap<{ id: number }, string>([[key, 'v']]);
      key.id = 2;
      key.id = 1;
      expect(map.get({ id: 1 })).toBe('v');
      expect(map.delete({ id: 1 })).toBe(true);
      expect(map.size).toBe(0);
    });

    it('mutating an object used as a VALUE does not affect lookups', () => {
      const value = { n: 1 };
      const map = new HashMap<{ k: number }, { n: number }>([[{ k: 1 }, value]]);
      value.n = 99;
      expect(map.get({ k: 1 })).toBe(value);
    });
  });

  describe('large numbers of distinct object keys', () => {
    const N = 3000;

    it('stores N {id: i} keys and finds each via a fresh literal, across resizes', () => {
      const map = new HashMap<{ id: number }, number>();
      for (let i = 0; i < N; i++) map.set({ id: i }, i * 2);
      expect(map.size).toBe(N);
      expect((map as any).capacity).toBeGreaterThanOrEqual(N / 0.75);
      for (let i = 0; i < N; i++) expect(map.get({ id: i })).toBe(i * 2);
      expect(map.has({ id: N })).toBe(false);
      expect(map.has({ id: -1 })).toBe(false);
    });

    it('re-setting with fresh equal literals updates values without growing', () => {
      const map = new HashMap<{ id: number; tag: string }, number>();
      for (let i = 0; i < N; i++) map.set({ id: i, tag: `t${i % 7}` }, i);
      for (let i = 0; i < N; i++) map.set({ tag: `t${i % 7}`, id: i }, -i);
      expect(map.size).toBe(N);
      for (let i = 0; i < N; i++) expect(map.get({ id: i, tag: `t${i % 7}` })).toBe(-i);
    });

    it('deleting a shuffled half via fresh literals leaves exactly the other half', () => {
      const rand = mulberry32(1234);
      const map = new HashMap<{ id: number; meta: { even: boolean } }, number>();
      const ids = Array.from({ length: N }, (_, i) => i);
      for (const i of ids) map.set({ id: i, meta: { even: i % 2 === 0 } }, i);
      const order = shuffle(ids, rand);
      const removed = new Set(order.slice(0, N / 2));
      for (const i of removed)
        expect(map.delete({ meta: { even: i % 2 === 0 }, id: i })).toBe(true);
      for (const i of removed)
        expect(map.delete({ id: i, meta: { even: i % 2 === 0 } })).toBe(false);
      expect(map.size).toBe(N / 2);
      for (const i of ids) {
        expect(map.has({ id: i, meta: { even: i % 2 === 0 } })).toBe(!removed.has(i));
      }
      expect([...map.keys()].length).toBe(N / 2);
    });

    it('compound array keys [x, y] on a grid are all distinct and retrievable', () => {
      const map = new HashMap<[number, number], string>();
      for (let x = 0; x < 50; x++) for (let y = 0; y < 50; y++) map.set([x, y], `${x},${y}`);
      expect(map.size).toBe(2500);
      for (let x = 0; x < 50; x++)
        for (let y = 0; y < 50; y++) expect(map.get([x, y])).toBe(`${x},${y}`);
    });
  });

  describe('delete via an equal-but-not-identical object', () => {
    it.each([
      ['object', { a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 }],
      ['array', [1, { x: 2 }], [1, { x: 2 }]],
      ['Date', new Date(123), new Date(123)],
      ['RegExp', /x/g, /x/g],
      ['Set', new Set([1, 2]), new Set([2, 1])],
    ])('%s', (_, stored, probe) => {
      const map = new HashMap<unknown, number>([
        [stored, 1],
        ['other', 2],
      ]);
      expect(map.delete(probe)).toBe(true);
      expect(map.size).toBe(1);
      expect(map.has(stored)).toBe(false);
      expect(map.delete(probe)).toBe(false);
      expect(map.get('other')).toBe(2);
    });

    it('deleting one of several colliding-bucket object keys leaves the rest', () => {
      // capacity 16 => ids differing by 16 share a bucket under the default hash ({id} hash = hash('id') + id)
      const map = new HashMap<{ id: number }, number>();
      const ids = [0, 16, 32, 48];
      for (const id of ids) map.set({ id }, id);
      expect(map.delete({ id: 16 })).toBe(true);
      expect(map.size).toBe(3);
      for (const id of [0, 32, 48]) expect(map.get({ id })).toBe(id);
      expect(map.get({ id: 16 })).toBeUndefined();
    });
  });

  describe('randomised hash/equals contract via reordered clones', () => {
    type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

    function gen(rand: () => number, depth: number): Json {
      const r = rand();
      if (depth <= 0 || r < 0.3) {
        const p = rand();
        if (p < 0.2) return null;
        if (p < 0.4) return rand() < 0.5;
        if (p < 0.7) return Math.floor(rand() * 1000) - 500;
        return Math.floor(rand() * 1e6).toString(36);
      }
      if (r < 0.6)
        return Array.from({ length: Math.floor(rand() * 4) }, () => gen(rand, depth - 1));
      const obj: { [k: string]: Json } = {};
      const n = 1 + Math.floor(rand() * 4);
      for (let i = 0; i < n; i++) obj[`k${Math.floor(rand() * 10)}`] = gen(rand, depth - 1);
      return obj;
    }

    // Deep clone with object keys inserted in a shuffled order.
    function reorderedClone(v: Json, rand: () => number): Json {
      if (Array.isArray(v)) return v.map((x) => reorderedClone(x, rand));
      if (v !== null && typeof v === 'object') {
        const out: { [k: string]: Json } = {};
        for (const k of shuffle(Object.keys(v), rand)) out[k] = reorderedClone(v[k]!, rand);
        return out;
      }
      return v;
    }

    it('200 random structures: clones are equal, hash equally, and resolve to the same entry', () => {
      const rand = mulberry32(42);
      const map = new HashMap<Json, number>();
      const originals: Json[] = [];
      for (let i = 0; i < 200; i++) {
        const v = { seq: i, body: gen(rand, 4) };
        originals.push(v);
        map.set(v, i);
      }
      expect(map.size).toBe(200);
      originals.forEach((v, i) => {
        const c = reorderedClone(v, rand);
        expect(isEqual(v, c)).toBe(true);
        expect(getHashCode(c)).toBe(getHashCode(v));
        expect(map.get(c)).toBe(i);
      });
    });
  });
});
