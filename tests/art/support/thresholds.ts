// Every T11 gate limit in one place (plan section 5, M1's gate table), each with its source.
// tag 'A': assumed, set once on real frames at M2 and frozen after M3; changing it needs a Decision log entry and the
// reviewer's agreement (Agents.md). tag 'O': fixed by another document or by a measurement T11 does not own.
// reportOnly: printed and viewed, never asserted, with the Decision log entry that demoted it.

export interface Limit { readonly value: number; readonly dir: 'max' | 'min'; readonly tag: 'A' | 'O'; readonly source: string; readonly reportOnly?: boolean }

function max(value: number, tag: 'A' | 'O', source: string): Limit { return { value, dir: 'max', tag, source }; }
function min(value: number, tag: 'A' | 'O', source: string): Limit { return { value, dir: 'min', tag, source }; }
function reportOnly(l: Limit): Limit { return { ...l, reportOnly: true }; }

export const LIMITS = {
  /** Percent of pixels, min(r,g,b) > 235, `full`. */
  W1: max(0.5, 'O', 'architecture.md 6.7 near-white; prototype .003%'),
  /** Mean max - min, `full`. */
  W2: min(55, 'O', 'architecture.md 6.7 mean chroma; prototype 71'),
  /** Centre haze, uv radius .26, `min` against `min` at bloomGain 0, code values. */
  W3: max(20, 'A', 'M2 r00: clean worst 18.66 viewed and accepted (shard glow, Arctic/Canyon), p95 15.3; M3: DR6 (edge L x3) worst 22.07, the mildest real-path failure, DR1 min 45.5 [O]. Was 18 from the prototype; thin margin, 1.3'),
  /** Floor black, 25th percentile luma, rows 612-1079, `full`. */
  W4: max(13, 'A', 'M2 r00: clean worst 11.06 viewed and accepted (lit near spikes and cars), p95 8.1; toward.15 min 14.5, lift.08 min 22.1 [O]. Was 10'),
  /** Lit saturation, max >= 32, `full`. */
  W5: reportOnly(min(0.7, 'A', 'M2 r00: clean min .706 (Arctic Laser) overlaps lift.08 up to .746 and desat.4 up to .790 [O], so it does not separate')),
  /** Percent of pixels with max >= 254, `full`. */
  C1: max(2.5, 'A', 'M2 r00: clean worst 1.84% viewed and accepted (saturated neon fences and ring, no white), p95 1.41%; image flood median 4.3% [O]. Was 1'),
  /** T04's changes per level, sky crop x 64-320 rows 0-240 of `min`, channels spanning >= 8 levels. */
  B1: reportOnly(min(1.3, 'O', "T04's A10 [A; O min 1.35]. M2 r00: Miami Dusk's steep sky reads 1.19 to 1.22 in all 30 samples with no contour in a stretched crop, Toxic/Orbital's aurora .98, against post off's 1.00 [O], so it does not separate on real frames")),
  /** Share of the disc above the horizon covered, non-canyon, `bare` all against `bare` sky only, tolerance 24. */
  O1: max(0.15, 'O', 'architecture.md 11.5 and 14 risk 12 [A in architecture]'),
  /** Share of pixels above the horizon changed over 12 by props, each sample. */
  D1: min(0.04, 'A', 'M2 r00: clean worst .058 viewed and accepted (Arctic/Olympus, full, uncluttered), p5 .068; noprops 0 [O]. Was .08'),
  /** Each biome's median D1 against the median across biomes. */
  D1ratio: min(0.4, 'A', 'plan M1'),
  /** Of 12 outer screen columns above the horizon, how many under .5% coverage. */
  D2: max(1, 'A', "plan M1, mirrors T01's screen column rule"),
  /** Grid and accent slots, sRGB saturation at m = .25, .5, .75, all 30 ordered pairs. */
  X0: min(0.4, 'A', 'plan M1: OKLCh worst .41 [arithmetic]'),
  /** Real frame at m = .5: chroma. */
  X1chroma: min(50, 'A', 'plan M1: OKLCh 56.3 on Sunset to Toxic [O, stand-in, no props]'),
  /** Real frame at m = .5: lit saturation. */
  X1sat: min(0.6, 'A', 'plan M1: OKLCh .731 [O, stand-in]'),
  /** Largest full-frame mean luma step across a transition, 1500 frames at 1.3333 u. */
  /** Largest full-frame mean luma step across a transition, props hidden, as a multiple of the same zone's plain cruise. */
  X2step: max(1.5, 'A', 'M2 r00, props hidden: plain cruise steps 1.46 to 1.65 code values, transitions 1.67 to 1.82, ratio 1.10 to 1.15 [O]. Was an absolute 1.0, which plain cruise fails'),
  /** p99.9 of 64 x 36 block steps across a transition against the same biome's plain cruise. */
  X2ratio: max(1.5, 'A', 'plan M1'),
  /** Sparkle, abs second difference of luma > 60, share. Far floor rows 615-650. */
  S1far: max(0.07, 'A', 'M2 r00 and DR2, props hidden, cruise: clean 0.07% to 4.97%, hard-step grid 8.94% to 12.31% [O]. Was 2% from the prototype. Boost overlaps (clean up to 10.24%, DR2 from 9.79%), so boost is printed'),
  /** Mid floor rows 650-720. */
  S1mid: reportOnly(max(0.09, 'A', 'M2 r00 and DR2, props hidden: clean up to 16.0% (Boulevard), hard-step grid 8.7% to 10.9% [O], so it does not separate')),
  /** Far objects rows 440-590. Uncalibrated until M2: the prototype's objects did not move. */
  S1obj: reportOnly(max(0.0025, 'A', 'M2 r00: 20 to 38% with all layers, from true motion of near fences, gates and grid lines [O]; no limit separates it, props aliasing is gated by T05 A16b (DI-74, DI-82)')),
  /** Near floor mean frame difference, rows 760-1079. */
  S2: min(2, 'A', 'plan M1: prototype 5.4'),
  /** First lit frame after navigation of dist/, ms. */
  F1: max(3000, 'A', 'plan M1'),
  /** 64 x 36 mean luma of any screencast frame. */
  F2: max(140, 'A', 'plan M1'),
  /** Hit transient near-white percent (M7). */
  hitNearWhite: max(1.5, 'A', 'plan M7'),
  /** GPU-synced p95 ms per biome, tier 3. */
  P1ms: max(2, 'O', 'architecture.md 9.2 proxy gate'),
  P1calls: max(68, 'O', 'architecture.md 9.2'),
  P1tris: max(1_500_000, 'O', 'architecture.md 9.2'),
  /** Tier 0 on SwiftShader, ms. */
  P2: max(50, 'O', 'architecture.md 9.2'),
} as const satisfies Record<string, Limit>;

export type GateId = keyof typeof LIMITS;

/** True when value passes the limit. NaN never passes. */
export function passes(id: GateId, value: number): boolean {
  const l: Limit = LIMITS[id];
  if (!Number.isFinite(value)) return false;
  return l.dir === 'max' ? value <= l.value : value >= l.value;
}

/** For "worst" ordering: larger means worse. */
export function badness(id: GateId, value: number): number {
  const l: Limit = LIMITS[id];
  return l.dir === 'max' ? value : -value;
}

// Fixed measuring geometry, at 1920 x 1080 (plan M1, section 2).
export const FRAME_W = 1920;
export const FRAME_H = 1080;
/** Last row above the horizon, near row 590 (architecture.md 6.1). */
export const HORIZON_LAST_ROW = 589;
export const FLOOR_FIRST_ROW = 612;
export const CENTRE_R = 0.26;
export const B1_BOX = { x0: 64, y0: 0, x1: 320, y1: 240 } as const;
export const B1_MIN_LEVELS = 8;
export const SPARKLE_THRESH = 60;
export const BANDS = {
  farFloor: [615, 650],
  midFloor: [650, 720],
  farObjects: [440, 590],
  nearFloor: [760, 1080],
} as const;
export const CAM = { fovDeg: 58, pitch: 0.05 } as const;
/** Cruise step: 80 u/s at 60 Hz, and 2 sim ticks per frame at 120 Hz. Boost: 150 u/s. */
export const CRUISE_DU = 80 / 60;
export const BOOST_DU = 150 / 60;
export const TICKS_PER_FRAME = 2;
