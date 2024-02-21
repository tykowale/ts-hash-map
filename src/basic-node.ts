export class Node<K, V> {
  key: K;
  value: V;
  next?: Node<K, V>;

  constructor(key: K, value: V, next?: Node<K, V>) {
    this.key = key;
    this.value = value;
    this.next = next;
  }
}
