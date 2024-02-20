import { isEqual } from './is-equal';

describe('isEqual', () => {
  describe('primitives', () => {
    it('returns true for equal primitives', () => {
      expect(isEqual(5, 5)).toEqual(true);
      expect(isEqual('hello', 'hello')).toEqual(true);
      expect(isEqual(true, true)).toEqual(true);
    });

    it('returns false for different primitives', () => {
      expect(isEqual(5, 10)).toEqual(false);
      expect(isEqual('hello', 'world')).toEqual(false);
      expect(isEqual(true, false)).toEqual(false);
    });
  });

  it('returns true for equal arrays', () => {
    expect(isEqual([1, 2, 3], [1, 2, 3])).toEqual(true);
    expect(isEqual(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual(true);
  });

  it('returns false for different arrays', () => {
    expect(isEqual([1, 2, 3], [1, 2, 4])).toEqual(false);
    expect(isEqual(['a', 'b', 'c'], ['a', 'b'])).toEqual(false);
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
