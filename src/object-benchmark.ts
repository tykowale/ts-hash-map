import stringify from 'fast-json-stable-stringify';
import { v4 as uuidv4 } from 'uuid';
import { HashMap } from './hash-map';

const iterations = 10000;
const maxSize = 100;
const keys = generateFakeUserObject(maxSize);
const results: any[] = [];

type User = {
  id: string,
  name: string;
  username: string;
  email: string;
  someOtherField: string;
  permissions: string[];
  active: boolean;
}

function generateFakeUserObject(size: number): User[] {
  const res = [];

  for (let i = 0; i < size; i++) {
    const id = uuidv4();
    res.push({
      id,
      name: 'Ty Kowalewski',
      username: 'tykowale',
      email: 'ty@foobar.com',
      someOtherField: `${id} plus some stuff`,
      permissions: [
        'admin',
        'moderator',
      ],
      active: true,
    });
  }

  return res;
}

function benchmarkOperation(title: string, operation: () => void) {
  console.log(`Testing ${title}`);
  const startTime = new Date().getTime();
  operation();
  const endTime = new Date().getTime();
  const totalTime = endTime - startTime;
  const fnTime = (totalTime / (iterations * keys.length)).toFixed(10);
  const operations = Math.floor((iterations * keys.length) / (totalTime / 1000));
  results.push({
    Title: title,
    'Total Time (ms)': totalTime,
    'Time per Operation (ms)': fnTime,
    'Operations per Second': operations.toLocaleString(),
  });
}

function testHashMap(): void {
  const hashMapSet: HashMap<User, string>[] = [];
  const hashMapUpdate: HashMap<User, string>[] = [];
  const hashMapDelete: HashMap<User, string>[] = [];

  // Populate maps for set, update, and delete operations
  for (let i = 0; i < iterations; i++) {
    const mapSet = new HashMap<User, string>();
    const mapUpdate = new HashMap<User, string>();
    const mapDelete = new HashMap<User, string>();
    hashMapSet.push(mapSet);
    hashMapUpdate.push(mapUpdate);
    hashMapDelete.push(mapDelete);
    mapSet.set(keys[i], `value_${keys[i]}`);
    mapUpdate.set(keys[i], `value_${keys[i]}`);
    mapDelete.set(keys[i], `value_${keys[i]}`);
  }

  benchmarkOperation('hash map set', () => {
    hashMapSet.forEach(map => {
      keys.forEach(key => {
        map.set(key, `value_${key}`);
      });
    });
  });

  benchmarkOperation('hash map get', () => {
    hashMapSet.forEach(map => {
      keys.forEach(key => {
        map.get(key);
      });
    });
  });

  benchmarkOperation('hash map update', () => {
    hashMapUpdate.forEach(map => {
      keys.forEach(key => {
        map.set(key, `new_value_${key}`);
      });
    });
  });

  benchmarkOperation('hash map delete', () => {
    hashMapDelete.forEach(map => {
      keys.forEach(key => {
        map.delete(key);
      });
    });
  });
}

function testMap(): void {
  const mapSet: Map<string, string>[] = [];
  const mapUpdate: Map<string, string>[] = [];
  const mapDelete: Map<string, string>[] = [];

  // Populate maps for set, update, and delete operations
  for (let i = 0; i < iterations; i++) {
    const mapSetInstance = new Map<string, string>();
    const mapUpdateInstance = new Map<string, string>();
    const mapDeleteInstance = new Map<string, string>();
    mapSet.push(mapSetInstance);
    mapUpdate.push(mapUpdateInstance);
    mapDelete.push(mapDeleteInstance);
    mapSetInstance.set(stringify(keys[i]), `value_${keys[i]}`);
    mapUpdateInstance.set(stringify(keys[i]), `value_${keys[i]}`);
    mapDeleteInstance.set(stringify(keys[i]), `value_${keys[i]}`);
  }

  benchmarkOperation('native map set', () => {
    mapSet.forEach(map => {
      keys.forEach(key => {
        map.set(stringify(key), `value_${key}`);
      });
    });
  });

  benchmarkOperation('native map get', () => {
    mapSet.forEach(map => {
      keys.forEach(key => {
        map.get(stringify(key));
      });
    });
  });

  benchmarkOperation('native map update', () => {
    mapUpdate.forEach(map => {
      keys.forEach(key => {
        map.set(stringify(key), `new_value_${key}`);
      });
    });
  });

  benchmarkOperation('native map delete', () => {
    mapDelete.forEach(map => {
      keys.forEach(key => {
        map.delete(stringify(key));
      });
    });
  });
}


function runTests(): void {
  console.log('Running Tests....');
  testHashMap();
  testMap();
  console.log('Tests finished!');
  console.log('Benchmark Results:');
  console.table(results);
}

runTests();
