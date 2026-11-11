export class Node<K, V> {
  key: K;
  value: V;
  hash: number;
  /** Next node in the same bucket chain. */
  next: Node<K, V> | undefined;
  /** Previous node in insertion order. */
  before: Node<K, V> | undefined;
  /** Next node in insertion order. */
  after: Node<K, V> | undefined;
  /**
   * True once the node has been removed from the map. A removed node keeps its
   * `before` pointer so a live iterator positioned on it can find its way back
   * into the live insertion-order list.
   */
  deleted: boolean;

  constructor(key: K, value: V, hash: number, next?: Node<K, V>) {
    this.key = key;
    this.value = value;
    this.hash = hash;
    this.next = next;
    this.before = undefined;
    this.after = undefined;
    this.deleted = false;
  }
}
