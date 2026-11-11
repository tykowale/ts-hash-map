/**
 * Structural equality used as the default `equalsFn` of HashMap.
 *
 * Semantics (the default hash function must agree: isEqual(a, b) => hash(a) === hash(b)):
 *  - Primitives: SameValueZero (NaN equals NaN, +0 equals -0). No coercion across types.
 *  - Objects must share the same prototype (Object.getPrototypeOf), otherwise not equal.
 *  - Arrays: same length, element-wise equality by index (holes equal undefined);
 *    non-index properties are ignored.
 *  - Date: equal timestamps, all invalid Dates are equal to each other.
 *  - RegExp: equal source and flags (lastIndex ignored).
 *  - Boxed Number/String/Boolean/BigInt/Symbol: SameValueZero of valueOf().
 *  - Error: equal name and message, plus own enumerable keys as for plain objects.
 *  - Typed arrays: same type (prototype) and length, element-wise SameValueZero.
 *  - ArrayBuffer / DataView: same byte length, byte-wise equality.
 *  - Map: same size and a one-to-one matching of entries whose keys AND values are
 *    structurally equal (insertion order irrelevant).
 *  - Set: same size and a one-to-one matching of structurally equal members.
 *  - Functions: equal source text (Function.prototype.toString).
 *  - Other objects (plain, class instances, null-prototype): same set of own enumerable
 *    string keys and own enumerable symbol keys, values compared recursively.
 *  - Cycles: a pair (a, b) currently being compared higher up the stack is assumed equal.
 */

interface Stack {
  /** the (a, b) pairs currently being compared (the path from the root) */
  a: unknown[];
  b: unknown[];
  /**
   * Memo mode (first attempt): results of large pair comparisons are cached so shared
   * sub-objects (DAGs such as `x = { a: y, b: y }` nested n times) compare in linear rather
   * than 2^n time. A comparison that never hits the cycle check is context-independent, so
   * caching is exact as long as the whole run is hit-free; the first hit aborts the run
   * (`aborted`) and isEqual redoes it without the memo.
   */
  useMemo: boolean;
  aborted: boolean;
  /** object pairs compared so far (to size sub-comparisons for the memo) */
  count: number;
  memo: Map<unknown, Map<unknown, boolean>> | undefined;
}

/** pair comparisons that visited fewer object pairs than this are not memoized */
const MEMO_MIN_PAIRS = 16;

const objToString = Object.prototype.toString;
const propIsEnumerable = Object.prototype.propertyIsEnumerable;

function sameValueZero(a: unknown, b: unknown): boolean {
  // eslint-disable-next-line no-self-compare
  return a === b || (a !== a && b !== b);
}

function isPrimitiveLike(v: unknown): boolean {
  return v === null || (typeof v !== 'object' && typeof v !== 'function');
}

function isArrayEqual(a: unknown[], b: unknown[], stack: Stack): boolean {
  const len = a.length;
  if (len !== b.length) {
    return false;
  }
  for (let i = 0; i < len; i++) {
    if (!eq(a[i], b[i], stack)) {
      return false;
    }
  }
  return true;
}

function isTypedArrayEqual(a: ArrayLike<number | bigint>, b: ArrayLike<number | bigint>): boolean {
  const len = a.length;
  if (len !== b.length) {
    return false;
  }
  for (let i = 0; i < len; i++) {
    if (!sameValueZero(a[i], b[i])) {
      return false;
    }
  }
  return true;
}

function isBytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  const len = a.length;
  if (len !== b.length) {
    return false;
  }
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function isMapEqual(a: Map<unknown, unknown>, b: Map<unknown, unknown>, stack: Stack): boolean {
  if (a.size !== b.size) {
    return false;
  }

  // object-keyed entries of a that need a structural search in b
  let pendingA: Array<[unknown, unknown]> | undefined;

  for (const entry of a) {
    const key = entry[0];
    if (isPrimitiveLike(key)) {
      // a primitive key can only be structurally equal to the SameValueZero-same key
      if (!b.has(key) || !eq(entry[1], b.get(key), stack)) {
        return false;
      }
    } else {
      (pendingA ??= []).push(entry);
    }
  }

  if (pendingA === undefined) {
    return true;
  }

  const candidates: Array<[unknown, unknown] | undefined> = [];
  for (const entry of b) {
    if (!isPrimitiveLike(entry[0])) {
      candidates.push(entry);
    }
  }
  if (candidates.length !== pendingA.length) {
    return false;
  }

  // entry equality (key and value equal) is an equivalence relation, so greedy matching is exact
  outer: for (const [key, value] of pendingA) {
    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i];
      if (cand !== undefined && eq(key, cand[0], stack) && eq(value, cand[1], stack)) {
        candidates[i] = undefined;
        continue outer;
      }
    }
    return false;
  }
  return true;
}

function isSetEqual(a: Set<unknown>, b: Set<unknown>, stack: Stack): boolean {
  if (a.size !== b.size) {
    return false;
  }

  let pendingA: unknown[] | undefined;
  for (const value of a) {
    if (isPrimitiveLike(value)) {
      if (!b.has(value)) {
        return false;
      }
    } else {
      (pendingA ??= []).push(value);
    }
  }

  if (pendingA === undefined) {
    return true;
  }

  const candidates: unknown[] = [];
  for (const value of b) {
    if (!isPrimitiveLike(value)) {
      candidates.push(value);
    }
  }
  if (candidates.length !== pendingA.length) {
    return false;
  }

  const used: boolean[] = new Array(candidates.length).fill(false);
  outer: for (const value of pendingA) {
    for (let i = 0; i < candidates.length; i++) {
      if (!used[i] && eq(value, candidates[i], stack)) {
        used[i] = true;
        continue outer;
      }
    }
    return false;
  }
  return true;
}

function ownEnumerableSymbols(o: object): symbol[] {
  const syms = Object.getOwnPropertySymbols(o);
  if (syms.length === 0) {
    return syms;
  }
  return syms.filter((s) => propIsEnumerable.call(o, s));
}

function isObjectEqual(a: any, b: any, stack: Stack): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) {
    return false;
  }

  for (let i = 0; i < keysA.length; i++) {
    const key = keysA[i];
    // fast path: same key at the same position (counts are equal and keys unique, so it is own
    // enumerable in b); otherwise check own-key membership so {a: undefined} !== {b: undefined}
    if ((keysB[i] !== key && !propIsEnumerable.call(b, key)) || !eq(a[key], b[key], stack)) {
      return false;
    }
  }

  const symsA = ownEnumerableSymbols(a);
  const symsB = ownEnumerableSymbols(b);
  if (symsA.length !== symsB.length) {
    return false;
  }
  for (let i = 0; i < symsA.length; i++) {
    const sym = symsA[i];
    if (!propIsEnumerable.call(b, sym) || !eq(a[sym], b[sym], stack)) {
      return false;
    }
  }

  return true;
}

function compareObjects(a: object, b: object, proto: unknown, stack: Stack): boolean {
  // prototypes are already known to be identical here
  if (proto === Object.prototype || proto === null) {
    return isObjectEqual(a, b, stack);
  }
  if (Array.isArray(a)) {
    return Array.isArray(b) && isArrayEqual(a, b as unknown[], stack);
  }

  const tag = objToString.call(a);
  if (tag !== objToString.call(b)) {
    return false;
  }

  switch (tag) {
    case '[object Object]':
      return isObjectEqual(a, b, stack);
    case '[object Date]': {
      return sameValueZero((a as Date).getTime(), (b as Date).getTime());
    }
    case '[object RegExp]':
      return (a as RegExp).source === (b as RegExp).source && (a as RegExp).flags === (b as RegExp).flags;
    case '[object Map]':
      return isMapEqual(a as Map<unknown, unknown>, b as Map<unknown, unknown>, stack);
    case '[object Set]':
      return isSetEqual(a as Set<unknown>, b as Set<unknown>, stack);
    case '[object Number]':
    case '[object String]':
    case '[object Boolean]':
    case '[object BigInt]':
    case '[object Symbol]':
      return sameValueZero((a as any).valueOf(), (b as any).valueOf());
    case '[object Error]':
      return (a as Error).name === (b as Error).name
        && (a as Error).message === (b as Error).message
        && isObjectEqual(a, b, stack);
    case '[object ArrayBuffer]':
    case '[object SharedArrayBuffer]':
      return isBytesEqual(new Uint8Array(a as ArrayBuffer), new Uint8Array(b as ArrayBuffer));
    case '[object DataView]': {
      const da = a as DataView;
      const db = b as DataView;
      return isBytesEqual(
        new Uint8Array(da.buffer, da.byteOffset, da.byteLength),
        new Uint8Array(db.buffer, db.byteOffset, db.byteLength),
      );
    }
    default:
      if (ArrayBuffer.isView(a)) {
        return isTypedArrayEqual(a as any, b as any);
      }
      // Map/Set subclasses that override Symbol.toStringTag (same prototype, so b matches too)
      if (a instanceof Map) {
        return isMapEqual(a, b as Map<unknown, unknown>, stack);
      }
      if (a instanceof Set) {
        return isSetEqual(a, b as Set<unknown>, stack);
      }
      return isObjectEqual(a, b, stack);
  }
}

function eq(a: unknown, b: unknown, stack: Stack): boolean {
  if (a === b) {
    return true;
  }

  const typeA = typeof a;
  if (typeA !== 'object' && typeA !== 'function') {
    // primitive (or undefined): SameValueZero, only NaN remains to be checked
    // eslint-disable-next-line no-self-compare
    return a !== a && b !== b;
  }
  if (a === null || b === null || typeA !== typeof b) {
    return false;
  }

  if (typeA === 'function') {
    return (a as Function).toString() === (b as Function).toString();
  }

  const proto = Object.getPrototypeOf(a);
  if (proto !== Object.getPrototypeOf(b)) {
    return false;
  }

  const useMemo = stack.useMemo;
  if (useMemo) {
    if (stack.aborted) {
      return false; // result is discarded
    }
    const known = stack.memo?.get(a)?.get(b);
    if (known !== undefined) {
      return known;
    }
  }

  // cycle detection: if this exact (a, b) pair is already being compared further up, assume equal
  const sa = stack.a;
  const sb = stack.b;
  for (let i = sa.length - 1; i >= 0; i--) {
    if (sa[i] === a && sb[i] === b) {
      if (useMemo) {
        stack.aborted = true;
        return false;
      }
      return true;
    }
  }

  // the stack is created fresh per top-level call, so no try/finally is needed for throws
  const before = stack.count;
  sa.push(a);
  sb.push(b);
  // plain objects and arrays are dispatched here directly (one stack frame less per level)
  const result = proto === Object.prototype || proto === null
    ? isObjectEqual(a, b, stack)
    : Array.isArray(a)
      ? Array.isArray(b) && isArrayEqual(a, b as unknown[], stack)
      : compareObjects(a as object, b as object, proto, stack);
  sa.pop();
  sb.pop();

  if (useMemo && !stack.aborted && ++stack.count - before >= MEMO_MIN_PAIRS) {
    const memo = (stack.memo ??= new Map());
    let row = memo.get(a);
    if (row === undefined) {
      row = new Map();
      memo.set(a, row);
    }
    row.set(b, result);
  }
  return result;
}

function newStack(useMemo: boolean): Stack {
  return { a: [], b: [], useMemo, aborted: false, count: 0, memo: undefined };
}

export function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  const typeA = typeof a;
  if (typeA !== 'object' && typeA !== 'function') {
    // eslint-disable-next-line no-self-compare
    return a !== a && b !== b;
  }
  const memoStack = newStack(true);
  const result = eq(a, b, memoStack);
  if (!memoStack.aborted) {
    return result;
  }
  // a cycle was hit: compare again with plain cycle-assumption semantics and no memo
  return eq(a, b, newStack(false));
}
