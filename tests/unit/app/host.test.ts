// HarnessHost delegation, on the recording rig: each member reaches the live loop and overrides, per plan section 4.
import { describe, expect, it } from 'vitest';
import { CAMERA_PITCH, PALETTE_FLOATS, type RenderContext } from '../../../src/contracts/index';
import { writePalette } from '../../../src/world/palettes';
import { createHost } from '../../../src/app/host';
import { createRig } from './fixtures/fakes';

function hostRig() {
  const rig = createRig();
  const ctx = { renderer: null, scene: null, camera: rig.camera, shared: rig.deps.shared, world: rig.world } as unknown as RenderContext;
  const host = createHost({ sim: rig.sim, ctx, layers: rig.layers, post: rig.post, loop: rig.loop, overrides: rig.deps.overrides, governor: () => rig.gov });
  rig.loop.start();
  rig.frame(0);
  return { rig, host };
}

describe('createHost', () => {
  it('hands over the live objects, unfrozen', () => {
    const { rig, host } = hostRig();
    expect(host.sim).toBe(rig.sim);
    expect(host.layers).toBe(rig.layers);
    expect(host.post).toBe(rig.post);
    expect(host.governor).toBe(rig.gov);
    expect(host.layers.map((l) => l.name)).toEqual(['sky', 'terrain', 'props', 'fx']);
    for (const o of [host.sim, host.post, ...host.layers]) expect(Object.isFrozen(o)).toBe(false);
  });

  it('setManual(true) cancels the pending frame and is idempotent; false re-arms once', () => {
    const { rig, host } = hostRig();
    host.setManual(true);
    host.setManual(true);
    expect(rig.raf.pending).toBeNull();
    host.setManual(false);
    expect(rig.raf.pending).not.toBeNull();
  });

  it('runFrame steps the sim and feeds sample(0); renderState steps nothing and holds the sim still', () => {
    const { rig, host } = hostRig();
    host.setManual(true);
    const steps = rig.sim.steps;
    host.runFrame(2.5 / 120);
    expect(rig.sim.steps - steps).toBe(2);
    expect(rig.gov.samples.at(-1)).toBe(0);
    const tick = rig.sim.state.tick;
    const travel = { ...rig.sim.state.travel };
    host.renderState(5, 3, 120);
    expect(rig.sim.state.tick).toBe(tick);
    expect(rig.sim.state.travel).toEqual(travel);
    expect(rig.view.cam).toEqual({ chunk: 5, local: 3 });
    expect(rig.view.tick).toBe(120);
    expect(rig.view.alpha).toBe(0);
    expect(rig.view.dt).toBe(0);
    expect(rig.view.feel).toBe(rig.deps.neutralFeel);
  });

  it('renderState rebuilds first on a backward move or a jump over CHUNK_LEN, and not on a step within it', () => {
    const { rig, host } = hostRig();
    host.setManual(true);
    const count = () => rig.r.log.filter((s) => s === 'sky.rebuild').length;
    host.renderState(1000, 0, 120);
    expect(count()).toBe(1);
    host.renderState(1000, 30, 120);
    host.renderState(1000 + 1, 0, 120);
    expect(count()).toBe(1);
    host.renderState(1000, 63, 120);
    expect(count()).toBe(2);
    host.renderState(1003, 0, 120);
    expect(count()).toBe(3);
  });

  it('overrideZone writes the palette through writePalette, all mixes 0; null restores the world', () => {
    const { rig, host } = hostRig();
    host.setManual(true);
    host.overrideZone({ palette: 5, biome: 2, hero: 3 });
    host.renderState(10, 0, 0);
    const want = new Float32Array(PALETTE_FLOATS);
    writePalette(5, want);
    expect(Array.from(rig.view.zone.palette)).toEqual(Array.from(want));
    const z = rig.view.zone;
    expect([z.paletteA, z.paletteB, z.biomeA, z.biomeB, z.heroA, z.heroB, z.paletteMix, z.biomeMix, z.heroMix]).toEqual([5, 5, 2, 2, 3, 3, 0, 0, 0]);
    host.overrideZone(null);
    host.renderState(10, 1, 0);
    expect(rig.view.zone.paletteA).toBe(4);
  });

  it('overrideBend replaces a and c, leaving vMax', () => {
    const { rig, host } = hostRig();
    host.setManual(true);
    host.overrideBend({ a: 8e-5, c: 0 });
    host.renderState(10, 0, 0);
    expect(rig.view.bend).toEqual({ a: 8e-5, c: 0, vMax: 1500 });
    host.overrideBend(null);
    host.renderState(10, 1, 0);
    expect(rig.view.bend.a).toBe(1e-5);
  });

  it('overrideFeel merges over neutral feel in renderState and over feel.out in runFrame; overrideFov wins on fovDeg', () => {
    const { rig, host } = hostRig();
    host.setManual(true);
    host.overrideFeel({ shakeY: -CAMERA_PITCH, fovDeg: 60 });
    host.renderState(10, 0, 0);
    expect(rig.view.feel.shakeY).toBe(-CAMERA_PITCH);
    expect(rig.view.feel.fovDeg).toBe(60);
    expect(rig.camera.rotation.x).toBe(0);
    host.overrideFov(68);
    host.renderState(10, 1, 0);
    expect(rig.view.feel.fovDeg).toBe(68);
    expect(rig.camera.fov).toBe(68);
    (rig.feel.out as { roll: number }).roll = 0.01;
    host.runFrame(1 / 60);
    expect(rig.view.feel.roll).toBe(0.01);
    expect(rig.view.feel.shakeY).toBe(-CAMERA_PITCH);
    expect(rig.view.feel.fovDeg).toBe(68);
    host.overrideFeel(null);
    host.overrideFov(null);
    host.runFrame(1 / 60);
    expect(rig.view.feel).toBe(rig.feel.out);
  });

  it('overrides do not retain the caller object', () => {
    const { rig, host } = hostRig();
    host.setManual(true);
    const o = { shakeY: 0.1 };
    host.overrideFeel(o);
    o.shakeY = 0.2;
    host.renderState(10, 0, 0);
    expect(rig.view.feel.shakeY).toBe(0.1);
  });

  it('a governor force applies at step 15 of the next runFrame or renderState', () => {
    const { rig, host } = hostRig();
    host.setManual(true);
    host.governor.force(1);
    host.renderState(10, 0, 0);
    expect(rig.view.quality.tier).toBe(1);
    host.governor.force(4);
    host.runFrame(1 / 60);
    expect(rig.view.quality.tier).toBe(4);
  });
});
