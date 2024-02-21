import { getHashCode } from 'src/hash';

describe('getHashCode tests', () => {
it.each`
    value                     | expected
  ${null}                   | ${0}
  ${undefined}              | ${0}
  ${42}                     | ${42}
  ${3.14}                   | ${3.14}
  ${true}                   | ${1231}
  ${false}                  | ${1237}
  ${'hello'}                | ${99162322}
  ${'world'}                | ${113318802}
  ${new Date('2022-01-01')} | ${1640995200000}
  ${/^hello$/i}             | ${459043387}
  ${() => {}}               | ${-702898920}
  ${[1, 2, 3]}              | ${1026}
  ${new Map([[1, 'one'], [2, 'two']])} | ${6512020}
  ${new Set([1, 2, 3])}     | ${6}
  ${{}}                     | ${0}
  ${{ a: 1, b: 2 }}         | ${9376} 
  `('returns $expected for $value', ({ value, expected }) => {
    expect(getHashCode(value)).toEqual(expected);
  });

  it('handles circular references', () => {
    const obj: any = {};
    obj.objRef = obj;
    expect(getHashCode(obj)).toEqual(-1023386596);
  });
});
