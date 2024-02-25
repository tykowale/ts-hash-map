export class Node<K, V> {
  key: K;
  value: V;
  hash: number;
  next?: Node<K, V>;

  constructor(key: K, value: V, hash: number, next?: Node<K, V>) {
    this.key = key;
    this.value = value;
    this.hash = hash;
    this.next = next;
  }
}
