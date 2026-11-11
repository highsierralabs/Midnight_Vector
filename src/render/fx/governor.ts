// The quality governor of section 6.10: turns rAF deltas into tier changes. Pure and allocation-free after create.
// Its only clock is the sum of the frameMs it is fed. Percentiles come from a fixed histogram, so there is no sort.
import type { Governor, Tier } from '../../contracts/index';
import { TIERS } from './quality';

export const WINDOW_MS = 2000;
export const SETTLE_MS = 3000;
export const MIN_WINDOW_SAMPLES = 5;
export const STALL_MS = 1000;
export const DOWN_P95_MS = 20;
export const UP_P95_MS = 17.5;
export const UP_CHAIN_MS = 60000;
export const STEADY_SPREAD_MS = 2;
export const TIER0_ENTRY_P95_MS = 50;
export const REVERSAL_MS = 30000;
export const LOCKOUT_MS = 300000;
export const HIST_BIN_MS = 0.25;
export const HIST_BINS = 512;

const TIER_COUNT = TIERS.length;

/** Section 6.10's boot rule. Not finite or not above 0 means no measurement, which is tier 3, the default. */
export function bootTier(p95Ms: number): Tier {
  if (!Number.isFinite(p95Ms) || p95Ms <= 0) return 3;
  if (p95Ms < 2) return 4;
  if (p95Ms < 14) return 3;
  if (p95Ms < 28) return 2;
  return 1;
}

export function createGovernorImpl(o: { software: boolean; bootP95Ms: number; forced: Tier | null }): Governor {
  const software = o.software;
  /** A missing measurement never triggers the display-limit hold. */
  const boot = Number.isFinite(o.bootP95Ms) && o.bootP95Ms > 0 ? o.bootP95Ms : Infinity;
  const hist = new Uint32Array(HIST_BINS);
  const lockUntil = new Float64Array(TIER_COUNT);

  let tier: Tier = o.forced ?? (software ? 0 : bootTier(o.bootP95Ms));
  let pinned = o.forced !== null;
  let pending: Tier | null = null;
  let clock = 0;
  let settle = SETTLE_MS;
  let chain = 0;
  let winMs = 0;
  let winN = 0;
  let lastUpAt = -Infinity;
  let lastUpTo = -1;
  let p50 = 0;
  let p95 = 0;

  function clearWindow(): void {
    hist.fill(0);
    winMs = 0;
    winN = 0;
  }

  /** Bin i holds (i - 1) * HIST_BIN_MS < ms <= i * HIST_BIN_MS. The top bin is overflow. */
  function addSample(ms: number): void {
    const i = Math.ceil(ms / HIST_BIN_MS);
    hist[i < HIST_BINS ? i : HIST_BINS - 1]!++;
    winMs += ms;
    winN += 1;
  }

  /** Nearest-rank percentiles, reporting the bin's upper edge, so 17.5 and 20 sit exactly on the thresholds. */
  function readPercentiles(): void {
    const r50 = Math.ceil(winN * 0.5);
    const r95 = Math.ceil(winN * 0.95);
    let seen = 0;
    let found50 = false;
    for (let i = 0; i < HIST_BINS; i++) {
      seen += hist[i]!;
      if (!found50 && seen >= r50) {
        p50 = i * HIST_BIN_MS;
        found50 = true;
      }
      if (seen >= r95) {
        p95 = i * HIST_BIN_MS;
        return;
      }
    }
  }

  function change(next: Tier): Tier {
    if (next < tier && lastUpTo === tier && clock - lastUpAt <= REVERSAL_MS) lockUntil[tier] = clock + LOCKOUT_MS;
    if (next > tier) {
      lastUpAt = clock;
      lastUpTo = next;
    }
    tier = next;
    settle = SETTLE_MS;
    chain = 0;
    clearWindow();
    return tier;
  }

  function rearm(): void {
    settle = SETTLE_MS;
    chain = 0;
    clearWindow();
  }

  return {
    get profile() {
      return TIERS[tier]!;
    },
    sample(ms: number): Tier | null {
      clock += ms;
      if (pending !== null) {
        const out = pending;
        pending = null;
        return out;
      }
      if (ms <= 0) return null;
      if (pinned || software) return null;
      if (ms >= STALL_MS) {
        chain = 0;
        clearWindow();
        return null;
      }
      if (settle > 0) {
        settle -= ms;
        return null;
      }
      addSample(ms);
      if (winMs < WINDOW_MS || winN < MIN_WINDOW_SAMPLES) return null;
      readPercentiles();
      const span = winMs;
      clearWindow();
      if (p95 > DOWN_P95_MS) {
        chain = 0;
        // A steady delta well above what boot measured is a display or power limit, and shedding quality would not help.
        if (p95 - p50 <= STEADY_SPREAD_MS && boot < p95 / 2) return null;
        if (tier > 1 || (tier === 1 && p95 > TIER0_ENTRY_P95_MS)) return change((tier - 1) as Tier);
        return null;
      }
      if (p95 <= UP_P95_MS) chain += span;
      else chain = 0;
      if (chain >= UP_CHAIN_MS && tier < 4 && lockUntil[tier + 1]! <= clock) return change((tier + 1) as Tier);
      return null;
    },
    force(t: Tier | 'auto'): void {
      if (t === 'auto') {
        pinned = false;
        rearm();
        if (software && tier !== 0) {
          tier = 0;
          pending = 0;
        }
        return;
      }
      pinned = true;
      if (t !== tier) {
        tier = t;
        pending = t;
      }
      rearm();
    },
  };
}
