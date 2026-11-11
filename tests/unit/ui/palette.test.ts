import { describe, expect, it } from 'vitest';
import { PALETTE_FLOATS } from '../../../src/contracts/index';
import { writeFakePalette } from '../../../src/testing/fakeWorld';
import { createPaletteWriter, liftedColour } from '../../../src/ui/palette';

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function hexToLinear(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255)];
}

function luminance(hex: string): number {
  const [r, g, b] = hexToLinear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe('liftedColour', () => {
  it('leaves a bright colour alone, round trip through linear', () => {
    expect(liftedColour(hexToLinear('#2DE2E6'), 0)).toBe('#2DE2E6');
    expect(liftedColour(new Float32Array(hexToLinear('#2DE2E6')), 0)).toBe('#2DE2E6');
  });

  it('reads the offset it is given', () => {
    const p = new Float32Array([0, 0, 0, ...hexToLinear('#FFD319')]);
    expect(liftedColour(p, 3)).toBe('#FFD319');
  });

  it('lifts all six section 6.8 grid and accent colours to luminance .40 or more', () => {
    const p = new Float32Array(PALETTE_FLOATS);
    for (let row = 0; row < 6; row++) {
      writeFakePalette(row, p);
      for (const at of [15, 18]) {
        const hex = liftedColour(p, at);
        expect(hex, `row ${row} offset ${at}`).toMatch(/^#[0-9A-F]{6}$/);
        expect(luminance(hex), `row ${row} offset ${at}: ${hex}`).toBeGreaterThanOrEqual(0.4);
      }
    }
  });

  it('moves a dark colour toward white and keeps its hue order', () => {
    const hex = liftedColour(hexToLinear('#F6019D'), 0);
    expect(hex).not.toBe('#F6019D');
    const [r, g, b] = hexToLinear(hex);
    expect(r).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(g);
  });

  it('survives out of range input', () => {
    expect(liftedColour([2, -1, NaN], 0)).toMatch(/^#[0-9A-F]{6}$/);
    expect(liftedColour([], 0)).toMatch(/^#[0-9A-F]{6}$/);
  });
});

describe('createPaletteWriter', () => {
  function setup() {
    const writes: [string, string][] = [];
    const w = createPaletteWriter({ setProperty(p, v) { writes.push([p, v]); } });
    const palette = new Float32Array(PALETTE_FLOATS);
    writeFakePalette(0, palette);
    return { w, writes, zone: { paletteA: 0, paletteB: 1, paletteMix: 0, palette } };
  }

  it('writes both properties on the first frame and none while the key holds', () => {
    const { w, writes, zone } = setup();
    w.frame(0, zone);
    expect(writes.map((x) => x[0])).toEqual(['--mv-accent', '--mv-hot']);
    expect(writes[0]![1]).toBe('#2DE2E6');
    for (let t = 1; t < 1000; t++) w.frame(t, zone);
    expect(writes.length).toBe(2);
  });

  it('costs 32 writes over a whole crossfade', () => {
    const { w, writes, zone } = setup();
    const ticks = 2400;   // 20 s
    for (let t = 0; t <= ticks; t++) {
      zone.paletteMix = t / ticks * 0.9999;
      w.frame(t, zone);
    }
    expect(writes.length).toBe(32);
  });

  it('recomputes when either palette index changes', () => {
    const { w, writes, zone } = setup();
    w.frame(0, zone);
    zone.paletteB = 2;
    w.frame(10, zone);
    expect(writes.length).toBe(4);
    zone.paletteA = 3;
    w.frame(20, zone);
    expect(writes.length).toBe(6);
  });

  it('stays under the slot throttle', () => {
    const { w, writes, zone } = setup();
    for (let t = 0; t < 600; t++) {
      zone.paletteA = t % 6;
      w.frame(t, zone);
    }
    expect(writes.length).toBeLessThanOrEqual(200);
  });
});
