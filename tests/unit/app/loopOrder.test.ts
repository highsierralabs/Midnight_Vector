// A6: one frame records exactly section 3.3's order. Reordering any two steps fails a test here.
import { describe, expect, it } from 'vitest';
import { createRig, type Rig } from './fixtures/fakes';

const FRAME = [
  'raf', 'governor.sample', 'input.sample', 'step', 'step', 'zoneAt', 'bendAt', 'feel.update',
  'info.reset', 'writeUniforms', 'camera.updateMatrixWorld',
  'sky.frame', 'terrain.frame', 'props.frame', 'fx.frame', 'post.frame', 'post.render',
  'ui.frame', 'audio.frame', 'events.count=0',
];
const SET_QUALITY = ['sky.setQuality', 'terrain.setQuality', 'props.setQuality', 'fx.setQuality', 'post.setQuality'];
const REBUILD = ['sky.rebuild', 'terrain.rebuild', 'props.rebuild', 'fx.rebuild', 'post.rebuild'];

/** Starts the loop, runs the first frame (rawDt 0 after the clock reset), and clears the log. */
function started(): Rig {
  const rig = createRig();
  rig.loop.start();
  rig.frame(1000);
  rig.r.log.length = 0;
  return rig;
}

/** rawDt = 2.5 / 120 s cannot straddle a step boundary, so it is exactly 2 steps (section 10 of the plan). */
const T1 = 1000 + 2500 / 120;

describe('section 3.3 order', () => {
  it('one frame with a tier pending records every step in order', () => {
    const rig = started();
    rig.gov.pend(2);
    rig.frame(T1);
    expect(rig.r.log).toEqual([...FRAME, ...SET_QUALITY]);
    expect(rig.view.quality.tier).toBe(2);
  });

  it('with no tier pending, step 15 does nothing', () => {
    const rig = started();
    rig.frame(T1);
    expect(rig.r.log).toEqual(FRAME);
  });

  it('a changed warpSerial rebuilds once, between the camera and sky.frame', () => {
    const rig = started();
    expect(rig.sim.warpTo(40, 10)).toBe(true);
    rig.frame(T1);
    const i = FRAME.indexOf('sky.frame');
    expect(rig.r.log).toEqual([...FRAME.slice(0, i), ...REBUILD, ...FRAME.slice(i)]);
    rig.r.log.length = 0;
    rig.frame(T1 + 2000 / 120);
    expect(rig.r.log).toEqual(FRAME);
  });

  it('with the context lost: step, feel, ui and audio remain; drawing, rebuild and setQuality wait for the restore', () => {
    const rig = started();
    rig.deps.flags.contextOk = false;
    rig.gov.pend(1);
    rig.sim.warpTo(50, 0);
    rig.frame(T1);
    const lost = FRAME.filter((s) => !/\.frame$|^post\./.test(s) || s === 'ui.frame' || s === 'audio.frame');
    expect(rig.r.log).toEqual(lost);
    expect(rig.r.log).toContain('step');
    expect(rig.r.log).toContain('feel.update');
    expect(rig.deps.flags.tierHeld).toBe(true);
    expect(rig.view.quality.tier).toBe(3);

    // Lifecycle's restore: contextOk and restorePending set together.
    rig.deps.flags.contextOk = true;
    rig.deps.flags.restorePending = true;
    rig.r.log.length = 0;
    rig.frame(T1 + 2000 / 120);
    const i = FRAME.indexOf('sky.frame');
    expect(rig.r.log).toEqual([...FRAME.slice(0, i), ...REBUILD, ...FRAME.slice(i), ...SET_QUALITY]);
    expect(rig.view.quality.tier).toBe(1);
    expect(rig.deps.flags.tierHeld).toBe(false);
    expect(rig.deps.flags.restorePending).toBe(false);
  });

  it('zone and bend overrides are written after bendAt and before feel.update', () => {
    const rig = started();
    const floats = new Float32Array(21).fill(0.25);
    rig.deps.overrides.zone = { palette: 2, biome: 5, hero: 3, floats };
    rig.deps.overrides.bend = { a: 7e-5, c: -3e-6 };
    const seen: unknown[] = [];
    rig.feel.probe = () => {
      const z = rig.view.zone;
      seen.push([z.paletteA, z.paletteB, z.paletteMix, z.biomeA, z.biomeB, z.biomeMix, z.heroA, z.heroB, z.heroMix, z.palette[20], rig.view.bend.a, rig.view.bend.c]);
    };
    rig.frame(T1);
    expect(seen).toEqual([[2, 2, 0, 5, 5, 0, 3, 3, 0, 0.25, 7e-5, -3e-6]]);
    rig.deps.overrides.zone = null;
    rig.deps.overrides.bend = null;
    seen.length = 0;
    rig.frame(T1 + 2000 / 120);
    expect(seen).toEqual([[4, 1, 0.5, 4, 2, 0.25, 1, 2, 0.75, 0.5, 1e-5, -1.2e-5]]);
  });

  it('renderState runs steps 2 and 5 to 15: no input, no step, no feel.update', () => {
    const rig = started();
    rig.loop.renderState(rig.sim.state.travel.chunk, 0, 500);
    expect(rig.r.log).toEqual(FRAME.filter((s) => !['raf', 'input.sample', 'step', 'feel.update'].includes(s)));
  });

  it('runFrame runs steps 2 to 15 and arms no rAF', () => {
    const rig = started();
    rig.loop.setManual(true);
    rig.r.log.length = 0;
    rig.loop.runFrame(2.5 / 120);
    expect(rig.r.log).toEqual(FRAME.slice(1));
    expect(rig.gov.samples.at(-1)).toBe(0);
  });
});
