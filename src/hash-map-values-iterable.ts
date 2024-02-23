import { Node } from './basic-node';

export class HashMapValuesIterable<V> implements Iterator<V> {
  private index: number;
  private node: Node<unknown, V> | undefined;

  constructor(
    private readonly table: Array<Node<unknown, V> | undefined>,
    private readonly capacity: number,
  ) {
    this.index = 0;
    this.node = undefined;
  }

  next(): IteratorResult<V> {
    while (this.index < this.capacity) {
      if (this.node == null) {
        this.node = this.table[this.index];
      } else {
        this.node = this.node.next;
      }

      if (this.node != null) {
        return {
          value: this.node.value,
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
