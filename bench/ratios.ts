/**
 * Ranks the library rows of one result file by how far they trail their in-process baseline, so
 * the worst rows (the best hill-climbing targets) come first.
 *
 *   npm run bench:ratios -- bench/results/latest.json
 *   npm run bench:ratios -- head.json --filter "n=1000$" --top 20
 *
 * Each row shows HashMap's median, the group's baseline and the HashMap/baseline ratio, plus the
 * fastest native Map row in the group when it is not the baseline (e.g. Map over same-instance
 * keys). Groups whose baseline is HashMap itself (adversarial) are left out unless --all. Output is
 * a Markdown table. With several files, each row's ratio is taken within each file (against that
 * file's own baseline) and the table shows the median over files.
 */
import { readFileSync } from 'node:fs';
import { exitWithUsage, isHelp } from './lib/config.ts';
import { SCHEMA, type CaseRecord, type ResultFile } from './lib/report.ts';
import { formatNs, formatRatio, quantile } from './lib/stats.ts';

const USAGE = `usage: npm run bench:ratios -- <result.json> [more.json ...] [options]

Prints every library row (HashMap, getHashCode, isEqual) that has an in-process baseline, worst
HashMap/baseline ratio first, as a Markdown table.

Options:
  --filter <regex>  only rows whose family/group/impl id matches (case-insensitive)
  --top <n>         only the first n rows
  --all             also include groups whose baseline is itself a library row (adversarial
                    collisions vs HashMap with good hashes)
  -h, --help        print this help and exit`;

/** Same rule as bench/compare.ts: rows that run library code. */
const LIBRARY_ROW = /HashMap|getHashCode|isEqual/;
/** Native rows that may be faster than the group's baseline. */
const NATIVE_ROW = /^(new )?Map\b/;

const argv = process.argv.slice(2);
if (isHelp(argv)) {
  exitWithUsage(USAGE);
}
const files: string[] = [];
let filter: RegExp | undefined;
let top = Infinity;
let all = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  const value = (): string => {
    const v = argv[++i];
    if (v === undefined || v.startsWith('--')) {
      exitWithUsage(USAGE, `${a} needs a value`);
    }
    return v;
  };
  if (a === '--filter') {
    filter = new RegExp(value(), 'i');
  } else if (a === '--top') {
    top = Number(value());
    if (!Number.isInteger(top) || top < 1) {
      exitWithUsage(USAGE, '--top must be a positive integer');
    }
  } else if (a === '--all') {
    all = true;
  } else if (a.startsWith('-')) {
    exitWithUsage(USAGE, `unknown flag: ${a}`);
  } else {
    files.push(a);
  }
}
if (files.length === 0) {
  exitWithUsage(USAGE, 'give at least one result file');
}

const median = (xs: number[]): number =>
  quantile(
    xs.toSorted((a, b) => a - b),
    0.5,
  );

/** One library row in one result file, divided by that file's own baseline (same process). */
interface Measure {
  hm: number;
  base: number;
  ratio: number;
  best: { impl: string; ratio: number } | undefined;
}

// Several files (e.g. alternating runs) are kept apart: each row is divided by the baseline from
// its own file, and the table shows the median over files per row.
const perRow = new Map<string, { baseImpl: string; measures: Measure[] }>();
for (const file of files) {
  const res = JSON.parse(readFileSync(file, 'utf8')) as ResultFile;
  if (res.schema !== SCHEMA) {
    exitWithUsage(USAGE, `${file}: expected schema ${SCHEMA}, got ${res.schema}`);
  }
  const byGroup = new Map<string, CaseRecord[]>();
  for (const c of res.cases) {
    if (c.error) {
      continue;
    }
    const g = `${c.family}/${c.group}`;
    const list = byGroup.get(g) ?? [];
    list.push(c);
    byGroup.set(g, list);
  }
  for (const [g, cs] of byGroup) {
    const base = cs.find((c) => c.baseline);
    if (!base || (!all && LIBRARY_ROW.test(base.impl))) {
      continue;
    }
    const best = cs
      .filter((c) => NATIVE_ROW.test(c.impl) && c !== base)
      .toSorted((a, b) => a.median - b.median)[0];
    for (const c of cs) {
      const id = `${g}/${c.impl}`;
      if (c.baseline || !LIBRARY_ROW.test(c.impl) || (filter && !filter.test(id))) {
        continue;
      }
      const entry = perRow.get(id) ?? { baseImpl: base.impl, measures: [] };
      entry.measures.push({
        hm: c.median,
        base: base.median,
        ratio: c.median / base.median,
        best:
          best && best.median < base.median
            ? { impl: best.impl, ratio: c.median / best.median }
            : undefined,
      });
      perRow.set(id, entry);
    }
  }
}

interface Row {
  id: string;
  baseImpl: string;
  hm: number;
  base: number;
  ratio: number;
  best: { impl: string; ratio: number } | undefined;
  runs: number;
}

const rows: Row[] = [...perRow].map(([id, { baseImpl, measures }]) => {
  const bests = measures.flatMap((m) => (m.best ? [m.best] : []));
  return {
    id,
    baseImpl,
    hm: median(measures.map((m) => m.hm)),
    base: median(measures.map((m) => m.base)),
    ratio: median(measures.map((m) => m.ratio)),
    // Shown when the faster native row beat the baseline in most files.
    best:
      bests.length * 2 > measures.length
        ? { impl: bests[0]!.impl, ratio: median(bests.map((b) => b.ratio)) }
        : undefined,
    runs: measures.length,
  };
});
rows.sort((a, b) => b.ratio - a.ratio);

const multi = files.length > 1;
const lines = [
  `| row | ns/op | baseline | baseline ns/op | ratio | faster native row |${multi ? ' files |' : ''}`,
  `|---|---|---|---|---|---|${multi ? '---|' : ''}`,
  ...rows
    .slice(0, top)
    .map(
      (r) =>
        `| ${r.id} | ${formatNs(r.hm)} | ${r.baseImpl} | ${formatNs(r.base)} | ` +
        `${formatRatio(r.ratio)} | ${r.best ? `${r.best.impl} ${formatRatio(r.best.ratio)}` : '-'} |` +
        (multi ? ` ${r.runs} |` : ''),
    ),
];
console.log(lines.join('\n'));
if (rows.length === 0) {
  console.error('no library rows with a baseline matched');
  process.exit(1);
}
