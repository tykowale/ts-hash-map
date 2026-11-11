import { Node } from './basic-node';

/**
 * The minimal view of a map that an iterator needs: the head of its
 * insertion-ordered list. Iterators read it lazily so they always observe the
 * map's current state (inserts, deletes, clear and resize).
 */
export interface OrderedNodeSource<K, V> {
  readonly head: Node<K, V> | undefined;
}

export const ITERATE_ENTRIES = 0;
export const ITERATE_KEYS = 1;
export const ITERATE_VALUES = 2;
export type IterationKind = typeof ITERATE_ENTRIES | typeof ITERATE_KEYS | typeof ITERATE_VALUES;

/**
 * Given the last visited node (or undefined when nothing has been visited yet),
 * returns the next live node in insertion order, following native Map semantics:
 * entries added later are visited, entries removed before being reached are
 * skipped, and removing the current entry is safe.
 */
export function nextLiveNode<K, V>(
  source: OrderedNodeSource<K, V>,
  current: Node<K, V> | undefined,
): Node<K, V> | undefined {
  // Walk back from a removed node to the nearest node still in the map. Every
  // live node after it was inserted after `current`, so it has not been visited.
  while (current !== undefined && current.deleted) {
    current = current.before;
  }

  return current === undefined ? source.head : current.after;
}

export class HashMapIterable<K, V, T> implements IterableIterator<T> {
  private current: Node<K, V> | undefined = undefined;
  private source: OrderedNodeSource<K, V> | undefined;

  constructor(
    source: OrderedNodeSource<K, V>,
    private readonly kind: IterationKind,
  ) {
    this.source = source;
  }

  next(): IteratorResult<T> {
    const source = this.source;

    if (source === undefined) {
      return { value: undefined, done: true };
    }

    const node = nextLiveNode(source, this.current);

    if (node === undefined) {
      // exhausted iterators stay exhausted, like native Map iterators
      this.source = undefined;
      this.current = undefined;
      return { value: undefined, done: true };
    }

    this.current = node;

    switch (this.kind) {
      case ITERATE_KEYS:
        return { value: node.key as unknown as T, done: false };
      case ITERATE_VALUES:
        return { value: node.value as unknown as T, done: false };
      default:
        return { value: [node.key, node.value] as unknown as T, done: false };
    }
  }

  [Symbol.iterator](): IterableIterator<T> {
    return this;
  }
}
