/**
 * CPU-profiles one HashMap workload (or a matrix of them), each in its own `node --cpu-prof`
 * process, and writes per run: the `.cpuprofile` (open it in Chrome DevTools or speedscope), a
 * self/total top-N table of the timed work, and an SVG flame graph.
 *
 *   npm run bench:profile -- --workload user-record --n 1000 --op get-hit
 *   npm run bench:profile -- --workload tuple --n 1000 --op get-hit --no-inline
 *   npm run bench:profile -- --matrix --workloads int,user-record --ops get-hit,churn
 *   npm run bench:profile -- --smoke
 *
 * Output goes to bench/results/profiles/ (gitignored). See bench/README.md, "Profiling".
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  exitWithUsage,
  isHelp,
  parseSizes,
  PRIMITIVE_SIZES,
  STRUCTURAL_SIZES,
} from '../lib/config.ts';
import { formatNs } from '../lib/stats.ts';
import {
  analyze,
  flameGraphSvg,
  formatAnalysis,
  readProfile,
  RESULT_PREFIX,
  type Analysis,
} from './cpuprofile.ts';

const REPO = resolve(import.meta.dirname, '..', '..');
const DRIVER = join(import.meta.dirname, 'driver.ts');

// Kept in sync with workloads.ts by the smoke run (which imports it); listed here so that --help
// and argument checks do not have to load the library.
const WORKLOAD_NAMES = [
  'int',
  'sparse-int',
  'float',
  'strided-int',
  'tagged-int',
  'timestamp-ms',
  'string-8',
  'uuid',
  'string-100',
  'string-8-fresh',
  'uuid-fresh',
  'string-100-fresh',
  'user-record',
  'date',
  'record-shapes',
  'record-16',
  'tuple',
  'nested',
  'mixed',
];
const PRIMITIVE = new Set([
  'int',
  'sparse-int',
  'float',
  'strided-int',
  'tagged-int',
  'timestamp-ms',
  'string-8',
  'uuid',
  'string-100',
  'string-8-fresh',
  'uuid-fresh',
  'string-100-fresh',
]);
const OP_NAMES = [
  'get-hit',
  'get-hit-seq',
  'get-miss',
  'get-50',
  'has-50',
  'update',
  'set-fresh',
  'set-presized',
  'churn',
  'delete-all',
  'clear',
  'clear-refill',
  'from-entries',
  'grow-from-1',
  'for-of',
  'for-of-after-delete',
  'keys-values',
  'for-each',
];

const USAGE = `usage: npm run bench:profile -- --workload <name> --n <n> --op <op> [options]
       npm run bench:profile -- --matrix [--workloads a,b] [--ops a,b] [--sizes a,b] [options]
       npm run bench:profile -- --smoke

Profiles HashMap alone (no native baselines) under node --cpu-prof, one process per run, and
writes <workload>_<n>_<op>.{cpuprofile,txt,svg} to bench/results/profiles/ (or --out-dir).

Run options:
  --workload <name>   key type, named after the scenario labels (default int):
                      ${WORKLOAD_NAMES.join(', ')}
  --n <n>             entries in the map (default 1000)
  --op <op>           ${OP_NAMES.join(', ')}
                      (default get-hit)
  --seconds <s>       timed work per run, setup excluded (default 2.5)
  --no-inline         run with --no-turbo-inlining, so hot callees keep their own frames
                      (slower overall, but self time is attributed to the function that owns it)
  --trace-deopt       also run with --trace-opt --trace-deopt and save the log as <name>.deopt.log
  --node-flag <flag>  pass another V8/Node flag to the profiled process (repeatable)
  --interval <us>     sampling interval in microseconds (default 250)
  --top <n>           rows per table (default 25)
  --dist              profile the built dist/index.mjs (npm run build first)
  --root <dir>        profile the library in another checkout
  --out-dir <dir>     where to write (default bench/results/profiles, matrix: a dated subfolder)

Matrix options:
  --matrix            profile a matrix of workloads x sizes x ops and write summary.md
  --workloads <a,b>   only these workloads
  --ops <a,b>         only these ops (default: get-hit, get-miss, set-fresh, churn, delete-all
                      everywhere, plus iteration and construction ops on int and user-record)
  --sizes <a,b>       override each workload's scenario sizes

Other:
  --smoke             verify every workload x op in-process at tiny sizes, then profile one short
                      run end to end (what CI runs)
  --list              print workloads and ops
  -h, --help          print this help`;

interface Options {
  workload: string;
  n: number;
  op: string;
  seconds: number;
  noInline: boolean;
  traceDeopt: boolean;
  nodeFlags: string[];
  interval: number;
  top: number;
  dist: boolean;
  root: string | undefined;
  outDir: string | undefined;
  matrix: boolean;
  workloads: string[] | undefined;
  ops: string[] | undefined;
  sizes: number[] | undefined;
  smoke: boolean;
}

function positive(text: string, flag: string, integer: boolean): number {
  const x = Number(text);
  if (!(x > 0) || (integer && !Number.isInteger(x))) {
    exitWithUsage(USAGE, `${flag} must be a positive ${integer ? 'integer' : 'number'}`);
  }
  return x;
}

function list(text: string, known: string[], flag: string): string[] {
  const items = text.split(',').filter(Boolean);
  const bad = items.filter((x) => !known.includes(x));
  if (bad.length > 0) {
    exitWithUsage(USAGE, `${flag}: unknown ${bad.join(', ')}`);
  }
  return items;
}

function parse(argv: string[]): Options {
  if (isHelp(argv)) {
    exitWithUsage(USAGE);
  }
  if (argv.includes('--list')) {
    console.log(`workloads: ${WORKLOAD_NAMES.join(', ')}\nops: ${OP_NAMES.join(', ')}`);
    process.exit(0);
  }
  const o: Options = {
    workload: 'int',
    n: 1000,
    op: 'get-hit',
    seconds: 2.5,
    noInline: false,
    traceDeopt: false,
    nodeFlags: [],
    interval: 250,
    top: 25,
    dist: false,
    root: undefined,
    outDir: undefined,
    matrix: false,
    workloads: undefined,
    ops: undefined,
    sizes: undefined,
    smoke: false,
  };
  const value = (i: number, flag: string): string => {
    const v = argv[i];
    if (v === undefined || (v.startsWith('--') && flag !== '--node-flag')) {
      exitWithUsage(USAGE, `${flag} needs a value`);
    }
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case '--workload':
        o.workload = list(value(++i, a), WORKLOAD_NAMES, a)[0] ?? o.workload;
        break;
      case '--n':
        o.n = positive(value(++i, a).replaceAll('_', ''), a, true);
        break;
      case '--op':
        o.op = list(value(++i, a), OP_NAMES, a)[0] ?? o.op;
        break;
      case '--seconds':
        o.seconds = positive(value(++i, a), a, false);
        break;
      case '--no-inline':
        o.noInline = true;
        break;
      case '--trace-deopt':
        o.traceDeopt = true;
        break;
      case '--node-flag':
        o.nodeFlags.push(value(++i, a));
        break;
      case '--interval':
        o.interval = positive(value(++i, a), a, true);
        break;
      case '--top':
        o.top = positive(value(++i, a), a, true);
        break;
      case '--dist':
        o.dist = true;
        break;
      case '--root':
        o.root = resolve(value(++i, a));
        break;
      case '--out-dir':
        o.outDir = resolve(value(++i, a));
        break;
      case '--matrix':
        o.matrix = true;
        break;
      case '--workloads':
        o.workloads = list(value(++i, a), WORKLOAD_NAMES, a);
        break;
      case '--ops':
        o.ops = list(value(++i, a), OP_NAMES, a);
        break;
      case '--sizes':
        try {
          o.sizes = parseSizes(value(++i, a));
        } catch (err) {
          exitWithUsage(USAGE, (err as Error).message);
        }
        break;
      case '--smoke':
        o.smoke = true;
        break;
      default:
        exitWithUsage(
          USAGE,
          a.startsWith('-') ? `unknown flag: ${a}` : `unexpected argument: ${a}`,
        );
    }
  }
  return o;
}

interface Spec {
  workload: string;
  n: number;
  op: string;
}

interface DriverResult extends Spec {
  calls: number;
  ops: number;
  timedMs: number;
  nsPerOp: number;
  dist: boolean;
}

interface RunOutput {
  name: string;
  result: DriverResult;
  analysis: Analysis;
  table: string;
}

function runName(spec: Spec, o: Options): string {
  return (
    `${spec.workload}_${spec.n}_${spec.op}` +
    (o.noInline ? '_noinline' : '') +
    (o.dist ? '_dist' : '') +
    o.nodeFlags.map((f) => `_${f.replaceAll(/[^a-z0-9]+/gi, '')}`).join('')
  );
}

/** One profiled process: the .cpuprofile, the table and the flame graph. */
function profileOne(spec: Spec, o: Options, outDir: string, quiet = false): RunOutput {
  const name = runName(spec, o);
  const nodeArgs = [
    ...(o.noInline ? ['--no-turbo-inlining'] : []),
    ...(o.traceDeopt ? ['--trace-opt', '--trace-deopt'] : []),
    ...o.nodeFlags,
    // Lets workloads.ts keep runTimed out of TurboFan, so TIMED_ROOT keeps its own frame.
    '--allow-natives-syntax',
    '--cpu-prof',
    `--cpu-prof-dir=${outDir}`,
    `--cpu-prof-name=${name}.cpuprofile`,
    `--cpu-prof-interval=${o.interval}`,
    '--import',
    'tsx',
    DRIVER,
    '--workload',
    spec.workload,
    '--n',
    String(spec.n),
    '--op',
    spec.op,
    '--seconds',
    String(o.seconds),
    ...(o.dist ? ['--dist'] : []),
    ...(o.root ? ['--root', o.root] : []),
  ];
  const child = spawnSync(process.execPath, nodeArgs, {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 1 << 30,
  });
  if (o.traceDeopt) {
    writeFileSync(join(outDir, `${name}.deopt.log`), `${child.stdout}${child.stderr}`);
  }
  const line = child.stdout?.split('\n').find((l) => l.startsWith(RESULT_PREFIX));
  if (child.status !== 0 || !line) {
    throw new Error(
      `${name}: profiled process failed (exit ${child.status})\n${child.stderr ?? ''}`.trimEnd(),
    );
  }
  const result = JSON.parse(line.slice(RESULT_PREFIX.length)) as DriverResult;
  const profileFile = join(outDir, `${name}.cpuprofile`);
  const prof = readProfile(profileFile);
  const roots = [o.root ?? REPO, REPO];
  const analysis = analyze(prof, roots, o.top);
  const title =
    `${spec.workload} n=${spec.n} ${spec.op}: ${formatNs(result.nsPerOp)}/op` +
    `${o.noInline ? ', --no-turbo-inlining' : ''}${o.dist ? ', dist' : ''}, ${process.version}`;
  const table = formatAnalysis(title, analysis);
  writeFileSync(join(outDir, `${name}.txt`), table);
  writeFileSync(join(outDir, `${name}.svg`), flameGraphSvg(prof, roots, title));
  if (analysis.timedSamples === 0) {
    throw new Error(`${name}: the profile has no samples under TIMED_ROOT`);
  }
  if (!quiet) {
    console.log(table);
  }
  return { name, result, analysis, table };
}

const DEFAULT_MATRIX_OPS = ['get-hit', 'get-miss', 'set-fresh', 'churn', 'delete-all'];
const INT_EXTRA_OPS = [
  'for-of',
  'for-of-after-delete',
  'keys-values',
  'for-each',
  'from-entries',
  'grow-from-1',
  'set-presized',
  'clear',
  'clear-refill',
];
const USER_EXTRA_OPS = ['for-of', 'from-entries', 'set-presized'];
const FRESH_OPS = ['get-hit', 'set-fresh'];

function scenarioSizes(workload: string): number[] {
  return PRIMITIVE.has(workload) ? PRIMITIVE_SIZES : STRUCTURAL_SIZES;
}

function matrixSpecs(o: Options): Spec[] {
  const specs: Spec[] = [];
  for (const workload of o.workloads ?? WORKLOAD_NAMES) {
    let ops: string[];
    if (o.ops) {
      ops = o.ops;
    } else if (workload.endsWith('-fresh')) {
      ops = FRESH_OPS;
    } else if (workload === 'int') {
      ops = [...DEFAULT_MATRIX_OPS, ...INT_EXTRA_OPS];
    } else if (workload === 'user-record') {
      ops = [...DEFAULT_MATRIX_OPS, ...USER_EXTRA_OPS];
    } else {
      ops = DEFAULT_MATRIX_OPS;
    }
    for (const n of o.sizes ?? scenarioSizes(workload)) {
      for (const op of ops) {
        specs.push({ workload, n, op });
      }
    }
  }
  return specs;
}

function runMatrix(o: Options): void {
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const outDir = o.outDir ?? join(REPO, 'bench', 'results', 'profiles', `matrix-${stamp}`);
  mkdirSync(outDir, { recursive: true });
  const specs = matrixSpecs(o);
  const jsonl = join(outDir, 'results.jsonl');
  const est = Math.ceil((specs.length * (o.seconds + 1)) / 60);
  console.log(`profiling ${specs.length} runs into ${relative(REPO, outDir)} (about ${est} min)`);
  const rows: string[] = [
    '| workload | n | op | ns/op | GC | top self frames |',
    '|---|---|---|---|---|---|',
  ];
  const failed: string[] = [];
  specs.forEach((spec, i) => {
    let out: RunOutput;
    try {
      out = profileOne(spec, o, outDir, true);
    } catch (err) {
      failed.push(`${spec.workload} ${spec.n} ${spec.op}`);
      console.error((err as Error).message);
      return;
    }
    const { result, analysis } = out;
    appendFileSync(
      jsonl,
      `${JSON.stringify({ ...result, gcPct: analysis.gcPct, self: analysis.self.slice(0, 10), total: analysis.total.slice(0, 10) })}\n`,
    );
    const topSelf = analysis.self
      .slice(0, 3)
      .map(([k, v]) => `${v.toFixed(0)}% ${k}`)
      .join('<br>');
    rows.push(
      `| ${spec.workload} | ${spec.n} | ${spec.op} | ${formatNs(result.nsPerOp)} | ${analysis.gcPct.toFixed(0)}% | ${topSelf} |`,
    );
    console.log(
      `[${i + 1}/${specs.length}] ${out.name}: ${formatNs(result.nsPerOp)}/op, GC ${analysis.gcPct.toFixed(0)}%, ` +
        `top: ${analysis.self[0]?.[0] ?? '-'} ${analysis.self[0]?.[1].toFixed(0) ?? ''}%`,
    );
  });
  writeFileSync(join(outDir, 'summary.md'), `${rows.join('\n')}\n`);
  console.log(`\nwrote ${relative(REPO, join(outDir, 'summary.md'))} and results.jsonl`);
  if (failed.length > 0) {
    console.error(`FAILED: ${failed.join(', ')}`);
    process.exit(1);
  }
}

async function runSmoke(o: Options): Promise<void> {
  // In-process: every workload x op at tiny sizes, with the before/after result checks.
  const { OPS, WORKLOADS, runTimed } = await import('./workloads.ts');
  const missingW = Object.keys(WORKLOADS).filter((w) => !WORKLOAD_NAMES.includes(w));
  const missingO = OPS.filter((op) => !OP_NAMES.includes(op));
  const wrongSizes = Object.entries(WORKLOADS)
    .filter(([name, w]) => w.sizes !== scenarioSizes(name))
    .map(([name]) => `${name} (sizes)`);
  missingW.push(...wrongSizes);
  if (
    missingW.length + missingO.length > 0 ||
    WORKLOAD_NAMES.length !== Object.keys(WORKLOADS).length
  ) {
    throw new Error(
      `run.ts and workloads.ts disagree on names: ${[...missingW, ...missingO].join(', ')}`,
    );
  }
  let count = 0;
  const failures: string[] = [];
  for (const workload of Object.keys(WORKLOADS)) {
    for (const op of OPS) {
      for (const n of o.sizes ?? [10, 100]) {
        try {
          runTimed({ workload, n, op }, 0.001);
          count++;
        } catch (err) {
          failures.push((err as Error).message);
        }
      }
    }
  }
  console.log(`profile smoke: ${count} workload runs verified`);
  // End to end: one profiled process, its table and its flame graph.
  const outDir = o.outDir ?? join(REPO, 'bench', 'results', 'profiles', 'smoke');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const specs: Spec[] = [
    { workload: 'int', n: 1000, op: 'get-hit' },
    { workload: 'user-record', n: 100, op: 'clear' },
  ];
  for (const spec of specs) {
    try {
      const out = profileOne(spec, { ...o, seconds: 0.3, top: 5 }, outDir, true);
      if (spec.op === 'clear') {
        // clear never hashes: hash.ts frames in its timed work mean setup leaked into the window.
        const full = analyze(readProfile(join(outDir, `${out.name}.cpuprofile`)), [REPO], 1e6);
        const leaked = full.total.filter(([k]) => /src\/hash\.ts/.test(k));
        if (leaked.length > 0) {
          throw new Error(
            `${out.name}: setup leaked into the timed profile: ${leaked.map(([k, v]) => `${v.toFixed(1)}% ${k}`).join(', ')}`,
          );
        }
      }
      console.log(
        `profile smoke: ${out.name} ${formatNs(out.result.nsPerOp)}/op, ${out.analysis.timedSamples} timed samples, ` +
          `top self: ${out.analysis.self[0]?.[0] ?? '-'}`,
      );
    } catch (err) {
      failures.push((err as Error).message);
    }
  }
  if (failures.length > 0) {
    console.error(`FAILED:\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log(`profile smoke ok (files in ${relative(REPO, outDir)})`);
}

const o = parse(process.argv.slice(2));
if (o.smoke) {
  await runSmoke(o);
} else if (o.matrix) {
  runMatrix(o);
} else {
  const outDir = o.outDir ?? join(REPO, 'bench', 'results', 'profiles');
  mkdirSync(outDir, { recursive: true });
  const out = profileOne({ workload: o.workload, n: o.n, op: o.op }, o, outDir);
  const base = relative(REPO, join(outDir, out.name));
  console.log(
    `${out.result.ops} ops in ${out.result.timedMs.toFixed(0)} ms timed: ${formatNs(out.result.nsPerOp)}/op` +
      `\nwrote ${base}.cpuprofile, ${base}.txt, ${base}.svg${o.traceDeopt ? `, ${base}.deopt.log` : ''}`,
  );
}
