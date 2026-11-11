// Runtime smoke test of the built CommonJS entry, resolved through package.json "exports".
const assert = require('node:assert/strict');
const { HashMap } = require('@tykowale/ts-hash-map');

const map = new HashMap([[{ id: 1 }, 'one']]);
map.set({ id: 2 }, 'two');

assert.equal(map.get({ id: 1 }), 'one');
assert.equal(map.size, 2);
assert.ok(map instanceof HashMap);
assert.deepEqual([...map.values()], ['one', 'two']);
assert.deepEqual(
  map
    .keys()
    .map((key) => key.id)
    .toArray(),
  [1, 2],
);

console.log('cjs smoke ok');
