import { describe, expect, it } from 'vitest';
import {
  CAMERA_FOV, CAMERA_Y, Ev, PHASE_COUNT, PHASE_PERIOD_TICKS, SIM_HZ, SPEED_CRUISE, SimMode, type FrameView, type Tier,
} from '../../../src/contracts/index';
import { between } from '../../../src/core/coords';
import { phaseOf } from '../../../src/core/motion';
import { createFakeWorld } from '../../../src/testing/fakeWorld';
import { fakeProfile, scriptedFrame } from '../../../src/testing/scriptedFrame';

function snapshot(v: FrameView): unknown {
  return {
    tick: v.tick, alpha: v.alpha, cam: { ...v.cam }, camX: v.camX, camY: v.camY, phases: Array.from(v.phases),
    sim: { ...v.sim, travel: { ...v.sim.travel } }, feel: { ...v.feel }, palette: Array.from(v.zone.palette), zoneIndex: v.zone.index,
    bend: { ...v.bend }, tier: v.quality.tier,
  };
}

describe('scriptedFrame', () => {
  it('gives the same values for the same t', () => {
    const a = snapshot(scriptedFrame(4.2));
    scriptedFrame(99);
    const b = snapshot(scriptedFrame(4.2));
    expect(b).toEqual(a);
  });

  it('returns one object, mutated in place', () => {
    expect(scriptedFrame(1)).toBe(scriptedFrame(2));
  });

  it('derives tick and alpha from t, with travel at tick distance from chunk 1', () => {
    const v = scriptedFrame(1.5);
    expect(v.tick).toBe(180);
    expect(v.alpha).toBe(0);
    expect(v.sim.stepDist).toBe(SPEED_CRUISE / SIM_HZ);
    expect(v.sim.speed).toBe(SPEED_CRUISE);
    expect(between(v.sim.travel, { chunk: 1, local: 0 })).toBeCloseTo(180 * (SPEED_CRUISE / SIM_HZ), 9);
  });

  it('interpolates the camera as section 3.3 step 5', () => {
    const v = scriptedFrame(1.5 + 0.25 / SIM_HZ);
    expect(v.tick).toBe(180);
    expect(v.alpha).toBeCloseTo(0.25, 6);
    expect(between(v.sim.travel, v.cam)).toBeCloseTo((1 - v.alpha) * v.sim.stepDist, 9);
  });

  it('phases equal section 4.5', () => {
    const v = scriptedFrame(3.21);
    for (let i = 0; i < PHASE_COUNT; i++) {
      expect(v.phases[i]).toBe(Math.fround(phaseOf(v.tick, v.alpha, i)));
    }
  });

  it('at gives alpha 0 and the exact cam, with phases at alpha 0', () => {
    const v = scriptedFrame(0, { at: { chunk: 2 ** 40, local: 12.5 }, tick: 120 });
    expect(v.alpha).toBe(0);
    expect(v.tick).toBe(120);
    expect(v.cam).toEqual({ chunk: 2 ** 40, local: 12.5 });
    expect(v.dt).toBe(0);
    for (let i = 0; i < PHASE_COUNT; i++) {
      const p = PHASE_PERIOD_TICKS[i]!;
      expect(v.phases[i]).toBe(Math.fround((120 % p) / p));
    }
  });

  it('at with no tick takes the tick from t', () => {
    expect(scriptedFrame(2, { at: { chunk: 3, local: 0 } }).tick).toBe(240);
  });

  it('o.hero sets both heroes and mix 0, o.biome both biomes and mix 0, o.palette the table', () => {
    const v = scriptedFrame(0, { hero: 2, biome: 4, palette: 3 });
    expect(v.zone.heroA).toBe(2);
    expect(v.zone.heroB).toBe(2);
    expect(v.zone.heroMix).toBe(0);
    expect(v.zone.biomeA).toBe(4);
    expect(v.zone.biomeB).toBe(4);
    expect(v.zone.biomeMix).toBe(0);
    expect(v.zone.paletteA).toBe(3);
    expect(v.zone.paletteB).toBe(3);
    // Toxic Arcade grid is #00FF9F, slot 5: red 0, green 1.
    expect(v.zone.palette[15]).toBe(0);
    expect(v.zone.palette[16]).toBe(1);
  });

  it('o.zone applies last, over palette, biome and hero', () => {
    const v = scriptedFrame(0, { hero: 2, biome: 4, zone: { heroA: 1, heroB: 3, heroMix: 0.5, biomeMix: 0.25, dayPhase: 0.75, index: 9 } });
    expect(v.zone.heroA).toBe(1);
    expect(v.zone.heroB).toBe(3);
    expect(v.zone.heroMix).toBe(0.5);
    expect(v.zone.biomeA).toBe(4);
    expect(v.zone.biomeMix).toBe(0.25);
    expect(v.zone.dayPhase).toBe(0.75);
    expect(v.zone.index).toBe(9);
    expect(v.sim.sectorIndex).toBe(9);
  });

  it('o.sim overrides win over derived values', () => {
    const v = scriptedFrame(4, { sim: { beat: 77, sync: 9, mode: SimMode.PLAY, speed: 123, score: 5, shields: 1 } });
    expect(v.sim.beat).toBe(77);
    expect(v.sim.sync).toBe(9);
    expect(v.sim.mode).toBe(SimMode.PLAY);
    expect(v.sim.speed).toBe(123);
    expect(v.sim.score).toBe(5);
    expect(v.sim.shields).toBe(1);
  });

  it('o.sim.travel writes into the stable travel object', () => {
    const before = scriptedFrame(0).sim.travel;
    const v = scriptedFrame(0, { sim: { travel: { chunk: 9, local: 1 } } });
    expect(v.sim.travel).toBe(before);
    expect(v.sim.travel).toEqual({ chunk: 9, local: 1 });
  });

  it('defaults sim values as M6, and the next call resets an override', () => {
    scriptedFrame(4, { sim: { mode: SimMode.PLAY, beat: 77 } });
    const v = scriptedFrame(4.5);
    expect(v.sim.mode).toBe(SimMode.DEMO);
    expect(v.sim.score).toBe(450);
    expect(v.sim.sync).toBe(2);
    expect(v.sim.shields).toBe(3);
    expect(v.sim.overdrive).toBeCloseTo(0.45, 9);
    expect(v.sim.beat).toBe(v.tick / 72);
    expect(v.sim.ghost).toBe(0);
    expect(v.sim.sectorIndex).toBe(v.zone.index);
    expect(v.sim.objectiveProgress).toBe(0);
  });

  it('derives camX and camY from sim, and sin(0) gives the framing T05 relies on', () => {
    const zero = scriptedFrame(0, { at: { chunk: 1, local: 0 }, tick: 0 });
    expect(zero.sim.x).toBe(0);
    expect(zero.sim.y).toBe(6);
    expect(zero.camX).toBe(0);
    expect(zero.camY).toBe(CAMERA_Y);
    const v = scriptedFrame(4);
    expect(v.sim.x).toBeCloseTo(12 * Math.sin((2 * Math.PI * 4) / 16), 9);
    expect(v.camX).toBeCloseTo(0.72 * v.sim.x, 9);
    const moved = scriptedFrame(0, { sim: { y: 10 } });
    expect(moved.camY).toBeCloseTo(CAMERA_Y + 0.35 * 4, 9);
  });

  it('camX and camY override the derived camera', () => {
    const v = scriptedFrame(4, { camX: -28.8, camY: 12 });
    expect(v.camX).toBe(-28.8);
    expect(v.camY).toBe(12);
  });

  it('feel is neutral, with overrides, and the next call resets them', () => {
    const v = scriptedFrame(0, { feel: { fovDeg: 68, shakeY: -0.05, bloomGain: 0 } });
    expect(v.feel.fovDeg).toBe(68);
    expect(v.feel.shakeY).toBe(-0.05);
    expect(v.feel.bloomGain).toBe(0);
    const w = scriptedFrame(0);
    expect(w.feel.fovDeg).toBe(CAMERA_FOV);
    expect(w.feel.shakeY).toBe(0);
    expect(w.feel.bloomGain).toBe(1);
  });

  it('o.bend overrides a and c and keeps vMax', () => {
    const v = scriptedFrame(0, { bend: { a: 0, c: 0 } });
    expect(v.bend.a).toBe(0);
    expect(v.bend.c).toBe(0);
    expect(v.bend.vMax).toBe(1500);
  });

  it('o.events fills the buffer with count set, and the next call clears it', () => {
    const v = scriptedFrame(0, { events: [{ kind: Ev.SHARD, x: 1, y: 2, value: 3, chunk: 4, index: 5 }] });
    expect(v.events.count).toBe(1);
    expect(v.events.kind[0]).toBe(Ev.SHARD);
    expect(v.events.x[0]).toBe(1);
    expect(v.events.y[0]).toBe(2);
    expect(v.events.value[0]).toBe(3);
    expect(v.events.chunk[0]).toBe(4);
    expect(v.events.index[0]).toBe(5);
    expect(scriptedFrame(0).events.count).toBe(0);
  });

  it('o.tier and o.reducedMotion apply', () => {
    const v = scriptedFrame(0, { tier: 1, reducedMotion: true });
    expect(v.quality.tier).toBe(1);
    expect(v.reducedMotion).toBe(true);
    const w = scriptedFrame(0);
    expect(w.quality.tier).toBe(3);
    expect(w.reducedMotion).toBe(false);
  });

  it('o.world supplies zone and bend', () => {
    const custom = createFakeWorld({ periodChunks: 8 });
    const v = scriptedFrame(0, { at: { chunk: 800, local: 0 }, world: custom });
    expect(v.zone.index).toBe(0);
    expect(scriptedFrame(0, { at: { chunk: 800, local: 0 } }).zone.index).toBe(8);
  });

  it('sim and zone are plain mutable objects at run time, which T08 relies on', () => {
    const v = scriptedFrame(0);
    (v.sim as { score: number }).score = 123;
    expect(v.sim.score).toBe(123);
  });
});

describe('fakeProfile', () => {
  it.each([
    [4, 2, 3686400, 4, true, 'full', 7, 384, 1, 1, 96],
    [3, 1.5, 2073600, 2, true, 'full', 6, 384, 1, 1, 64],
    [2, 1, 1440000, 0, false, 'noCa', 5, 192, 0.7, 1, 32],
    [1, 0.75, 921600, 0, false, 'min', 3, 0, 0.4, 2, 0],
    [0, 1, 230400, 0, false, 'bare', 0, 0, 0.08, 2, 0],
  ] as const)('tier %d copies section 6.10', (tier, dprCap, maxPixels, msaa, mirror, post, bloomLevels, nebulaWidth, propDensity, terrainStride, speedLines) => {
    expect(fakeProfile(tier as Tier)).toEqual({ tier, dprCap, maxPixels, msaa, mirror, post, bloomLevels, nebulaWidth, propDensity, terrainStride, speedLines });
  });
});
