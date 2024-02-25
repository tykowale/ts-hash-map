import { Node } from './basic-node';
import { getHashCode } from './hash';
import { isEqual } from './is-equal';
import { HashMapIterable } from './hash-map-iterable';
import { HashMapKeysIterable } from './hash-map-keys-iterable';
import { HashMapValuesIterable } from './hash-map-values-iterable';

/**
 * Advanced options for constructing your hashmap.
 */
export type HashMapOptions = {
  /**
   * The initial capacity of the hashmap.
   * Must always be a factor of 2.
   * If not provided, the default initial capacity (16) is used.
   */
  capacity?: number,
  /**
   * The load factor of the hashmap.
   * Determines when the hashmap should resize based on its size relative to its capacity.
   * If not provided, the default load factor (0.75) is used.
   */
  loadFactor?: number;
};

export class HashMap<K, V> implements Map<K, V> {
  readonly [Symbol.toStringTag]: string;
  size: number;

  private DEFAULT_INITIAL_CAPACITY = 16;
  private DEFAULT_LOAD_FACTOR = 0.75;

  private capacity: number;
  private loadFactor: number;
  private table: Array<Node<K, V> | undefined>;

  /**
   * Constructs a hashmap with no elements and the default options
   */
  constructor();
  /**
   * Constructs a hashmap with the provided elements and the default options
   */
  constructor(initialValues: Array<[K, V]>);
  /**
   * Constructs a hashmap with no elements and the provided options
   */
  constructor(options: HashMapOptions);
  /**
   * Constructs a hashmap with provided elements and the provided options
   */
  constructor(initialValues: Array<[K, V]>, options: HashMapOptions);
  constructor(
    initialValuesOrOptions?: Array<[K, V]> | HashMapOptions,
    options?: HashMapOptions,
  ) {
    let initVals: Array<[K, V]> | undefined;
    const opts: Partial<HashMapOptions> = {};

    if (Array.isArray(initialValuesOrOptions)) {
      initVals = initialValuesOrOptions;
      Object.assign(opts, options);
    } else if (typeof initialValuesOrOptions === 'object') {
      Object.assign(opts, initialValuesOrOptions);
    }

    if (opts.capacity != null) {
      // round up to the nearest power of 2 if they pass in something else
      opts.capacity = Math.pow(2, Math.ceil(Math.log2(opts.capacity)));
    }

    this.capacity = opts.capacity ?? this.DEFAULT_INITIAL_CAPACITY;
    this.loadFactor = opts.loadFactor ?? this.DEFAULT_LOAD_FACTOR;
    this.size = 0;
    this.table = new Array(this.capacity);

    if (initVals !== undefined) {
      for (const [key, value] of initVals) {
        this.set(key, value);
      }
    }
  }

  get(key: K): V | undefined {
    const node = this.getNode(key);

    if (node == null) {
      return undefined;
    }

    return node.value;
  }

  has(key: K): boolean {
    const node = this.getNode(key);

    return node != null;
  }

  set(key: K, value: V): this {
    const hash = getHashCode(key);
    const index = hash & (this.capacity - 1);
    let node: Node<K, V> | undefined = this.table[index];

    // if the key is already in the map we need to update it
    while (node != null) {
      if (isEqual(node.key, key)) {
        node.value = value;
        return this;
      }

      node = node.next;
    }

    this.table[index] = new Node<K, V>(key, value, hash, this.table[index]);
    this.size++;

    if (this.size > (this.capacity * this.loadFactor)) {
      this.resize();
    }

    return this;
  }

  clear(): void {
    this.table = new Array(this.capacity);
    this.size = 0;
  }

  delete(key: K): boolean {
    const index = this.hash(key);
    let currNode: Node<K, V> | undefined = this.table[index];
    let prevNode: Node<K, V> | undefined = undefined;

    while (currNode != null) {
      if (isEqual(currNode.key, key)) {
        if (prevNode == null) {
          this.table[index] = currNode.next;
        } else {
          prevNode.next = currNode.next;
        }
        this.size--;
        return true;
      }

      prevNode = currNode;
      currNode = currNode.next;
    }

    return false;
  }


  forEach(callBackFn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: any): void {
    for (const [key, value] of this) {
      callBackFn.call(thisArg, value, key, this);
    }
  }

  values(): IterableIterator<V> {
    return new HashMapValuesIterable(this.table, this.capacity);
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return new HashMapIterable(this.table, this.capacity);
  }

  entries(): IterableIterator<[K, V]> {
    return new HashMapIterable(this.table, this.capacity);
  }

  keys(): IterableIterator<K> {
    return new HashMapKeysIterable(this.table, this.capacity);
  }

  private hash(key: K): number {
    return getHashCode(key) & (this.capacity - 1);
  }

  private getNode(key: K): Node<K, V> | undefined {
    const index = this.hash(key);
    let node: Node<K, V> | undefined = this.table[index];

    while (node != null) {
      if (isEqual(key, node.key)) {
        return node;
      }

      node = node.next;
    }

    return undefined;
  }

  private resize() {
    const oldCapacity = this.capacity;
    this.capacity *= 2;

    const newTable = new Array<Node<K, V> | undefined>(this.capacity);

    for (let i = 0; i < oldCapacity; i++) {
      let curr = this.table[i];

      while (curr != null) {
        const next = curr.next;
        // cool little trick because capacity is a power of 2 we can treat capacity as a mask
        // ie capacity = 16. Since we do minus one this makes sure everything is between
        // [0, this.capacity - 1] so it's good for the hashmap
        const newIndex = curr.hash & (this.capacity - 1);

        curr.next = newTable[newIndex];
        newTable[newIndex] = curr;

        curr = next;
      }
    }

    this.table = newTable;
  }
}
