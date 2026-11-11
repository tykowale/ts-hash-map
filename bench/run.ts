/**
 * Runs every scenario family (bench/scenarios/*.ts) in its own Node process, so JIT state and type
 * feedback from one family (e.g. string keys making getHashCode polymorphic) cannot leak into the
 * next. With --out, merges each family's JSON into one result file.
 *
 *   npm run bench                                  # all families, full sizes
 *   npm run bench -- --family int-keys,iteration   # a subset of families
 *   npm run bench -- --filter "get-hit n=1000$"    # groups whose family/group id matches
 *   npm run bench:smoke                            # tiny sizes, ~1ms per case, verifies everything
 *   npm run bench -- --out bench/results/head.json
 *   npm run bench -- --dist                        # benchmark the built dist/index.mjs
 *   npm run bench -- --preset hill                 # a named subset (bench/lib/presets.ts)
 *
 * Every other flag (--time, --sizes, --root) is forwarded to the family processes. --help lists
 * them; an unknown flag is an error.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { CONFIG_USAGE, checkArgs, exitWithUsage, isHelp, parseConfig } from './lib/config.ts';
import { PRESET_USAGE, presetArgs } from './lib/presets.ts';
import { environment, gitInfo, SCHEMA, type ResultFile } from './lib/report.ts';

const SCENARIO_DIR = join(import.meta.dirname, 'scenarios');

const USAGE = `usage: npm run bench -- [options]

Runs every scenario family (bench/scenarios/*.ts) in its own Node process.

Runner options:
  --family <a,b,...>  only run these families (see --list)
  --list              print the available families and exit
${PRESET_USAGE}

${CONFIG_USAGE}`;

const rawArgv = process.argv.slice(2);
if (isHelp(rawArgv)) {
  exitWithUsage(USAGE);
}

// --preset expands into --filter and --time placed before the user's own flags, so an explicit
// --time (or --sizes) still wins. It picks the families itself.
let preset: string | undefined;
let presetFamilies: string[] | undefined;
let argv = rawArgv;
const presetAt = rawArgv.indexOf('--preset');
if (presetAt >= 0) {
  const name = rawArgv[presetAt + 1];
  if (name === undefined || name.startsWith('-')) {
    exitWithUsage(USAGE, '--preset needs a value');
  }
  if (rawArgv.includes('--family') || rawArgv.includes('--filter')) {
    exitWithUsage(USAGE, '--preset cannot be combined with --family or --filter');
  }
  if (rawArgv.lastIndexOf('--preset') !== presetAt) {
    exitWithUsage(USAGE, '--preset can only be given once');
  }
  let expanded: ReturnType<typeof presetArgs>;
  try {
    expanded = presetArgs(name);
  } catch (err) {
    exitWithUsage(USAGE, (err as Error).message);
  }
  preset = name;
  presetFamilies = expanded.families;
  argv = [...expanded.args, ...rawArgv.toSpliced(presetAt, 2)];
}

// Shared flags are forwarded to every family process, except --out: the runner merges results
// itself, and each family writes to its own temp file.
const forward: string[] = [];
const leftover: string[] = [];
let wanted: string[] | undefined = presetFamilies;
let list = false;
let parsed: ReturnType<typeof parseConfig>;
try {
  parsed = parseConfig(argv);
} catch (err) {
  exitWithUsage(USAGE, (err as Error).message);
}
const { config, rest } = parsed;
for (let i = 0; i < rest.length; i++) {
  const arg = rest[i]!;
  if (arg === '--family') {
    const value = rest[++i];
    if (value === undefined || value.startsWith('-')) {
      exitWithUsage(USAGE, '--family needs a value');
    }
    wanted = value.split(',').filter(Boolean);
  } else if (arg === '--list') {
    list = true;
  } else {
    leftover.push(arg);
  }
}
checkArgs(argv, leftover, USAGE);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]!;
  if (arg === '--out' || arg === '--family') {
    i++;
  } else if (arg !== '--list') {
    forward.push(arg);
  }
}

const all = readdirSync(SCENARIO_DIR)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => basename(f, '.ts'))
  .sort();

if (list) {
  console.log(all.join('\n'));
  process.exit(0);
}

const unknown = (wanted ?? []).filter((f) => !all.includes(f));
if (unknown.length > 0) {
  console.error(`unknown family: ${unknown.join(', ')}; available: ${all.join(', ')}`);
  process.exit(2);
}
const families = wanted ?? all;

const tmp = mkdtempSync(join(tmpdir(), 'ts-hash-map-bench-'));
const merged: ResultFile = {
  schema: SCHEMA,
  createdAt: new Date().toISOString(),
  target: { root: config.root, dist: config.dist, git: gitInfo(config.root) },
  env: environment(),
  config: {
    smoke: config.smoke,
    timeMs: config.timeMs,
    filter: config.filter?.source ?? null,
    sizes: config.sizes ?? null,
    preset: preset ?? null,
  },
  families: [],
  cases: [],
};

const failed: string[] = [];
const started = performance.now();
console.log(
  `ts-hash-map bench: ${families.length} families${preset ? ` (preset ${preset})` : ''}, ` +
    `${config.smoke ? 'smoke' : 'full'} mode, ` +
    `${config.timeMs}ms/case, ${merged.env.node} ${merged.env.arch}, ${merged.env.cpu}` +
    `\ntarget: ${config.root}${config.dist ? ' (dist)' : ' (src)'} @ ${merged.target.git.sha?.slice(0, 10) ?? '?'}` +
    (merged.target.git.dirty ? ' (dirty)' : ''),
);

for (const family of families) {
  console.log(`\n=== ${family} ===`);
  const out = join(tmp, `${family}.json`);
  const child = spawnSync(
    process.execPath,
    [
      '--expose-gc',
      '--import',
      'tsx',
      join(SCENARIO_DIR, `${family}.ts`),
      ...forward,
      '--out',
      out,
    ],
    { stdio: 'inherit', env: { ...process.env, BENCH_ROOT: config.root } },
  );
  if (child.status !== 0) {
    failed.push(family);
  }
  try {
    const result = JSON.parse(readFileSync(out, 'utf8')) as ResultFile;
    merged.families.push(...result.families);
    merged.cases.push(...result.cases);
  } catch {
    failed.push(`${family} (no results)`);
  }
}
rmSync(tmp, { recursive: true, force: true });

if (config.out) {
  mkdirSync(dirname(config.out), { recursive: true });
  writeFileSync(config.out, `${JSON.stringify(merged, null, 1)}\n`);
  console.log(`\nwrote ${merged.cases.length} cases to ${config.out}`);
}

console.log(`\ndone in ${((performance.now() - started) / 1000).toFixed(1)}s`);
if (failed.length > 0) {
  console.error(`FAILED: ${[...new Set(failed)].join(', ')}`);
  process.exit(1);
}
