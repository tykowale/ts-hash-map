# TS Hash Map

## Introduction

The native Javascript map is an excellent map to use but runs into the issue of using referential equality, which makes
difficult if you want to consider using the key `{id: 1}` without maintaining the original reference. This uses a well
established pattern to efficiently create a `Map` using deep equality.

## Table of Contents

- [Usage](#usage)

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
