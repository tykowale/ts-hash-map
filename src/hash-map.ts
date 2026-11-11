import { Node } from './basic-node';
import { getHashCode } from './hash';
import { isEqual } from './is-equal';
import {
  HashMapIterable,
  ITERATE_ENTRIES,
  ITERATE_KEYS,
  ITERATE_VALUES,
  IterationKind,
  OrderedNodeSource,
  nextLiveNode,
} from './hash-map-iterable';

/**
 * Advanced options for constructing your hashmap.
 */
export type HashMapOptions = {
  /**
   * The initial capacity of the hashmap.
   * Rounded up to the nearest power of 2. Values below 1 (or non-finite values) fall back to 1.
   * If not provided, the default initial capacity (16) is used.
   */
  capacity?: number,

  /**
   * The load factor of the hashmap.
   * Determines when the hashmap should resize based on its size relative to its capacity.
   * If not provided (or not a positive finite number), the default load factor (0.75) is used.
   */
  loadFactor?: number;

  /**
   * Allows for overriding the default hash function, useful if objects already have
   * a natural hash or if other libraries have better performance
   */
  hashFn?: (value: unknown) => number;

  /**
   * Allows for overriding the default equals function, useful if objects already have
   * a quick equality check or if other libraries have better performance
   */
  equalsFn?: (a: unknown, b: unknown) => boolean;
};

const DEFAULT_INITIAL_CAPACITY = 16;
const DEFAULT_LOAD_FACTOR = 0.75;
const MAXIMUM_CAPACITY = 1 << 30;

function normaliseCapacity(capacity: number | undefined): number {
  if (capacity == null) {
    return DEFAULT_INITIAL_CAPACITY;
  }

  const c = Number(capacity);

  if (!(c >= 1)) {
    // 0, negatives and NaN would otherwise produce an unusable table
    return 1;
  }

  if (c >= MAXIMUM_CAPACITY) {
    return MAXIMUM_CAPACITY;
  }

  // round up to the nearest power of 2 if they pass in something else
  return Math.pow(2, Math.ceil(Math.log2(c)));
}

function normaliseLoadFactor(loadFactor: number | undefined): number {
  if (loadFactor == null) {
    return DEFAULT_LOAD_FACTOR;
  }

  const lf = Number(loadFactor);

  return lf > 0 && lf !== Infinity ? lf : DEFAULT_LOAD_FACTOR;
}

/**
 * A hash map keyed by value (via `hashFn` / `equalsFn`) that otherwise behaves like
 * the native `Map`: iteration follows insertion order and is live, so entries added
 * during iteration are visited, entries removed before being reached are skipped,
 * and `clear()` or a resize never invalidates an iterator.
 *
 * Internally every node lives in two structures: a bucket chain (`next`) used for
 * lookups, and a doubly linked insertion-order list (`before` / `after`) used for
 * iteration. Resizing only rebuilds the bucket chains.
 */
export class HashMap<K, V> implements Map<K, V> {
  private readonly DEFAULT_INITIAL_CAPACITY = DEFAULT_INITIAL_CAPACITY;
  private readonly DEFAULT_LOAD_FACTOR = DEFAULT_LOAD_FACTOR;

  private capacity: number;
  private loadFactor: number;
  private hashFn: (value: unknown) => number;
  private isEqual: (a: unknown, b: unknown) => boolean;
  private table: Array<Node<K, V> | undefined>;
  private count: number;
  /** Oldest live node in insertion order. */
  private head: Node<K, V> | undefined;
  /** Newest live node in insertion order. */
  private tail: Node<K, V> | undefined;

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
    let opts: HashMapOptions | undefined;

    if (Array.isArray(initialValuesOrOptions)) {
      initVals = initialValuesOrOptions;
      opts = options;
    } else if (initialValuesOrOptions != null && typeof initialValuesOrOptions === 'object') {
      opts = initialValuesOrOptions;
    }

    this.capacity = normaliseCapacity(opts?.capacity);
    this.loadFactor = normaliseLoadFactor(opts?.loadFactor);
    this.hashFn = opts?.hashFn ?? getHashCode;
    this.isEqual = opts?.equalsFn ?? isEqual;
    this.count = 0;
    this.head = undefined;
    this.tail = undefined;
    this.table = new Array(this.capacity);

    if (initVals != null) {
      for (const [key, value] of initVals) {
        this.set(key, value);
      }
    }
  }

  /**
   * The number of entries in the map. Read-only, like `Map.prototype.size`.
   */
  get size(): number {
    return this.count;
  }

  get [Symbol.toStringTag](): string {
    return 'HashMap';
  }

  get(key: K): V | undefined {
    const node = this.getNode(key);

    if (node === undefined) {
      return node;
    }

    return node.value;
  }

  getOrDefault(key: K, defaultValue: V) {
    const node = this.getNode(key);

    if (node === undefined) {
      return defaultValue;
    }

    return node.value;
  }

  getOrThrow(key: K) {
    const node = this.getNode(key);

    if (node === undefined) {
      throw new Error('Element not found');
    }

    return node.value;
  }

  has(key: K): boolean {
    return this.getNode(key) !== undefined;
  }

  set(key: K, value: V): this {
    const hash = this.hash(key);
    const index = hash & (this.capacity - 1);
    const bucket = this.table[index];
    let node: Node<K, V> | undefined = bucket;

    // if the key is already in the map we need to update it
    while (node !== undefined) {
      if (node.hash === hash && this.isEqual(node.key, key)) {
        node.value = value;
        return this;
      }

      node = node.next;
    }

    // like native Map, a -0 key is stored as +0
    if ((key as unknown) === 0) {
      key = 0 as unknown as K;
    }

    const created = new Node<K, V>(key, value, hash, bucket);
    this.table[index] = created;

    // append to the insertion-order list
    const tail = this.tail;
    created.before = tail;
    if (tail === undefined) {
      this.head = created;
    } else {
      tail.after = created;
    }
    this.tail = created;

    this.count++;

    if (this.count > (this.capacity * this.loadFactor)) {
      this.resize();
    }

    return this;
  }

  clear(): void {
    // Mark every node as removed so live iterators skip them. Dropping `before`
    // lets such an iterator jump straight back to the (now empty) head.
    let node = this.head;

    while (node !== undefined) {
      const after: Node<K, V> | undefined = node.after;
      node.deleted = true;
      node.before = undefined;
      node.after = undefined;
      node.next = undefined;
      node = after;
    }

    this.table = new Array(this.capacity);
    this.count = 0;
    this.head = undefined;
    this.tail = undefined;
  }

  delete(key: K): boolean {
    const hash = this.hash(key);
    const index = hash & (this.capacity - 1);
    let currNode: Node<K, V> | undefined = this.table[index];
    let prevNode: Node<K, V> | undefined = undefined;

    while (currNode !== undefined) {
      if (currNode.hash === hash && this.isEqual(currNode.key, key)) {
        if (prevNode === undefined) {
          this.table[index] = currNode.next;
        } else {
          prevNode.next = currNode.next;
        }

        this.unlink(currNode);
        this.count--;
        return true;
      }

      prevNode = currNode;
      currNode = currNode.next;
    }

    return false;
  }

  forEach(callBackFn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: any): void {
    const source = this.asSource();
    let node = nextLiveNode(source, undefined);

    while (node !== undefined) {
      callBackFn.call(thisArg, node.value, node.key, this);
      node = nextLiveNode(source, node);
    }
  }

  values(): IterableIterator<V> {
    return this.iterator<V>(ITERATE_VALUES);
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.iterator<[K, V]>(ITERATE_ENTRIES);
  }

  entries(): IterableIterator<[K, V]> {
    return this.iterator<[K, V]>(ITERATE_ENTRIES);
  }

  keys(): IterableIterator<K> {
    return this.iterator<K>(ITERATE_KEYS);
  }

  private iterator<T>(kind: IterationKind): IterableIterator<T> {
    return new HashMapIterable<K, V, T>(this.asSource(), kind);
  }

  private asSource(): OrderedNodeSource<K, V> {
    return this as unknown as OrderedNodeSource<K, V>;
  }

  /**
   * Removes a node from the insertion-order list. The node keeps its own
   * `before` / `after` pointers so an iterator currently on it can continue.
   */
  private unlink(node: Node<K, V>): void {
    const before = node.before;
    const after = node.after;

    if (before === undefined) {
      this.head = after;
    } else {
      before.after = after;
    }

    if (after === undefined) {
      this.tail = before;
    } else {
      after.before = before;
    }

    node.deleted = true;
    node.next = undefined;
  }

  /**
   * Normalises the user hash to a 32-bit integer so that NaN, floats and
   * out-of-range values still compare equal to themselves and index the table.
   */
  private hash(key: K): number {
    return this.hashFn(key) | 0;
  }

  private getNode(key: K): Node<K, V> | undefined {
    const hash = this.hash(key);
    let node: Node<K, V> | undefined = this.table[hash & (this.capacity - 1)];

    while (node !== undefined) {
      if (node.hash === hash && this.isEqual(key, node.key)) {
        return node;
      }

      node = node.next;
    }

    return undefined;
  }

  private resize() {
    if (this.capacity >= MAXIMUM_CAPACITY) {
      return;
    }

    this.capacity *= 2;

    // Rebuild the bucket chains from the insertion-order list. Iterators walk that
    // list rather than the table, so they are unaffected.
    const mask = this.capacity - 1;
    const newTable = new Array<Node<K, V> | undefined>(this.capacity);
    let node = this.head;

    while (node !== undefined) {
      const index = node.hash & mask;
      node.next = newTable[index];
      newTable[index] = node;
      node = node.after;
    }

    this.table = newTable;
  }
}
