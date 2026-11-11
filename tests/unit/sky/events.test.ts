import { describe, expect, it } from 'vitest';
import { Biome } from '../../../src/contracts/index';
import { biomeWeight, createSkyEvents, nightFactor, SKY_CYCLE, writeSkyEvents, type SkyEvents, type SkyZone } from '../../../src/render/sky/events';
import { BOLT_SLOT_TICKS, BOLT_X_MAX, METEOR_CHANNEL_OFFSET, METEOR_SLOT_TICKS } from '../../../src/render/sky/skyParams';

const SEED = 1985;
const ORBITAL: SkyZone = { biomeA: Biome.ORBITAL_NIGHT, biomeB: Biome.ORBITAL_NIGHT, biomeMix: 0, dayPhase: 0 };
const CANYON: SkyZone = { biomeA: Biome.CYBER_CANYON, biomeB: Biome.CYBER_CANYON, biomeMix: 0, dayPhase: 0 };
const BOULEVARD: SkyZone = { biomeA: Biome.BOULEVARD, biomeB: Biome.BOULEVARD, biomeMix: 0, dayPhase: 0 };

function snapshot(e: SkyEvents): number[] {
  return [...e.met, ...e.metK, ...e.boltX, e.boltK, e.flash, e.aurora];
}

describe('writeSkyEvents is pure', () => {
  it('gives the same output for the same input, in any call order', () => {
    const a = createSkyEvents();
    const b = createSkyEvents();
    const ticks = [0, 600, 1234, 9999, 30719, 480, 20000];
    const first = ticks.map((t) => { writeSkyEvents(SEED, t, 0.25, ORBITAL, false, a); return snapshot(a); });
    const reversed = [...ticks].reverse().map((t) => { writeSkyEvents(SEED, t, 0.25, ORBITAL, false, b); return snapshot(b); }).reverse();
    expect(reversed).toEqual(first);
  });

  it('leaves nothing behind from an earlier strike or meteor', () => {
    const dirty = createSkyEvents();
    dirty.met.fill(9);
    dirty.metK.fill(9);
    dirty.boltX.fill(9);
    dirty.boltK = 9;
    dirty.flash = 9;
    dirty.aurora = 9;
    const clean = createSkyEvents();
    for (let t = 0; t < SKY_CYCLE; t += 37) {
      writeSkyEvents(SEED, t, 0, CANYON, false, dirty);
      writeSkyEvents(SEED, t, 0, CANYON, false, clean);
      expect(snapshot(dirty)).toEqual(snapshot(clean));
    }
  });

  it('is identical at tick and tick + 30720 * 2^30', () => {
    const a = createSkyEvents();
    const b = createSkyEvents();
    for (let t = 0; t < SKY_CYCLE; t += 11) {
      writeSkyEvents(SEED, t, 0.5, ORBITAL, false, a);
      writeSkyEvents(SEED, t + SKY_CYCLE * 2 ** 30, 0.5, ORBITAL, false, b);
      expect(snapshot(b)).toEqual(snapshot(a));
    }
  });

  it('keeps the identity of its out arrays', () => {
    const e = createSkyEvents();
    const { met, metK, boltX } = e;
    for (let t = 0; t < 4000; t += 7) writeSkyEvents(SEED, t, 0, CANYON, false, e);
    expect(e.met).toBe(met);
    expect(e.metK).toBe(metK);
    expect(e.boltX).toBe(boltX);
    expect([met.length, metK.length, boltX.length]).toEqual([8, 2, 9]);
  });
});

describe('meteors over a full cycle at 120 Hz', () => {
  it('appear in every zone, more often in Orbital Night, and rest in the last 20% of a slot', () => {
    const e = createSkyEvents();
    const active: Record<string, number> = { orbital: 0, boulevard: 0 };
    for (const [name, zone] of [['orbital', ORBITAL], ['boulevard', BOULEVARD]] as const) {
      for (let t = 0; t < SKY_CYCLE; t++) {
        writeSkyEvents(SEED, t, 0, zone, false, e);
        for (let c = 0; c < 2; c++) {
          if (e.metK[c]! > 0) {
            active[name]!++;
            const local = (t + SKY_CYCLE - c * METEOR_CHANNEL_OFFSET) % METEOR_SLOT_TICKS;
            expect(local / METEOR_SLOT_TICKS).toBeLessThan(0.8);
          }
        }
      }
    }
    expect(active['boulevard']).toBeGreaterThan(0);
    expect(active['orbital']).toBeGreaterThan(active['boulevard']!);
  });

  it('moves the head toward the centre, keeps the tail behind it, and stays above the horizon', () => {
    const e = createSkyEvents();
    let checked = 0;
    let previous = 0, previousHead = 0;
    for (let t = 0; t < SKY_CYCLE; t++) {
      writeSkyEvents(SEED, t, 0, ORBITAL, false, e);
      const k = e.metK[0]!;
      if (k > 0) {
        expect(e.met[1]!).toBeGreaterThan(0);
        expect(e.met[3]!).toBeGreaterThanOrEqual(e.met[1]!);
        if (previous > 0) {
          expect(Math.abs(e.met[0]!)).toBeLessThanOrEqual(Math.abs(previousHead) + 1e-3 + 0.02);
          checked++;
        }
      }
      previous = k;
      previousHead = e.met[0]!;
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('runs channel 1 through the cycle wrap with no jump', () => {
    const a = createSkyEvents();
    const b = createSkyEvents();
    writeSkyEvents(SEED, SKY_CYCLE - 1, 0.999999, ORBITAL, false, a);
    writeSkyEvents(SEED, SKY_CYCLE, 0, ORBITAL, false, b);
    for (let i = 0; i < 2; i++) expect(Math.abs(a.metK[i]! - b.metK[i]!)).toBeLessThan(1e-3);
    for (let i = 0; i < 8; i++) expect(Math.abs(a.met[i]! - b.met[i]!)).toBeLessThan(1e-3);
  });

  it('has metK continuous as biomeMix ramps at the production rate, so a changing weight cannot pop a meteor', () => {
    const e = createSkyEvents();
    let worst = 0;
    let moved = false;
    for (let t = 0; t < SKY_CYCLE; t += 3) {
      let previous = -1;
      for (let m = 0; m <= 1200; m += 12) {
        const z: SkyZone = { biomeA: Biome.BOULEVARD, biomeB: Biome.ORBITAL_NIGHT, biomeMix: m / 1200, dayPhase: 0 };
        writeSkyEvents(SEED, t, 0, z, false, e);
        const k = e.metK[0]!;
        if (previous >= 0) {
          worst = Math.max(worst, Math.abs(k - previous));
          if (k !== previous) moved = true;
        }
        previous = k;
      }
    }
    expect(moved).toBe(true);
    // Twelve production steps: the gate moves .25 / 1200 / .02 per step, so at most .125 over twelve of them.
    expect(worst).toBeLessThanOrEqual(0.13);
  });

  it('has metK 0 under reduced motion', () => {
    const e = createSkyEvents();
    for (let t = 0; t < SKY_CYCLE; t++) {
      writeSkyEvents(SEED, t, 0, ORBITAL, true, e);
      expect(e.metK[0]).toBe(0);
      expect(e.metK[1]).toBe(0);
    }
  });
});

describe('lightning over a full cycle at 120 Hz', () => {
  function flashes(zone: SkyZone, reduced: boolean): Float64Array {
    const e = createSkyEvents();
    const out = new Float64Array(SKY_CYCLE);
    for (let t = 0; t < SKY_CYCLE; t++) {
      writeSkyEvents(SEED, t, 0, zone, reduced, e);
      out[t] = e.flash;
      if (!reduced && zone === CANYON) expect(e.flash).toBeCloseTo(0.05 * e.boltK, 12);
    }
    return out;
  }

  it('strikes in Cyber Canyon, under .05, with at most two rising edges in any 120-tick window and 3.7 s between strikes', () => {
    const f = flashes(CANYON, false);
    const rising: number[] = [];
    for (let t = 1; t < SKY_CYCLE; t++) if (f[t]! > 0 && f[t - 1] === 0) rising.push(t);
    expect(rising.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...f)).toBeLessThanOrEqual(0.05);
    for (let i = 0; i < rising.length; i++) {
      let inWindow = 0;
      for (const r of rising) if (r >= rising[i]! && r < rising[i]! + 120) inWindow++;
      expect(inWindow).toBeLessThanOrEqual(2);
    }
    // Rising edges come in pairs 20 ticks apart. A pair's first edge is at least 3.7 s after the one before it.
    for (let i = 0; i < rising.length; i += 2) expect(rising[i + 1]! - rising[i]!).toBe(20);
    for (let i = 2; i < rising.length; i += 2) expect(rising[i]! - rising[i - 1]!).toBeGreaterThanOrEqual(3.7 * 120);
  });

  it('stays inside its slot, so a strike cannot cross a slot boundary', () => {
    const e = createSkyEvents();
    for (let t = 0; t < SKY_CYCLE; t++) {
      writeSkyEvents(SEED, t, 0, CANYON, false, e);
      if (e.boltK > 0) {
        const local = t % BOLT_SLOT_TICKS;
        expect(local).toBeGreaterThanOrEqual(192);
        expect(local).toBeLessThan(192 + 1440 + 30);
      }
    }
  });

  it('has boltK 0 at weight 0 and under reduced motion', () => {
    const e = createSkyEvents();
    for (let t = 0; t < SKY_CYCLE; t++) {
      writeSkyEvents(SEED, t, 0, BOULEVARD, false, e);
      expect(e.boltK).toBe(0);
      expect(e.flash).toBe(0);
      writeSkyEvents(SEED, t, 0, CANYON, true, e);
      expect(e.boltK).toBe(0);
      expect(e.flash).toBe(0);
    }
  });

  it('scales with the biome weight', () => {
    const f = flashes(CANYON, false);
    const peak = f.indexOf(Math.max(...f));
    const half = createSkyEvents();
    writeSkyEvents(SEED, peak, 0, { biomeA: Biome.BOULEVARD, biomeB: Biome.CYBER_CANYON, biomeMix: 0.5, dayPhase: 0 }, false, half);
    expect(half.flash).toBeCloseTo(f[peak]! * 0.5, 10);
  });

  it('keeps every bolt on a 16:9 screen at FOV 58, and almost never over the disc', () => {
    // V1 review: about a quarter of strikes lay wholly past the screen edge, so the sky flashed with no bolt.
    const e = createSkyEvents();
    let strikes = 0, overDisc = 0, worst = 0;
    for (let seed = 1; seed <= 200; seed++) {
      let lastSlot = -1;
      // A strobe lasts 12 ticks, so a 10-tick step finds every strike.
      for (let t = 0; t < SKY_CYCLE; t += 10) {
        writeSkyEvents(seed, t, 0, CANYON, false, e);
        const slot = Math.floor(t / BOLT_SLOT_TICKS);
        if (e.boltK === 0 || slot === lastSlot) continue;
        lastSlot = slot;
        strikes++;
        let inner = Infinity;
        for (const x of e.boltX) {
          worst = Math.max(worst, Math.abs(x));
          inner = Math.min(inner, Math.abs(x));
        }
        if (inner < 0.215) overDisc++;   // HERO_R: the disc composites over the bolt there
      }
    }
    expect(strikes).toBeGreaterThan(1000);
    expect(worst).toBeLessThanOrEqual(BOLT_X_MAX + 1e-6);
    expect(overDisc / strikes).toBeLessThanOrEqual(0.01);
  });
});

describe('weights', () => {
  it('biomeWeight ignores biomeB at mix 0 and reaches B exactly at mix 1', () => {
    const z = (biomeMix: number): SkyZone => ({ biomeA: 0, biomeB: 4, biomeMix, dayPhase: 0 });
    expect(biomeWeight(z(0), 4)).toBe(0);
    expect(biomeWeight(z(0), 0)).toBe(1);
    expect(biomeWeight(z(0.25), 4)).toBe(0.25);
    expect(biomeWeight(z(0.25), 0)).toBe(0.75);
    expect(biomeWeight(z(1), 4)).toBe(1);
    expect(biomeWeight(z(1), 0)).toBe(0);
    expect(biomeWeight(z(0.5), 3)).toBe(0);
  });

  it('nightFactor is 1 at dayPhase 0, equal just under 1, and 0 at .5', () => {
    expect(nightFactor(0)).toBe(1);
    expect(Math.abs(nightFactor(0) - nightFactor(1 - 1e-6))).toBeLessThanOrEqual(1e-6);
    expect(nightFactor(0.5)).toBeCloseTo(0, 12);
  });

  it('aurora is on only by Orbital Night weight, stays on under reduced motion, and follows the night', () => {
    const e = createSkyEvents();
    writeSkyEvents(SEED, 100, 0, ORBITAL, false, e);
    expect(e.aurora).toBe(1);
    writeSkyEvents(SEED, 100, 0, ORBITAL, true, e);
    expect(e.aurora).toBe(1);
    writeSkyEvents(SEED, 100, 0, { ...ORBITAL, dayPhase: 0.5 }, false, e);
    expect(e.aurora).toBeCloseTo(0.6, 10);
    writeSkyEvents(SEED, 100, 0, BOULEVARD, false, e);
    expect(e.aurora).toBe(0);
  });
});
