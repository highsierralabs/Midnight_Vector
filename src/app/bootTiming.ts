// Boot frame timing for the governor (section 6.10, 11.4). Pure: frame, sync and the clock are passed in.
export const WARMUP = 5;
export const TIMED = 30;
export const BUDGET_MS = 1500;
const MIN_SAMPLES = 5;

/**
 * Runs WARMUP untimed frames, then up to TIMED timed ones, each t0 = now(); frame(); sync(); ms = now() - t0. Stops early
 * once the whole run, warm-up included, exceeds BUDGET_MS with at least MIN_SAMPLES timed samples. Returns the
 * nearest-rank 95th percentile in ms, or 0 with no samples, which the governor reads as no measurement.
 */
export function measureBootP95(frame: () => void, sync: () => void, now: () => number): number {
  const start = now();
  for (let i = 0; i < WARMUP; i++) { frame(); sync(); }
  const samples: number[] = [];
  for (let i = 0; i < TIMED; i++) {
    const t0 = now();
    frame();
    sync();
    const t1 = now();
    samples.push(t1 - t0);
    if (t1 - start > BUDGET_MS && samples.length >= MIN_SAMPLES) break;
  }
  return nearestRankP95(samples);
}

/** Nearest-rank 95th percentile: samples[ceil(.95 n) - 1] of the sorted values, or 0 for none. Sorts in place. */
export function nearestRankP95(samples: number[]): number {
  if (samples.length === 0) return 0;
  samples.sort((a, b) => a - b);
  return samples[Math.ceil(0.95 * samples.length) - 1]!;
}
