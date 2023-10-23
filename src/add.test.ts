import { add } from 'src/index';

describe('add', () => {
  it('adds numbers properly', () => {
    const result = add(2, 3);
    expect(result).toBe(5);
  });
});
