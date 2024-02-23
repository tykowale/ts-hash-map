import { Node } from './basic-node';

export class HashMapKeysIterable<K> implements Iterator<K> {
  private index: number;
  private node: Node<K, unknown> | undefined;

  constructor(
    private readonly table: Array<Node<K, unknown> | undefined>,
    private readonly capacity: number,
  ) {
    this.index = 0;
    this.node = undefined;
  }

  next(): IteratorResult<K> {
    while (this.index < this.capacity) {
      if (this.node == null) {
        this.node = this.table[this.index];
      } else {
        this.node = this.node.next;
      }

      if (this.node != null) {
        return {
          value: this.node.key,
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
