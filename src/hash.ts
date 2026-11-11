/**
 * Structural hash used as the default `hashFn` of HashMap.
 *
 * Contract: `isEqual(a, b)` implies `getHashCode(a) === getHashCode(b)`, and the result is
 * always a 32-bit integer. The dispatch below mirrors `compareObjects` in is-equal.ts:
 *  - numbers use SameValueZero (NaN has one fixed hash, -0 hashes like 0); int32 values hash
 *    to themselves, everything else is mixed from its float64 bits
 *  - containers are tagged by kind so empty containers of different kinds hash differently
 *  - object properties, Map entries and Set members are combined commutatively (key order /
 *    insertion order never matters); arrays and byte sequences are combined in order
 *  - shared, non-circular sub-objects are hashed by structure every time they appear
 *  - cyclic values: isEqual treats equivalent cycles of different length as equal, so a value
 *    whose traversal hits a cycle is re-hashed from a depth-limited unfolding (identical for
 *    equal values) instead of from its cycle structure
 */

const objToString = Object.prototype.toString;
const propIsEnumerable = Object.prototype.propertyIsEnumerable;

// type tags (arbitrary odd constants)
const NULL_HASH = 0;
const UNDEFINED_HASH = 0;
const NAN_HASH = 0x7ff80000 | 0;
const TAG_BIGINT = 0x1b873593;
const TAG_SYMBOL = 0x2c1b3c6d;
const TAG_FUNCTION = 0x297a2d39;
const TAG_OBJECT = 0x6a09e667;
const TAG_ARRAY = 0x3c6ef372;
const TAG_DATE = 0x510e527f;
const TAG_REGEXP = 0x1f83d9ab;
const TAG_MAP = 0x5be0cd19;
const TAG_SET = 0x428a2f98;
const TAG_BOXED = 0x71374491;
const TAG_ERROR = 0x3956c25b;
const TAG_BYTES = 0x59f111f1;
const TAG_TYPED = 0x123456d1;
const CYCLE_HASH = 0x0badc0de;

/** depth (0 = top level) from which containers are only hashed shallowly in cycle mode */
const CYCLE_UNFOLD_DEPTH = 2;
/** deeper unfoldings are tried (up to this depth) while they stay within CYCLE_UNFOLD_BUDGET */
const CYCLE_UNFOLD_MAX_DEPTH = 16;
/** max containers visited by one deeper cycle-mode unfolding pass */
const CYCLE_UNFOLD_BUDGET = 256;
/**
 * normal mode: acyclic sub-objects whose hashing visited at least this many containers are
 * memoized. Smaller ones are cheap to re-hash, so typical keys never allocate the memo, while
 * shared sub-objects (DAGs such as `x = { a: y, b: y }` nested n times) stay linear, not 2^n.
 */
const MEMO_MIN_CONTAINERS = 16;

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

/** murmur3 finalizer: full avalanche of a 32-bit value */
function fmix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h | 0;
}

/** murmur3 block step: order-dependent combine of `k` into `h` */
function combine(h: number, k: number): number {
  k = Math.imul(k, 0xcc9e2d51);
  k = (k << 15) | (k >>> 17);
  k = Math.imul(k, 0x1b873593);
  h ^= k;
  h = (h << 13) | (h >>> 19);
  return (Math.imul(h, 5) + 0xe6546b64) | 0;
}

/** well-mixed hash of an ordered pair, for commutative (sum) accumulation */
function pairHash(a: number, b: number): number {
  return fmix(combine(combine(0x9e3779b9, a), b));
}

function getBooleanHashCode(value: boolean): number {
  // Java convention for boolean hash codes
  return value ? 1231 : 1237;
}

function getStringHashCode(value: string): number {
  let hash = 0;

  for (let i = 0; i < value.length; i++) {
    hash = (Math.imul(hash, 31) + value.charCodeAt(i)) | 0;
  }

  return hash;
}

/** SameValueZero-consistent number hash */
function getNumberHashCode(value: number): number {
  if ((value | 0) === value) {
    // int32 (this also maps -0 to 0)
    return value | 0;
  }
  // eslint-disable-next-line no-self-compare
  if (value !== value) {
    return NAN_HASH;
  }
  f64[0] = value;
  return fmix(u32[0] ^ Math.imul(u32[1], 0x9e3779b1));
}

function getPrimitiveHashCode(value: unknown): number {
  switch (typeof value) {
    case 'number':
      return getNumberHashCode(value);
    case 'string':
      return getStringHashCode(value);
    case 'boolean':
      return getBooleanHashCode(value);
    case 'undefined':
      return UNDEFINED_HASH;
    case 'bigint':
      return fmix(getStringHashCode(value.toString()) ^ TAG_BIGINT);
    case 'symbol':
      return fmix(getStringHashCode(value.toString()) ^ TAG_SYMBOL);
    case 'function':
      return fmix(getStringHashCode(value.toString()) ^ TAG_FUNCTION);
    default:
      return NULL_HASH;
  }
}

interface Ctx {
  /** objects currently being hashed (the path from the root), only used in normal mode */
  stack: object[];
  /** set when a back-reference to an object on the stack was found */
  cyclic: boolean;
  /** -1 in normal mode; otherwise the depth at which containers are hashed shallowly */
  maxDepth: number;
  /** containers visited so far (normal mode: memo sizing; cycle mode: unfolding budget) */
  count: number;
  /** cycle mode: a pass is abandoned once `count` exceeds this */
  budget: number;
  /**
   * normal mode: hashes of already hashed large acyclic sub-objects (see MEMO_MIN_CONTAINERS),
   * created lazily. An acyclic sub-object's hash does not depend on where it appears.
   */
  memo: Map<object, number> | undefined;
}

function ownEnumerableSymbols(o: object): symbol[] {
  const syms = Object.getOwnPropertySymbols(o);
  if (syms.length === 0) {
    return syms;
  }
  return syms.filter((s) => propIsEnumerable.call(o, s));
}

function hashObjectProps(value: any, tag: number, ctx: Ctx, depth: number): number {
  const keys = Object.keys(value);
  const syms = ownEnumerableSymbols(value);
  const count = keys.length + syms.length;
  let acc = 0;

  if (depth === ctx.maxDepth) {
    // shallow: key names only
    for (let i = 0; i < keys.length; i++) {
      acc = (acc + fmix(getStringHashCode(keys[i]))) | 0;
    }
    for (let i = 0; i < syms.length; i++) {
      acc = (acc + fmix(getPrimitiveHashCode(syms[i]))) | 0;
    }
  } else {
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      acc = (acc + pairHash(getStringHashCode(key), hash(value[key], ctx, depth))) | 0;
    }
    for (let i = 0; i < syms.length; i++) {
      const sym = syms[i];
      acc = (acc + pairHash(getPrimitiveHashCode(sym), hash(value[sym], ctx, depth))) | 0;
    }
  }

  return fmix(combine(combine(tag, count), acc));
}

function hashArray(value: unknown[], ctx: Ctx, depth: number): number {
  const len = value.length;
  let h = combine(TAG_ARRAY, len);
  if (depth !== ctx.maxDepth) {
    for (let i = 0; i < len; i++) {
      h = combine(h, hash(value[i], ctx, depth));
    }
  }
  return fmix(h);
}

function hashMap(value: Map<unknown, unknown>, ctx: Ctx, depth: number): number {
  let acc = 0;
  if (depth !== ctx.maxDepth) {
    for (const entry of value) {
      acc = (acc + pairHash(hash(entry[0], ctx, depth), hash(entry[1], ctx, depth))) | 0;
    }
  }
  return fmix(combine(combine(TAG_MAP, value.size), acc));
}

function hashSet(value: Set<unknown>, ctx: Ctx, depth: number): number {
  let acc = 0;
  if (depth !== ctx.maxDepth) {
    for (const member of value) {
      acc = (acc + fmix(hash(member, ctx, depth))) | 0;
    }
  }
  return fmix(combine(combine(TAG_SET, value.size), acc));
}

function hashBytes(bytes: Uint8Array): number {
  const len = bytes.length;
  let h = combine(TAG_BYTES, len);
  for (let i = 0; i < len; i++) {
    h = combine(h, bytes[i]);
  }
  return fmix(h);
}

function hashTypedArray(value: ArrayLike<number | bigint>, tagName: string): number {
  const len = value.length;
  let h = combine(combine(TAG_TYPED, getStringHashCode(tagName)), len);
  for (let i = 0; i < len; i++) {
    h = combine(h, getPrimitiveHashCode(value[i]));
  }
  return fmix(h);
}

/** hash of a non-primitive container whose kind is already known to need recursion */
function hashContainer(value: object, proto: unknown, ctx: Ctx, depth: number): number {
  if (proto === Object.prototype || proto === null) {
    return hashObjectProps(value, TAG_OBJECT, ctx, depth);
  }
  if (Array.isArray(value)) {
    return hashArray(value, ctx, depth);
  }

  const tag = objToString.call(value);
  switch (tag) {
    case '[object Object]':
      return hashObjectProps(value, TAG_OBJECT, ctx, depth);
    case '[object Map]':
      return hashMap(value as Map<unknown, unknown>, ctx, depth);
    case '[object Set]':
      return hashSet(value as Set<unknown>, ctx, depth);
    case '[object Error]': {
      const err = value as Error;
      const base = combine(
        combine(TAG_ERROR, getPrimitiveHashCode(err.name)),
        getPrimitiveHashCode(err.message),
      );
      return hashObjectProps(value, base, ctx, depth);
    }
    default:
      // Map/Set subclasses that override Symbol.toStringTag (mirrors is-equal.ts)
      if (value instanceof Map) {
        return hashMap(value, ctx, depth);
      }
      if (value instanceof Set) {
        return hashSet(value, ctx, depth);
      }
      return hashObjectProps(value, TAG_OBJECT, ctx, depth);
  }
}

/** hash of non-recursive object kinds, or undefined if `value` is a container */
function hashLeafObject(value: object, proto: unknown): number | undefined {
  if (proto === Object.prototype || proto === null || Array.isArray(value)) {
    return undefined;
  }

  const tag = objToString.call(value);
  switch (tag) {
    case '[object Date]':
      return fmix(combine(TAG_DATE, getNumberHashCode((value as Date).getTime())));
    case '[object RegExp]': {
      const re = value as RegExp;
      return fmix(combine(combine(TAG_REGEXP, getStringHashCode(re.source)), getStringHashCode(re.flags)));
    }
    case '[object Number]':
    case '[object String]':
    case '[object Boolean]':
    case '[object BigInt]':
    case '[object Symbol]':
      return fmix(combine(combine(TAG_BOXED, getStringHashCode(tag)), getPrimitiveHashCode((value as any).valueOf())));
    case '[object ArrayBuffer]':
    case '[object SharedArrayBuffer]':
      return hashBytes(new Uint8Array(value as ArrayBuffer));
    case '[object DataView]': {
      const dv = value as DataView;
      return hashBytes(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength));
    }
    case '[object Object]':
    case '[object Map]':
    case '[object Set]':
    case '[object Error]':
      return undefined;
    default:
      if (ArrayBuffer.isView(value)) {
        return hashTypedArray(value as any, tag);
      }
      return undefined;
  }
}

// dispatches the two common kinds directly (one stack frame less per nesting level)
function hashKnownContainer(value: object, proto: unknown, plain: boolean, ctx: Ctx, depth: number): number {
  if (plain) {
    return hashObjectProps(value, TAG_OBJECT, ctx, depth);
  }
  if (Array.isArray(value)) {
    return hashArray(value, ctx, depth);
  }
  return hashContainer(value, proto, ctx, depth);
}

function hash(value: unknown, ctx: Ctx, depth: number): number {
  if (value === null || typeof value !== 'object') {
    return getPrimitiveHashCode(value);
  }

  const proto = Object.getPrototypeOf(value);
  const plain = proto === Object.prototype || proto === null;
  if (!plain) {
    const leaf = hashLeafObject(value, proto);
    if (leaf !== undefined) {
      return leaf;
    }
  }

  if (ctx.maxDepth >= 0) {
    // cycle mode: depth-limited unfolding, no cycle detection needed
    if (++ctx.count > ctx.budget) {
      return 0; // pass abandoned, result discarded
    }
    return hashKnownContainer(value, proto, plain, ctx, depth + 1);
  }

  if (ctx.cyclic) {
    return 0; // first pass result is discarded once a cycle was found
  }

  const memo = ctx.memo;
  if (memo !== undefined) {
    const known = memo.get(value);
    if (known !== undefined) {
      return known;
    }
  }

  const stack = ctx.stack;
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i] === value) {
      ctx.cyclic = true;
      return CYCLE_HASH;
    }
  }

  const before = ctx.count;
  stack.push(value);
  const result = hashKnownContainer(value, proto, plain, ctx, depth + 1);
  stack.pop();

  // A sub-object whose traversal hit no back-reference is acyclic (any object that reaches a
  // cycle reaches some object twice along one path), so its hash is context-independent.
  if (!ctx.cyclic && ++ctx.count - before >= MEMO_MIN_CONTAINERS) {
    (ctx.memo ??= new Map()).set(value, result);
  }
  return result;
}

export function getHashCode(value: unknown): number {
  if (value === null || typeof value !== 'object') {
    return getPrimitiveHashCode(value);
  }

  const ctx: Ctx = { stack: [], cyclic: false, maxDepth: -1, count: 0, budget: Infinity, memo: undefined };
  const result = hash(value, ctx, -1);
  if (!ctx.cyclic) {
    return result;
  }

  // The value contains a cycle. isEqual can consider cycles of different lengths equal (it
  // compares the infinite unfoldings), so hash a depth-limited unfolding instead, which is
  // identical for equal values.
  ctx.memo = undefined;
  ctx.stack.length = 0;
  ctx.maxDepth = CYCLE_UNFOLD_DEPTH;
  let cycleHash = hash(value, ctx, -1);

  // Deeper unfoldings separate more cyclic values (a depth-2 unfolding makes e.g. all
  // `{ a: { b: { id } }, self }` collide). Equal values have identical unfoldings, hence the
  // same container count per depth, so "deepest unfolding within the budget" is chosen
  // identically for equal values.
  for (let d = CYCLE_UNFOLD_DEPTH + 1; d <= CYCLE_UNFOLD_MAX_DEPTH; d++) {
    ctx.maxDepth = d;
    ctx.count = 0;
    ctx.budget = CYCLE_UNFOLD_BUDGET;
    const h = hash(value, ctx, -1);
    if (ctx.count > CYCLE_UNFOLD_BUDGET) {
      break;
    }
    cycleHash = h;
  }
  return cycleHash;
}
