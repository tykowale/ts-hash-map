import { HashMap } from './hash-map';

describe('HashMap', () => {
  describe('with primitive keys', () => {
    let hashMap: HashMap<number, string>;

    beforeEach(() => {
      hashMap = new HashMap<number, string>();
    });

    describe('primitive keys', () => {
      it('gets and sets values correctly', () => {
        hashMap.set(1, 'value1');
        hashMap.set(2, 'value2');

        expect(hashMap.get(1)).toEqual('value1');
        expect(hashMap.get(2)).toEqual('value2');
      });

      it('updates value if key already exists', () => {
        hashMap.set(1, 'value1');
        hashMap.set(1, 'updatedValue');

        expect(hashMap.get(1)).toEqual('updatedValue');
      });

      it('returns undefined for non-existing keys', () => {
        expect(hashMap.get(1)).toBeUndefined();
      });

      it('returns true when a key exists', () => {
        hashMap.set(1, 'value1');

        expect(hashMap.has(1)).toBeTruthy();
      });

      it('returns false when a key does not exist', () => {
        expect(hashMap.has(1)).toBeFalsy();
      });
    });
  });


  describe('object keys', () => {
    let hashMap: HashMap<object, string>;

    beforeEach(() => {
      hashMap = new HashMap<object, string>();
    });

    it('sets and get values correctly for object keys', () => {
      const key1 = { id: 1 };
      const key2 = { id: 2 };

      hashMap.set(key1, 'value1');
      hashMap.set(key2, 'value2');

      expect(hashMap.get(key1)).toEqual('value1');
      expect(hashMap.get(key2)).toEqual('value2');
    });

    it('updates value if key already exists for object keys', () => {
      const key = { id: 1 };

      hashMap.set(key, 'value1');
      hashMap.set(key, 'updatedValue');

      expect(hashMap.get(key)).toEqual('updatedValue');
    });

    it('returns undefined for non-existing keys for object keys', () => {
      const nonExistingKey = { id: 1 };
      expect(hashMap.get(nonExistingKey)).toBeUndefined();
    });

    it('returns true when a key exists', () => {
      const key = { id: 1 };

      hashMap.set(key, 'value1');

      expect(hashMap.has(key)).toBeTruthy();
    });

    it('returns false when a key does not exist', () => {
      const key = { id: 1 };

      expect(hashMap.has(key)).toBeFalsy();
    });
  });
});
