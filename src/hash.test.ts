import { getHashCode } from 'src/hash';

describe('HashCode tests', () => {
  it.each`
    value                     | expected
    ${null}                   | ${0}
    ${undefined}              | ${0}
    ${42}                     | ${42}
    ${3.14}                   | ${3.14}
    ${true}                   | ${1}
    ${false}                  | ${0}
    ${'hello'}                | ${99162322} 
    ${'world'}                | ${113285276} 
    ${new Date('2022-01-01')} | ${1640995200000} 
    ${/^hello$/i}             | ${65154666} 
    ${() => {}}               | ${-1830454922} 
    ${[1, 2, 3]}              | ${579757003} 
    ${new Map([[1, 'one'], [2, 'two']])} | ${-577285097} 
    ${new Set([1, 2, 3])}     | ${8} 
    ${{}}                     | ${0} 
    ${{ a: 1, b: 2 }}         | ${-1798626175} 
  `('returns $expected for $value', ({ value, expected }) => {
    expect(getHashCode(value)).toEqual(expected);
  });

  it('handles circular references', () => {
    const obj: any = {};
    obj.objRef = obj;
    expect(getHashCode(obj)).toEqual(0);
  });
});
