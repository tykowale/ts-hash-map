/**
 * Retained heap per entry, measured in fresh processes (one per sample) so nothing else lives in
 * the heap. Time benchmarks miss memory entirely; this is the companion number.
 *
 *   npm run bench:memory                         # 1k, 10k, 100k entries, 5 processes each
 *   npm run bench:memory -- --sizes 1000,1000000 --reps 3 --out bench/results/memory.json
 *
 * Per sample: gc() twice, read heapUsed, build the map (keys are created inside the window, so
 * whatever the map keeps alive, keys included, is counted), gc() twice, read again. Then delete
 * half the entries and measure again: the table never shrinks, so bytes per *live* entry rises.
 * Values are small integers (no heap cost) so the numbers are the per-entry overhead plus keys.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import stringify from 'fast-json-stable-stringify';
import {
  CONFIG_USAGE,
  checkArgs,
  config,
  exitWithUsage,
  isHelp,
  parseConfig,
  sizes,
} from './lib/config.ts';
import { rngFor, smallInts, tuples, users, uuids } from './lib/keys.ts';
import { environment, gitInfo } from './lib/report.ts';
import { quantile, formatRatio } from './lib/stats.ts';
import { HashMap } from './lib/target.ts';

const KEY_TYPES = ['int', 'uuid', 'user-record', 'tuple'] as const;
type KeyType = (typeof KEY_TYPES)[number];
const STRUCTURAL = new Set<KeyType>(['user-record', 'tuple']);
type ImplName = 'Map' | 'Map + stable-stringify' | 'HashMap';

interface Sample {
  bytesPerEntry: number;
  bytesPerLiveAfterHalfDeleted: number;
}

function keysFor(type: KeyType, n: number): unknown[] {
  const rng = rngFor(`memory:${type}:${n}`);
  switch (type) {
    case 'int':
      return smallInts(n, rng).keys;
    case 'uuid':
      return uuids(n, rng).keys;
    case 'user-record':
      return users(n, rng).keys;
    default:
      return tuples(n, rng).keys;
  }
}

function heapAfterGc(): number {
  globalThis.gc!();
  globalThis.gc!();
  return process.memoryUsage().heapUsed;
}

/** Runs inside a child process: one measurement, printed as JSON. */
function child(type: KeyType, impl: ImplName, n: number): void {
  const before = heapAfterGc();
  let map: Map<unknown, number> | HashMap<unknown, number>;
  {
    const keys = keysFor(type, n);
    if (impl === 'HashMap') {
      map = new HashMap<unknown, number>();
      keys.forEach((k, i) => map.set(k, i));
    } else if (impl === 'Map') {
      map = new Map<unknown, number>();
      keys.forEach((k, i) => map.set(k, i));
    } else {
      map = new Map<unknown, number>();
      keys.forEach((k, i) => map.set(stringify(k), i));
    }
  }
  const after = heapAfterGc();

  // Delete the oldest half, using the map's own keys so identity maps work too.
  {
    const victims: unknown[] = [];
    for (const k of map.keys()) {
      if (victims.length >= n / 2) {
        break;
      }
      victims.push(k);
    }
    for (const k of victims) {
      map.delete(k);
    }
  }
  const afterDelete = heapAfterGc();
  const result: Sample = {
    bytesPerEntry: (after - before) / n,
    bytesPerLiveAfterHalfDeleted: (afterDelete - before) / map.size,
  };
  console.log(JSON.stringify(result));
}

function median(xs: number[]): number {
  return quantile(
    xs.toSorted((a, b) => a - b),
    0.5,
  );
}

function parent(): void {
  let reps = config.smoke ? 1 : 5;
  const argv = process.argv.slice(2);
  const { rest } = parseConfig(argv);
  const leftover: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--reps') {
      reps = Number(rest[++i]);
      if (!Number.isInteger(reps) || reps < 1) {
        exitWithUsage(USAGE, '--reps must be a positive integer');
      }
    } else {
      leftover.push(rest[i]!);
    }
  }
  checkArgs(argv, leftover, USAGE);
  const ns = sizes([1_000, 10_000, 100_000], [1_000]);
  const rows: Array<{
    type: KeyType;
    impl: ImplName;
    n: number;
    bytesPerEntry: number;
    bytesPerLiveAfterHalfDeleted: number;
    samples: Sample[];
  }> = [];
  console.log(
    `memory: retained heap per entry, median of ${reps} fresh processes, ${process.version}`,
  );

  for (const type of KEY_TYPES) {
    const impls: ImplName[] = STRUCTURAL.has(type)
      ? ['Map + stable-stringify', 'HashMap', 'Map']
      : ['Map', 'HashMap'];
    for (const n of ns) {
      console.log(`\n• ${type} n=${n}`);
      console.log(
        `  ${''.padEnd(26)}${'bytes/entry'.padStart(12)}${'after delete ½'.padStart(16)}  vs ${impls[0]}`,
      );
      let ref = Number.NaN;
      for (const impl of impls) {
        const samples: Sample[] = [];
        for (let r = 0; r < reps; r++) {
          const res = spawnSync(
            process.execPath,
            [
              '--expose-gc',
              '--import',
              'tsx',
              import.meta.filename,
              '--child',
              type,
              impl,
              String(n),
            ],
            {
              encoding: 'utf8',
              env: { ...process.env, BENCH_ROOT: config.root, BENCH_DIST: config.dist ? '1' : '' },
            },
          );
          if (res.status !== 0) {
            throw new Error(`memory child failed: ${res.stderr}`);
          }
          samples.push(JSON.parse(res.stdout.trim().split('\n').at(-1)!) as Sample);
        }
        const bytesPerEntry = median(samples.map((s) => s.bytesPerEntry));
        const after = median(samples.map((s) => s.bytesPerLiveAfterHalfDeleted));
        if (Number.isNaN(ref)) {
          ref = bytesPerEntry;
        }
        const label = impl === 'Map' && STRUCTURAL.has(type) ? 'Map (identity, not equiv.)' : impl;
        console.log(
          `  ${label.padEnd(26)}${bytesPerEntry.toFixed(1).padStart(12)}${after.toFixed(1).padStart(16)}` +
            `  ${impl === impls[0] ? 'baseline' : formatRatio(bytesPerEntry / ref)}`,
        );
        rows.push({ type, impl, n, bytesPerEntry, bytesPerLiveAfterHalfDeleted: after, samples });
      }
    }
  }

  if (config.out) {
    mkdirSync(dirname(config.out), { recursive: true });
    writeFileSync(
      config.out,
      `${JSON.stringify({ schema: 'ts-hash-map-memory/1', createdAt: new Date().toISOString(), target: { root: config.root, dist: config.dist, git: gitInfo(config.root) }, env: environment(), reps, rows }, null, 1)}\n`,
    );
    console.log(`\nwrote ${config.out}`);
  }
}

const USAGE = `usage: npm run bench:memory -- [options]

Retained heap per entry, measured in fresh processes.

Memory options:
  --reps <n>         processes per measurement (default 5, 1 with --smoke)

${CONFIG_USAGE}

--filter and --time do not apply here.`;

const childAt = process.argv.indexOf('--child');
if (childAt < 0 && isHelp(process.argv.slice(2))) {
  exitWithUsage(USAGE);
}
if (typeof globalThis.gc !== 'function') {
  throw new Error('run with node --expose-gc (npm run bench:memory does this)');
}
if (childAt >= 0) {
  const [type, impl, n] = process.argv.slice(childAt + 1);
  child(type as KeyType, impl as ImplName, Number(n));
} else {
  parent();
}
