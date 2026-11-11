/**
 * Statistics over mitata's raw samples. mitata reports percentiles but no confidence interval or
 * margin of error, so we compute them here. All inputs are sorted ascending.
 */
import { mulberry32 } from './keys.ts';

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

/**
 * Bootstrap 95% CI (percentile method) for median(head) / median(base). Deterministic: seeded.
 */
export function bootstrapRatioCI(
  base: number[],
  head: number[],
  resamples = 2000,
): { ratio: number; low: number; high: number } {
  const rng = mulberry32(0xbe7c4);
  const cb = new Uint32Array(base.length);
  const ch = new Uint32Array(head.length);
  const ratios = new Float64Array(resamples);
  for (let r = 0; r < resamples; r++) {
    ratios[r] = resampledMedian(head, ch, rng) / resampledMedian(base, cb, rng);
  }
  ratios.sort();
  return {
    ratio: quantile(head, 0.5) / quantile(base, 0.5),
    low: quantile(ratios, 0.025),
    high: quantile(ratios, 0.975),
  };
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
