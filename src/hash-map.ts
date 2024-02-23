import { Node } from './basic-node';
import { getHashCode } from './hash';
import { isEqual } from './is-equal';
import { HashMapIterable } from './hash-map-iterable';
import { HashMapKeysIterable } from 'src/hash-map-keys-iterable';
import { HashMapValuesIterable } from 'src/hash-map-values-iterable';

export class HashMap<K, V> implements Map<K, V> {
  readonly [Symbol.toStringTag]: string;
  size: number;

  private DEFAULT_INITIAL_CAPACITY = 16;

  private readonly capacity: number;
  private table: Array<Node<K, V> | undefined>;

  constructor() {
    this.capacity = this.DEFAULT_INITIAL_CAPACITY;
    this.size = 0;

    // later we'll need to do an Object.seal on this
    // but for now allow it to be any sized
    this.table = new Array(this.capacity);
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
