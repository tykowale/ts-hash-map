/**
 * Reads a V8 `.cpuprofile` (from `node --cpu-prof`) and keeps only the timed work: samples whose
 * stack contains TIMED_ROOT and not UNTIMED_SETUP (see workloads.ts), plus the GC and `(program)`
 * samples that fall between the first and last timed sample and follow a timed sample, since GC
 * caused by the timed loop runs outside any JS stack. GC that follows setup (or other untimed JS)
 * is the setup's allocation and is dropped with it. From those it builds self/total tables and a flame graph SVG.
 */
import { readFileSync } from 'node:fs';
import { basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TIMED_ROOT = 'TIMED_ROOT';
export const UNTIMED_SETUP = 'UNTIMED_SETUP';
/** The driver prints its JSON result after this prefix. */
export const RESULT_PREFIX = 'PROFILE_RESULT ';

interface CallFrame {
  functionName: string;
  url: string;
  lineNumber: number;
}

interface ProfileNode {
  id: number;
  callFrame: CallFrame;
  children?: number[];
}

export interface CpuProfile {
  nodes: ProfileNode[];
  startTime: number;
  endTime: number;
  samples: number[];
  timeDeltas: number[];
}

export interface Analysis {
  /** Microseconds of samples kept. */
  windowUs: number;
  timedSamples: number;
  gcPct: number;
  programPct: number;
  /** [frame, percent of the window] sorted descending. */
  self: Array<[string, number]>;
  total: Array<[string, number]>;
}

export function readProfile(file: string): CpuProfile {
  return JSON.parse(readFileSync(file, 'utf8')) as CpuProfile;
}

/** Labels frames as `name path:line`, with paths relative to one of `roots` when possible. */
function labeller(roots: string[]): (frame: CallFrame) => string {
  const sources = new Map<string, string[] | null>();
  const shortPath = (url: string): string => {
    if (!url) {
      return '';
    }
    let path = url;
    if (url.startsWith('file://')) {
      try {
        path = fileURLToPath(url);
      } catch {
        // keep the url
      }
    }
    for (const root of roots) {
      const rel = relative(root, path);
      if (!rel.startsWith('..') && rel !== path) {
        return rel;
      }
    }
    return basename(path);
  };
  /**
   * tsx hands V8 its transpiled output on a single line, so the profile's line numbers say
   * nothing. For frames in this repo's TypeScript files, look the function up by name in the
   * source instead: its declaration, else its first `const`/`let` binding. Unknown: no line.
   */
  const sourceLine = (url: string, name: string, line: number): number | undefined => {
    if (!url.startsWith('file://') || !url.endsWith('.ts')) {
      return line > 0 ? line + 1 : undefined;
    }
    if (!name) {
      return undefined;
    }
    let lines = sources.get(url);
    if (lines === undefined) {
      try {
        lines = readFileSync(fileURLToPath(url), 'utf8').split('\n');
      } catch {
        lines = null;
      }
      sources.set(url, lines);
    }
    if (!lines) {
      return undefined;
    }
    const escaped = name.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const decl = new RegExp(
      `(function\\*?\\s+${escaped}\\b|^\\s*(export\\s+)?(abstract\\s+)?class\\s+${escaped}\\b|` +
        `^\\s*((private|protected|public|static|override|readonly|get|set|async)\\s+)*\\[?${escaped}\\]?\\s*(<[^>]*>)?\\()`,
    );
    const binding = new RegExp(`^\\s*(export\\s+)?(const|let)\\s+${escaped}\\s*[:=]`);
    let i = lines.findIndex((l) => decl.test(l));
    if (i < 0) {
      i = lines.findIndex((l) => binding.test(l));
    }
    return i >= 0 ? i + 1 : undefined;
  };
  return (cf) => {
    const path = shortPath(cf.url);
    const name = cf.functionName || '(anonymous)';
    if (!path) {
      return name;
    }
    const line = sourceLine(cf.url, cf.functionName, cf.lineNumber);
    return line === undefined ? `${name} ${path}` : `${name} ${path}:${line}`;
  };
}

interface Indexed {
  /** Stack labels per node id, leaf first, without (root). */
  stack: (id: number) => string[];
  /** Per sample: its weight in microseconds (time until the next sample). */
  weights: number[];
  isTimed: (id: number) => boolean;
  isSetup: (id: number) => boolean;
  /**
   * Per sample index: kept as timed work. A timed sample is kept; a GC, (program) or (idle)
   * sample is kept when the last JS sample before it was timed; anything else is dropped.
   */
  keep: boolean[];
  /** First and last sample index whose stack is timed work. */
  first: number;
  last: number;
}

function index(prof: CpuProfile, roots: string[]): Indexed {
  const label = labeller(roots);
  const byId = new Map(prof.nodes.map((n) => [n.id, n]));
  const parent = new Map<number, number>();
  for (const n of prof.nodes) {
    for (const c of n.children ?? []) {
      parent.set(c, n.id);
    }
  }
  const stacks = new Map<number, string[]>();
  const names = new Map<number, Set<string>>();
  const walk = (id: number): void => {
    const out: string[] = [];
    const fnNames = new Set<string>();
    for (let cur: number | undefined = id; cur !== undefined; cur = parent.get(cur)) {
      const n = byId.get(cur)!;
      if (n.callFrame.functionName === '(root)') {
        break;
      }
      out.push(label(n.callFrame));
      fnNames.add(n.callFrame.functionName);
    }
    stacks.set(id, out);
    names.set(id, fnNames);
  };
  const namesOf = (id: number): Set<string> => {
    if (!names.has(id)) {
      walk(id);
    }
    return names.get(id)!;
  };
  const stack = (id: number): string[] => {
    if (!stacks.has(id)) {
      walk(id);
    }
    return stacks.get(id)!;
  };
  const isSetup = (id: number): boolean => namesOf(id).has(UNTIMED_SETUP);
  const isTimed = (id: number): boolean => namesOf(id).has(TIMED_ROOT) && !isSetup(id);

  const weights: number[] = [];
  for (let i = 0; i < prof.samples.length; i++) {
    weights.push(prof.timeDeltas[i + 1] ?? 0);
  }
  const outsideJs = (id: number): boolean => {
    const name = byId.get(id)!.callFrame.functionName;
    return name === '(garbage collector)' || name === '(program)' || name === '(idle)';
  };
  let first = -1;
  let last = -1;
  const keep: boolean[] = [];
  let lastJsTimed = false;
  for (let i = 0; i < prof.samples.length; i++) {
    const id = prof.samples[i]!;
    if (outsideJs(id)) {
      keep.push(lastJsTimed);
      continue;
    }
    lastJsTimed = isTimed(id);
    keep.push(lastJsTimed);
    if (lastJsTimed) {
      if (first < 0) {
        first = i;
      }
      last = i;
    }
  }
  return { stack, weights, isTimed, isSetup, keep, first, last };
}

/** Self and total time per frame over the timed window (see the file comment). */
export function analyze(prof: CpuProfile, roots: string[], top = 25): Analysis {
  const ix = index(prof, roots);
  const self = new Map<string, number>();
  const total = new Map<string, number>();
  let counted = 0;
  let timedSamples = 0;
  let gc = 0;
  let program = 0;
  if (ix.first >= 0) {
    for (let i = ix.first; i <= ix.last; i++) {
      const id = prof.samples[i]!;
      if (!ix.keep[i]) {
        continue; // setup, GC after setup, or other untimed JS between timed calls
      }
      const st = ix.stack(id);
      const leaf = st[0] ?? '(root)';
      const w = ix.weights[i]!;
      counted += w;
      if (ix.isTimed(id)) {
        timedSamples++;
      }
      if (leaf === '(garbage collector)') {
        gc += w;
      } else if (leaf === '(program)') {
        program += w;
      }
      self.set(leaf, (self.get(leaf) ?? 0) + w);
      for (const k of new Set(st)) {
        total.set(k, (total.get(k) ?? 0) + w);
      }
    }
  }
  const pct = (x: number): number => (counted > 0 ? (100 * x) / counted : 0);
  const sorted = (m: Map<string, number>): Array<[string, number]> =>
    [...m]
      .sort((a, b) => b[1] - a[1])
      .slice(0, top)
      .map(([k, v]) => [k, pct(v)]);
  return {
    windowUs: counted,
    timedSamples,
    gcPct: pct(gc),
    programPct: pct(program),
    self: sorted(self),
    total: sorted(total),
  };
}

const p = (x: number): string => `${x.toFixed(1).padStart(5)}%`;

export function formatAnalysis(title: string, a: Analysis): string {
  const lines = [
    `# ${title}`,
    `window ${(a.windowUs / 1e3).toFixed(0)} ms, ${a.timedSamples} timed samples, GC ${p(a.gcPct)}, (program) ${p(a.programPct)}`,
    '',
    '## self time',
    ...a.self.map(([k, v]) => `${p(v)}  ${k}`),
    '',
    '## total time',
    ...a.total.map(([k, v]) => `${p(v)}  ${k}`),
  ];
  return `${lines.join('\n')}\n`;
}

interface FlameNode {
  name: string;
  v: number;
  kids: Map<string, FlameNode>;
}

const escapeXml = (s: string): string =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function colour(name: string): string {
  if (/src\/hash\.ts/.test(name)) {
    return '#e8a33a';
  }
  if (/src\/is-equal\.ts/.test(name)) {
    return '#d9603b';
  }
  if (/src\/hash-map/.test(name)) {
    return '#c94c4c';
  }
  if (/src\//.test(name)) {
    return '#d97a6c';
  }
  if (/garbage collector|\(program\)/.test(name)) {
    return '#8a8a8a';
  }
  if (/bench\//.test(name)) {
    return '#6a9fd8';
  }
  return '#d6b85a';
}

/**
 * A flame graph (root at the bottom) of the timed work, time-weighted. Each stack is cut to start
 * at TIMED_ROOT; GC and (program) samples in the window sit directly on the root. Hover a box for
 * its share of the window.
 */
export function flameGraphSvg(prof: CpuProfile, roots: string[], title: string): string {
  const ix = index(prof, roots);
  const tree: FlameNode = { name: 'all', v: 0, kids: new Map() };
  for (let i = Math.max(ix.first, 0); ix.first >= 0 && i <= ix.last; i++) {
    const id = prof.samples[i]!;
    if (!ix.keep[i]) {
      continue;
    }
    const st = ix.stack(id).toReversed(); // root first
    const k = st.findIndex((s) => s.startsWith(`${TIMED_ROOT} `) || s === TIMED_ROOT);
    let path: string[];
    if (k >= 0) {
      path = st.slice(k);
    } else if (st.length === 1 && /^\((garbage collector|program)\)$/.test(st[0]!)) {
      path = st;
    } else {
      continue;
    }
    const w = ix.weights[i]!;
    let node = tree;
    node.v += w;
    for (const s of path) {
      let c = node.kids.get(s);
      if (!c) {
        c = { name: s, v: 0, kids: new Map() };
        node.kids.set(s, c);
      }
      c.v += w;
      node = c;
    }
  }

  const W = 1400;
  const H = 17;
  const rects: Array<{ x: number; depth: number; w: number; node: FlameNode }> = [];
  let maxDepth = 0;
  const lay = (node: FlameNode, x: number, depth: number): void => {
    const w = tree.v > 0 ? (node.v / tree.v) * W : 0;
    if (w < 0.3) {
      return;
    }
    maxDepth = Math.max(maxDepth, depth);
    rects.push({ x, depth, w, node });
    let cx = x;
    for (const c of [...node.kids.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      lay(c, cx, depth + 1);
      cx += (c.v / tree.v) * W;
    }
  };
  lay(tree, 0, 0);
  const height = (maxDepth + 2) * H + 30;
  let svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" font-family="monospace" font-size="11">\n` +
    `<rect width="100%" height="100%" fill="#fff"/>` +
    `<text x="4" y="16">${escapeXml(title)} (timed work only; hover for %)</text>\n`;
  for (const r of rects) {
    const y = height - (r.depth + 1) * H - 4;
    const pct = ((100 * r.node.v) / tree.v).toFixed(2);
    const chars = Math.floor(r.w / 6.6);
    const text = chars > 3 ? escapeXml(r.node.name.slice(0, chars)) : '';
    svg +=
      `<g><title>${escapeXml(r.node.name)} ${pct}%</title>` +
      `<rect x="${r.x.toFixed(1)}" y="${y}" width="${Math.max(r.w - 0.5, 0.1).toFixed(1)}" height="${H - 1}" fill="${colour(r.node.name)}"/>` +
      `<text x="${(r.x + 2).toFixed(1)}" y="${y + 12}">${text}</text></g>\n`;
  }
  return `${svg}</svg>\n`;
}
