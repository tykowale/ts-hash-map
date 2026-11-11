/**
 * Turns mitata stats into per-op numbers, prints tables, and writes stripped JSON (no generated
 * `debug` source, samples thinned to quantiles) that compare.ts can read.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname } from 'node:path';
import type { measure } from 'mitata';
import { config } from './config.ts';
import type { CaseDef } from './harness.ts';
import { formatBytes, formatNs, formatRatio, medianCI, quantile, rme, thin } from './stats.ts';

type Stats = Awaited<ReturnType<typeof measure>>;

export const SCHEMA = 'ts-hash-map-bench/1';
/** Cases whose median has a relative margin of error above this are flagged as unreliable. */
export const NOISY_RME = 5;
const KEEP_SAMPLES = 200;

export interface CaseResult {
  def: CaseDef;
  stats: Stats | undefined;
  error: string | undefined;
}

export interface GroupResult {
  id: string;
  name: string;
  n: number | undefined;
  series: string | undefined;
  info: string | undefined;
  cases: CaseResult[];
}

/** One measured case as stored in JSON. All times are nanoseconds per op. */
export interface CaseRecord {
  id: string;
  family: string;
  group: string;
  impl: string;
  n: number | null;
  series: string | null;
  baseline: boolean;
  baselineImpl: string | null;
  note: string | null;
  ops: number;
  error: string | null;
  median: number;
  ciLow: number;
  ciHigh: number;
  rme: number;
  p75: number;
  p99: number;
  avg: number;
  min: number;
  max: number;
  /** Number of timed samples (each may be a batch of calls). */
  sampleCount: number;
  /** Number of calls measured. */
  ticks: number;
  heapBytesPerOp: number | null;
  /** median / baseline median in the same group, same process. */
  ratio: number | null;
  /** Up to 200 evenly spaced quantiles of the per-op samples, sorted. */
  samples: number[];
}

export interface ResultFile {
  schema: string;
  createdAt: string;
  target: { root: string; dist: boolean; git: GitInfo };
  env: { node: string; v8: string; platform: string; arch: string; cpu: string };
  config: { smoke: boolean; timeMs: number; filter: string | null; sizes: number[] | null };
  families: Array<{ family: string; durationMs: number; noopNs: number }>;
  cases: CaseRecord[];
}

export interface GitInfo {
  sha: string | null;
  branch: string | null;
  dirty: boolean | null;
}

export function gitInfo(root: string): GitInfo {
  const git = (...args: string[]): string | null => {
    try {
      return execFileSync('git', ['-C', root, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return null;
    }
  };
  const status = git('status', '--porcelain', '--untracked-files=no');
  return {
    sha: git('rev-parse', 'HEAD'),
    branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
    dirty: status === null ? null : status.length > 0,
  };
}

export function environment(): ResultFile['env'] {
  return {
    node: process.version,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    cpu: cpus()[0]?.model ?? 'unknown',
  };
}

function perOp(c: CaseResult): number[] {
  const ops = c.def.ops;
  return c.stats ? c.stats.samples.map((s) => s / ops) : [];
}

function toRecord(
  family: string,
  g: GroupResult,
  c: CaseResult,
  base: CaseResult | undefined,
): CaseRecord {
  const samples = perOp(c);
  const median = quantile(samples, 0.5);
  const ci = medianCI(samples);
  const baseMedian = base?.stats ? quantile(perOp(base), 0.5) : Number.NaN;
  const heap = c.stats?.heap;
  return {
    id: `${g.id}/${c.def.impl}`,
    family,
    group: g.name,
    impl: c.def.impl,
    n: g.n ?? null,
    series: g.series ?? null,
    baseline: c.def.baseline === true,
    baselineImpl: base?.def.impl ?? null,
    note: c.def.note ?? null,
    ops: c.def.ops,
    error: c.error ?? null,
    median,
    ciLow: ci.low,
    ciHigh: ci.high,
    rme: rme(median, ci),
    p75: quantile(samples, 0.75),
    p99: quantile(samples, 0.99),
    avg: c.stats ? c.stats.avg / c.def.ops : Number.NaN,
    min: samples[0] ?? Number.NaN,
    max: samples.at(-1) ?? Number.NaN,
    sampleCount: samples.length,
    ticks: c.stats?.ticks ?? 0,
    heapBytesPerOp: heap && Number.isFinite(heap.avg) ? heap.avg / c.def.ops : null,
    ratio: base && base !== c && Number.isFinite(baseMedian) ? median / baseMedian : null,
    samples: thin(samples, KEEP_SAMPLES),
  };
}

const records: CaseRecord[] = [];
let currentFamily = '';

export function setFamily(family: string): void {
  currentFamily = family;
}

function pad(s: string, w: number, left = false): string {
  return left ? s.padStart(w) : s.padEnd(w);
}

/** Prints one group's table and stores its records for the JSON file. */
export function printGroup(g: GroupResult): void {
  const base = g.cases.find((c) => c.def.baseline);
  const rows = g.cases.map((c) => toRecord(currentFamily, g, c, base));
  records.push(...rows);

  const implWidth = Math.max(24, ...rows.map((r) => r.impl.length + 2));
  const showHeap = rows.some((r) => r.heapBytesPerOp !== null);
  const vs = base ? `vs ${base.def.impl}` : '';
  console.log(`\n• ${g.id}`);
  if (g.info) {
    console.log(`  ${g.info}`);
  }
  console.log(
    (
      `  ${pad('', implWidth)}${pad('median/op', 11, true)}${pad('±95%', 8, true)}` +
      `${pad('p75', 11, true)}${pad('p99', 11, true)}${pad('samples', 9, true)}` +
      `${showHeap ? pad('heap/op', 10, true) : ''}  ${vs}`
    ).trimEnd(),
  );
  for (const r of rows) {
    if (r.error && r.sampleCount === 0) {
      console.log(`  ${pad(r.impl, implWidth)}error: ${r.error}`);
      continue;
    }
    const flags = [
      r.error ? `error: ${r.error}` : '',
      !config.smoke && r.rme > NOISY_RME ? `noisy (rme ${r.rme.toFixed(1)}%)` : '',
      r.note ?? '',
    ].filter(Boolean);
    const cells = [
      `  ${pad(r.impl, implWidth)}`,
      pad(formatNs(r.median), 11, true),
      pad(`${r.rme.toFixed(1)}%`, 8, true),
      pad(formatNs(r.p75), 11, true),
      pad(formatNs(r.p99), 11, true),
      pad(String(r.sampleCount), 9, true),
      showHeap
        ? pad(r.heapBytesPerOp === null ? '-' : formatBytes(r.heapBytesPerOp), 10, true)
        : '',
      `  ${pad(r.baseline ? 'baseline' : r.ratio === null ? '' : formatRatio(r.ratio), 9)}`,
      flags.length ? `  ${flags.join('; ')}` : '',
    ];
    console.log(cells.join('').trimEnd());
  }
}

/** Per-op growth between consecutive sizes of each series (adversarial and scaling groups). */
function printScaling(rows: CaseRecord[]): void {
  const series = new Map<string, CaseRecord[]>();
  for (const r of rows) {
    if (r.series !== null && r.n !== null && !r.error) {
      const key = `${r.series} | ${r.impl}`;
      series.set(key, [...(series.get(key) ?? []), r]);
    }
  }
  const multi = [...series].filter(([, rs]) => rs.length > 1);
  if (multi.length === 0) {
    return;
  }
  console.log('\n• scaling: per-op median by n (growth vs previous n; ~1x is O(1), ~Nx is O(n))');
  const width = Math.max(...multi.map(([k]) => k.length)) + 2;
  for (const [key, rs] of multi) {
    rs.sort((a, b) => a.n! - b.n!);
    const cells = rs.map((r, i) => {
      const prev = rs[i - 1];
      const growth = prev ? ` (${formatRatio(r.median / prev.median)})` : '';
      return `n=${r.n}: ${formatNs(r.median)}${growth}`;
    });
    console.log(`  ${pad(key, width)}${cells.join('   ')}`);
  }
}

/** Prints the family summary and writes JSON. Returns true if any case failed. */
export function finishFamily(
  family: string,
  groups: GroupResult[],
  noopNs: number,
  durationMs: number,
): boolean {
  const familyRecords = records.filter((r) => r.family === family);
  printScaling(familyRecords);

  const failures = familyRecords.filter((r) => r.error);
  const setupFailures = groups.filter((g) => g.cases.length === 0);
  const noisy = familyRecords.filter((r) => !r.error && r.rme > NOISY_RME);
  console.log(
    `\n${family}: ${familyRecords.length} cases in ${(durationMs / 1000).toFixed(1)}s` +
      (noisy.length && !config.smoke ? `, ${noisy.length} noisy (rme > ${NOISY_RME}%)` : '') +
      (failures.length + setupFailures.length
        ? `, ${failures.length + setupFailures.length} FAILED`
        : ''),
  );
  for (const f of failures) {
    console.log(`  ✗ ${f.id}: ${f.error}`);
  }

  if (config.out) {
    const file: ResultFile = {
      schema: SCHEMA,
      createdAt: new Date().toISOString(),
      target: { root: config.root, dist: config.dist, git: gitInfo(config.root) },
      env: environment(),
      config: {
        smoke: config.smoke,
        timeMs: config.timeMs,
        filter: config.filter?.source ?? null,
        sizes: config.sizes ?? null,
      },
      families: [{ family, durationMs, noopNs }],
      cases: familyRecords,
    };
    mkdirSync(dirname(config.out), { recursive: true });
    // JSON.stringify writes NaN as null, which is what readers expect for "no value".
    writeFileSync(config.out, `${JSON.stringify(file, null, 1)}\n`);
  }
  return failures.length + setupFailures.length > 0;
}
