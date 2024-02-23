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

      it('deletes existing key and return true', () => {
        hashMap.set(1, 'value1');
        expect(hashMap.delete(1)).toEqual(true);
        expect(hashMap.has(1)).toEqual(false);
      });

      it('returns false if key does not exist', () => {
        expect(hashMap.delete(1)).toEqual(false);
      });

      it('decreases size when deleting existing key', () => {
        hashMap.set(1, 'value1');
        hashMap.set(2, 'value2');
        hashMap.delete(1);

        expect(hashMap.size).toEqual(1);
      });

      it('does not decrease size when key does not exist', () => {
        hashMap.set(1, 'value1');
        hashMap.delete(2);

        expect(hashMap.size).toEqual(1);
      });

      it('clears the map of all elements', () => {
        hashMap.set(1, 'value1');
        hashMap.set(2, 'value1');

        expect(hashMap.size).toEqual(2);
        expect(hashMap.has(1)).toBeTruthy();
        hashMap.clear();
        expect(hashMap.size).toEqual(0);
        expect(hashMap.has(1)).toBeFalsy();
      });

      it('iterates over all entries in the hashmap', () => {
        hashMap.set(1, 'one');
        hashMap.set(2, 'two');
        hashMap.set(3, 'three');

        const res = [];

        for (const e of hashMap) {
          res.push(e);
        }

        expect(res).toEqual([[1, 'one'], [2, 'two'], [3, 'three']]);

        const iterator = hashMap[Symbol.iterator]();
        const res2 = Array.from(iterator);

        expect(res2).toEqual([[1, 'one'], [2, 'two'], [3, 'three']]);
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

    it('deletes existing key and return true', () => {
      const key = { id: 1 };
      hashMap.set(key, 'value1');
      expect(hashMap.delete(key)).toEqual(true);
      expect(hashMap.has(key)).toEqual(false);
    });

    it('returns false if key does not exist', () => {
      const key = { id: 1 };
      expect(hashMap.delete(key)).toEqual(false);
    });

    it('decreases size when deleting existing key', () => {
      const key1 = { id: 1 };
      const key2 = { id: 2 };
      hashMap.set(key1, 'value1');
      hashMap.set(key2, 'value2');
      hashMap.delete(key1);

      expect(hashMap.size).toEqual(1);
    });

    it('does not decrease size when key does not exist', () => {
      const key1 = { id: 1 };
      const key2 = { id: 2 };
      hashMap.set(key1, 'value1');
      hashMap.delete(key2);

      expect(hashMap.size).toEqual(1);
    });

    it('clears the map of all elements', () => {
      hashMap.set({ id: 1 }, 'value1');
      hashMap.set({ id: 2 }, 'value1');

      expect(hashMap.size).toEqual(2);
      expect(hashMap.has({ id: 1 })).toBeTruthy();
      hashMap.clear();
      expect(hashMap.size).toEqual(0);
      expect(hashMap.has({ id: 1 })).toBeFalsy();
    });

    it('iterates over all entries in the hashmap', () => {
      const key1 = { id: 1 };
      const key2 = { id: 2 };
      hashMap.set(key1, 'value1');
      hashMap.set(key2, 'value2');

      const res = [];

      for (const e of hashMap) {
        res.push(e);
      }

      expect(res.sort()).toEqual([[key1, 'value1'], [key2, 'value2']].sort());

      const iterator = hashMap[Symbol.iterator]();
      const res2 = Array.from(iterator);

      expect(res2.sort()).toEqual([[key1, 'value1'], [key2, 'value2']].sort());
    });
  });
});
