// The tier table of section 6.10 as data, with the arithmetic that hangs off it. Pure: no three, no clock.
import type { QualityProfile } from '../../contracts/index';

/** Mean darkening of a scan period, expressed as the amplitude of a 3-row pattern with 1 dark row. */
export const SCAN = 0.1;

function row(p: QualityProfile): Readonly<QualityProfile> {
  return Object.freeze(p);
}

/** Index = tier. Exact pixel counts, per section 6.10. */
export const TIERS: readonly Readonly<QualityProfile>[] = Object.freeze([
  row({ tier: 0, dprCap: 1, maxPixels: 230400, msaa: 0, mirror: false, post: 'bare', bloomLevels: 0, nebulaWidth: 0, propDensity: 0.08, terrainStride: 2, speedLines: 0 }),
  row({ tier: 1, dprCap: 0.75, maxPixels: 921600, msaa: 0, mirror: false, post: 'min', bloomLevels: 3, nebulaWidth: 0, propDensity: 0.4, terrainStride: 2, speedLines: 0 }),
  row({ tier: 2, dprCap: 1, maxPixels: 1440000, msaa: 0, mirror: false, post: 'noCa', bloomLevels: 5, nebulaWidth: 192, propDensity: 0.7, terrainStride: 1, speedLines: 32 }),
  row({ tier: 3, dprCap: 1.5, maxPixels: 2073600, msaa: 2, mirror: true, post: 'full', bloomLevels: 6, nebulaWidth: 384, propDensity: 1, terrainStride: 1, speedLines: 64 }),
  row({ tier: 4, dprCap: 2, maxPixels: 3686400, msaa: 4, mirror: true, post: 'full', bloomLevels: 7, nebulaWidth: 384, propDensity: 1, terrainStride: 1, speedLines: 96 }),
]);

/** Section 6.10: min(devicePixelRatio, dprCap, sqrt(maxPixels / (cssW * cssH))). Never supersamples a DPR 1 monitor. */
export function pixelRatioFor(q: Readonly<QualityProfile>, cssW: number, cssH: number, dpr: number): number {
  return Math.min(dpr, q.dprCap, Math.sqrt(q.maxPixels / (cssW * cssH)));
}

/** An integer scan period in drawing-buffer rows, about 3 CSS px at any pixel ratio. At least 2, or there is no pattern. */
export function scanPeriodFor(pixelRatio: number): number {
  return Math.max(2, Math.round(3 * pixelRatio));
}

/** Rows of a period that are dark. The shader computes the same thing, so the two cannot disagree. */
export function scanDarkRows(period: number): number {
  return Math.floor(period / 3 + 0.5);
}

/** The amplitude that keeps mean darkening at SCAN / 3, so a tier change does not shift overall brightness. */
export function scanAmpFor(period: number): number {
  return (SCAN * (1 / 3)) / (scanDarkRows(period) / period);
}
