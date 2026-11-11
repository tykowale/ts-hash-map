# TS Hash Map

## Introduction

The native Javascript map is an excellent map to use but runs into the issue of using referential equality, which makes
difficult if you want to consider using the key `{id: 1}` without maintaining the original reference. This uses a well
established pattern to efficiently create a `Map` using deep equality.

## Table of Contents

- [Installation](#installation)
- [Usage](#usage)
- [Breaking changes in v2](#breaking-changes-in-v2)
- [Benchmarks](#benchmarks)
- [Development](#development)

## Installation

To use the HashMap class in your projects, you can install it via npm:

```bash
npm install @tykowale/ts-hash-map
```

The package ships both ES modules and CommonJS, each with its own type declarations, and has no
runtime dependencies. It requires Node.js 22 or newer.

```ts
import { HashMap } from '@tykowale/ts-hash-map'; // ESM
const { HashMap } = require('@tykowale/ts-hash-map'); // CommonJS
```

## Usage

#### Creating a HashMap

You can create a new instance of the HashMap class as follows:

```ts
const map = new HashMap<string, number>();
```

#### Getting and Setting Values

You can set key-value pairs using the set method and retrieve values by key using the get method:

```ts
// Set key-value pairs
map.set('apple', 5);
map.set('banana', 10);

// Get values by key
const appleCount = map.get('apple'); // Returns 5
const bananaCount = map.get('banana'); // Returns 10
```

#### Deleting Values

You can delete values by key using the delete method:

```ts
// Delete a value by key
map.delete('apple');
```

#### Iterating Over Entries

You can iterate over entries in the HashMap using a for...of loop or the forEach method:

```ts
// Iterate over entries using a for...of loop
for (const [key, value] of map) {
  console.log(`${key}: ${value}`);
}

// Iterate over entries using the forEach method
map.forEach((value, key) => {
  console.log(`${key}: ${value}`);
});
```

#### Size of Map

The `size` property returns the number of elements in the map

```ts
const map = new HashMap<string, number>();

map.size; // returns 0

map.set('apple', 5);

map.size; // returns 1
```

#### getOrDefault

Sometimes you want a default value instead of having to check for an undefined value

```ts
const map = new HashMap<string, number>();

map.getOrDefault('hello', 'world'); // returns 'world'
```

#### getOrThrow

Sometimes you know an element should exist and do not want to deal with an undefined check

```ts
const map = new HashMap<string, number>();

map.getOrThrow('hello'); // throws Error
```

## Breaking changes in v2

v2 makes `HashMap` behave like the native `Map` wherever value-equality allows, and makes the default
`isEqual` / `getHashCode` pair agree with each other. Behavior changes compared with v1:

#### Iteration

- Iteration (`for...of`, `entries()`, `keys()`, `values()`, `forEach`) now follows **insertion order**, like
  `Map`. v1 iterated in bucket (hash) order. Updating the value of an existing key keeps its position.
- Iteration is **live**, with native `Map` semantics: entries added during iteration are visited, entries deleted
  before being reached are skipped, and a resize mid-iteration no longer skips or repeats entries.
- `clear()` ends any in-progress iteration, and an iterator created before `clear()` yields nothing afterwards.
- The internal `HashMapKeysIterable` / `HashMapValuesIterable` modules were removed. `keys()`, `values()`,
  `entries()` and `[Symbol.iterator]()` are now typed as `MapIterator`, like `Map`, and inherit from the built-in
  `Iterator`, so iterator helpers such as `map`, `filter`, `take` and `toArray` work on them. The typings need
  TypeScript 5.6 or newer.

#### Keys

- `NaN` works as a key (SameValueZero, like `Map`): setting `NaN` twice keeps one entry, and `NaN` from any
  computation finds it. This also applies to `NaN` nested inside structural keys (e.g. `[NaN]`, `{ v: NaN }`)
  and to invalid `Date`s, which are all equal to each other.
- A `-0` key is stored and yielded as `+0`, like `Map`.
- The result of `hashFn` (default or custom) is truncated to a 32-bit integer (`hash | 0`), so float or `NaN`
  hashes no longer make keys unreachable.

#### Equality (`isEqual`, the default `equalsFn`)

- Objects must have the **same prototype**: instances of different classes with the same fields, `[]` vs `{}`,
  `['a']` vs `{ 0: 'a' }`, and `Date` / `RegExp` / `Map` / `Set` vs `{}` are no longer equal.
- Plain objects compare their **key sets**: `{ a: undefined }` no longer equals `{ b: undefined }`.
  Only own enumerable properties count (inherited enumerable properties are ignored, so equality is symmetric),
  and own enumerable **symbol** keys are now compared too.
- `Set` members and `Map` keys are compared **structurally**: `new Set([{ id: 1 }])` equals
  `new Set([{ id: 1 }])` and `new Map([[{ id: 1 }, 'v']])` equals `new Map([[{ id: 1 }, 'v']])`
  (v1 compared them by reference). Map entry insertion order does not matter.
- Boxed primitives (`new Number(1)`, `new Boolean(true)`, ...) compare by value; `Error`s compare `name` and
  `message`; typed arrays compare element type and contents; `ArrayBuffer` and `DataView` compare bytes.
- Cyclic structures are compared by `(a, b)` pairs, so unrelated values that were merely seen earlier are no
  longer treated as equal, and repeated (shared, non-circular) references compare correctly.

#### Hashing (`getHashCode`, the default `hashFn`)

- Hash values changed: all hashes are now well-mixed 32-bit integers (v1 returned raw numbers such as `3.14`
  or a `Date`'s timestamp). Exact hash values are not part of the public contract.
- `isEqual(a, b)` now always implies `getHashCode(a) === getHashCode(b)`: object properties, `Map` entries and
  `Set` members are combined order-independently, different container kinds hash differently, and shared
  sub-objects / equivalent cycles hash consistently.

#### Map surface

- `size` is a read-only getter (assigning to it throws in strict mode), like `Map.prototype.size`.
- `[Symbol.toStringTag]` is `'HashMap'`, so `Object.prototype.toString.call(map)` is `'[object HashMap]'`
  (it was `undefined` / `'[object Object]'` in v1).
- `capacity: 0` (or another non-positive / invalid capacity) now yields a working map; invalid `loadFactor`
  values fall back to the default `0.75`.

## Benchmarks

The suite in [`bench/`](bench/README.md) is built on [mitata](https://github.com/evanwashere/mitata). It
measures each operation (get hit/miss, has, set, update, churn, delete, clear, iteration, construction) across
several key types and map sizes. Every result sits next to a native `Map` baseline from the same process.
For structural keys the baseline is a `Map` keyed by `fast-json-stable-stringify(key)`, which is what you would
write without this library. Structural lookups always use equal _clones_, not the inserted references.

```bash
npm run bench                                 # everything (a few minutes)
npm run bench -- --family object-keys         # one scenario family
npm run bench:smoke                           # quick check that every benchmark runs and verifies
npm run bench:branches -- --base origin/v2    # compare this checkout against another branch
npm run bench:memory                          # retained bytes per entry and per small map
npm run bench -- --large                      # add the opt-in 1M-entry tier
npm run bench:profile -- --workload user-record --n 1000 --op get-hit  # CPU profile + flame graph
```

See [bench/README.md](bench/README.md) for the methodology, how to read the output and how to compare runs.
Results depend on the machine and the Node version, so quote ratios to the baseline, not absolute times.

## Development

The toolchain is TypeScript 7, [vitest](https://vitest.dev), [oxlint](https://oxc.rs/docs/guide/usage/linter),
[oxfmt](https://oxc.rs/docs/guide/usage/formatter) and [tsdown](https://tsdown.dev). Use Node.js 22 or newer
(`.node-version` pins the version used for development).

```bash
npm install
npm run check        # typecheck, lint, format check, tests, build and package checks
npm test             # run the tests once (npm run test:watch to watch)
npm run coverage     # tests with v8 coverage
npm run typecheck    # tsc -b
npm run lint         # oxlint (npm run lint:fix to apply fixes)
npm run format       # oxfmt (npm run format:check to verify only)
npm run build        # bundle to dist/ with tsdown, then run publint and attw
npm run test:package # typecheck and smoke test the built dist/ as a consumer would
```
