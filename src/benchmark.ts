import { HashMap } from './hash-map';

const size = 1000000;
const keys = generateRandomKeys();
const results: any[] = [];

function getRandomInt(min: number, max: number): number {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateRandomKeys(): number[] {
  const keys: number[] = [];
  for (let i = 0; i < size; i++) {
    keys.push(getRandomInt(1, Number.MAX_SAFE_INTEGER));
  }
  return keys;
}

function benchmarkOperation(title: string, operation: () => void) {
  console.log(`Testing ${title}`);
  const startTime = new Date().getTime();
  operation();
  const endTime = new Date().getTime();
  const totalTime = endTime - startTime;
  const fnTime = (totalTime / size).toFixed(10);
  const operations = Math.floor(1000 / totalTime * size);
  results.push({
    Title: title,
    'Total Time (ms)': totalTime,
    'Time per Operation (ms)': fnTime,
    'Operations per Second': operations.toLocaleString(),
  });
}

function testHashMap(): void {
  const hashMap = new HashMap<number, string>();

  benchmarkOperation('hash map set', () => {
    keys.forEach(key => {
      hashMap.set(key, `value_${key}`);
    });
  });

  benchmarkOperation('hash map get', () => {
    keys.forEach(key => {
      hashMap.get(key);
    });
  });

  benchmarkOperation('hash map update', () => {
    keys.forEach(key => {
      hashMap.set(key, `new_value_${key}`);
    });
  });

  benchmarkOperation('hash map delete', () => {
    keys.forEach(key => {
      hashMap.delete(key);
    });
  });
}

function testMap(): void {
  const m = new Map<number, string>();

  benchmarkOperation('native map set', () => {
    keys.forEach(key => {
      m.set(key, `value_${key}`);
    });
  });

  benchmarkOperation('native map get', () => {
    keys.forEach(key => {
      m.get(key);
    });
  });

  benchmarkOperation('native map update', () => {
    keys.forEach(key => {
      m.set(key, `new_value_${key}`);
    });
  });

  benchmarkOperation('native map delete', () => {
    keys.forEach(key => {
      m.delete(key);
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
