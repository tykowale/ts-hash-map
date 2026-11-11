import { HashMap } from './hash-map';

/**
 * Iteration-focused tests for HashMap: keys()/values()/entries()/[Symbol.iterator],
 * the iterator protocol, forEach, interop with native consumers, and behavior under
 * mutation during iteration (compared against native Map semantics).
 *
 * Note: numbers hash to themselves, so with the default capacity (16) integer key k
 * lives in bucket k & 15. Several mutation tests rely on that to control bucket layout.
 */

// Deterministic PRNG (mulberry32)
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const constantHash = () => 42;

function range(n: number, start = 0): number[] {
  return Array.from({ length: n }, (_, i) => i + start);
}

function build(keys: number[], opts = {}): HashMap<number, string> {
  const m = new HashMap<number, string>(opts);
  for (const k of keys) m.set(k, `v${k}`);
  return m;
}

const byKey = (a: [unknown, unknown], b: [unknown, unknown]) =>
  String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0;

function sortedNums(xs: Iterable<number>): number[] {
  return Array.from(xs).sort((a, b) => a - b);
}

type IterKind = 'keys' | 'values' | 'entries' | 'iterator';
const iterKinds: IterKind[] = ['keys', 'values', 'entries', 'iterator'];

function getIter<K, V>(m: HashMap<K, V>, kind: IterKind): IterableIterator<unknown> {
  switch (kind) {
    case 'keys': return m.keys();
    case 'values': return m.values();
    case 'entries': return m.entries();
    case 'iterator': return m[Symbol.iterator]();
  }
}

describe('HashMap iteration', () => {
  describe('empty / single / many', () => {
    it.each(iterKinds)('%s() on an empty map yields nothing and is immediately done', (kind) => {
      const m = new HashMap<number, string>();
      const it = getIter(m, kind);
      expect(it.next()).toEqual({ value: undefined, done: true });
      expect([...getIter(m, kind)]).toEqual([]);
    });

    it.each([
      ['keys', ['k']],
      ['values', ['v']],
      ['entries', [['k', 'v']]],
      ['iterator', [['k', 'v']]],
    ] as Array<[IterKind, unknown[]]>)('%s() on a single-entry map', (kind, expected) => {
      const m = new HashMap<string, string>([['k', 'v']]);
      const it = getIter(m, kind);
      const first = it.next();
      expect(first.done).toBe(false);
      expect([first.value]).toEqual(expected);
      expect(it.next().done).toBe(true);
    });

    it.each([2, 13, 100, 1000, 5000])('iterates all %i entries exactly once', (n) => {
      const m = build(range(n));
      const keys = [...m.keys()];
      expect(keys).toHaveLength(n);
      expect(new Set(keys).size).toBe(n);
      expect(sortedNums(keys)).toEqual(range(n));
      expect([...m.values()].sort()).toEqual(range(n).map((k) => `v${k}`).sort());
      expect([...m.entries()]).toHaveLength(n);
    });

    it('iteration count equals size for every kind', () => {
      const m = build(range(77));
      for (const kind of iterKinds) {
        expect([...getIter(m, kind)]).toHaveLength(m.size);
      }
    });
  });

  describe('after structural changes', () => {
    it('reflects all entries after multiple resizes', () => {
      const m = build(range(200), { capacity: 2 });
      expect((m as any).capacity).toBeGreaterThanOrEqual(256);
      expect(sortedNums(m.keys())).toEqual(range(200));
    });

    it('does not yield deleted entries (no ghosts)', () => {
      const m = build(range(100));
      for (let k = 0; k < 100; k += 2) m.delete(k);
      const keys = sortedNums(m.keys());
      expect(keys).toEqual(range(100).filter((k) => k % 2 === 1));
      expect([...m.values()]).toHaveLength(50);
      expect([...m.entries()].every(([k]) => k % 2 === 1)).toBe(true);
    });

    it('does not yield ghosts after deleting heads, middles and tails of collision chains', () => {
      const m = build(range(10), { hashFn: constantHash });
      [0, 4, 9].forEach((k) => m.delete(k));
      expect(sortedNums(m.keys())).toEqual([1, 2, 3, 5, 6, 7, 8]);
    });

    it('yields nothing after clear', () => {
      const m = build(range(50));
      m.clear();
      for (const kind of iterKinds) expect([...getIter(m, kind)]).toEqual([]);
    });

    it('yields only new entries after clear and re-adding', () => {
      const m = build(range(50));
      m.clear();
      m.set(1000, 'x').set(2000, 'y');
      expect([...m.entries()].sort(byKey)).toEqual([[1000, 'x'], [2000, 'y']]);
    });

    it('reflects overwritten values without duplicating keys', () => {
      const m = build(range(20));
      m.set(5, 'five').set(5, 'FIVE');
      const entries = [...m.entries()];
      expect(entries).toHaveLength(20);
      expect(entries.filter(([k]) => k === 5)).toEqual([[5, 'FIVE']]);
    });

    it('deleting everything then iterating yields nothing', () => {
      const m = build(range(40));
      range(40).forEach((k) => m.delete(k));
      expect([...m]).toEqual([]);
    });
  });

  describe('consistency between iterators', () => {
    const m = build(mulberrySample(300));

    function mulberrySample(n: number): number[] {
      const rnd = mulberry32(1234);
      const s = new Set<number>();
      while (s.size < n) s.add(Math.floor(rnd() * 1e6));
      return [...s];
    }

    it('entries() and [Symbol.iterator]() yield the same sequence', () => {
      expect([...m.entries()]).toEqual([...m[Symbol.iterator]()]);
    });

    it('zip(keys, values) equals entries in the same order', () => {
      const keys = [...m.keys()];
      const values = [...m.values()];
      const zipped = keys.map((k, i) => [k, values[i]]);
      expect(zipped).toEqual([...m.entries()]);
    });

    it('each yielded entry is consistent with get()', () => {
      for (const [k, v] of m) expect(m.get(k)).toBe(v);
    });

    it('entries yields fresh 2-element arrays that are decoupled from the map', () => {
      const small = build([1, 2]);
      const a = small.entries().next().value as [number, string];
      const b = small.entries().next().value as [number, string];
      expect(Array.isArray(a)).toBe(true);
      expect(a).toHaveLength(2);
      expect(a).toEqual(b);
      expect(a).not.toBe(b);
      const [k] = a;
      a[1] = 'mutated';
      expect(small.get(k)).toBe(`v${k}`);
    });

    it('forEach visits the same entries in the same order as the iterator', () => {
      const visited: Array<[number, string]> = [];
      m.forEach((v, k) => visited.push([k, v]));
      expect(visited).toEqual([...m]);
    });
  });

  describe('iterator protocol', () => {
    it.each(iterKinds)('%s() iterator is itself iterable (returns itself)', (kind) => {
      const m = build(range(3));
      const it = getIter(m, kind);
      expect(typeof it.next).toBe('function');
      expect(it[Symbol.iterator]()).toBe(it);
    });

    it.each(iterKinds)('%s() keeps returning done:true after exhaustion', (kind) => {
      const m = build(range(3));
      const it = getIter(m, kind);
      for (let i = 0; i < 3; i++) expect(it.next().done).toBe(false);
      for (let i = 0; i < 5; i++) expect(it.next()).toEqual({ value: undefined, done: true });
    });

    it.each(iterKinds)('%s() stays done even if entries are added after exhaustion', (kind) => {
      const m = build(range(3));
      const it = getIter(m, kind);
      [...it];
      m.set(1, 'x').set(2, 'y').set(15, 'z');
      expect(it.next().done).toBe(true);
    });

    it.each(iterKinds)('%s() returns a new independent iterator each call', (kind) => {
      const m = build(range(5));
      const a = getIter(m, kind);
      const b = getIter(m, kind);
      expect(a).not.toBe(b);
      a.next();
      a.next();
      expect([...b]).toHaveLength(5);
      expect([...a]).toHaveLength(3);
    });

    it('multiple iterators can be interleaved independently', () => {
      const m = build(range(10), { hashFn: (k: unknown) => (k as number) % 3 });
      const a = m.keys();
      const b = m.keys();
      const outA: number[] = [];
      const outB: number[] = [];
      for (let i = 0; i < 10; i++) {
        outA.push(a.next().value as number);
        if (i % 2 === 0) outB.push(b.next().value as number);
      }
      outB.push(...b);
      expect(outA).toEqual(outB);
      expect(sortedNums(outA)).toEqual(range(10));
    });

    it('partially consumed iterator spreads only remaining items', () => {
      const m = build(range(6));
      const it = m.keys();
      const first = it.next().value as number;
      const rest = [...it];
      expect(rest).toHaveLength(5);
      expect(rest).not.toContain(first);
    });

    it('breaking out of for-of and starting a new loop restarts from the beginning', () => {
      const m = build(range(8));
      for (const _ of m) break;
      expect([...m]).toHaveLength(8);
    });
  });

  describe('consumers', () => {
    const m = new HashMap<string, number>([['a', 1], ['b', 2], ['c', 3]]);

    it('works with for-of destructuring', () => {
      const seen: Record<string, number> = {};
      for (const [k, v] of m) seen[k] = v;
      expect(seen).toEqual({ a: 1, b: 2, c: 3 });
    });

    it.each(iterKinds)('%s() works with spread and Array.from equivalently', (kind) => {
      expect([...getIter(m, kind)]).toEqual(Array.from(getIter(m, kind)));
    });

    it('works with array destructuring of the iterator', () => {
      const [first, second, ...rest] = m.keys();
      expect([first, second, ...rest].sort()).toEqual(['a', 'b', 'c']);
    });

    it('Array.from with a map function', () => {
      expect(Array.from(m.values(), (v) => v * 10).sort()).toEqual([10, 20, 30]);
    });

    it('new Map(hashMap) copies all entries', () => {
      const native = new Map(m);
      expect(native.size).toBe(3);
      expect([...native.entries()].sort(byKey)).toEqual([['a', 1], ['b', 2], ['c', 3]]);
    });

    it('new Set(hashMap.keys()) and new HashMap([...hashMap]) round-trip', () => {
      expect(new Set(m.keys())).toEqual(new Set(['a', 'b', 'c']));
      const copy = new HashMap<string, number>([...m]);
      expect(copy.size).toBe(3);
      expect(copy.get('b')).toBe(2);
    });

    it('Object.fromEntries(hashMap) builds a plain object', () => {
      expect(Object.fromEntries(m)).toEqual({ a: 1, b: 2, c: 3 });
    });

    it('works with Promise.all over values', async () => {
      await expect(Promise.all(m.values())).resolves.toHaveLength(3);
    });
  });

  describe('object keys and values (references)', () => {
    it('keys() and values() yield the exact stored references, not copies', () => {
      const k1 = { id: 1 };
      const k2 = { id: 2 };
      const v1 = { payload: 'a' };
      const v2 = { payload: 'b' };
      const m = new HashMap<object, object>([[k1, v1], [k2, v2]]);
      const keys = [...m.keys()];
      const values = [...m.values()];
      expect(keys).toHaveLength(2);
      expect(keys.some((k) => k === k1)).toBe(true);
      expect(keys.some((k) => k === k2)).toBe(true);
      expect(values.some((v) => v === v1)).toBe(true);
      expect(values.some((v) => v === v2)).toBe(true);
    });

    it('updating via a structurally equal key yields one entry, keeping the original key reference', () => {
      const original = { a: [1, 2] };
      const m = new HashMap<object, number>([[original, 1]]);
      m.set({ a: [1, 2] }, 2);
      const entries = [...m.entries()];
      expect(entries).toHaveLength(1);
      expect(entries[0][0]).toBe(original);
      expect(entries[0][1]).toBe(2);
    });
  });

  describe('null / undefined / falsy keys and values', () => {
    it('yields undefined and null values', () => {
      const m = new HashMap<string, unknown>([['u', undefined], ['n', null], ['z', 0], ['e', '']]);
      const entries = [...m.entries()].sort(byKey);
      expect(entries).toEqual([['e', ''], ['n', null], ['u', undefined], ['z', 0]]);
      expect([...m.values()]).toHaveLength(4);
    });

    it('yields undefined and null keys (both hash to 0, same bucket)', () => {
      const m = new HashMap<unknown, string>([[undefined, 'u'], [null, 'n'], [0, 'zero'], [false, 'f']]);
      const keys = [...m.keys()];
      expect(keys).toHaveLength(4);
      expect(keys).toContain(undefined);
      expect(keys).toContain(null);
      expect(keys).toContain(0);
      expect(keys).toContain(false);
    });

    it('iteration does not stop early at an undefined value', () => {
      const m = new HashMap<number, unknown>(range(10).map((k) => [k, undefined] as [number, unknown]));
      expect([...m.values()]).toEqual(new Array(10).fill(undefined));
      expect(sortedNums(m.keys())).toEqual(range(10));
    });
  });

  describe('collisions and long chains', () => {
    it.each([10, 100, 500])('constant hashFn: %i entries each visited exactly once', (n) => {
      const m = build(range(n), { hashFn: constantHash });
      const keys = [...m.keys()];
      expect(keys).toHaveLength(n);
      expect(new Set(keys).size).toBe(n);
      expect([...m.values()]).toHaveLength(n);
    });

    it('long chains survive resizes without loss or duplication', () => {
      // hash = k % 4 yields 4 long chains regardless of capacity
      const m = build(range(400), { hashFn: (k: unknown) => (k as number) % 4, capacity: 2 });
      expect(sortedNums(m.keys())).toEqual(range(400));
    });

    it('keys colliding on bucket index but not full hash are all visited', () => {
      const keys = range(20).map((i) => i * 16); // all land in bucket 0 at capacity 16
      const m = build(keys, { loadFactor: 100 });
      expect(sortedNums(m.keys())).toEqual(keys);
    });

    it('seeded random insert/delete workload matches a native Map', () => {
      const rnd = mulberry32(99);
      const m = new HashMap<number, number>({ hashFn: (k: unknown) => (k as number) % 7 });
      const ref = new Map<number, number>();
      for (let i = 0; i < 3000; i++) {
        const k = Math.floor(rnd() * 300);
        if (rnd() < 0.3) {
          m.delete(k);
          ref.delete(k);
        } else {
          m.set(k, i);
          ref.set(k, i);
        }
      }
      expect([...m].sort(byKey)).toEqual([...ref].sort(byKey));
    });
  });

  describe('forEach', () => {
    it('passes (value, key, map) and respects thisArg', () => {
      const m = new HashMap<string, number>([['a', 1]]);
      const ctx = { tag: 'ctx' };
      const calls: unknown[][] = [];
      m.forEach(function (this: unknown, v, k, map) {
        calls.push([this, v, k, map]);
      }, ctx);
      expect(calls).toEqual([[ctx, 1, 'a', m]]);
      expect(calls[0][3]).toBe(m);
    });

    it('is not called on an empty map', () => {
      const fn = jest.fn();
      new HashMap().forEach(fn);
      expect(fn).not.toHaveBeenCalled();
    });

    it('returns undefined', () => {
      expect(build(range(3)).forEach(() => 1)).toBeUndefined();
    });

    it('propagates exceptions thrown by the callback and stops', () => {
      const m = build(range(5));
      let count = 0;
      expect(() => m.forEach(() => {
        count++;
        if (count === 2) throw new Error('boom');
      })).toThrow('boom');
      expect(count).toBe(2);
    });

    it('a key deleted before being visited is not visited', () => {
      const m = build(range(10));
      const seen: number[] = [];
      m.forEach((_, k) => {
        seen.push(k);
        if (k === 2) m.delete(7);
      });
      expect(seen).not.toContain(7);
      expect(seen).toHaveLength(9);
    });

    // BUG: forEach uses the table-walking iterator; entries inserted into an already-passed bucket are skipped
    test.failing('visits entries added during forEach (native Map semantics)', () => {
      const m = build([5]);
      const seen: number[] = [];
      m.forEach((_, k) => {
        seen.push(k);
        if (k === 5) m.set(1, 'v1');
      });
      expect(seen).toEqual([5, 1]);
    });
  });

  describe('mutation during iteration (native Map semantics)', () => {
    it('deleting a not-yet-visited key (later bucket) means it is not visited', () => {
      const m = build(range(10));
      const seen: number[] = [];
      for (const [k] of m) {
        seen.push(k);
        if (k === 2) m.delete(7);
      }
      expect(seen).not.toContain(7);
      expect(sortedNums(seen)).toEqual([0, 1, 2, 3, 4, 5, 6, 8, 9]);
    });

    it('deleting a not-yet-visited key in the same collision chain means it is not visited', () => {
      const m = build(range(5), { hashFn: constantHash });
      const order = [...m.keys()];
      const seen: number[] = [];
      for (const k of m.keys()) {
        seen.push(k);
        if (k === order[0]) m.delete(order[3]);
      }
      expect(seen).toEqual(order.filter((k) => k !== order[3]));
    });

    it('deleting the current entry continues iteration over the rest', () => {
      const m = build(range(10, 0), { hashFn: (k: unknown) => (k as number) % 3 });
      const seen: number[] = [];
      for (const k of m.keys()) {
        seen.push(k);
        m.delete(k);
      }
      expect(sortedNums(seen)).toEqual(range(10));
      expect(m.size).toBe(0);
    });

    // BUG: iterator keeps a pointer to the removed current node, whose stale `next` still references a later-deleted node
    test.failing('deleting the current entry and then its chain successor does not visit the successor', () => {
      const m = build([1, 2, 3], { hashFn: constantHash });
      const order = [...m.keys()]; // chain order, e.g. [3, 2, 1]
      const seen: number[] = [];
      for (const k of m.keys()) {
        seen.push(k);
        if (k === order[0]) {
          m.delete(order[0]);
          m.delete(order[1]);
        }
      }
      expect(seen).toEqual([order[0], order[2]]);
    });

    it('an entry added into a later bucket during iteration is visited', () => {
      const m = build([0, 1]);
      const seen: number[] = [];
      for (const [k] of m) {
        seen.push(k);
        if (k === 0) m.set(9, 'v9');
      }
      expect(sortedNums(seen)).toEqual([0, 1, 9]);
    });

    // BUG: new entries are prepended to bucket chains; if that bucket was already passed the iterator never sees them
    test.failing('an entry added into an earlier bucket during iteration is visited', () => {
      const m = build([5]);
      const seen: number[] = [];
      for (const [k] of m) {
        seen.push(k);
        if (k === 5) m.set(1, 'v1');
      }
      expect(seen).toEqual([5, 1]);
    });

    // BUG: new nodes are prepended at the chain head, behind the iterator's current position
    test.failing('an entry added into the current collision chain during iteration is visited', () => {
      const m = build([1, 2], { hashFn: constantHash });
      const seen: number[] = [];
      for (const [k] of m) {
        seen.push(k);
        if (seen.length === 1) m.set(3, 'v3');
      }
      expect(sortedNums(seen)).toEqual([1, 2, 3]);
    });

    // BUG: resize relinks nodes into a new table; the iterator still walks the old table/capacity and loses entries
    test.failing('set() that triggers a resize mid-iteration still visits every original entry exactly once', () => {
      // keys i and i+16 share bucket i at capacity 16 but split after resizing to 32
      const keys = range(6).flatMap((i) => [i, i + 16]); // 12 entries, threshold 12
      const m = build(keys);
      expect((m as any).capacity).toBe(16);
      const seen: number[] = [];
      for (const [k] of m) {
        seen.push(k);
        if (seen.length === 1) m.set(100, 'v100'); // size 13 > 12 -> resize
      }
      expect((m as any).capacity).toBe(32);
      const originals = seen.filter((k) => keys.includes(k));
      expect(sortedNums(originals)).toEqual(sortedNums(keys));
    });

    // BUG: after resize the iterator holds the stale table/capacity, so new entries (and some old ones) are missed
    test.failing('entries added during iteration that trigger a resize are all visited', () => {
      const m = build(range(12));
      const seen: number[] = [];
      for (const [k] of m) {
        seen.push(k);
        if (k === 0) for (let j = 12; j < 40; j++) m.set(j, `v${j}`);
      }
      expect(sortedNums(seen)).toEqual(range(40));
    });

    it('updating an existing key during iteration is reflected and not duplicated', () => {
      const m = build(range(10));
      const seen: Array<[number, string]> = [];
      for (const [k, v] of m) {
        seen.push([k, v]);
        if (k === 0) m.set(8, 'updated');
      }
      expect(seen).toHaveLength(10);
      expect(new Set(seen.map(([k]) => k)).size).toBe(10);
      expect(seen.find(([k]) => k === 8)).toEqual([8, 'updated']);
      expect(m.size).toBe(10);
    });

    it('updating the current key during iteration does not cause a revisit', () => {
      const m = build(range(10), { hashFn: constantHash });
      const seen: number[] = [];
      for (const [k] of m) {
        seen.push(k);
        m.set(k, 'changed');
      }
      expect(sortedNums(seen)).toEqual(range(10));
      expect([...m.values()].every((v) => v === 'changed')).toBe(true);
    });

    it('deleting and re-adding a visited key mid-iteration does not lose unvisited keys', () => {
      const m = build(range(10));
      const seen: number[] = [];
      for (const [k] of m) {
        seen.push(k);
        if (k === 3) {
          m.delete(1);
          m.set(1, 'again');
        }
      }
      for (const k of range(10)) expect(seen).toContain(k);
    });

    // BUG: clear() swaps in a new table but live iterators keep walking the old one
    test.failing('clear() during iteration ends the iteration', () => {
      const m = build(range(10));
      const seen: number[] = [];
      for (const [k] of m) {
        seen.push(k);
        if (seen.length === 3) m.clear();
      }
      expect(seen).toHaveLength(3);
    });

    // BUG: clear() swaps in a new table but an iterator created before it still yields the old entries
    test.failing('an iterator created before clear() yields nothing afterwards', () => {
      const m = build(range(5));
      const it = m.entries();
      m.clear();
      expect(it.next().done).toBe(true);
    });

    // BUG: iterator captured the pre-resize table; resize relinks nodes so it no longer sees all entries
    test.failing('an iterator created before a resize yields every entry present when consumed', () => {
      const keys = range(6).flatMap((i) => [i, i + 16]);
      const m = build(keys);
      const it = m.keys();
      for (let j = 200; j < 220; j++) m.set(j, `v${j}`);
      expect(sortedNums(it)).toEqual(sortedNums([...keys, ...range(20, 200)]));
    });

    it('an iterator created before a non-resizing set() sees the new entry in a later bucket', () => {
      const m = build([0]);
      const it = m.keys();
      m.set(7, 'v7');
      expect(sortedNums(it)).toEqual([0, 7]);
    });
  });
});
