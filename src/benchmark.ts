import { HashMap } from './hash-map';

const size = 1000000;

function testHashMap(): void {
  console.log('Testing hash map set');
  let startTime = new Date().getTime();
  const hashMap = new HashMap<number, string>();

  for (let i = 0; i < size; i++) {
    hashMap.set(i, `value_${i}`);
  }

  let endTime = new Date().getTime();
  let totalTime = endTime - startTime;
  let fnTime = (totalTime / size).toFixed(10);
  let operations = Math.floor(1000 / totalTime * size);
  console.log(`Hash Map Set total: ${totalTime}ms, time: ${fnTime}, op/sec: ${operations}`);


  console.log('Testing hash map get');
  startTime = new Date().getTime();
  for (let i = 0; i < size; i++) {
    hashMap.get(i);
  }

  endTime = new Date().getTime();
  totalTime = endTime - startTime;
  fnTime = (totalTime / size).toFixed(10);
  operations = Math.floor(1000 / totalTime * size);
  console.log(`Hash Map get total: ${totalTime}ms, time: ${fnTime}, op/sec: ${operations}`);
}

function testMap(): void {
  console.log('Testing native map set');
  let startTime = new Date().getTime();
  const m = new Map<number, string>();

  for (let i = 0; i < size; i++) {
    m.set(i, `value_${i}`);
  }

  let endTime = new Date().getTime();
  let totalTime = endTime - startTime;
  let fnTime = (totalTime / size).toFixed(10);
  let operations = Math.floor(1000 / totalTime * size);
  console.log(`Native Map Set total: ${totalTime}ms, time: ${fnTime}, op/sec: ${operations}`);


  console.log('Testing native map get');
  startTime = new Date().getTime();
  for (let i = 0; i < size; i++) {
    m.get(i);
  }

  endTime = new Date().getTime();
  totalTime = endTime - startTime;
  fnTime = (totalTime / size).toFixed(10);
  operations = Math.floor(1000 / totalTime * size);
  console.log(`Native Map get total: ${totalTime}ms, time: ${fnTime}, op/sec: ${operations}`);
}

function runTests(): void {
  console.log('Running Tests....');
  testHashMap();
  testMap();
  console.log('Tests finished!');
}

runTests();
