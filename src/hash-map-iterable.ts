import { Node } from './basic-node';

export class HashMapIterable<K, V> implements Iterator<[K, V]> {
  private index: number;
  private node: Node<K, V> | undefined;

  constructor(
    private readonly table: Array<Node<K, V> | undefined>,
    private readonly capacity: number,
  ) {
    this.index = 0;
    this.node = undefined;
  }

  next(): IteratorResult<[K, V]> {
    while (this.index < this.capacity) {
      if (this.node == null) {
        this.node = this.table[this.index];
      } else {
        this.node = this.node.next;
      }

      if (this.node != null) {
        return {
          value: [this.node.key, this.node.value],
          done: false,
        };
      }

      this.index++;
    }

    return { value: undefined, done: true };
  }

  [Symbol.iterator]() {
    return this;
  }
}
