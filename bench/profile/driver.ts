/**
 * The profiled child process: runs one workload for a fixed time and prints one result line.
 * bench/profile/run.ts starts it under `node --cpu-prof`; you can also run it by hand:
 *
 *   node --cpu-prof --import tsx bench/profile/driver.ts --workload user-record --n 1000 --op get-hit
 *
 * Flags: --workload <name> --n <n> --op <op> [--seconds 2.5] [--dist] [--root <dir>].
 * The result is printed on its own line after RESULT_PREFIX, so V8 tracing output on the same
 * stream (--trace-deopt) cannot break parsing.
 */
import { RESULT_PREFIX } from './cpuprofile.ts';
import { isOp, runTimed } from './workloads.ts';

const argv = process.argv.slice(2);
const get = (flag: string): string | undefined => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};

const workload = get('--workload') ?? 'int';
const n = Number(get('--n') ?? '1000');
const op = get('--op') ?? 'get-hit';
const seconds = Number(get('--seconds') ?? '2.5');
if (!isOp(op)) {
  throw new Error(`unknown op: ${op}`);
}
if (!Number.isInteger(n) || n < 1 || !(seconds > 0)) {
  throw new Error('--n must be a positive integer and --seconds a positive number');
}

const result = runTimed({ workload, n, op }, seconds);
console.log(`${RESULT_PREFIX}${JSON.stringify({ ...result, dist: argv.includes('--dist') })}`);
