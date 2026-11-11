import { describe, expect, it, test } from 'vitest';
import { isEqual } from './is-equal';
import { getHashCode } from './hash';

// Small seeded PRNG so generated data is deterministic across runs.
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomValue(rand: () => number, depth = 0): unknown {
  const pick = Math.floor(rand() * (depth > 2 ? 4 : 7));
  switch (pick) {
    case 0:
      return Math.floor(rand() * 5);
    case 1:
      return ['a', 'b', 'c'][Math.floor(rand() * 3)];
    case 2:
      return rand() < 0.5;
    case 3:
      return rand() < 0.5 ? null : undefined;
    case 4: {
      const len = Math.floor(rand() * 3);
      return Array.from({ length: len }, () => randomValue(rand, depth + 1));
    }
    case 5: {
      const obj: Record<string, unknown> = {};
      const n = Math.floor(rand() * 3);
      for (let i = 0; i < n; i++) {
        obj[['x', 'y', 'z'][i]] = randomValue(rand, depth + 1);
      }
      return obj;
    }
    default:
      return new Date(Math.floor(rand() * 3) * 1000);
  }
}

// A fresh-structure factory per entry so reflexivity is tested on distinct references.
const valueFactories: Array<[string, () => unknown]> = [
  ['number 0', () => 0],
  ['number -0', () => -0],
  ['number 1', () => 1],
  ['Infinity', () => Infinity],
  ['-Infinity', () => -Infinity],
  ['string empty', () => ''],
  ['string "0"', () => '0'],
  ['string "a"', () => 'a'],
  ['true', () => true],
  ['false', () => false],
  ['null', () => null],
  ['undefined', () => undefined],
  ['bigint 1n', () => BigInt(1)],
  ['empty array', () => []],
  ['array [1]', () => [1]],
  ['array ["1"]', () => ['1']],
  ['array [[1]]', () => [[1]]],
  ['empty object', () => ({})],
  ['object {a:1}', () => ({ a: 1 })],
  ['object {a:"1"}', () => ({ a: '1' })],
  ['object {a:{b:1}}', () => ({ a: { b: 1 } })],
  ['object {0:1}', () => ({ 0: 1 })],
  ['date epoch', () => new Date(0)],
  ['date 1000', () => new Date(1000)],
  ['regexp /a/', () => /a/],
  ['regexp /a/g', () => /a/g],
  ['map a=>1', () => new Map([['a', 1]])],
  ['map a=>2', () => new Map([['a', 2]])],
  ['set {1}', () => new Set([1])],
  ['set {2}', () => new Set([2])],
];

describe('isEqual edge cases', () => {
  describe('equivalence relation laws', () => {
    describe('reflexivity on distinct-but-identical structures', () => {
      it.each(valueFactories)('%s equals a fresh copy of itself', (_name, make) => {
        expect(isEqual(make(), make())).toBe(true);
      });

      it.each(valueFactories)('%s equals itself by reference', (_name, make) => {
        const v = make();
        expect(isEqual(v, v)).toBe(true);
      });
    });

    describe('symmetry across all pairs of the value table', () => {
      const pairs: Array<[string, string, () => unknown, () => unknown]> = [];
      for (const [na, fa] of valueFactories) {
        for (const [nb, fb] of valueFactories) {
          if (na < nb) pairs.push([na, nb, fa, fb]);
        }
      }
      it.each(pairs)('isEqual(%s, %s) === isEqual(b, a)', (_na, _nb, fa, fb) => {
        expect(isEqual(fa(), fb())).toBe(isEqual(fb(), fa()));
      });
    });

    test('is symmetric and reflexive on seeded random structures', () => {
      const rand = mulberry32(1234);
      const values = Array.from({ length: 60 }, () => randomValue(rand));
      for (const a of values) {
        expect(isEqual(a, a)).toBe(true);
        for (const b of values) {
          expect(isEqual(a, b)).toBe(isEqual(b, a));
        }
      }
    });

    test('is transitive on seeded random structures', () => {
      const rand = mulberry32(42);
      const values = Array.from({ length: 40 }, () => randomValue(rand));
      for (const a of values) {
        for (const b of values) {
          if (!isEqual(a, b)) continue;
          for (const c of values) {
            if (isEqual(b, c)) {
              expect(isEqual(a, c)).toBe(true);
            }
          }
        }
      }
    });

    it('is transitive for structurally equal nested objects', () => {
      const a = { x: [1, { y: 2 }], d: new Date(5) };
      const b = { d: new Date(5), x: [1, { y: 2 }] };
      const c = { x: [1, { y: 2 }], d: new Date(5) };
      expect(isEqual(a, b) && isEqual(b, c)).toBe(true);
      expect(isEqual(a, c)).toBe(true);
    });

    test('is symmetric for an object with an undefined prop vs a one-element array', () => {
      expect(isEqual({ x: undefined }, [3])).toBe(isEqual([3], { x: undefined }));
    });

    test('is symmetric when one side has inherited enumerable properties', () => {
      const proto = { inherited: 1 };
      const a = Object.create(proto);
      a.own = 1;
      const b = { own: 1 };
      expect(isEqual(a, b)).toBe(isEqual(b, a));
    });
  });

  describe('number semantics (SameValueZero, as used by Map keys)', () => {
    test('NaN equals NaN', () => {
      expect(isEqual(NaN, NaN)).toBe(true);
    });

    test.each<[string, () => unknown]>([
      ['array', () => [NaN]],
      ['object', () => ({ n: NaN })],
      ['Map value', () => new Map([['k', NaN]])],
    ])('NaN nested in a %s equals NaN', (_n, make) => {
      expect(isEqual(make(), make())).toBe(true);
    });

    it('NaN does not equal numbers, strings, or undefined', () => {
      expect(isEqual(NaN, 0)).toBe(false);
      expect(isEqual(NaN, 'NaN')).toBe(false);
      expect(isEqual(NaN, undefined)).toBe(false);
    });

    it('+0 equals -0 (SameValueZero), including nested', () => {
      expect(isEqual(0, -0)).toBe(true);
      expect(isEqual(-0, 0)).toBe(true);
      expect(isEqual([0], [-0])).toBe(true);
      expect(isEqual({ z: -0 }, { z: 0 })).toBe(true);
    });

    it('number does not equal bigint of same magnitude', () => {
      expect(isEqual(1, BigInt(1))).toBe(false);
      expect(isEqual(BigInt(1), 1)).toBe(false);
    });

    it('Infinity and -Infinity differ', () => {
      expect(isEqual(Infinity, -Infinity)).toBe(false);
    });
  });

  describe('primitives vs boxed primitives', () => {
    it.each([
      ['number', 1, () => new Number(1)],
      ['string', 'a', () => new String('a')],
      ['boolean', true, () => new Boolean(true)],
    ])('%s primitive does not equal its boxed form', (_n, prim, box) => {
      expect(isEqual(prim, box())).toBe(false);
      expect(isEqual(box(), prim)).toBe(false);
    });

    it('boxed values with the same primitive value are equal', () => {
      expect(isEqual(new Number(1), new Number(1))).toBe(true);
      expect(isEqual(new String('ab'), new String('ab'))).toBe(true);
      expect(isEqual(new Boolean(false), new Boolean(false))).toBe(true);
    });

    it('boxed strings with different contents differ', () => {
      expect(isEqual(new String('ab'), new String('cd'))).toBe(false);
      expect(isEqual(new String('a'), new String('ab'))).toBe(false);
    });

    test('boxed numbers with different values differ', () => {
      expect(isEqual(new Number(1), new Number(2))).toBe(false);
    });

    test('boxed booleans with different values differ', () => {
      expect(isEqual(new Boolean(true), new Boolean(false))).toBe(false);
    });
  });

  describe('different types with the same shape', () => {
    it('array-like object with length does not equal an array', () => {
      expect(isEqual({ 0: 'a', length: 1 }, ['a'])).toBe(false);
      expect(isEqual(['a'], { 0: 'a', length: 1 })).toBe(false);
    });

    it('Date does not equal its numeric timestamp', () => {
      expect(isEqual(new Date(0), 0)).toBe(false);
      expect(isEqual(0, new Date(0))).toBe(false);
    });

    it('RegExp does not equal its string form', () => {
      expect(isEqual(/a/, '/a/')).toBe(false);
    });

    it('function does not equal an object', () => {
      expect(isEqual(() => 1, {})).toBe(false);
      expect(isEqual({}, () => 1)).toBe(false);
    });

    test.each([
      ['[] vs {}', () => [], () => ({})],
      ['["a"] vs {0:"a"}', () => ['a'], () => ({ 0: 'a' })],
      ['Date vs {}', () => new Date(0), () => ({})],
      ['RegExp vs {}', () => /a/, () => ({})],
      ['Map vs {}', () => new Map(), () => ({})],
      ['Set vs {}', () => new Set(), () => ({})],
      ['Map vs Set', () => new Map(), () => new Set()],
      ['Date vs RegExp', () => new Date(0), () => /a/],
      ['Uint8Array [1] vs [1]', () => new Uint8Array([1]), () => [1]],
    ])('%s are not equal', (_n, fa, fb) => {
      expect(isEqual(fa(), fb())).toBe(false);
    });
  });

  describe('undefined-valued vs missing properties', () => {
    it('{a: undefined} does not equal {}', () => {
      expect(isEqual({ a: undefined }, {})).toBe(false);
      expect(isEqual({}, { a: undefined })).toBe(false);
    });

    test('{a: undefined} does not equal {b: undefined}', () => {
      expect(isEqual({ a: undefined }, { b: undefined })).toBe(false);
    });

    test('{a: 1, b: undefined} does not equal {a: 1, c: undefined}', () => {
      expect(isEqual({ a: 1, b: undefined }, { a: 1, c: undefined })).toBe(false);
    });

    it('{a: undefined} equals {a: undefined}', () => {
      expect(isEqual({ a: undefined }, { a: undefined })).toBe(true);
    });

    it('{a: null} does not equal {a: undefined}', () => {
      expect(isEqual({ a: null }, { a: undefined })).toBe(false);
    });
  });

  describe('prototypes and class instances', () => {
    class Point {
      constructor(public x: number, public y: number) {}
    }
    class Vec {
      constructor(public x: number, public y: number) {}
    }

    it('instances of the same class with equal fields are equal', () => {
      expect(isEqual(new Point(1, 2), new Point(1, 2))).toBe(true);
    });

    it('instances of the same class with different fields differ', () => {
      expect(isEqual(new Point(1, 2), new Point(2, 1))).toBe(false);
    });

    test('instances of different classes with the same fields are not equal', () => {
      expect(isEqual(new Point(1, 2), new Vec(1, 2))).toBe(false);
    });

    it('Object.create(null) objects compare structurally', () => {
      const a = Object.create(null);
      a.k = 1;
      const b = Object.create(null);
      b.k = 1;
      expect(isEqual(a, b)).toBe(true);
      b.k = 2;
      expect(isEqual(a, b)).toBe(false);
    });

    it('null-prototype object vs plain object with no differences does not throw', () => {
      const a = Object.create(null);
      a.k = 1;
      expect(() => isEqual(a, { k: 1 })).not.toThrow();
      expect(isEqual(a, { k: 1 })).toBe(isEqual({ k: 1 }, a));
    });

    test('Errors with different messages are not equal', () => {
      expect(isEqual(new Error('a'), new Error('b'))).toBe(false);
    });

    it('non-enumerable own properties are ignored', () => {
      const a = { v: 1 };
      Object.defineProperty(a, 'hidden', { value: 1, enumerable: false });
      const b = { v: 1 };
      Object.defineProperty(b, 'hidden', { value: 2, enumerable: false });
      expect(isEqual(a, b)).toBe(true);
    });
  });

  describe('symbol-keyed properties', () => {
    const s = Symbol('k');

    it('objects with equal symbol-keyed values are equal', () => {
      expect(isEqual({ [s]: 1 }, { [s]: 1 })).toBe(true);
    });

    test('objects with different symbol-keyed values are not equal', () => {
      expect(isEqual({ [s]: 1 }, { [s]: 2 })).toBe(false);
    });

    it('symbol values compare by identity', () => {
      expect(isEqual({ a: s }, { a: s })).toBe(true);
      expect(isEqual({ a: Symbol('k') }, { a: Symbol('k') })).toBe(false);
    });
  });

  describe('nested Maps and Sets', () => {
    // v2: Set members and Map keys are compared structurally (v1 compared them by reference).
    it('Set of structurally-equal but distinct objects is equal', () => {
      expect(isEqual(new Set([{ id: 1 }]), new Set([{ id: 1 }]))).toBe(true);
      expect(isEqual(new Set([{ id: 1 }]), new Set([{ id: 2 }]))).toBe(false);
    });

    it('Map with structurally-equal but distinct object keys is equal', () => {
      expect(isEqual(new Map([[{ id: 1 }, 'v']]), new Map([[{ id: 1 }, 'v']]))).toBe(true);
      expect(isEqual(new Map([[{ id: 1 }, 'v']]), new Map([[{ id: 2 }, 'v']]))).toBe(false);
    });

    it('Set/Map with shared object references are equal', () => {
      const k = { id: 1 };
      expect(isEqual(new Set([k]), new Set([k]))).toBe(true);
      expect(isEqual(new Map([[k, 'v']]), new Map([[k, 'v']]))).toBe(true);
    });

    it('Map values are compared deeply', () => {
      expect(isEqual(new Map([['a', { x: [1] }]]), new Map([['a', { x: [1] }]]))).toBe(true);
      expect(isEqual(new Map([['a', { x: [1] }]]), new Map([['a', { x: [2] }]]))).toBe(false);
    });

    it('Map with undefined value does not equal Map with a missing key', () => {
      expect(isEqual(new Map([['a', undefined]]), new Map([['b', undefined]]))).toBe(false);
    });

    it('nested Maps inside Maps compare deeply', () => {
      const a = new Map([['outer', new Map([['inner', [1, 2]]])]]);
      const b = new Map([['outer', new Map([['inner', [1, 2]]])]]);
      expect(isEqual(a, b)).toBe(true);
    });

    it.each([
      ['sets of objects', () => new Set([{ id: 1 }, { id: 2 }]), () => new Set([{ id: 1 }, { id: 2 }])],
      ['maps with object keys', () => new Map([[{ id: 1 }, 1]]), () => new Map([[{ id: 1 }, 1]])],
      ['set inside object', () => ({ s: new Set([[1]]) }), () => ({ s: new Set([[1]]) })],
      ['map inside array', () => [new Map([[[1], 2]])], () => [new Map([[[1], 2]])]],
    ])('never asymmetric: %s', (_n, fa, fb) => {
      expect(isEqual(fa(), fb())).toBe(isEqual(fb(), fa()));
    });

    it('Set with NaN equals Set with NaN (Set.has uses SameValueZero)', () => {
      expect(isEqual(new Set([NaN]), new Set([NaN]))).toBe(true);
    });

    it('Map with a NaN key equals Map with a NaN key (Map.has uses SameValueZero)', () => {
      expect(isEqual(new Map([[NaN, 1]]), new Map([[NaN, 1]]))).toBe(true);
    });

    it('Map keyed by -0 equals Map keyed by +0 (Map normalizes -0)', () => {
      expect(isEqual(new Map([[-0, 'v']]), new Map([[0, 'v']]))).toBe(true);
      expect(isEqual(new Set([-0]), new Set([0]))).toBe(true);
    });

    it('same-size Sets/Maps with different members are not equal in either order', () => {
      expect(isEqual(new Set([1, 2]), new Set([1, 3]))).toBe(false);
      expect(isEqual(new Set([1, 3]), new Set([1, 2]))).toBe(false);
      expect(isEqual(new Map([['a', 1]]), new Map([['b', 1]]))).toBe(false);
      expect(isEqual(new Map([['b', 1]]), new Map([['a', 1]]))).toBe(false);
    });
  });

  describe('arrays', () => {
    it('sparse arrays with holes in the same positions are equal', () => {
      // eslint-disable-next-line no-sparse-arrays
      expect(isEqual([1, , 3], [1, , 3])).toBe(true);
    });

    it('documents: a hole and an explicit undefined at the same index compare equal', () => {
      // eslint-disable-next-line no-sparse-arrays
      expect(isEqual([, 1], [undefined, 1])).toBe(true);
      // eslint-disable-next-line no-sparse-arrays
      expect(isEqual([undefined, 1], [, 1])).toBe(true);
    });

    it('new Array(n) equals another new Array(n) but not a different length', () => {
      expect(isEqual(new Array(3), new Array(3))).toBe(true);
      expect(isEqual(new Array(3), new Array(2))).toBe(false);
    });

    it('a hole does not equal a defined value', () => {
      // eslint-disable-next-line no-sparse-arrays
      expect(isEqual([, 1], [0, 1])).toBe(false);
    });

    it('documents: extra non-index properties on arrays are ignored', () => {
      const a: any = [1, 2];
      a.extra = 'x';
      expect(isEqual(a, [1, 2])).toBe(true);
      expect(isEqual([1, 2], a)).toBe(true);
    });

    it('nested arrays compare element-wise', () => {
      expect(isEqual([[1, [2, [3]]]], [[1, [2, [3]]]])).toBe(true);
      expect(isEqual([[1, [2, [3]]]], [[1, [2, [4]]]])).toBe(false);
    });
  });

  describe('Dates', () => {
    test('two invalid dates are equal', () => {
      expect(isEqual(new Date('nope'), new Date('also nope'))).toBe(true);
    });

    it('the same invalid Date instance equals itself', () => {
      const d = new Date('nope');
      expect(isEqual(d, d)).toBe(true);
    });

    it('invalid date does not equal a valid date', () => {
      expect(isEqual(new Date('nope'), new Date(0))).toBe(false);
    });

    it('dates differing by one millisecond are not equal', () => {
      expect(isEqual(new Date(1000), new Date(1001))).toBe(false);
    });
  });

  describe('RegExps', () => {
    it.each([
      [/a/g, /a/i, false],
      [/a/g, /a/, false],
      [/a/gi, /a/ig, true],
      [/a/m, /a/m, true],
      [/a/u, /a/y, false],
      [new RegExp('a', 's'), /a/s, true],
      [/a\//, new RegExp('a/'), true],
    ])('isEqual(%s, %s) === %s', (a, b, expected) => {
      expect(isEqual(a, b)).toBe(expected);
      expect(isEqual(b, a)).toBe(expected);
    });

    it('documents: lastIndex is not part of equality', () => {
      const a = /a/g;
      const b = /a/g;
      a.exec('aaa');
      expect(a.lastIndex).not.toBe(b.lastIndex);
      expect(isEqual(a, b)).toBe(true);
    });
  });

  describe('functions', () => {
    it('functions with the same source text are equal', () => {
      const make = () => function add(x: number) { return x + 1; };
      expect(isEqual(make(), make())).toBe(true);
    });

    it('functions with different source text are not equal', () => {
      expect(isEqual((x: number) => x + 1, (x: number) => x + 2)).toBe(false);
    });

    it('documents: closures with the same text but different captured values are equal', () => {
      const make = (n: number) => () => n;
      expect(isEqual(make(1), make(2))).toBe(true);
    });

    it('functions nested in objects compare by source', () => {
      expect(isEqual({ f: () => 1 }, { f: () => 1 })).toBe(true);
      expect(isEqual({ f: () => 1 }, { f: () => 2 })).toBe(false);
    });
  });

  describe('circular structures', () => {
    it('self-referential objects with the same shape are equal', () => {
      const a: any = { v: 1 };
      a.self = a;
      const b: any = { v: 1 };
      b.self = b;
      expect(isEqual(a, b)).toBe(true);
    });

    it('self-referential arrays are equal', () => {
      const a: any[] = [1];
      a.push(a);
      const b: any[] = [1];
      b.push(b);
      expect(isEqual(a, b)).toBe(true);
    });

    it('mutually-referential structures with the same shape are equal', () => {
      const a1: any = { n: 'a' };
      const a2: any = { n: 'b', peer: a1 };
      a1.peer = a2;
      const b1: any = { n: 'a' };
      const b2: any = { n: 'b', peer: b1 };
      b1.peer = b2;
      expect(isEqual(a1, b1)).toBe(true);
    });

    it('circular structures differing deeper in the cycle are not equal', () => {
      const a: any = { v: 1 };
      a.self = a;
      const b: any = { v: 1 };
      b.self = { v: 2, self: b };
      expect(isEqual(a, b)).toBe(false);
      expect(isEqual(b, a)).toBe(false);
    });

    it('swapped distinct-shape refs are not equal', () => {
      const o1 = { p: 1 };
      const o2 = { q: [2] };
      expect(isEqual({ x: o1, y: o2 }, { x: o2, y: o1 })).toBe(false);
    });

    test('values seen at different positions are not treated as equal', () => {
      const x = { v: 1 };
      const y = { w: 2 };
      const x2 = { v: 1 };
      const y2 = { w: 2 };
      // a[2] is x-shaped, b[2] is y-shaped: must be false
      expect(isEqual([x, y, x], [x2, y2, y2])).toBe(false);
    });

    it('a shared (DAG) sub-object equals two distinct structurally equal copies', () => {
      const s = { v: [1] };
      const dag = { p: s, q: s };
      const tree = { p: { v: [1] }, q: { v: [1] } };
      expect(isEqual(dag, tree)).toBe(true);
      expect(isEqual(tree, dag)).toBe(true);
    });

    it('a shared sub-object does not mask a differing distinct copy', () => {
      const s = { v: 1 };
      expect(isEqual({ p: s, q: s }, { p: { v: 1 }, q: { v: 2 } })).toBe(false);
      expect(isEqual({ p: { v: 1 }, q: { v: 2 } }, { p: s, q: s })).toBe(false);
    });

    it('a Map containing itself compares without stack overflow', () => {
      const a = new Map<string, unknown>();
      a.set('me', a);
      const b = new Map<string, unknown>();
      b.set('me', b);
      expect(isEqual(a, b)).toBe(true);
    });

    it('default refs does not leak state across calls', () => {
      const x = { v: 1 };
      const y = { v: 2 };
      expect(isEqual(x, y)).toBe(false);
      expect(isEqual({ v: 1 }, { v: 1 })).toBe(true);
      // after a call that pushed x and y into a refs array, they must still compare unequal
      expect(isEqual([x], [x])).toBe(true);
      expect(isEqual(x, y)).toBe(false);
      expect(isEqual(y, x)).toBe(false);
    });
  });

  describe('typed arrays and ArrayBuffers', () => {
    it('typed arrays with equal contents are equal', () => {
      expect(isEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
      expect(isEqual(new Float64Array([1.5]), new Float64Array([1.5]))).toBe(true);
    });

    it('typed arrays with different contents or lengths differ', () => {
      expect(isEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
      expect(isEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 0]))).toBe(false);
    });

    test('typed arrays of different element types differ', () => {
      expect(isEqual(new Uint8Array([1, 2]), new Int8Array([1, 2]))).toBe(false);
    });

    test('ArrayBuffers with different bytes differ', () => {
      const a = new Uint8Array([1, 2]).buffer;
      const b = new Uint8Array([9, 9]).buffer;
      expect(isEqual(a, b)).toBe(false);
    });

    test('ArrayBuffers with different byteLength differ', () => {
      expect(isEqual(new ArrayBuffer(2), new ArrayBuffer(8))).toBe(false);
    });

    test('DataViews over different bytes differ', () => {
      const a = new DataView(new Uint8Array([1]).buffer);
      const b = new DataView(new Uint8Array([2]).buffer);
      expect(isEqual(a, b)).toBe(false);
    });
  });

  describe('deep nesting', () => {
    function nest(depth: number, leaf: unknown): unknown {
      let v: unknown = leaf;
      for (let i = 0; i < depth; i++) {
        v = i % 2 === 0 ? { child: v } : [v];
      }
      return v;
    }

    it.each([10, 100, 1000])('equal structures nested %i levels deep are equal', (depth) => {
      expect(isEqual(nest(depth, 'leaf'), nest(depth, 'leaf'))).toBe(true);
    });

    it.each([10, 100, 1000])('structures differing only at the leaf (%i levels) are not equal', (depth) => {
      expect(isEqual(nest(depth, 'leaf'), nest(depth, 'other'))).toBe(false);
    });

    it('structures of different depth are not equal', () => {
      expect(isEqual(nest(50, 1), nest(51, 1))).toBe(false);
    });

    it('wide objects with many keys compare correctly', () => {
      const a: Record<string, number> = {};
      const b: Record<string, number> = {};
      for (let i = 0; i < 2000; i++) {
        a[`k${i}`] = i;
        b[`k${1999 - i}`] = 1999 - i;
      }
      expect(isEqual(a, b)).toBe(true);
      b.k1000 = -1;
      expect(isEqual(a, b)).toBe(false);
    });
  });

  describe('hash/equals contract: isEqual(a,b) implies equal hash codes', () => {
    it.each<[string, () => unknown, () => unknown]>([
      ['+0 / -0', () => 0, () => -0],
      ['reordered object keys', () => ({ a: 1, b: [2] }), () => ({ b: [2], a: 1 })],
      ['reordered Set', () => new Set([1, 2, 3]), () => new Set([3, 2, 1])],
      ['equal dates', () => new Date(5), () => new Date(5)],
      ['equal regexps', () => /x/gi, () => /x/ig],
      // eslint-disable-next-line no-sparse-arrays
      ['hole vs undefined', () => [, 1], () => [undefined, 1]],
    ])('%s', (_n, fa, fb) => {
      const a = fa();
      const b = fb();
      expect(isEqual(a, b)).toBe(true);
      // contract is ===, so +0 and -0 hashes are interchangeable
      expect(getHashCode(a) === getHashCode(b)).toBe(true);
    });

    // (Map insertion-order hash sensitivity is covered in hash.edge-cases.test.ts.)

    test('holds over seeded random structures', () => {
      const rand = mulberry32(7);
      const values = Array.from({ length: 80 }, () => randomValue(rand));
      for (const a of values) {
        for (const b of values) {
          if (isEqual(a, b)) {
            expect(getHashCode(a)).toBe(getHashCode(b));
          }
        }
      }
    });
  });
});
