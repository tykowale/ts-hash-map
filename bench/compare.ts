/**
 * Compares two sets of result files case by case.
 *
 *   npm run bench:compare -- base.json head.json
 *   npm run bench:compare -- --base b1.json,b2.json,b3.json --head h1.json,h2.json,h3.json
 *   npm run bench:compare -- --base ... --head ... --summary
 *
 * Several files per side (alternating runs) are compared run by run. Separate processes drift (CPU
 * clocks, thermal state, JIT and memory layout), and that drift moves every row of a run, the
 * native Map baseline included. So a row is judged on what the library can change:
 *
 * - A row with an in-process baseline (HashMap vs Map) is judged on its HashMap/baseline ratio.
 *   Each side's value is the geometric mean over its runs of median(row) / median(baseline), both
 *   from the same process, and the printed change is head / base. Its 95% CI comes from a joint
 *   two-level bootstrap (lib/stats.ts, sideReplicates): runs are resampled, then the row and its
 *   baseline are resampled together within each drawn run. The interval therefore includes the
 *   baseline's own noise and the spread between processes.
 * - A baseline row, or any other row that does not run library code (native Map variants,
 *   stringify), is never judged: that code does not differ between branches. It is printed as `drift` when it moved beyond the threshold, which says how much
 *   the two processes differed. Rows measured against a baseline that moved are marked `drift`
 *   too: even their ratio is unreliable then (re-run, or run more alternations).
 * - A row in a group without a baseline is judged on its per-run medians the same way.
 *
 * Verdicts:
 *   slower / faster  the whole CI lies beyond ±THRESHOLD (default 5%)
 *   overlap          the CI says changed, but the runs disagree: with 2+ runs per side, some
 *                    base run was as slow (or as fast) as some head run (per-run ratios for rows
 *                    with a baseline, per-run medians otherwise).
 *   noisy            either side's median has an RME above 5%; not judged
 *   drift            a baseline row moved beyond ±THRESHOLD (that row, and every row judged
 *                    against it); not judged
 *   ~                otherwise (no detectable change)
 *
 * --summary adds one objective for hill climbing: the geometric mean of the per-row change in
 * HashMap/baseline ratio over every library row with a baseline, with a bootstrap CI, the worst
 * single row, and a PASS / FAIL / INCONCLUSIVE line (see USAGE for the rule).
 *
 * Calibrate the threshold with an A/A run (base = head): any slower/faster verdict there is noise.
 */
import { readFileSync } from 'node:fs';
import { exitWithUsage, isHelp } from './lib/config.ts';
import { rngFor } from './lib/keys.ts';
import { NOISY_RME, type CaseRecord, type ResultFile } from './lib/report.ts';
import {
  changeInterval,
  formatChange,
  formatNs,
  formatRatio,
  geomeanInterval,
  type Interval,
  medianCI,
  medianReplicates,
  quantile,
  rme,
  type RunReplicates,
  sidePoint,
  sideReplicates,
} from './lib/stats.ts';

interface Args {
  base: string[];
  head: string[];
  threshold: number;
  all: boolean;
  failOnRegression: boolean;
  summary: boolean;
  accept: number;
  maxRegression: number;
}

const USAGE = `usage: npm run bench:compare -- base.json head.json
       npm run bench:compare -- --base a.json,b.json --head c.json,d.json [options]

Options:
  --base <files>          comma-separated result files for the base side (repeatable)
  --head <files>          comma-separated result files for the head side (repeatable)
  --threshold <pct>       change beyond which a row is judged slower/faster (default 5)
  --all                   print unchanged cases too
  --fail-on-regression    exit 1 when any row is slower
  --summary               print the hill-climbing summary: geomean of the per-row change in
                          HashMap/baseline ratio (library rows with a baseline), its bootstrap
                          95% CI, the worst row, and a verdict line
  --accept <pct>          summary PASS needs a geomean gain of at least this much, with the CI
                          entirely below 0 (default 2)
  --max-regression <pct>  summary FAIL when a row is SLOWER by more than this (default 3)
  -h, --help              print this help and exit

Summary verdict:
  FAIL          the geomean CI lies entirely above 0, or some row is SLOWER (runs agree) by more
                than --max-regression
  PASS          not FAIL, and the geomean improved by at least --accept with its CI below 0
  INCONCLUSIVE  otherwise`;

function parseArgs(argv: string[]): Args {
  if (isHelp(argv)) {
    exitWithUsage(USAGE);
  }
  const args: Args = {
    base: [],
    head: [],
    threshold: 5,
    all: false,
    failOnRegression: false,
    summary: false,
    accept: 2,
    maxRegression: 3,
  };
  const positional: string[] = [];
  const value = (i: number, flag: string): string => {
    const v = argv[i];
    if (v === undefined || v.startsWith('--')) {
      exitWithUsage(USAGE, `${flag} needs a value`);
    }
    return v;
  };
  const pct = (i: number, flag: string): number => {
    const n = Number(value(i, flag));
    if (!(n >= 0)) {
      exitWithUsage(USAGE, `${flag} must be a non-negative number`);
    }
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--base') {
      args.base.push(...value(++i, a).split(',').filter(Boolean));
    } else if (a === '--head') {
      args.head.push(...value(++i, a).split(',').filter(Boolean));
    } else if (a === '--threshold') {
      args.threshold = pct(++i, a);
    } else if (a === '--accept') {
      args.accept = pct(++i, a);
    } else if (a === '--max-regression') {
      args.maxRegression = pct(++i, a);
    } else if (a === '--all') {
      args.all = true;
    } else if (a === '--fail-on-regression') {
      args.failOnRegression = true;
    } else if (a === '--summary') {
      args.summary = true;
    } else if (a.startsWith('-')) {
      exitWithUsage(USAGE, `unknown flag: ${a}`);
    } else {
      positional.push(a);
    }
  }
  if (args.base.length === 0 && args.head.length === 0 && positional.length === 2) {
    args.base.push(positional[0]!);
    args.head.push(positional[1]!);
  } else if (positional.length > 0) {
    exitWithUsage(USAGE, `unexpected argument: ${positional[0]}`);
  }
  if (args.base.length === 0 || args.head.length === 0) {
    exitWithUsage(USAGE, 'need result files for both base and head');
  }
  return args;
}

interface Merged {
  rec: CaseRecord;
  /** Every run's samples, merged and sorted (for printing and the noise check). */
  samples: number[];
  /** Per-run sorted samples, keyed by the run's index on its side. */
  runs: Map<number, number[]>;
  /** Per-run ratios to the in-process baseline. */
  ratios: number[];
  /** Per-run medians. */
  medians: number[];
}

interface Side {
  name: 'base' | 'head';
  merged: Map<string, Merged>;
  meta: ResultFile[];
}

function load(name: Side['name'], files: string[]): Side {
  const merged = new Map<string, Merged>();
  const meta: ResultFile[] = [];
  files.forEach((f, run) => {
    const file = JSON.parse(readFileSync(f, 'utf8')) as ResultFile;
    meta.push(file);
    for (const rec of file.cases) {
      if (rec.error || rec.samples.length === 0) {
        continue;
      }
      const m: Merged = merged.get(rec.id) ?? {
        rec,
        samples: [],
        runs: new Map(),
        ratios: [],
        medians: [],
      };
      m.samples.push(...rec.samples);
      m.runs.set(
        run,
        rec.samples.toSorted((a, b) => a - b),
      );
      m.medians.push(rec.median);
      if (rec.ratio !== null) {
        m.ratios.push(rec.ratio);
      }
      merged.set(rec.id, m);
    }
  });
  for (const m of merged.values()) {
    m.samples.sort((a, b) => a - b);
  }
  return { name, merged, meta };
}

function describe(label: string, files: ResultFile[]): void {
  const f = files[0];
  if (!f) {
    return;
  }
  const sha = f.target.git.sha?.slice(0, 10) ?? '?';
  console.log(
    `${label}: ${files.length} run(s), ${f.target.git.branch ?? '?'} @ ${sha}${f.target.git.dirty ? ' (dirty)' : ''}` +
      `, ${f.env.node}, ${f.env.cpu}${f.config.preset ? `, preset ${f.config.preset}` : ''}` +
      (f.config.smoke ? ', SMOKE (numbers are meaningless)' : ''),
  );
}

/** JIT feedback carries over between groups, so only runs of the same selection are comparable. */
function selectionOf(f: ResultFile): string {
  const c = f.config;
  return JSON.stringify([c.smoke, c.timeMs, c.filter, c.sizes, c.preset ?? null]);
}

const args = parseArgs(process.argv.slice(2));
const base = load('base', args.base);
const head = load('head', args.head);
describe('base', base.meta);
describe('head', head.meta);
if (base.meta[0]?.env.node !== head.meta[0]?.env.node) {
  console.log('warning: base and head ran on different Node versions');
}
if (new Set([...base.meta, ...head.meta].map(selectionOf)).size > 1) {
  console.log(
    'warning: the runs used different --preset/--filter/--sizes/--time/--smoke settings; JIT ' +
      'state carries over between groups, so rows from different selections are not comparable',
  );
}

if (args.base.length < 2 || args.head.length < 2) {
  console.log(
    'note: with one run per side the CI only covers noise within a run; use 3+ alternating runs',
  );
}

const t = args.threshold / 100;
let regressions = 0;
let improvements = 0;
let noisy = 0;
let overlap = 0;
let drift = 0;
let same = 0;
const rows: string[] = [];
const ids = [...head.merged.keys()].filter((id) => base.merged.has(id));

function medianOf(values: number[]): number {
  return quantile(
    values.toSorted((x, y) => x - y),
    0.5,
  );
}

function baselineOf(m: Merged, side: Side): Merged | undefined {
  const { rec } = m;
  if (rec.baseline || rec.baselineImpl === null) {
    return undefined;
  }
  return side.merged.get(`${rec.family}/${rec.group}/${rec.baselineImpl}`);
}

/** Every head value beyond every base value, in the direction of the change (2+ runs a side). */
function runsAgree(bValues: number[], hValues: number[], slower: boolean): boolean {
  if (bValues.length < 2 || hValues.length < 2) {
    return true;
  }
  return slower
    ? Math.min(...hValues) > Math.max(...bValues)
    : Math.max(...hValues) < Math.min(...bValues);
}

// Bootstrap medians per (side, run, case), cached because a baseline serves every row of a group.
const replicateCache = new Map<string, Float64Array>();
function replicatesOf(side: Side, run: number, m: Merged): Float64Array {
  const key = `${side.name}:${run}:${m.rec.id}`;
  let reps = replicateCache.get(key);
  if (!reps) {
    reps = medianReplicates(m.runs.get(run)!, rngFor(key));
    replicateCache.set(key, reps);
  }
  return reps;
}

/** One side's runs of a row, paired with the same run's baseline when there is one. */
function sideRuns(
  side: Side,
  m: Merged,
  baseline: Merged | undefined,
): { reps: RunReplicates[]; point: number } | undefined {
  const reps: RunReplicates[] = [];
  const medians: Array<{ row: number; baseline?: number }> = [];
  for (const [run, samples] of m.runs) {
    const baseSamples = baseline?.runs.get(run);
    if (baseline && !baseSamples) {
      continue;
    }
    reps.push({
      row: replicatesOf(side, run, m),
      ...(baseline ? { baseline: replicatesOf(side, run, baseline) } : {}),
    });
    medians.push({
      row: quantile(samples, 0.5),
      ...(baseSamples ? { baseline: quantile(baseSamples, 0.5) } : {}),
    });
  }
  return reps.length > 0 ? { reps, point: sidePoint(medians) } : undefined;
}

/** head/base change of a row (relative to its baseline when given), with its bootstrap CI. */
function change(
  b: Merged,
  h: Merged,
  bBase: Merged | undefined,
  hBase: Merged | undefined,
): { ci: Interval; replicates: Float64Array } | undefined {
  const bs = sideRuns(base, b, bBase);
  const hs = sideRuns(head, h, hBase);
  if (!bs || !hs) {
    return undefined;
  }
  const rng = rngFor(`change:${h.rec.id}:${bBase ? 'ratio' : 'raw'}`);
  return changeInterval(
    hs.point / bs.point,
    sideReplicates(bs.reps, rng),
    sideReplicates(hs.reps, rng),
  );
}

/**
 * Rows that run library code. The others (native Map variants, stringify) are the same code on
 * both branches, so like baselines they are never judged, only checked for drift.
 */
const LIBRARY_ROW = /HashMap|getHashCode|isEqual/;

interface SummaryRow {
  id: string;
  ratio: number;
  replicates: Float64Array;
  ci: Interval;
  verdict: string;
}

const movedCache = new Map<string, boolean>();

/** True when a row's raw head/base CI lies wholly beyond ±threshold. */
function movedBeyond(b: Merged, h: Merged): boolean {
  let moved = movedCache.get(h.rec.id);
  if (moved === undefined) {
    const c = change(b, h, undefined, undefined);
    moved = c !== undefined && (c.ci.low > 1 + t || c.ci.high < 1 - t);
    movedCache.set(h.rec.id, moved);
  }
  return moved;
}

const summaryRows: SummaryRow[] = [];

for (const id of ids) {
  const b = base.merged.get(id)!;
  const h = head.merged.get(id)!;
  const bRme = rme(quantile(b.samples, 0.5), medianCI(b.samples));
  const hRme = rme(quantile(h.samples, 0.5), medianCI(h.samples));
  const bBase = baselineOf(b, base);
  const hBase = baselineOf(h, head);
  const ratioChange =
    bBase !== undefined && hBase !== undefined ? change(b, h, bBase, hBase) : undefined;
  const byRatio = ratioChange !== undefined;
  // The change to judge: the ratio-normalised one when the row has a baseline, else the raw one.
  const judged = ratioChange ?? change(b, h, undefined, undefined);
  if (!judged) {
    continue;
  }
  const { ci } = judged;
  let detail = '';
  let baselineMoved = false;
  if (byRatio) {
    baselineMoved = movedBeyond(bBase!, hBase!);
    const shift = quantile(hBase!.samples, 0.5) / quantile(bBase!.samples, 0.5);
    detail =
      `  vs ${h.rec.baselineImpl}: ${formatRatio(medianOf(b.ratios))} -> ${formatRatio(medianOf(h.ratios))}` +
      (baselineMoved ? ` (baseline moved ${formatRatio(shift)})` : '');
  }

  const native = h.rec.baseline || !LIBRARY_ROW.test(h.rec.impl);
  let verdict: string;
  if (native || baselineMoved) {
    // Baseline and native code is identical on both sides, so a baseline that moved means the
    // processes differed; neither it nor the rows measured against it get a slower/faster verdict.
    const moved = native ? movedBeyond(b, h) : true;
    verdict = moved ? 'drift' : '~';
    if (moved) {
      drift++;
    } else {
      same++;
    }
    if (native) {
      detail = h.rec.baseline ? '  (baseline: not judged)' : '  (native: not judged)';
    }
  } else if (bRme > NOISY_RME || hRme > NOISY_RME) {
    verdict = 'noisy';
    noisy++;
  } else if (ci.low > 1 + t || ci.high < 1 - t) {
    const slower = ci.low > 1 + t;
    const agree = byRatio
      ? runsAgree(b.ratios, h.ratios, slower)
      : runsAgree(b.medians, h.medians, slower);
    if (!agree) {
      verdict = 'overlap';
      overlap++;
    } else if (slower) {
      verdict = 'SLOWER';
      regressions++;
    } else {
      verdict = 'faster';
      improvements++;
    }
  } else {
    verdict = '~';
    same++;
  }
  if (byRatio && !native) {
    summaryRows.push({ id, ratio: ci.ratio, replicates: judged.replicates, ci, verdict });
  }
  if (!args.all && verdict === '~') {
    continue;
  }
  rows.push(
    `${verdict.padEnd(7)} ${formatRatio(ci.ratio).padStart(7)} [${formatRatio(ci.low)}, ${formatRatio(ci.high)}]` +
      `  ${formatNs(quantile(b.samples, 0.5)).padStart(10)} -> ${formatNs(quantile(h.samples, 0.5)).padStart(10)}` +
      `  ${id}${detail}`,
  );
}

console.log(
  `\nhead/base change with bootstrap 95% CI, judged beyond ±${args.threshold}%. Rows with a baseline` +
    ' are judged on their ratio to it; baseline rows are not judged (drift = moved beyond threshold).\n',
);
for (const r of rows) {
  console.log(r);
}
const onlyBase = [...base.merged.keys()].filter((id) => !head.merged.has(id)).length;
const onlyHead = [...head.merged.keys()].filter((id) => !base.merged.has(id)).length;
console.log(
  `\n${ids.length} cases compared: ${regressions} slower, ${improvements} faster, ${overlap} overlap, ${noisy} noisy, ${drift} baseline drift, ${same} unchanged` +
    (onlyBase || onlyHead ? ` (${onlyBase} only in base, ${onlyHead} only in head)` : ''),
);

function range(ci: Interval): string {
  return `[${formatChange(ci.low)}, ${formatChange(ci.high)}]`;
}

function printSummary(): void {
  if (summaryRows.length === 0) {
    console.log('\nsummary: no library rows with a baseline in both base and head');
    return;
  }
  const geo = geomeanInterval(summaryRows);
  const worst = summaryRows.reduce((w, r) => (r.ratio > w.ratio ? r : w));
  const best = summaryRows.reduce((w, r) => (r.ratio < w.ratio ? r : w));
  const count = (v: string): number => summaryRows.filter((r) => r.verdict === v).length;
  const bigRegressions = summaryRows.filter(
    (r) => r.verdict === 'SLOWER' && r.ratio > 1 + args.maxRegression / 100,
  );

  const reasons: string[] = [];
  let verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE';
  if (geo.low > 1 || bigRegressions.length > 0) {
    verdict = 'FAIL';
    if (geo.low > 1) {
      reasons.push('geomean CI entirely above 0');
    }
    if (bigRegressions.length > 0) {
      reasons.push(`${bigRegressions.length} row(s) SLOWER by > ${args.maxRegression}%`);
    }
  } else if (geo.high < 1 && geo.ratio <= 1 - args.accept / 100) {
    verdict = 'PASS';
    reasons.push(
      `geomean ${formatChange(geo.ratio)} <= -${args.accept}% with CI below 0, ` +
        `no row SLOWER by > ${args.maxRegression}%`,
    );
  } else {
    verdict = 'INCONCLUSIVE';
    reasons.push(
      geo.high >= 1
        ? 'geomean CI includes 0'
        : `geomean gain smaller than ${args.accept}% (--accept)`,
    );
  }

  console.log(
    `\nsummary over ${summaryRows.length} library rows (change in HashMap/baseline ratio, head vs base, joint bootstrap 95% CI):`,
  );
  console.log(`  geomean  ${formatChange(geo.ratio).padStart(7)} ${range(geo)}`);
  console.log(
    `  worst    ${formatChange(worst.ratio).padStart(7)} ${range(worst.ci)}  ${worst.verdict}  ${worst.id}`,
  );
  console.log(
    `  best     ${formatChange(best.ratio).padStart(7)} ${range(best.ci)}  ${best.verdict}  ${best.id}`,
  );
  for (const r of bigRegressions) {
    console.log(`  SLOWER   ${formatChange(r.ratio).padStart(7)} ${range(r.ci)}  ${r.id}`);
  }
  console.log(
    `  rows     ${count('SLOWER')} slower, ${count('faster')} faster, ${count('overlap')} overlap, ` +
      `${count('noisy')} noisy, ${count('drift')} drift, threshold ±${args.threshold}%` +
      `, ${Math.min(base.meta.length, head.meta.length)} run(s) per side`,
  );
  // One line, easy to paste into a commit message or grep from a log.
  console.log(
    `\n${verdict}: geomean ${formatChange(geo.ratio)} ${range(geo)} over ${summaryRows.length} rows; ` +
      `worst ${formatChange(worst.ratio)} ${worst.id}; ${count('SLOWER')} slower, ${count('faster')} faster` +
      ` (${reasons.join('; ')})`,
  );
}

if (args.summary) {
  printSummary();
}
if (args.failOnRegression && regressions > 0) {
  process.exit(1);
}
