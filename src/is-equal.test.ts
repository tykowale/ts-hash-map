import { isEqual } from 'src/is-equal';

describe('isEqual', () => {
  describe('Primitive equality tests', () => {
    it.each`
    a             | b               | expected
    ${42}         | ${42}           | ${true}
    ${0}          | ${0}            | ${true}
    ${-1}         | ${-1}           | ${true}
    ${3.14}       | ${3.14}         | ${true}
    ${'hello'}    | ${'hello'}      | ${true}
    ${'world'}    | ${'world'}      | ${true}
    ${''}         | ${''}           | ${true}
    ${true}       | ${true}         | ${true}
    ${false}      | ${false}        | ${true}
    ${null}       | ${null}         | ${true}
    ${undefined}  | ${undefined}    | ${true}
    ${42}         | ${43}           | ${false}
    ${-1}         | ${1}            | ${false}
    ${3.14}       | ${3.14159}      | ${false}
    ${'hello'}    | ${'world'}      | ${false}
    ${'hello'}    | ${'HELLO'}      | ${false}
    ${true}       | ${false}        | ${false}
    ${false}      | ${true}         | ${false}
    ${42}         | ${'42'}         | ${false}
    ${'hello'}    | ${true}         | ${false}
    ${null}       | ${undefined}    | ${false}
    ${null}       | ${0}            | ${false}
    ${null}       | ${''}           | ${false}
    ${undefined}  | ${false}        | ${false}
    ${BigInt(42)} | ${BigInt(42)}   | ${true}
    ${BigInt(0)}  | ${BigInt(0)}    | ${true}
    ${BigInt(-1)} | ${BigInt(-1)}   | ${true}
    ${BigInt(42)} | ${BigInt(43)}   | ${false}
    ${BigInt(-1)} | ${BigInt(1)}    | ${false}
  `('returns $expected for ($a, $b)', ({ a, b, expected }) => {
      expect(isEqual(a, b)).toEqual(expected);
    });
  });

  describe('Symbol equality tests', () => {
    it.each`
    a                 | b                 | expected
    ${Symbol('a')}    | ${Symbol('a')}    | ${false}
    ${Symbol.for('b')}    | ${Symbol.for('b')}    | ${true}
    ${Symbol()}       | ${Symbol()}       | ${false} 
  `('returns $expected for ($a, $b)', ({ a, b, expected }) => {
      expect(isEqual(a, b)).toEqual(expected);
    });
  });
  describe('Array equality tests', () => {
    it.each`
    a                                     | b                                     | expected
    ${[]}                                 | ${[]}                                 | ${true}
    ${[1, 2, 3]}                          | ${[1, 2, 3]}                          | ${true}
    ${['a', 'b', 'c']}                    | ${['a', 'b', 'c']}                    | ${true}
    ${[1, 2, 3]}                          | ${[3, 2, 1]}                          | ${false}
    ${[1, 2, 3]}                          | ${[1, 2]}                             | ${false}
    ${[1, 2, 3]}                          | ${[1, 2, 3, 4]}                       | ${false}
    ${[1, 'hello', true]}                 | ${[1, 'hello', true]}                 | ${true}
    ${[{ a: 1 }, { b: 2 }]}               | ${[{ a: 1 }, { b: 2 }]}               | ${true}
    ${[{ a: 1 }, { b: 2 }]}               | ${[{ b: 2 }, { a: 1 }]}               | ${false} // Order matters for objects inside arrays
    ${[{ a: 1, b: [1, 2, 3] }]}           | ${[{ a: 1, b: [1, 2, 3] }]}           | ${true}
    ${[{ a: 1, b: [1, 2, 3] }]}           | ${[{ a: 1, b: [3, 2, 1] }]}           | ${false}
    ${[{ a: 1, b: { c: 'hello' } }]}      | ${[{ a: 1, b: { c: 'hello' } }]}      | ${true}
    ${[{ a: 1, b: { c: 'hello' } }]}      | ${[{ a: 1, b: { c: 'world' } }]}      | ${false}
  `('returns $expected for ($a, $b)', ({ a, b, expected }) => {
      expect(isEqual(a, b)).toEqual(expected);
    });
  });

  describe('Date equality tests', () => {
    it.each`
    a                     | b                     | expected
    ${new Date('2024-01-01')} | ${new Date('2024-01-01')} | ${true}
    ${new Date('2024-01-01')} | ${new Date('2024-01-02')} | ${false}
    ${new Date('2024-01-01')} | ${new Date('2023-01-01')} | ${false}
    ${new Date('2024-02-01')} | ${new Date('2024-01-01')} | ${false}
  `('returns $expected for ($a, $b)', ({ a, b, expected }) => {
      expect(isEqual(a, b)).toEqual(expected);
    });
  });

  describe('RegExp equality tests', () => {
    it.each`
    a                         | b                         | expected
    ${/^hello$/i}             | ${/^hello$/i}             | ${true}
    ${/^hello$/i}             | ${/^world$/i}             | ${false}
    ${/^\d+$/}                | ${/^\d+$/}                | ${true}
    ${/^\d+$/}                | ${/^\\d+$/}               | ${false} // Different escape representation
  `('returns $expected for ($a, $b)', ({ a, b, expected }) => {
      expect(isEqual(a, b)).toEqual(expected);
    });
  });

  // these are too hard to do in each blocks and it formats poorly
  describe('Function equality tests', () => {
    it('returns true for two anonymous functions', () => {
      const f1 = () => {
      };
      const f2 = () => {
      };
      expect(isEqual(f1, f2)).toEqual(true);
    });
  });

  describe('Set equality tests', () => {
    it.each`
    a                             | b                             | expected
    ${new Set([1, 2, 3])}         | ${new Set([1, 2, 3])}         | ${true}
    ${new Set([1, 2, 3])}         | ${new Set([3, 2, 1])}         | ${true}
    ${new Set(['hello', 'world'])} | ${new Set(['hello', 'world'])} | ${true}
    ${new Set(['hello', 'world'])} | ${new Set(['world', 'hello'])} | ${true}
    ${new Set([1, 2, 3])}         | ${new Set([1, 2])}            | ${false}
    ${new Set([1, 2, 3])}         | ${new Set([1, 2, 3, 4])}      | ${false}
  `('returns $expected for ($a, $b)', ({ a, b, expected }) => {
      expect(isEqual(a, b)).toEqual(expected);
    });
  });

  describe('Map equality tests', () => {
    it.each`
    a                                                     | b                                                     | expected
    ${new Map([['a', 1], ['b', 2]])}                     | ${new Map([['a', 1], ['b', 2]])}                     | ${true}
    ${new Map([['a', 1], ['b', 2]])}                     | ${new Map([['b', 2], ['a', 1]])}                     | ${true}
    ${new Map([['a', 1], ['b', 2]])}                     | ${new Map([['a', 1]])}                               | ${false}
    ${new Map([['a', 1], ['b', 2]])}                     | ${new Map([['a', 1], ['b', 2], ['c', 3]])}           | ${false}
  `('returns $expected for ($a, $b)', ({ a, b, expected }) => {
      expect(isEqual(a, b)).toEqual(expected);
    });
  });

  describe('Object equality tests', () => {
    it.each`
    a                       | b                       | expected
    ${{}}                   | ${{}}                   | ${true}
    ${{ a: 1, b: 2 }}       | ${{ a: 1, b: 2 }}       | ${true}
    ${{ a: 1, b: 2 }}       | ${{ b: 2, a: 1 }}       | ${true}
    ${{ a: 1, b: 2 }}       | ${{ a: 1, b: 3 }}       | ${false}
    ${{ a: 1, b: 2 }}       | ${{ a: 1, c: 2 }}       | ${false}
    ${{ a: 1, b: 2 }}       | ${{ a: 1 }}             | ${false}
    ${{ a: 1, b: [1, 2, 3] }} | ${{ a: 1, b: [1, 2, 3] }} | ${true}
    ${{ a: 1, b: [1, 2, 3] }} | ${{ a: 1, b: [3, 2, 1] }} | ${false}
    ${{ a: { b: 2 } }}       | ${{ a: { b: 2 } }}       | ${true}
    ${{ a: { b: 2 } }}       | ${{ a: { b: 3 } }}       | ${false}
  `('returns $expected for ($a, $b)', ({ a, b, expected }) => {
      expect(isEqual(a, b)).toEqual(expected);
    });
  });
});
