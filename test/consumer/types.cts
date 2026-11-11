import tsHashMap = require('@tykowale/ts-hash-map');

const hashMap = new tsHashMap.HashMap<string, number>();
const asMap: Map<string, number> = hashMap;
const values: MapIterator<number> = asMap.values();

export = { values };
