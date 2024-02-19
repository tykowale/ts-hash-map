import { Hash } from './Hash';

describe('Hash', () => {
  it('hashes strings correctly', () => {
    expect(Hash('test')).toEqual(Hash('test'));
    expect(Hash('hello')).not.toEqual(Hash('world'));
  });

  it('hashes numbers correctly', () => {
    expect(Hash(123)).toEqual(Hash(123));
    expect(Hash(123)).not.toEqual(Hash(456));
  });

  it('hashes objects correctly', () => {
    const obj1 = { a: 1, b: 'test', c: true };
    const obj2 = { b: 'test', c: true, a: 1 };

    expect(Hash(obj1)).toEqual(Hash(obj2));
    expect(Hash({})).toEqual(0);
  });

  it('handles cyclic objects', () => {
    const obj: any = { a: 1 };
    obj.objRef = obj;

    const hashedValue = Hash(obj);

    expect(hashedValue).toEqual(-1023386516);
  });

  it('handles nested objects correctly', () => {
    const obj1 = { a: { b: 1 }, c: { d: 'test' } };
    const obj2 = { c: { d: 'test' }, a: { b: 1 } };

    expect(Hash(obj1)).toEqual(Hash(obj2));
  });
});
