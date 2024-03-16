# TS Hash Map

## Introduction

The native Javascript map is an excellent map to use but runs into the issue of using referential equality, which makes
difficult if you want to consider using the key `{id: 1}` without maintaining the original reference. This uses a well
established pattern to efficiently create a `Map` using deep equality.

## Table of Contents

- [Installation](#installation)
- [Usage](#usage)
- [Benchmarks](#benchmark)

## Installation

To use the HashMap class in your projects, you can install it via npm:
```bash
npm install @tykowale/ts-hash-map
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

## Benchmarks

Comparison between native and ts-hash-map, 100,000 iterations of doing the same operation 100 times on a single map. 
These benchmarks are for Map<string, string> so an all primitive comparison 

|       Title        | Total Time (ms) | Time per Operation (ms) | Operations per Second |
|-------------------|-----------------|-------------------------|-----------------------|
|   'Hash Map Set'  |      2402       |      '0.0002402000'     |       '4,163,197'     |
|   'Hash Map Get'  |      974       |      '0.0000974000'     |       '10,266,940'     |
| 'Hash Map Update' |      2207       |      '0.0002207000'     |       '4,531,037'     |
| 'Hash Map Delete' |      665       |      '0.0000665000'     |       '15,037,593'     |
|  'Native Map Set' |      1690       |      '0.0001690000'     |       '5,917,159'     |
|  'Native Map Get' |       18        |      '0.0000018000'     |     '555,555,555'     |
|'Native Map Update'|      1184       |      '0.0001184000'     |       '8,445,945'     |
|'Native Map Delete'|       96        |      '0.0000096000'     |     '104,166,666'     |


These benchmarks are for Map<CustomObject, string>. It assumes to store the object in the map
you want deep equality so we use [fast-json-stable-stringify](https://www.npmjs.com/package/fast-json-stable-stringify) then store
it in the native m ap as Map<string, string>. This is done with only 10,000 iterations so total time is not apples
to apples with the above table.

| Title               | Total Time (ms) | Time per Operation (ms) | Operations per Second |
|---------------------|------------------|-------------------------|-----------------------|
| Hash Map Set        | 1274             | 0.0012740000            | 784,929               |
| Hash Map Get        | 988              | 0.0009880000            | 1,012,145             |
| Hash Map Update     | 1223             | 0.0012230000            | 817,661               |
| Hash Map Delete     | 898              | 0.0008980000            | 1,113,585             |
| Native Map Set      | 6527             | 0.0065270000            | 153,209               |
| Native Map Get      | 2706             | 0.0027060000            | 369,549               |
| Native Map Update   | 7904             | 0.0079040000            | 126,518               |
| Native Map Delete   | 3950             | 0.0039500000            | 253,164               |


