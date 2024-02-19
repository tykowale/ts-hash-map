export class Node<K, V> {
  hash: number;
  key: K;
  value: V;
  next: Node<K, V>;

  constructor(hash: number, key: K, value: V, next: Node<K, V>) {
    this.hash = hash;
    this.key = key;
    this.value = value;
    this.next = next;
  }

  hashCode(): number {
    return -1;
  }
}
