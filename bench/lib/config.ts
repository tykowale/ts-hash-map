import { resolve } from 'node:path';

/**
 * Options shared by the runner (`bench/run.ts`) and every scenario family process.
 * The runner forwards its own argv to each family, so the same flags work in both places.
 */
export interface BenchConfig {
  /** Tiny sizes and a ~1ms time budget per case: proves every case runs and verifies. */
  smoke: boolean;
  /** Only run groups whose `family/group` id matches. */
  filter: RegExp | undefined;
  /** Write stripped JSON results here. */
  out: string | undefined;
  /** Minimum measured CPU time per case, in milliseconds (mitata's own default is 642). */
  timeMs: number;
  /** Overrides each family's default size list. */
  sizes: number[] | undefined;
  /** Benchmark the built `dist/index.mjs` instead of `src/`. */
  dist: boolean;
  /** Repository root whose library code is benchmarked (a git worktree for branch comparisons). */
  root: string;
}

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

function takeValue(argv: string[], i: number, flag: string): string {
  const value = argv[i + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} needs a value`);
  }
  return value;
}

export function parseSizes(text: string): number[] {
  const list = text.split(',').map((s) => Number(s.replaceAll('_', '').trim()));
  if (list.some((n) => !Number.isInteger(n) || n < 1)) {
    throw new Error(`invalid --sizes list: ${text}`);
  }
  return list;
}

/**
 * Parses the shared flags. Unknown flags are returned in `rest` so scripts can add their own.
 */
export function parseConfig(argv: string[]): { config: BenchConfig; rest: string[] } {
  const config: BenchConfig = {
    smoke: process.env.BENCH_SMOKE === '1',
    filter: undefined,
    out: undefined,
    timeMs: 250,
    sizes: undefined,
    dist: process.env.BENCH_DIST === '1',
    root: process.env.BENCH_ROOT ?? REPO_ROOT,
  };
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case '--smoke':
        config.smoke = true;
        break;
      case '--dist':
        config.dist = true;
        break;
      case '--filter':
        config.filter = new RegExp(takeValue(argv, i++, arg), 'i');
        break;
      case '--out':
        config.out = resolve(takeValue(argv, i++, arg));
        break;
      case '--time':
        config.timeMs = Number(takeValue(argv, i++, arg));
        if (!(config.timeMs > 0)) {
          throw new Error('--time must be a positive number of milliseconds');
        }
        break;
      case '--sizes':
        config.sizes = parseSizes(takeValue(argv, i++, arg));
        break;
      case '--root':
        config.root = resolve(takeValue(argv, i++, arg));
        break;
      default:
        rest.push(arg);
    }
  }

  if (config.smoke) {
    config.timeMs = Math.min(config.timeMs, 1);
  }
  return { config, rest };
}

export const { config } = parseConfig(process.argv.slice(2));

/** Help text for the flags `parseConfig` understands, for each script's usage message. */
export const CONFIG_USAGE = `Shared options:
  --smoke            tiny sizes and ~1ms per case: checks that every case runs and verifies
  --filter <regex>   only run groups whose family/group id matches (case-insensitive)
  --out <file>       write JSON results to <file>
  --time <ms>        minimum measured CPU time per case (default 250)
  --sizes <a,b,...>  override each family's size list, e.g. 10,1000,100000
  --dist             benchmark the built dist/index.mjs instead of src/
  --root <dir>       benchmark the library in another checkout (e.g. a git worktree)
  -h, --help         print this help and exit`;

export function isHelp(argv: string[]): boolean {
  return argv.includes('--help') || argv.includes('-h');
}

/** Prints the usage and exits: 0 for --help, 1 (after the error) for a bad command line. */
export function exitWithUsage(usage: string, error?: string): never {
  if (error === undefined) {
    console.log(usage);
    process.exit(0);
  }
  console.error(`error: ${error}\n\n${usage}`);
  process.exit(1);
}

/**
 * Handles --help and rejects whatever a script did not recognise. `leftover` is what remains
 * after the shared flags and the script's own flags have been consumed.
 */
export function checkArgs(argv: string[], leftover: string[], usage: string): void {
  if (isHelp(argv)) {
    exitWithUsage(usage);
  }
  const first = leftover[0];
  if (first !== undefined) {
    exitWithUsage(
      usage,
      first.startsWith('-') ? `unknown flag: ${first}` : `unexpected argument: ${first}`,
    );
  }
}

/**
 * The size list for a family: `--sizes` wins, then smoke sizes, then the family's full list.
 */
export function sizes(full: number[], smoke: number[] = [10, 100]): number[] {
  if (config.sizes) {
    return config.sizes;
  }
  return config.smoke ? smoke : full;
}

/** Default sizes for primitive keys (int, string). Add 1M with `--sizes 10,1000,100000,1000000`. */
export const PRIMITIVE_SIZES = [10, 1_000, 100_000];
/** Default sizes for structural keys, where every op hashes and compares a whole object. */
export const STRUCTURAL_SIZES = [10, 1_000, 10_000];
