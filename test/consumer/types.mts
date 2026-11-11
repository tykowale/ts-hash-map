import { HashMap } from '@tykowale/ts-hash-map';

const hashMap = new HashMap<{ id: number }, string>();
const asMap: Map<{ id: number }, string> = hashMap;
const entries: MapIterator<[{ id: number }, string]> = asMap.entries();
const keys: MapIterator<{ id: number }> = hashMap.keys();
const values: MapIterator<string> = hashMap.values();

export { entries, keys, values };
