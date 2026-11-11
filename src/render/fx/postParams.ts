// All the per-frame arithmetic of the post stack, away from any GL: what a FrameView means for the effects. Pure, and
// writes only into the caller's object, so a frame allocates nothing here.
import type { FrameView, PostVariant } from '../../contracts/index';
import { scanAmpFor, scanPeriodFor } from './quality';

export const BLOOM_INTENSITY = 0.8;
/** T02's bloomGain tops out at 1.25. This is the last defence, and a harness override of 0 stays legal. */
export const BLOOM_GAIN_MAX = 1.5;
export const GRAIN = 0.07;
/** Flash adds the flash slot's colour at this luma, so feel's cap of .6 adds luma .12 and the frame keeps its colour. */
export const FLASH_LUMA = 0.2;
/** Grain steps every 5 ticks, 24 Hz at 120 Hz, and repeats with the 64 s phase. */
export const GRAIN_TICKS = 5;
export const GRAIN_PERIOD_TICKS = 7680;

const TAU = 2 * Math.PI;
const CA_X_LOW = 0.0006;
const CA_X_HIGH = 0.0014;
const CA_Y_LOW = 0.0003;
const CA_Y_HIGH = 0.0007;
const EXPOSURE_NIGHT_CUT = 0.12;
/** T11 r09: the flash takes the palette's grid colour (slot 5), its own dominant line hue, not the accent: an accent complementary
 * to the palette's dominant hue (Sunset Drive's cyan, Ultraviolet's mint) washed the peak flash frame to a muted teal (DI-66). */
const FLASH_SLOT = 15;

export interface PostParams {
  caX: number; caY: number; bloomIntensity: number; exposure: number;
  scan: number; scanPeriod: number; grain: number; grainFrame: number;
  flash: number; flashR: number; flashG: number; flashB: number; glitch: number;
}

export function createPostParams(): PostParams {
  return {
    caX: 0, caY: 0, bloomIntensity: BLOOM_INTENSITY, exposure: 1,
    scan: 0, scanPeriod: 3, grain: 0, grainFrame: 0,
    flash: 0, flashR: 0, flashG: 0, flashB: 0, glitch: 0,
  };
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** .88 at deepest night, 1 at midday. Only the cosine is read, so dayPhase's wrap cannot pop. */
export function exposureFor(dayPhase: number): number {
  return 1 - EXPOSURE_NIGHT_CUT * (0.5 + 0.5 * Math.cos(TAU * dayPhase));
}

export function computePostParams(v: Readonly<FrameView>, variant: PostVariant, pixelRatio: number, gainMax: number, out: PostParams): void {
  const feel = v.feel;
  if (v.reducedMotion || variant !== 'full') {
    out.caX = 0;
    out.caY = 0;
  } else {
    const a = clamp(feel.aberration, 0, 1);
    out.caX = CA_X_LOW + (CA_X_HIGH - CA_X_LOW) * a;
    out.caY = CA_Y_LOW + (CA_Y_HIGH - CA_Y_LOW) * a;
  }
  out.bloomIntensity = BLOOM_INTENSITY * clamp(feel.bloomGain, 0, gainMax);
  out.exposure = exposureFor(v.zone.dayPhase);

  const textured = variant === 'full' || variant === 'noCa';
  out.scanPeriod = scanPeriodFor(pixelRatio);
  out.scan = textured ? scanAmpFor(out.scanPeriod) : 0;
  out.grain = textured && !v.reducedMotion ? GRAIN : 0;
  out.grainFrame = Math.floor((v.tick % GRAIN_PERIOD_TICKS) / GRAIN_TICKS);

  out.flash = feel.flash;
  const pal = v.zone.palette;
  const r = pal[FLASH_SLOT]!;
  const g = pal[FLASH_SLOT + 1]!;
  const b = pal[FLASH_SLOT + 2]!;
  const luma = Math.max(0.2126 * r + 0.7152 * g + 0.0722 * b, 1e-3);
  const k = FLASH_LUMA / luma;
  out.flashR = r * k;
  out.flashG = g * k;
  out.flashB = b * k;
  out.glitch = feel.glitch;
}
