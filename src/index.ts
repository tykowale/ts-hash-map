export class HashMap<K, V> implements Map<K, V> {
  readonly [Symbol.toStringTag]: string;
  size: number;

  /**
   * The default initial capacity - MUST be a power of two.
   */
  private DEFAULT_INITIAL_CAPACITY: number = 16

  constructor() {
  }

  clear(): void {
    throw new Error('Not Implemented');
  }

  delete(key: K): boolean {
    throw new Error('Not Implemented');
  }

  get(key: K): V | undefined {
    throw new Error('Not Implemented');
  }

  has(key: K): boolean {
    throw new Error('Not Implemented');
  }

  set(key: K, value: V): this {
    throw new Error('Not Implemented');
  }

  forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: any): void {
  }

  values(): IterableIterator<V> {
    throw new Error('Not Implemented');
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    throw new Error('Not Implemented');
  }

  entries(): IterableIterator<[K, V]> {
    throw new Error('Not Implemented');
  }

  keys(): IterableIterator<K> {
    throw new Error('Not Implemented');
  }
}
