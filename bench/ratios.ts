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
 * a Markdown table.
 */
import { readFileSync } from 'node:fs';
import { exitWithUsage, isHelp } from './lib/config.ts';
import { SCHEMA, type CaseRecord, type ResultFile } from './lib/report.ts';
import { formatNs, formatRatio } from './lib/stats.ts';

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

const cases: CaseRecord[] = [];
for (const file of files) {
  const res = JSON.parse(readFileSync(file, 'utf8')) as ResultFile;
  if (res.schema !== SCHEMA) {
    exitWithUsage(USAGE, `${file}: expected schema ${SCHEMA}, got ${res.schema}`);
  }
  cases.push(...res.cases);
}

const byGroup = new Map<string, CaseRecord[]>();
for (const c of cases) {
  if (c.error) {
    continue;
  }
  const g = `${c.family}/${c.group}`;
  const list = byGroup.get(g) ?? [];
  list.push(c);
  byGroup.set(g, list);
}

interface Row {
  id: string;
  hm: CaseRecord;
  base: CaseRecord;
  ratio: number;
  best: CaseRecord | undefined;
}

const rows: Row[] = [];
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
    rows.push({
      id,
      hm: c,
      base,
      ratio: c.median / base.median,
      best: best && best.median < base.median ? best : undefined,
    });
  }
}
rows.sort((a, b) => b.ratio - a.ratio);

const lines = [
  '| row | ns/op | baseline | baseline ns/op | ratio | faster native row |',
  '|---|---|---|---|---|---|',
  ...rows
    .slice(0, top)
    .map(
      (r) =>
        `| ${r.id} | ${formatNs(r.hm.median)} | ${r.base.impl} | ${formatNs(r.base.median)} | ` +
        `${formatRatio(r.ratio)} | ${r.best ? `${r.best.impl} ${formatRatio(r.hm.median / r.best.median)}` : '-'} |`,
    ),
];
console.log(lines.join('\n'));
if (rows.length === 0) {
  console.error('no library rows with a baseline matched');
  process.exit(1);
}
