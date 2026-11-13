import { describe, expect, it } from 'vitest';
import { CHUNK_LIMIT, SIM_HZ, SPEED_CRUISE, SimMode, type ControlFrame } from '../../../src/contracts/index';
import { createFakeHost } from '../../../src/testing/fakeHost';

const NO_INPUT: ControlFrame = { moveX: 0, moveY: 0, absolute: false, boost: false, human: false };

describe('createFakeHost in Node', () => {
  it('constructs with a stub renderer, a real scene and a fake world', () => {
    const host = createFakeHost();
    expect(typeof document).toBe('undefined');
    expect(host.ctx.renderer.info).toBeDefined();
    expect(host.ctx.scene.isScene).toBe(true);
    expect(host.ctx.camera.isPerspectiveCamera).toBe(true);
    expect(host.ctx.world.seed).toBe(1985);
    expect(host.layers.map((l) => l.name)).toEqual(['sky', 'terrain', 'props', 'fx']);
  });

  it('records the host methods', () => {
    const host = createFakeHost();
    host.setManual(true);
    host.runFrame(1 / 60);
    host.renderState(5, 3, 120);
    host.overrideZone({ palette: 1, biome: 2, hero: 3 });
    host.overrideBend({ a: 1, c: 2 });
    host.overrideFov(68);
    host.overrideFov(null);
    host.overrideFeel({ shakeY: -0.05 });
    host.overrideCam?.(1);
    host.overrideCam?.(null);
    expect(host.calls.overrideCam).toEqual([1, null]);
    expect(host.calls.setManual).toEqual([true]);
    expect(host.calls.runFrame).toEqual([1 / 60]);
    expect(host.calls.renderState).toEqual([[5, 3, 120]]);
    expect(host.calls.overrideZone).toEqual([{ palette: 1, biome: 2, hero: 3 }]);
    expect(host.calls.overrideBend).toEqual([{ a: 1, c: 2 }]);
    expect(host.calls.overrideFov).toEqual([68, null]);
    expect(host.calls.overrideFeel).toEqual([{ shakeY: -0.05 }]);
  });

  it('fake layers and post record into calls', () => {
    const host = createFakeHost();
    host.layers[1]!.setVisible(false);
    host.layers[1]!.setDebugMode('crack');
    host.post.forceVariant('off');
    host.post.forceMsaa(0);
    expect(host.calls.layerVisible).toEqual([['terrain', false]]);
    expect(host.calls.debugMode).toEqual([['terrain', 'crack']]);
    expect(host.calls.forceVariant).toEqual(['off']);
    expect(host.calls.forceMsaa).toEqual([0]);
  });

  it('no fake layer implements setCrackControl, so T09 can test its no-layer guard', () => {
    const host = createFakeHost();
    expect(host.layers.every((l) => l.setCrackControl === undefined)).toBe(true);
  });

  it('governor.force records, updates the profile at once, and the next sample returns it once', () => {
    const host = createFakeHost();
    expect(host.governor.profile.tier).toBe(3);
    host.governor.force(1);
    expect(host.calls.governorForce).toEqual([1]);
    expect(host.governor.profile.tier).toBe(1);
    expect(host.governor.sample(0)).toBe(1);
    expect(host.governor.sample(0)).toBeNull();
    host.governor.force('auto');
    expect(host.calls.governorForce).toEqual([1, 'auto']);
    expect(host.governor.profile.tier).toBe(1);
  });

  it('warpTo refuses CHUNK_LIMIT with the state unchanged and warpSerial still', () => {
    const { sim } = createFakeHost();
    const before = { ...sim.state, travel: { ...sim.state.travel } };
    expect(sim.warpTo(CHUNK_LIMIT, 0)).toBe(false);
    expect(sim.warpTo(2 ** 48, 0)).toBe(false);
    expect(sim.warpTo(1.5, 0)).toBe(false);
    expect(sim.warpTo(0, 64)).toBe(false);
    expect({ ...sim.state, travel: { ...sim.state.travel } }).toEqual(before);
    expect(sim.state.warpSerial).toBe(0);
  });

  it('warpSerial rises only on success, and warpTo updates travel', () => {
    const { sim } = createFakeHost();
    expect(sim.warpTo(CHUNK_LIMIT - 1, 3)).toBe(true);
    expect(sim.state.warpSerial).toBe(1);
    expect(sim.state.travel).toEqual({ chunk: CHUNK_LIMIT - 1, local: 3 });
    expect(sim.warpTo(CHUNK_LIMIT, 3)).toBe(false);
    expect(sim.state.warpSerial).toBe(1);
  });

  it('step advances travel, sets stepDist and raises tick', () => {
    const { sim } = createFakeHost();
    const t0 = sim.state.tick;
    const local0 = sim.state.travel.local;
    sim.step(NO_INPUT);
    expect(sim.state.tick).toBe(t0 + 1);
    expect(sim.state.stepDist).toBe(SPEED_CRUISE / SIM_HZ);
    expect(sim.state.travel.local).toBeCloseTo(local0 + SPEED_CRUISE / SIM_HZ, 9);
  });

  it('runFrame steps the sim for a positive dt', () => {
    const host = createFakeHost();
    host.runFrame(10 / SIM_HZ + 1e-6);
    expect(host.sim.state.tick).toBe(10);
  });

  it('forceSignalLost exists, and acts in PLAY only', () => {
    const { sim } = createFakeHost();
    sim.forceSignalLost();
    expect(sim.state.mode).toBe(SimMode.DEMO);
    sim.command('launch');
    expect(sim.state.mode).toBe(SimMode.PLAY);
    sim.forceSignalLost();
    expect(sim.state.mode).toBe(SimMode.SIGNAL_LOST);
  });

  it('the stub renderer takes the calls a harness makes', () => {
    const { ctx } = createFakeHost();
    expect(() => {
      ctx.renderer.info.reset();
      ctx.renderer.getContext();
      ctx.renderer.setRenderTarget(null);
      ctx.renderer.compile(ctx.scene, ctx.camera);
      ctx.renderer.render(ctx.scene, ctx.camera);
    }).not.toThrow();
    expect(ctx.renderer.domElement).toBeDefined();
  });
});
