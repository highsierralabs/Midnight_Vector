// HUD tints from the zone's grid and accent. A palette colour is a light in the world, and a dark one fails as text, so
// each is lifted toward white in linear light until its luminance can carry text over the panel fill.
import { createGate, type Gate, type StyleTarget } from './slots';

/** Section 8.1: 7 linear RGB triples, with grid at 15 and accent at 18. */
const GRID_OFFSET = 15;
const ACCENT_OFFSET = 18;

/** At least .40 after 8-bit rounding, which .405 leaves room for. */
const LIFT_TARGET = 0.405;
const MIX_STEPS = 16;

function clamp01(v: number): number {
  return v > 0 ? (v < 1 ? v : 1) : 0;
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function byteHex(linear: number): string {
  return Math.round(clamp01(linearToSrgb(linear)) * 255).toString(16).padStart(2, '0').toUpperCase();
}

/** The colour at p[at..at+2], linear floats, lifted if it is too dark, as #RRGGBB. */
export function liftedColour(p: ArrayLike<number>, at: number): string {
  let r = clamp01(p[at] ?? 0);
  let g = clamp01(p[at + 1] ?? 0);
  let b = clamp01(p[at + 2] ?? 0);
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (l < LIFT_TARGET) {
    const t = (LIFT_TARGET - l) / (1 - l);
    r += (1 - r) * t;
    g += (1 - g) * t;
    b += (1 - b) * t;
  }
  return `#${byteHex(r)}${byteHex(g)}${byteHex(b)}`;
}

export interface PaletteZone { paletteA: number; paletteB: number; paletteMix: number; readonly palette: ArrayLike<number> }
export interface PaletteWriter { frame(tick: number, zone: Readonly<PaletteZone>): void }

/** Recomputes only when paletteA, paletteB or floor(paletteMix * 16) changes, so a crossfade costs 32 style writes. */
export function createPaletteWriter(target: StyleTarget): PaletteWriter {
  const gate: Gate = createGate();
  return {
    frame(tick, zone) {
      const key = zone.paletteA * 4096 + zone.paletteB * 64 + Math.floor(zone.paletteMix * MIX_STEPS);
      if (!gate.pass(tick, key)) return;
      target.setProperty('--mv-accent', liftedColour(zone.palette, ACCENT_OFFSET));
      target.setProperty('--mv-hot', liftedColour(zone.palette, GRID_OFFSET));
    },
  };
}
