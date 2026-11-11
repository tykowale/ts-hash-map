/**
 * Statistics over mitata's raw samples. mitata reports percentiles but no confidence interval or
 * margin of error, so we compute them here. All inputs are sorted ascending.
 */

/** Linear-interpolated quantile of a sorted array. */
export function quantile(sorted: ArrayLike<number>, p: number): number {
  if (sorted.length === 0) {
    return Number.NaN;
  }
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo]!;
  return a + (sorted[hi]! - a) * (pos - lo);
}

/**
 * Distribution-free 95% confidence interval for the median, from order statistics: the true
 * median lies between ranks n/2 -/+ 1.96*sqrt(n)/2 with ~95% probability (binomial normal
 * approximation). Needs no resampling, so it is cheap even for 100k samples.
 */
export function medianCI(sorted: ArrayLike<number>): { low: number; high: number } {
  const n = sorted.length;
  if (n === 0) {
    return { low: Number.NaN, high: Number.NaN };
  }
  const half = 0.98 * Math.sqrt(n);
  const lo = Math.max(0, Math.floor(n / 2 - half) - 1);
  const hi = Math.min(n - 1, Math.ceil(n / 2 + half));
  return { low: sorted[lo]!, high: sorted[hi]! };
}

/** Relative margin of error of the median, in percent: half the CI width over the median. */
export function rme(median: number, ci: { low: number; high: number }): number {
  return median > 0 ? ((ci.high - ci.low) / 2 / median) * 100 : Number.NaN;
}

/**
 * Keeps `max` evenly spaced quantiles of a sorted array. The result is still a sorted sample of the
 * same distribution, which keeps result files small and lets compare.ts bootstrap cheaply.
 */
export function thin(sorted: number[], max: number): number[] {
  if (sorted.length <= max) {
    return sorted.slice();
  }
  return Array.from({ length: max }, (_, i) => quantile(sorted, i / (max - 1)));
}

/**
 * Median of a bootstrap resample of a sorted array. Because the input is sorted, the k-th smallest
 * resampled value is the value at the k-th smallest drawn index, so a counting pass over indices
 * finds it in O(n) without sorting.
 */
function resampledMedian(sorted: number[], counts: Uint32Array, rng: () => number): number {
  const n = sorted.length;
  counts.fill(0);
  for (let i = 0; i < n; i++) {
    counts[Math.floor(rng() * n)]!++;
  }
  const target = Math.floor((n - 1) / 2);
  let seen = 0;
  for (let i = 0; i < n; i++) {
    seen += counts[i]!;
    if (seen > target) {
      return sorted[i]!;
    }
  }
  return sorted[n - 1]!;
}

/** Bootstrap resamples per CI. Seeded, so the same inputs always give the same interval. */
export const RESAMPLES = 2000;

/** `resamples` bootstrap medians of one sorted sample. */
export function medianReplicates(
  sorted: number[],
  rng: () => number,
  resamples = RESAMPLES,
): Float64Array {
  const counts = new Uint32Array(sorted.length);
  const out = new Float64Array(resamples);
  for (let r = 0; r < resamples; r++) {
    out[r] = resampledMedian(sorted, counts, rng);
  }
  return out;
}

/**
 * One run of a case on one side of a comparison: bootstrap medians of the row itself and, when
 * the row is judged against an in-process baseline, of that baseline from the same run. `run` is
 * the run's index on its side (its result file), which `runDraws` refers to.
 */
export interface RunReplicates {
  run: number;
  row: Float64Array;
  baseline?: Float64Array;
}

/**
 * The runs each bootstrap replicate draws, with replacement: `runs` file indices per replicate,
 * flattened. Draw them once per side and pass them to every row's `sideReplicates`, so replicate
 * r of every row resamples the same runs. Run-level effects (one process ran hot) are shared by
 * every row of that run, so drawing runs per row would treat them as independent and make the
 * geomean CI too narrow.
 */
export function runDraws(runs: number, rng: () => number, resamples = RESAMPLES): Uint32Array {
  const out = new Uint32Array(resamples * runs);
  for (let i = 0; i < out.length; i++) {
    out[i] = runs === 1 ? 0 : Math.floor(rng() * runs);
  }
  return out;
}

/**
 * Two-level bootstrap of one side's statistic: the geometric mean over runs of
 * median(row) / median(baseline), or of median(row) alone when there is no baseline.
 *
 * Each replicate first draws runs with replacement (so variation between processes is in the
 * interval, not just the noise within one), then for each drawn run takes one bootstrap median of
 * the row and one of the baseline, both from that run. Keeping the row and its baseline in the same
 * run preserves the in-process pairing that cancels machine drift, and resampling the baseline too
 * puts its own noise in the interval.
 *
 * `draws` (from `runDraws`, over `sideRuns` runs) fixes which runs each replicate draws, shared
 * across rows. A drawn run that this row lacks (it failed in that run) is replaced by one of the
 * row's own runs, picked with `rng`. Without `draws`, runs are drawn per row with `rng`.
 */
export function sideReplicates(
  runs: RunReplicates[],
  rng: () => number,
  resamples = RESAMPLES,
  draws?: { indices: Uint32Array; runs: number },
): Float64Array {
  const out = new Float64Array(resamples);
  const byRun = new Map(runs.map((r) => [r.run, r]));
  const k = draws ? draws.runs : runs.length;
  for (let r = 0; r < resamples; r++) {
    let logSum = 0;
    for (let i = 0; i < k; i++) {
      const run =
        (draws && byRun.get(draws.indices[r * k + i]!)) ??
        runs[runs.length === 1 ? 0 : Math.floor(rng() * runs.length)]!;
      const row = run.row[Math.floor(rng() * run.row.length)]!;
      const base = run.baseline ? run.baseline[Math.floor(rng() * run.baseline.length)]! : 1;
      logSum += Math.log(row / base);
    }
    out[r] = Math.exp(logSum / k);
  }
  return out;
}

/** Point value of the statistic `sideReplicates` resamples, from each run's actual medians. */
export function sidePoint(runs: Array<{ row: number; baseline?: number }>): number {
  let logSum = 0;
  for (const run of runs) {
    logSum += Math.log(run.row / (run.baseline ?? 1));
  }
  return Math.exp(logSum / runs.length);
}

export interface Interval {
  ratio: number;
  low: number;
  high: number;
}

/** Percentile 95% CI of head/base from per-side replicates (same length). */
export function changeInterval(
  point: number,
  base: Float64Array,
  head: Float64Array,
): { ci: Interval; replicates: Float64Array } {
  const replicates = new Float64Array(base.length);
  for (let r = 0; r < base.length; r++) {
    replicates[r] = head[r]! / base[r]!;
  }
  const sorted = replicates.slice().sort();
  return {
    ci: { ratio: point, low: quantile(sorted, 0.025), high: quantile(sorted, 0.975) },
    replicates,
  };
}

/**
 * Geometric mean of several rows' changes with a percentile 95% CI: replicate r is the geometric
 * mean of every row's replicate r. Pass rows whose replicates share their run draws (`runDraws`),
 * so replicate r resamples the same processes for every row and run-level effects stay correlated
 * across rows, as they are in the data.
 */
export function geomeanInterval(
  rows: Array<{ ratio: number; replicates: Float64Array }>,
): Interval {
  const n = rows.length;
  if (n === 0) {
    return { ratio: Number.NaN, low: Number.NaN, high: Number.NaN };
  }
  const resamples = rows[0]!.replicates.length;
  const reps = new Float64Array(resamples);
  for (let r = 0; r < resamples; r++) {
    let logSum = 0;
    for (const row of rows) {
      logSum += Math.log(row.replicates[r]!);
    }
    reps[r] = Math.exp(logSum / n);
  }
  reps.sort();
  let logSum = 0;
  for (const row of rows) {
    logSum += Math.log(row.ratio);
  }
  return {
    ratio: Math.exp(logSum / n),
    low: quantile(reps, 0.025),
    high: quantile(reps, 0.975),
  };
}

/** A change ratio as a signed percentage: 0.97 -> "-3.0%". */
export function formatChange(ratio: number): string {
  if (!Number.isFinite(ratio)) {
    return '-';
  }
  const pct = (ratio - 1) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

export function formatNs(ns: number): string {
  if (!Number.isFinite(ns)) {
    return '-';
  }
  if (ns < 1e3) {
    return `${ns.toFixed(ns < 10 ? 2 : 1)} ns`;
  }
  if (ns < 1e6) {
    return `${(ns / 1e3).toFixed(2)} µs`;
  }
  if (ns < 1e9) {
    return `${(ns / 1e6).toFixed(2)} ms`;
  }
  return `${(ns / 1e9).toFixed(2)} s`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) {
    return '-';
  }
  if (Math.abs(bytes) < 1024) {
    return `${bytes.toFixed(0)} B`;
  }
  if (Math.abs(bytes) < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatRatio(r: number): string {
  if (!Number.isFinite(r)) {
    return '-';
  }
  return r < 0.1 ? `${r.toPrecision(2)}x` : `${r.toFixed(2)}x`;
}
