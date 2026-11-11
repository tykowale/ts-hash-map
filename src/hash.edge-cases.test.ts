import { describe, expect, it, test } from 'vitest';
import { getHashCode } from './hash';
import { isEqual } from './is-equal';

// Small deterministic PRNG so distribution tests are reproducible.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const isInt32 = (n: number): boolean => typeof n === 'number' && (n | 0) === n;

function countCollisions(values: unknown[]): number {
  const seen = new Set<number>();
  for (const v of values) {
    seen.add(getHashCode(v));
  }
  return values.length - seen.size;
}

class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
}

class WithMethod {
  value = 1;
  method(): number {
    return this.value;
  }
}

describe('getHashCode edge cases', () => {
  describe('return type', () => {
    it.each<[string, unknown]>([
      ['0', 0],
      ['negative int', -42],
      ['int32 max', 2147483647],
      ['int32 min', -2147483648],
      ['float 1.5', 1.5],
      ['0.1 + 0.2', 0.1 + 0.2],
      ['-0', -0],
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['-Infinity', -Infinity],
      ['MAX_SAFE_INTEGER', Number.MAX_SAFE_INTEGER],
      ['2 ** 53 + 2', 2 ** 53 + 2],
      ['empty string', ''],
      ['unicode string', 'héllo wörld'],
      ['emoji string', '😀👍🏽'],
      ['true', true],
      ['false', false],
      ['null', null],
      ['undefined', undefined],
      ['bigint', 123n],
      ['huge bigint', 2n ** 200n],
      ['symbol', Symbol('s')],
      ['arrow function', () => 1],
      [
        'named function',
        function named() {
          return 2;
        },
      ],
      ['Date', new Date(0)],
      ['invalid Date', new Date('nope')],
      ['RegExp', /a+b/gi],
      ['empty array', []],
      ['nested array', [[1, [2, [3]]]]],
      // eslint-disable-next-line no-sparse-arrays
      ['sparse array', [1, , 3]],
      [
        'Map',
        new Map<unknown, unknown>([
          ['a', 1],
          [{ b: 2 }, [3]],
        ]),
      ],
      ['Set', new Set([1, 'a', { b: 2 }])],
      ['plain object', { a: 1, b: 'two', c: [3] }],
      ['numeric keys object', { 1: 'a', 2: 'b' }],
      ['Object.create(null)', Object.assign(Object.create(null), { a: 1 })],
      ['class instance', new Point(1, 2)],
      ['Uint8Array', new Uint8Array([1, 2, 3])],
      ['Float64Array', new Float64Array([1.5, 2.5])],
      ['boxed Number', new Number(5)],
      ['boxed String', new String('abc')],
      ['boxed Boolean', new Boolean(true)],
    ])('returns a number for %s', (_name, value) => {
      expect(typeof getHashCode(value)).toBe('number');
    });

    it.each<[string, unknown]>([
      ['empty string', ''],
      ['unicode string', 'héllo wörld'],
      ['emoji / surrogate pairs', '😀👍🏽🇺🇸'],
      ['very long string', 'abcdefghij'.repeat(10000)],
      ['string of max char codes', '￿'.repeat(5000)],
      ['true', true],
      ['false', false],
      ['null', null],
      ['undefined', undefined],
      ['bigint', 123n],
      ['huge bigint', 2n ** 200n],
      ['symbol', Symbol('s')],
      ['function', (a: number) => a * 2],
      ['RegExp', /^[a-z]+$/u],
      ['empty array', []],
      ['array of floats', [1.5, 2.25, -3.75]],
      ['array with NaN/Infinity', [NaN, Infinity, -Infinity]],
      ['array of Dates', [new Date(8.64e15), new Date(-8.64e15)]],
      ['long array', Array.from({ length: 5000 }, (_, i) => i * 1000003)],
      ['deeply nested array', JSON.parse('['.repeat(200) + '1' + ']'.repeat(200))],
      [
        'Map',
        new Map([
          [Number.MAX_SAFE_INTEGER, 'big'],
          [1.5, 'f'],
        ]),
      ],
      ['Set', new Set([Number.MAX_SAFE_INTEGER, 1.5, 'x'])],
      ['object with large values', { a: Number.MAX_SAFE_INTEGER, b: 1e300 }],
      [
        'object with many keys',
        Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`k${i}`, i])),
      ],
      ['Object.create(null)', Object.assign(Object.create(null), { a: 1 })],
      ['class instance', new Point(3, 4)],
      ['typed array', new Int32Array([2147483647, -2147483648])],
      ['boxed primitive', new Number(5)],
    ])('returns a 32-bit integer for %s', (_name, value) => {
      expect(isInt32(getHashCode(value))).toBe(true);
    });

    it('long strings do not overflow and still differ by a single char', () => {
      const a = 'x'.repeat(100000) + 'a';
      const b = 'x'.repeat(100000) + 'b';
      expect(isInt32(getHashCode(a))).toBe(true);
      expect(getHashCode(a)).not.toBe(getHashCode(b));
    });

    test('NaN hash is comparable to itself with ===', () => {
      const h = getHashCode(NaN);
      expect(h === getHashCode(NaN)).toBe(true);
    });

    test('invalid Date hash is comparable to itself with ===', () => {
      const d = new Date('invalid');
      expect(isEqual(d, d)).toBe(true);
      // oxlint-disable-next-line no-self-compare -- comparing two separate hash calls on purpose
      expect(getHashCode(d) === getHashCode(d)).toBe(true);
    });
  });

  describe('determinism', () => {
    const fixtures: [string, () => unknown][] = [
      ['string', () => 'determinism'],
      ['float', () => 0.1 + 0.2],
      ['bigint', () => 99999999999999999999n],
      ['symbol', () => Symbol.for('det')],
      ['Date', () => new Date(2020, 1, 2)],
      ['RegExp', () => /x/g],
      ['nested object', () => ({ a: { b: [1, { c: new Set([1, 2]) }] }, d: new Map([[1, 2]]) })],
      ['typed array', () => new Uint16Array([5, 6, 7])],
    ];

    it.each(fixtures)('same %s yields same hash across repeated calls', (_name, make) => {
      const value = make();
      const first = getHashCode(value);
      for (let i = 0; i < 5; i++) {
        expect(Object.is(getHashCode(value), first)).toBe(true);
      }
    });

    it.each(fixtures)('two independently built %s values hash the same', (_name, make) => {
      expect(Object.is(getHashCode(make()), getHashCode(make()))).toBe(true);
    });

    it('default refs parameter does not leak between calls', () => {
      const obj = { a: 1, b: { c: 2 } };
      const expected = getHashCode(obj);
      expect(expected).not.toBe(0);
      // If refs leaked, the second call would see obj as already visited and return 0.
      expect(getHashCode(obj)).toBe(expected);
      expect(getHashCode([obj])).toBe(getHashCode([{ a: 1, b: { c: 2 } }]));
    });

    it('does not mutate the hashed value', () => {
      const value = { b: 2, a: [3, 1, 2], s: new Set([1]), m: new Map([[1, 1]]) };
      const snapshot = JSON.stringify({ ...value, s: [...value.s], m: [...value.m] });
      getHashCode(value);
      expect(Object.keys(value)).toEqual(['b', 'a', 's', 'm']);
      expect(JSON.stringify({ ...value, s: [...value.s], m: [...value.m] })).toBe(snapshot);
    });

    it('terminates on self-referencing arrays, Maps and Sets', () => {
      const arr: unknown[] = [1];
      arr.push(arr);
      const map = new Map<unknown, unknown>();
      map.set('self', map);
      const set = new Set<unknown>();
      set.add(set);
      expect(isInt32(getHashCode(arr))).toBe(true);
      expect(isInt32(getHashCode(map))).toBe(true);
      expect(isInt32(getHashCode(set))).toBe(true);
    });
  });

  describe('contract: isEqual(a, b) implies getHashCode(a) === getHashCode(b)', () => {
    const circularA: any = { name: 'node' };
    circularA.self = circularA;
    const circularB: any = { name: 'node' };
    circularB.self = circularB;

    const cycleArrA: any[] = [1];
    cycleArrA.push(cycleArrA);
    const cycleArrB: any[] = [1];
    cycleArrB.push(cycleArrB);

    const sharedKey = { id: 1 };
    const fn = (x: number) => x + 1;

    const passing: [string, unknown, unknown][] = [
      ['-0 and +0', -0, 0],
      ['same string', 'abc', 'abc'],
      ['reordered object keys', { a: 1, b: 2, c: 3 }, { c: 3, a: 1, b: 2 }],
      [
        'reordered nested object keys',
        { x: { p: 1, q: [1, 2] }, y: 2 },
        { y: 2, x: { q: [1, 2], p: 1 } },
      ],
      ['reordered Set members', new Set([1, 2, 3, 'a']), new Set(['a', 3, 2, 1])],
      ['Sets sharing object refs reordered', new Set([sharedKey, 1]), new Set([1, sharedKey])],
      ['equal Dates', new Date('2024-02-29T12:00:00Z'), new Date(Date.UTC(2024, 1, 29, 12))],
      ['equal RegExps', /ab+c/gi, new RegExp('ab+c', 'gi')],
      ['equal nested arrays', [1, [2, [3, { a: [4] }]]], [1, [2, [3, { a: [4] }]]]],
      [
        'equal Maps same order',
        new Map([
          [1, { a: 1 }],
          [2, { b: 2 }],
        ]),
        new Map([
          [1, { a: 1 }],
          [2, { b: 2 }],
        ]),
      ],
      ['equal functions (same source)', fn, (x: number) => x + 1],
      // eslint-disable-next-line no-sparse-arrays
      ['sparse vs undefined-filled', [1, , 3], [1, undefined, 3]],
      ['equal typed arrays', new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])],
      ['equal boxed numbers', new Number(5), new Number(5)],
      ['structurally identical circular objects', circularA, circularB],
      ['structurally identical circular arrays', cycleArrA, cycleArrB],
      ['object with undefined value vs same', { a: undefined, b: null }, { b: null, a: undefined }],
    ];

    it.each(passing)('%s', (_name, a, b) => {
      expect(isEqual(a, b)).toBe(true);
      expect(getHashCode(a) === getHashCode(b)).toBe(true);
    });

    // Pairs whose equality is a policy choice of isEqual (prototype / typed-array kind is ignored).
    // Only the implication is asserted, so the tests stay correct if isEqual becomes stricter.
    it.each<[string, unknown, unknown]>([
      ['class instance vs plain object', new Point(1, 2), { x: 1, y: 2 }],
      ['class instance with prototype method', new WithMethod(), { value: 1 }],
      [
        'Object.create(null) vs plain',
        Object.assign(Object.create(null), { a: 1, b: 2 }),
        { b: 2, a: 1 },
      ],
      ['different typed array kinds', new Uint8Array([1, 2]), new Int16Array([1, 2])],
      ['Number boxes with different values', new Number(5), new Number(6)],
    ])('if isEqual then same hash: %s', (_name, a, b) => {
      expect(!isEqual(a, b) || getHashCode(a) === getHashCode(b)).toBe(true);
    });

    test.each<[string, unknown, unknown]>([
      [
        'reordered Map entries (primitive keys)',
        new Map([
          [1, 'a'],
          [2, 'b'],
        ]),
        new Map([
          [2, 'b'],
          [1, 'a'],
        ]),
      ],
      [
        'reordered Map entries (object values)',
        new Map<string, unknown>([
          ['x', { a: 1 }],
          ['y', [1, 2]],
          ['z', 3],
        ]),
        new Map<string, unknown>([
          ['z', 3],
          ['x', { a: 1 }],
          ['y', [1, 2]],
        ]),
      ],
      [
        'reordered Map entries with shared object key',
        new Map<unknown, number>([
          [sharedKey, 1],
          ['k', 2],
        ]),
        new Map<unknown, number>([
          ['k', 2],
          [sharedKey, 1],
        ]),
      ],
    ])('%s', (_name, a, b) => {
      expect(isEqual(a, b)).toBe(true);
      expect(getHashCode(a) === getHashCode(b)).toBe(true);
    });

    test('[x, x] (same ref twice) hashes like [copyA, copyB]', () => {
      const x = { id: 7, tags: ['a'] };
      const a = [x, x];
      const b = [
        { id: 7, tags: ['a'] },
        { id: 7, tags: ['a'] },
      ];
      expect(isEqual(a, b)).toBe(true);
      expect(getHashCode(a)).toBe(getHashCode(b));
    });

    test('{ p: x, q: x } hashes like { p: copyA, q: copyB }', () => {
      const x = { v: [1, 2, 3] };
      const a = { p: x, q: x };
      const b = { p: { v: [1, 2, 3] }, q: { v: [1, 2, 3] } };
      expect(isEqual(a, b)).toBe(true);
      expect(getHashCode(a)).toBe(getHashCode(b));
    });

    test('Map with repeated value ref hashes like Map with equal copies', () => {
      const v = { n: 1 };
      const a = new Map([
        ['a', v],
        ['b', v],
      ]);
      const b = new Map([
        ['a', { n: 1 }],
        ['b', { n: 1 }],
      ]);
      expect(isEqual(a, b)).toBe(true);
      expect(getHashCode(a)).toBe(getHashCode(b));
    });

    test('equivalent cycles of different length hash the same', () => {
      const a: any = {};
      a.next = a;
      const b: any = {};
      b.next = { next: b };
      expect(isEqual(a, b)).toBe(true);
      expect(getHashCode(a)).toBe(getHashCode(b));
    });

    // Asserted as an implication: the test passes once either isEqual rejects the pair or the hashes agree.
    test.each<[string, unknown, unknown]>([
      ['array vs array-like object', [1, 2], { 0: 1, 1: 2 }],
      ['Date vs empty object', new Date(5), {}],
      ['non-empty Map vs empty object', new Map([[1, 2]]), {}],
      ['RegExp vs empty object', /abc/, {}],
      [
        'undefined-valued key vs different missing key',
        { a: undefined, b: 1 },
        { b: 1, c: undefined },
      ],
    ])('%s', (_name, a, b) => {
      expect(!isEqual(a, b) || getHashCode(a) === getHashCode(b)).toBe(true);
    });
  });

  describe('distinguishing values', () => {
    it.each<[string, unknown, unknown]>([
      ['true vs false', true, false],
      ['"ab" vs "ba"', 'ab', 'ba'],
      ['[1, 2] vs [2, 1]', [1, 2], [2, 1]],
      ['[1] vs [1, 0]', [1], [1, 0]],
      ['{ a: 1 } vs { b: 1 }', { a: 1 }, { b: 1 }],
      ['{ a: 1 } vs { a: 2 }', { a: 1 }, { a: 2 }],
      ['nested difference', { a: { b: [1, 2, 3] } }, { a: { b: [1, 2, 4] } }],
      ['Set [1, 2] vs Set [1, 3]', new Set([1, 2]), new Set([1, 3])],
      ['Map values differ', new Map([[1, 'a']]), new Map([[1, 'b']])],
      ['Date 0 vs Date 1', new Date(0), new Date(1)],
      ['/a/g vs /a/i', /a/g, /a/i],
      ['different symbols descriptions', Symbol('a'), Symbol('b')],
      ['1n vs 2n', 1n, 2n],
      ['emoji vs different emoji', '😀', '😁'],
    ])('%s hash differently', (_name, a, b) => {
      expect(getHashCode(a)).not.toBe(getHashCode(b));
    });
  });

  describe('distribution', () => {
    const N = 1000;
    const maxCollisions = N * 0.05;

    it('distinct small ints have no collisions', () => {
      expect(countCollisions(Array.from({ length: N }, (_, i) => i - 500))).toBe(0);
    });

    it('sequential keyed strings have few collisions', () => {
      expect(countCollisions(Array.from({ length: N }, (_, i) => `key${i}`))).toBeLessThanOrEqual(
        maxCollisions,
      );
    });

    it('random alphanumeric strings have few collisions', () => {
      const rand = mulberry32(42);
      const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
      const strs = new Set<string>();
      while (strs.size < N) {
        let s = '';
        const len = 4 + Math.floor(rand() * 12);
        for (let i = 0; i < len; i++) {
          s += alphabet[Math.floor(rand() * alphabet.length)];
        }
        strs.add(s);
      }
      expect(countCollisions([...strs])).toBeLessThanOrEqual(maxCollisions);
    });

    it('distinct small objects { id } have few collisions', () => {
      expect(countCollisions(Array.from({ length: N }, (_, i) => ({ id: i })))).toBeLessThanOrEqual(
        maxCollisions,
      );
    });

    test('distinct two-field objects have few collisions', () => {
      const objs: unknown[] = [];
      for (let x = 0; x < 32; x++) {
        for (let y = 0; y < 32; y++) {
          objs.push({ x, y });
        }
      }
      expect(countCollisions(objs)).toBeLessThanOrEqual(objs.length * 0.05);
    });

    it('distinct [i, j] tuples have few collisions', () => {
      const tuples: unknown[] = [];
      for (let i = 0; i < 32; i++) {
        for (let j = 0; j < 32; j++) {
          tuples.push([i, j]);
        }
      }
      expect(countCollisions(tuples)).toBeLessThanOrEqual(tuples.length * 0.05);
    });

    it('random objects spread across low-bit buckets (as HashMap indexes with hash & (cap - 1))', () => {
      const rand = mulberry32(7);
      const buckets = new Array(256).fill(0);
      for (let i = 0; i < 2048; i++) {
        const obj = { id: Math.floor(rand() * 1e9), name: `user${Math.floor(rand() * 1e6)}` };
        buckets[getHashCode(obj) & 255]++;
      }
      // Expected load is 8 per bucket; no bucket should be wildly overloaded and few should be empty.
      expect(Math.max(...buckets)).toBeLessThanOrEqual(32);
      expect(buckets.filter((b) => b === 0).length).toBeLessThanOrEqual(16);
    });
  });
});
