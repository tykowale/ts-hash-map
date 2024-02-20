import { isEqual } from './is-equal';

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
  `('should return $expected for ($a, $b)', ({ a, b, expected }) => {
      expect(isEqual(a, b)).toEqual(expected);
    });
  });

  describe('Symbol equality tests', () => {
    it.each`
    a                 | b                 | expected
    ${Symbol('a')}    | ${Symbol('a')}    | ${false}
    ${Symbol.for('b')}    | ${Symbol.for('b')}    | ${true}
    ${Symbol()}       | ${Symbol()}       | ${false} 
  `('should return $expected for ($a, $b)', ({ a, b, expected }) => {
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
  `('should return $expected for ($a, $b)', ({ a, b, expected }) => {
      expect(isEqual(a, b)).toEqual(expected);
    });
  });

  it('returns true for equal objects', () => {
    expect(isEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toEqual(true);
    // order shouldn't matter
    expect(isEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toEqual(true);
    expect(isEqual({ x: 'hello', y: 'world' }, { x: 'hello', y: 'world' })).toEqual(true);
  });

  it('returns false for different objects', () => {
    expect(isEqual({ x: 'hello', y: 'world' }, { x: 'hello', y: 'there' })).toEqual(false);
  });

  it('returns true for equal dates', () => {
    const date1 = new Date('2022-01-01');
    const date2 = new Date('2022-01-01');
    expect(isEqual(date1, date2)).toEqual(true);
  });

  it('returns false for different dates', () => {
    const date1 = new Date('2022-01-01');
    const date2 = new Date('2022-01-02');
    expect(isEqual(date1, date2)).toEqual(false);
  });

  it('returns true for equal regular expressions', () => {
    const regex1 = /hello/i;
    const regex2 = /hello/i;
    expect(isEqual(regex1, regex2)).toEqual(true);
  });

  it('returns false for different regular expressions', () => {
    const regex1 = /hello/i;
    const regex2 = /world/i;
    expect(isEqual(regex1, regex2)).toEqual(false);
  });
});
