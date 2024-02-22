import { Node } from 'src/basic-node';
import { getHashCode } from 'src/hash';
import { isEqual } from 'src/is-equal';

export class HashMap<K, V> implements Map<K, V> {
  readonly [Symbol.toStringTag]: string;
  size: number;

  private DEFAULT_INITIAL_CAPACITY = 16;

  private readonly capacity: number;
  private table: Array<Node<K, V>>;

  constructor() {
    this.capacity = this.DEFAULT_INITIAL_CAPACITY;

    // later we'll need to do an Object.seal on this
    // but for now allow it to be any sized
    this.table = new Array(this.capacity);
  }

  clear(): void {
    throw new Error('Not Implemented');
  }

  delete(key: K): boolean {
    throw new Error('Not Implemented');
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
    const index = this.hash(key);
    let node: Node<K, V> | undefined = this.table[index];

    // if the key is already in the map we need to update it
    while (node != null) {
      if (isEqual(node.key, key)) {
        node.value = value;
        return this;
      }

      node = node.next;
    }

    const newNode = new Node<K, V>(key, value);
    newNode.next = this.table[index];
    this.table[index] = newNode;
    this.size++;

    // come back later to do resizing

    return this;
  }

  forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: any): void {
    throw new Error('Not Implemented');
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

  private hash(key: K): number {
    return getHashCode(key) % this.capacity;
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
}
