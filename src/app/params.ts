// The URL switches, read here and nowhere else (plan section 4). Pure: the caller passes the search string and a warn.
import { DEFAULT_SEED, type Tier } from '../contracts/index';

export interface AppParams {
  readonly seed: number;
  /** ?harness: loads src/harness and the test hook after boot. */
  readonly harness: boolean;
  /** WorldOptions.periodChunks. 1024 under ?harness unless ?period overrides it, 0 (aperiodic) otherwise. */
  readonly period: number;
  /** ?tier=0..4: CreateGovernor.forced, and no boot timing. null when absent or bad. */
  readonly tier: Tier | null;
}

export const HARNESS_PERIOD = 1024;
const INT = /^-?\d+$/;
const NON_NEGATIVE_INT = /^\d+$/;
const TIER = /^[0-4]$/;

/** A bad value warns once and falls back, so createWorld's RangeError cannot fire from a URL. */
export function parseParams(search: string, warn: (msg: string) => void = (m) => { console.warn(m); }): AppParams {
  const q = new URLSearchParams(search);
  const harness = q.has('harness');

  let seed: number = DEFAULT_SEED;
  const rawSeed = q.get('seed');
  if (rawSeed !== null) {
    const n = Number(rawSeed);
    if (INT.test(rawSeed) && Number.isSafeInteger(n)) seed = n;
    else warn(`MV: ?seed=${rawSeed} is not a safe integer; using ${DEFAULT_SEED}`);
  }

  let period = harness ? HARNESS_PERIOD : 0;
  const rawPeriod = q.get('period');
  if (rawPeriod !== null) {
    if (!harness) {
      warn('MV: ?period is honoured only with ?harness; ignored');
    } else {
      const n = Number(rawPeriod);
      if (NON_NEGATIVE_INT.test(rawPeriod) && Number.isSafeInteger(n) && n % 8 === 0) period = n;
      else warn(`MV: ?period=${rawPeriod} must be a non-negative multiple of 8; using ${HARNESS_PERIOD}`);
    }
  }

  let tier: Tier | null = null;
  const rawTier = q.get('tier');
  if (rawTier !== null) {
    if (TIER.test(rawTier)) tier = Number(rawTier) as Tier;
    else warn(`MV: ?tier=${rawTier} must be 0 to 4; ignored`);
  }

  return { seed, harness, period, tier };
}
