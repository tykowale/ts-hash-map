/**
 * Compares two sets of result files case by case.
 *
 *   npm run bench:compare -- base.json head.json
 *   npm run bench:compare -- --base b1.json,b2.json,b3.json --head h1.json,h2.json,h3.json
 *
 * Several files per side (alternating runs) are merged per case. Separate processes drift (CPU
 * clocks, thermal state, JIT and memory layout), and that drift moves every row of a run, the
 * native Map baseline included. So a row is judged on what the library can change:
 *
 * - A row with an in-process baseline (HashMap vs Map) is judged on its HashMap/baseline ratio.
 *   The printed change is median(head ratios) / median(base ratios), with the raw bootstrap 95% CI
 *   of head/base medians divided by how far the baseline itself moved.
 * - A baseline row (native Map, stringify, ...) is never judged: that code does not differ between
 *   branches. It is printed as `drift` when it moved beyond the threshold, which says how much
 *   the two processes differed. Rows measured against a baseline that moved are marked `drift`
 *   too: even their ratio is unreliable then (re-run, or run more alternations).
 * - A row in a group without a baseline is judged on its raw head/base medians.
 *
 * Verdicts:
 *   slower / faster  the whole CI lies beyond ±THRESHOLD (default 5%)
 *   overlap          the CI says changed, but the runs disagree: with 2+ runs per side, some
 *                    base run was as slow (or as fast) as some head run (per-run ratios for rows
 *                    with a baseline, per-run medians otherwise). The CI only reflects noise
 *                    within runs, not between processes.
 *   noisy            either side's median has an RME above 5%; not judged
 *   drift            a baseline row moved beyond ±THRESHOLD (that row, and every row judged
 *                    against it); not judged
 *   ~                otherwise (no detectable change)
 *
 * Calibrate the threshold with an A/A run (base = head): any slower/faster verdict there is noise.
 *
 * Flags: --threshold <pct>, --all (print unchanged cases too), --fail-on-regression.
 */
import { readFileSync } from 'node:fs';
import { exitWithUsage, isHelp } from './lib/config.ts';
import { NOISY_RME, type CaseRecord, type ResultFile } from './lib/report.ts';
import { bootstrapRatioCI, formatNs, formatRatio, medianCI, quantile, rme } from './lib/stats.ts';

interface Args {
  base: string[];
  head: string[];
  threshold: number;
  all: boolean;
  failOnRegression: boolean;
}

const USAGE = `usage: npm run bench:compare -- base.json head.json
       npm run bench:compare -- --base a.json,b.json --head c.json,d.json [options]

Options:
  --base <files>        comma-separated result files for the base side (repeatable)
  --head <files>        comma-separated result files for the head side (repeatable)
  --threshold <pct>     change beyond which a row is judged slower/faster (default 5)
  --all                 print unchanged cases too
  --fail-on-regression  exit 1 when any row is slower
  -h, --help            print this help and exit`;

function parseArgs(argv: string[]): Args {
  if (isHelp(argv)) {
    exitWithUsage(USAGE);
  }
  const args: Args = { base: [], head: [], threshold: 5, all: false, failOnRegression: false };
  const positional: string[] = [];
  const value = (i: number, flag: string): string => {
    const v = argv[i];
    if (v === undefined || v.startsWith('--')) {
      exitWithUsage(USAGE, `${flag} needs a value`);
    }
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--base') {
      args.base.push(...value(++i, a).split(',').filter(Boolean));
    } else if (a === '--head') {
      args.head.push(...value(++i, a).split(',').filter(Boolean));
    } else if (a === '--threshold') {
      args.threshold = Number(value(++i, a));
      if (!(args.threshold >= 0)) {
        exitWithUsage(USAGE, '--threshold must be a non-negative number');
      }
    } else if (a === '--all') {
      args.all = true;
    } else if (a === '--fail-on-regression') {
      args.failOnRegression = true;
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
  samples: number[];
  /** Per-run ratios to the in-process baseline. */
  ratios: number[];
  /** Per-run medians. */
  medians: number[];
}

function load(files: string[]): { merged: Map<string, Merged>; meta: ResultFile[] } {
  const merged = new Map<string, Merged>();
  const meta: ResultFile[] = [];
  for (const f of files) {
    const file = JSON.parse(readFileSync(f, 'utf8')) as ResultFile;
    meta.push(file);
    for (const rec of file.cases) {
      if (rec.error || rec.samples.length === 0) {
        continue;
      }
      const m = merged.get(rec.id) ?? { rec, samples: [], ratios: [], medians: [] };
      m.samples.push(...rec.samples);
      m.medians.push(rec.median);
      if (rec.ratio !== null) {
        m.ratios.push(rec.ratio);
      }
      merged.set(rec.id, m);
    }
  }
  for (const m of merged.values()) {
    m.samples.sort((a, b) => a - b);
  }
  return { merged, meta };
}

function describe(label: string, files: ResultFile[]): void {
  const f = files[0];
  if (!f) {
    return;
  }
  const sha = f.target.git.sha?.slice(0, 10) ?? '?';
  console.log(
    `${label}: ${files.length} run(s), ${f.target.git.branch ?? '?'} @ ${sha}${f.target.git.dirty ? ' (dirty)' : ''}` +
      `, ${f.env.node}, ${f.env.cpu}${f.config.smoke ? ', SMOKE (numbers are meaningless)' : ''}`,
  );
}

const args = parseArgs(process.argv.slice(2));
const base = load(args.base);
const head = load(args.head);
describe('base', base.meta);
describe('head', head.meta);
if (base.meta[0]?.env.node !== head.meta[0]?.env.node) {
  console.log('warning: base and head ran on different Node versions');
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

function baselineOf(m: Merged, side: Map<string, Merged>): Merged | undefined {
  const { rec } = m;
  if (rec.baseline || rec.baselineImpl === null) {
    return undefined;
  }
  return side.get(`${rec.family}/${rec.group}/${rec.baselineImpl}`);
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

const movedCache = new Map<string, boolean>();

/** True when a row's raw head/base CI lies wholly beyond ±threshold. */
function movedBeyond(b: Merged, h: Merged): boolean {
  let moved = movedCache.get(h.rec.id);
  if (moved === undefined) {
    const ci = bootstrapRatioCI(b.samples, h.samples);
    moved = ci.low > 1 + t || ci.high < 1 - t;
    movedCache.set(h.rec.id, moved);
  }
  return moved;
}

for (const id of ids) {
  const b = base.merged.get(id)!;
  const h = head.merged.get(id)!;
  const raw = bootstrapRatioCI(b.samples, h.samples);
  const bRme = rme(quantile(b.samples, 0.5), medianCI(b.samples));
  const hRme = rme(quantile(h.samples, 0.5), medianCI(h.samples));
  const bBase = baselineOf(b, base.merged);
  const hBase = baselineOf(h, head.merged);
  const byRatio =
    bBase !== undefined && hBase !== undefined && b.ratios.length > 0 && h.ratios.length > 0;

  // The change to judge: the ratio-normalised one when the row has a baseline, else the raw one.
  let ci = raw;
  let detail = '';
  let baselineMoved = false;
  if (byRatio) {
    const shift = quantile(hBase.samples, 0.5) / quantile(bBase.samples, 0.5);
    ci = { ratio: raw.ratio / shift, low: raw.low / shift, high: raw.high / shift };
    baselineMoved = movedBeyond(bBase, hBase);
    detail =
      `  vs ${h.rec.baselineImpl}: ${formatRatio(medianOf(b.ratios))} -> ${formatRatio(medianOf(h.ratios))}` +
      (baselineMoved ? ` (baseline moved ${formatRatio(shift)})` : '');
  }

  let verdict: string;
  if (h.rec.baseline || baselineMoved) {
    // Baseline code is identical on both sides, so a baseline that moved means the processes
    // differed; neither it nor the rows measured against it get a slower/faster verdict.
    const moved = h.rec.baseline ? movedBeyond(b, h) : true;
    verdict = moved ? 'drift' : '~';
    if (moved) {
      drift++;
    } else {
      same++;
    }
    if (h.rec.baseline) {
      detail = '  (baseline: not judged)';
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
if (args.failOnRegression && regressions > 0) {
  process.exit(1);
}
