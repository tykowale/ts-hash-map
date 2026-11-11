/**
 * Benchmarks this checkout against another branch, then runs compare.ts.
 *
 *   npm run bench:branches -- --base v2 --runs 3 --family int-keys,object-keys
 *
 * 1. Checks out <base> (default: origin/v2, else v2) as a detached git worktree in ../ts-hash-map-bench-base.
 * 2. Runs THIS checkout's scenarios against each library in turn: base, head, base, head, ...
 *    (--runs times each), every run in fresh processes. Alternating spreads thermal and background
 *    drift evenly instead of giving it all to whichever side ran second. Using one copy of the
 *    scenarios for both sides means a change to the benchmarks cannot masquerade as a library
 *    change.
 * 3. Merges each side's runs and prints head/base ratios with bootstrap CIs.
 *
 * The library has no runtime dependencies and the scenarios import the target's src/ directly,
 * so the worktree needs no npm install (unless you pass --dist, which builds both sides).
 * Any other flag (--family, --filter, --preset, --large, --time, --sizes, --dist, --smoke) is passed to
 * bench/run.ts; --threshold, --summary, --accept, --max-regression, --target and
 * --fail-on-regression are passed to compare.ts. --help lists them, and an
 * unknown flag is an error.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CONFIG_USAGE, checkArgs, exitWithUsage, isHelp, parseConfig } from './lib/config.ts';
import { PRESET_USAGE, getPreset } from './lib/presets.ts';

const REPO = resolve(import.meta.dirname, '..');
const USAGE = `usage: npm run bench:branches -- [options]

Benchmarks this checkout against another branch (alternating runs), then runs compare.ts.

Branch options:
  --base <ref>        git ref to compare against (default: origin/v2, else v2)
  --runs <n>          runs per side, alternating base and head (default 3)
  --worktree <dir>    where to check out the base (default ../ts-hash-map-bench-base)
  --family <a,b,...>  only run these families
  --large             also run the opt-in large tier
${PRESET_USAGE}

Compare options (passed to bench:compare):
  --threshold <pct>   change beyond which a row is judged slower/faster (default 5)
  --summary           print the geomean summary line (see bench:compare --help)
  --accept <pct>      summary PASS needs a geomean gain of at least this much (default 2)
  --max-regression <pct>
                      summary FAIL threshold for a single row (default 3)
  --target <regex>    summary PASS also needs a matching row to be faster
  --fail-on-regression
                      exit 1 when any row is SLOWER

${CONFIG_USAGE}

--root and --out are set per run by this script and cannot be passed.`;

const argv = process.argv.slice(2);
if (isHelp(argv)) {
  exitWithUsage(USAGE);
}
let baseRef: string | undefined;
let runs = 3;
let worktree = resolve(REPO, '..', 'ts-hash-map-bench-base');
const forward: string[] = [];
const compareArgs: string[] = [];
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
    baseRef = value(++i, a);
  } else if (a === '--runs') {
    runs = Number(value(++i, a));
  } else if (a === '--worktree') {
    worktree = resolve(value(++i, a));
  } else if (
    a === '--threshold' ||
    a === '--accept' ||
    a === '--max-regression' ||
    a === '--target'
  ) {
    compareArgs.push(a, value(++i, a));
  } else if (a === '--summary' || a === '--fail-on-regression') {
    compareArgs.push(a);
  } else if (a === '--root' || a === '--out') {
    exitWithUsage(USAGE, `${a} is set by bench:branches itself`);
  } else {
    forward.push(a);
  }
}
// Everything else goes to bench/run.ts: the shared flags plus --family.
const leftover: string[] = [];
const { rest } = parseConfig(forward);
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === '--family' || rest[i] === '--preset') {
    const flag = rest[i]!;
    const v = rest[++i];
    if (v === undefined || v.startsWith('-')) {
      exitWithUsage(USAGE, `${flag} needs a value`);
    }
    if (flag === '--preset') {
      try {
        getPreset(v);
      } catch (err) {
        exitWithUsage(USAGE, (err as Error).message);
      }
    }
  } else if (rest[i] !== '--large') {
    leftover.push(rest[i]!);
  }
}
checkArgs(argv, leftover, USAGE);
if (!Number.isInteger(runs) || runs < 1) {
  exitWithUsage(USAGE, '--runs must be a positive integer');
}

const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();

const resolveRef = (ref: string): string | undefined => {
  try {
    return git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`);
  } catch {
    return undefined;
  }
};
// Default to the remote v2 so a stale local branch is not benchmarked by accident.
baseRef ??= resolveRef('origin/v2') ? 'origin/v2' : 'v2';
const baseSha = resolveRef(baseRef);
if (!baseSha) {
  throw new Error(`unknown base ref: ${baseRef}`);
}
if (existsSync(worktree)) {
  execFileSync('git', ['-C', worktree, 'checkout', '--quiet', '--detach', baseSha], {
    stdio: 'inherit',
  });
} else {
  git('worktree', 'add', '--detach', worktree, baseSha);
}
console.log(`base: ${baseRef} @ ${baseSha.slice(0, 10)} in ${worktree}\nhead: ${REPO}`);

if (forward.includes('--dist')) {
  for (const dir of [worktree, REPO]) {
    if (!existsSync(join(dir, 'node_modules'))) {
      execFileSync('npm', ['ci'], { cwd: dir, stdio: 'inherit' });
    }
    execFileSync('npm', ['run', 'build'], { cwd: dir, stdio: 'inherit' });
  }
}

const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
const outDir = join(REPO, 'bench', 'results', `branches-${stamp}`);
mkdirSync(outDir, { recursive: true });
const files = { base: [] as string[], head: [] as string[] };

for (let r = 1; r <= runs; r++) {
  for (const side of ['base', 'head'] as const) {
    const out = join(outDir, `${side}-${r}.json`);
    console.log(`\n##### run ${r}/${runs}: ${side} #####`);
    const child = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        join(REPO, 'bench', 'run.ts'),
        ...forward,
        '--root',
        side === 'base' ? worktree : REPO,
        '--out',
        out,
      ],
      { stdio: 'inherit' },
    );
    if (child.status !== 0) {
      console.error(`${side} run ${r} failed (exit ${child.status}); continuing`);
    }
    if (existsSync(out)) {
      files[side].push(out);
    }
  }
}

console.log(`\nresults in ${outDir}\n`);
const cmp = spawnSync(
  process.execPath,
  [
    '--import',
    'tsx',
    join(REPO, 'bench', 'compare.ts'),
    '--base',
    files.base.join(','),
    '--head',
    files.head.join(','),
    ...compareArgs,
  ],
  { stdio: 'inherit' },
);
console.log(`\nremove the worktree when done: git worktree remove ${worktree}`);
process.exit(cmp.status ?? 1);
