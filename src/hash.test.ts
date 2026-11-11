import { describe, expect, it } from 'vitest';
import { getHashCode } from './hash';

const isInt32 = (n: number) => Number.isInteger(n) && (n | 0) === n;

describe('getHashCode tests', () => {
  // Stable values for primitives whose hashing is unchanged from v1.
  it.each`
    value        | expected
    ${null}      | ${0}
    ${undefined} | ${0}
    ${42}        | ${42}
    ${true}      | ${1231}
    ${false}     | ${1237}
    ${'hello'}   | ${99162322}
    ${'world'}   | ${113318802}
  `('returns $expected for $value', ({ value, expected }) => {
    expect(getHashCode(value)).toEqual(expected);
  });

  // v2 changed how non-int32 numbers and containers are hashed (32-bit mixed hashes, kind tags,
  // order-independent Map/Set/object combining), so exact values are not part of the contract.
  // Instead assert the properties HashMap relies on: a deterministic 32-bit integer that is the
  // same for a structurally equal copy.
  it.each`
    name               | make
    ${'3.14'}          | ${() => 3.14}
    ${'Date'}          | ${() => new Date('2022-01-01')}
    ${'RegExp'}        | ${() => /^hello$/i}
    ${'function'}      | ${() => () => {}}
    ${'array'}         | ${() => [1, 2, 3]}
    ${'Map'}           | ${() => new Map([[1, 'one'], [2, 'two']])}
    ${'Set'}           | ${() => new Set([1, 2, 3])}
    ${'empty object'}  | ${() => ({})}
    ${'object'}        | ${() => ({ a: 1, b: 2 })}
  `('hashes $name to a stable int32 shared by equal copies', ({ make }) => {
    const h = getHashCode(make());
    expect(isInt32(h)).toBe(true);
    expect(getHashCode(make())).toBe(h);
  });

  it('handles circular references', () => {
    const obj: any = {};
    obj.objRef = obj;
    const other: any = {};
    other.objRef = other;
    const h = getHashCode(obj);
    expect(isInt32(h)).toBe(true);
    expect(getHashCode(obj)).toBe(h);
    expect(getHashCode(other)).toBe(h);
  });
});
