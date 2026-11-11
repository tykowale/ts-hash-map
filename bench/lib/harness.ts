/**
 * A thin wrapper over mitata's `measure()`. Scenario files register groups of cases (one HashMap
 * variant next to its native baselines); `runFamily()` measures them, verifies every case's result
 * outside the timed region, prints a table and optionally writes JSON.
 *
 * Why `measure()` and not mitata's `bench()/run()`: `run()` does not expose the time budget or
 * batch size, which smoke mode and fresh-state cases need. `measure()` is the same engine
 * (warmup, adaptive sample count, batching, inner GC, heap tracking) with those knobs exposed.
 */
import { getHeapStatistics } from 'node:v8';
import { measure } from 'mitata';
import { CONFIG_USAGE, checkArgs, config, parseConfig } from './config.ts';
import {
  finishFamily,
  printGroup,
  setFamily,
  type CaseResult,
  type GroupResult,
} from './report.ts';
import { doNotOptimize } from './sink.ts';

export interface CaseOptions {
  /** This row is the group's reference; every other row prints a ratio to it. */
  baseline?: boolean;
  /** Printed next to the row, e.g. "identity keys, not semantically equivalent". */
  note?: string;
  /**
   * Run a full GC before every sample (mitata's inner GC). Off everywhere by default: on Node 24 it
   * made allocation-heavy cases bimodal and up to 2-4x slower, and on large heaps it used up the
   * time budget (10-40 samples, RME > 10%). Without it, GC pauses that hit a sample show in p99.
   */
  gcInner?: boolean;
  /** Track heap bytes allocated per op (insert and construction cases). */
  heap?: boolean;
  /** Expected result of one call, if it differs from the group's `expect`. */
  expect?: unknown;
}

export interface CaseDef extends CaseOptions {
  impl: string;
  /** Logical operations per call; times are reported per op. */
  ops: number;
  /** Builds fresh state outside the timed region before every call (mitata computed params). */
  setup?: () => unknown;
  run: (state: unknown) => unknown;
}

export interface GroupBody {
  /** Every case must return this from one call; checked before and after measuring. */
  expect?: unknown;
  /** Extra line printed under the group header (e.g. bucket statistics). */
  info?: string;
  cases: CaseDef[];
}

interface GroupDef {
  name: string;
  n: number | undefined;
  series: string | undefined;
  build: () => GroupBody;
}

/** A case that times `run()` directly; state lives in the closure and must survive repeated calls. */
export function staticCase(
  impl: string,
  ops: number,
  run: () => unknown,
  options: CaseOptions = {},
): CaseDef {
  return { impl, ops, run, ...options };
}

/** A case whose state is rebuilt by `setup()` (untimed) before every timed `run(state)`. */
export function freshCase<S>(
  impl: string,
  ops: number,
  setup: () => S,
  run: (state: S) => unknown,
  options: CaseOptions = {},
): CaseDef {
  return { impl, ops, setup, run: (state) => run(state as S), ...options };
}

const groups: GroupDef[] = [];

/**
 * Registers a group. `build` runs only if the group passes `--filter`, right before it is measured,
 * so large inputs are created lazily and released before the next group.
 */
export function group(
  name: string,
  meta: { n?: number; series?: string },
  build: () => GroupBody,
): void {
  groups.push({ name, n: meta.n, series: meta.series, build });
}

function heapUsed(): number {
  const h = getHeapStatistics();
  return h.used_heap_size + h.malloced_memory;
}

function sameResult(a: unknown, b: unknown): boolean {
  return Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);
}

function verify(c: CaseDef, expected: unknown, when: string): void {
  if (expected === undefined) {
    return;
  }
  const actual = c.run(c.setup ? c.setup() : undefined);
  if (!sameResult(actual, expected)) {
    throw new Error(
      `verification failed ${when}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
    );
  }
}

async function measureCase(c: CaseDef): Promise<Awaited<ReturnType<typeof measure>>> {
  const options = {
    min_cpu_time: config.timeMs * 1e6,
    min_samples: config.smoke ? 2 : 12,
    inner_gc: c.gcInner === true,
    ...(c.heap ? { heap: heapUsed } : {}),
    // Fresh-state cases build one state per call; keep the batch small so a sample does not
    // hold thousands of prebuilt maps in memory.
    // Static cases already loop ~1024 ops per call, so 64 calls per batch is plenty and yields
    // hundreds of samples (tight CIs) instead of mitata's default 4096-call batches.
    batch_samples: c.setup ? 16 : 64,
  };
  const run = c.run;
  if (c.setup) {
    const setup = c.setup;
    // mitata's time budget counts only the timed region. When setup costs far more than the op
    // (clear() of a map that took 10x longer to build), cap the sample count so untimed setup
    // stays within ~4x the time budget.
    const t0 = performance.now();
    setup();
    const setupMs = Math.max(performance.now() - t0, 1e-3);
    const budgetMs = 4 * Math.max(config.timeMs, 25);
    const maxSamples = Math.max(options.min_samples, Math.floor(budgetMs / (setupMs * 16)));
    return measure(
      function* () {
        yield {
          [0]: setup,
          bench: (state: unknown) => doNotOptimize(run(state)),
        };
      },
      { ...options, max_samples: maxSamples },
    );
  }
  return measure(() => doNotOptimize(run(undefined)), options);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Measures every registered group of this family. Call once, at the end of a scenario file. */
export async function runFamily(family: string): Promise<void> {
  const argv = process.argv.slice(2);
  checkArgs(
    argv,
    parseConfig(argv).rest,
    `usage: node --expose-gc --import tsx bench/scenarios/${family}.ts [options]\n\n${CONFIG_USAGE}`,
  );
  if (typeof globalThis.gc !== 'function') {
    throw new Error('run benchmarks with node --expose-gc (npm run bench does this for you)');
  }
  setFamily(family);
  // Reference for mitata's "probably optimized out" rule (avg < 1.42x a no-op): the same wrapper a
  // static case runs, around an empty body, so a body V8 folded to a constant lands below it.
  const noop = await measureCase(staticCase('noop', 1, () => undefined));
  const results: GroupResult[] = [];
  const started = performance.now();

  for (const g of groups) {
    const id = `${family}/${g.name}`;
    if (config.filter && !config.filter.test(id)) {
      continue;
    }

    let body: GroupBody;
    try {
      body = g.build();
    } catch (err) {
      results.push({ id, name: g.name, n: g.n, series: g.series, info: undefined, cases: [] });
      console.error(`✗ ${id}: setup failed: ${errorMessage(err)}`);
      process.exitCode = 1;
      continue;
    }

    const cases: CaseResult[] = [];
    for (const c of body.cases) {
      const expected = c.expect ?? body.expect;
      try {
        verify(c, expected, 'before measuring');
        const stats = await measureCase(c);
        verify(c, expected, 'after measuring');
        const optimizedOut = stats.avg < 1.42 * noop.avg;
        cases.push({
          def: c,
          stats,
          error: optimizedOut ? 'probably optimized out (!)' : undefined,
        });
      } catch (err) {
        cases.push({ def: c, stats: undefined, error: errorMessage(err) });
      }
    }
    const result: GroupResult = {
      id,
      name: g.name,
      n: g.n,
      series: g.series,
      info: body.info,
      cases,
    };
    results.push(result);
    printGroup(result);
    globalThis.gc();
  }

  const failed = finishFamily(family, results, noop.avg, performance.now() - started);
  if (failed) {
    process.exitCode = 1;
  }
}
