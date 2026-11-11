import { beforeEach, describe, expect, it } from 'vitest';
import { CAMERA_FOV, CAMERA_PITCH, CHUNK_LIMIT, CRACK_CONTROL_GROW, DebugPaint, SimMode, type LayerName } from '../../../src/contracts/index';
import { createCore } from '../../../src/harness/api';
import { createHarness } from '../../../src/harness/index';
import type { HarnessLab } from '../../../src/harness/lab';
import { createGlStub, type GlStub } from './support/glStub';

const macrotask = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });
const NAMES: readonly LayerName[] = ['sky', 'terrain', 'props', 'fx'];
/**
 * DI-93: a frame is exact only below chunk 2^48, and from about 2^49 the terrain atlas's row loop cannot advance (q + 2
 * rounds to q), so a render there hangs the tab. warp refuses chunk >= CHUNK_LIMIT; a render gets 1024 chunks more.
 */
const RENDER_END = CHUNK_LIMIT + 1024;
const OUT_OF_RANGE: readonly number[] = [
  RENDER_END, 2 ** 49 + 5, Number.MAX_SAFE_INTEGER, -1, -0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
];

let stub: GlStub;
let mv: ReturnType<typeof createHarness>;

beforeEach(() => {
  stub = createGlStub();
  mv = createHarness(stub.host);
});

describe('createHarness', () => {
  it('installs window.__mv and window.__mvLab through globalThis, and is ready', () => {
    const g = globalThis as unknown as { __mv: unknown; __mvLab: HarnessLab; __mvHarnessChunk: string };
    expect(g.__mv).toBe(mv);
    expect(typeof g.__mvLab.compareAt).toBe('function');
    expect(mv.ready).toBe(true);
  });

  it('writes the chunk marker at module load', () => {
    expect((globalThis as unknown as { __mvHarnessChunk: string }).__mvHarnessChunk).toBe('MV-HARNESS-CHUNK');
  });
});

describe('each member maps to its host call', () => {
  it('manual calls setManual and remembers', () => {
    mv.manual(true);
    mv.manual(false);
    expect(stub.host.calls.setManual).toEqual([true, false]);
    expect(() => mv.renderAt(1, 2, 3)).toThrow('manual');
  });

  it('warp is the sim own answer: no pre-validation', () => {
    expect(mv.warp(7, 3)).toBe(true);
    expect(stub.host.sim.state.travel).toEqual({ chunk: 7, local: 3 });
    expect(stub.host.sim.state.warpSerial).toBe(1);
    expect(mv.warp(CHUNK_LIMIT, 0)).toBe(false);
    expect(mv.warp(1.5, 0)).toBe(false);
    expect(stub.host.sim.state.travel).toEqual({ chunk: 7, local: 3 });
    expect(stub.host.sim.state.warpSerial).toBe(1);
  });

  it('renderAt calls renderState and then a 1x1 read, and returns a time', () => {
    mv.manual(true);
    const ms = mv.renderAt(5, 12.5, 120);
    expect(stub.host.calls.renderState).toEqual([[5, 12.5, 120]]);
    expect(stub.reads).toEqual([{ x: 0, y: 0, w: 1, h: 1, offset: 0 }]);
    expect(ms).toBeGreaterThanOrEqual(0);
    expect(stub.renderTargets).toEqual([null]);
  });

  it('renderAt reads NaN and draws nothing while the context is lost', () => {
    mv.manual(true);
    stub.lost = true;
    expect(mv.renderAt(5, 12.5, 120)).toBeNaN();
    expect(stub.host.calls.renderState).toEqual([]);
    expect(() => mv.pixels()).toThrow('same run');
  });

  it('stepFrames calls runFrame n times with dt, and syncs', () => {
    mv.manual(true);
    mv.stepFrames(3, 0.125);
    expect(stub.host.calls.runFrame).toEqual([0.125, 0.125, 0.125]);
    expect(stub.reads.length).toBeGreaterThanOrEqual(1);
    mv.stepFrames(0, 0.125);
    expect(stub.host.calls.runFrame.length).toBe(3);
  });

  it('stepFrames keeps stepping through a loss, with no read: the sim never stops', () => {
    mv.manual(true);
    stub.lost = true;
    mv.stepFrames(3, 1 / 60);
    expect(stub.host.calls.runFrame.length).toBe(3);
    expect(stub.reads).toEqual([]);
  });

  it('a long stepFrames waits for the GPU more than once', () => {
    mv.manual(true);
    mv.stepFrames(200, 1 / 60);
    expect(stub.reads.length).toBe(4);
  });

  it('setPost and setMsaa force the post stack', () => {
    mv.setPost('off');
    mv.setPost('full');
    mv.setMsaa(2);
    expect(stub.host.calls.forceVariant).toEqual(['off', 'full']);
    expect(stub.host.calls.forceMsaa).toEqual([2]);
  });

  it('setLayerVisible reaches the named layer only', () => {
    mv.setLayerVisible('props', false);
    expect(stub.host.calls.layerVisible).toEqual([['props', false]]);
  });

  it('setLayerVisible throws on a name no layer has', () => {
    expect(() => { mv.setLayerVisible('nope' as LayerName, true); }).toThrow('no layer named nope');
  });

  it('forceZone, forceBend, forceFov and forceFeel pass through', () => {
    mv.forceZone(2, 3, 1);
    mv.forceBend(8e-5, -1.2e-5);
    mv.forceFov(68);
    mv.forceFov(null);
    mv.forceFeel({ bloomGain: 0 });
    mv.forceFeel(null);
    expect(stub.host.calls.overrideZone).toEqual([{ palette: 2, biome: 3, hero: 1 }]);
    expect(stub.host.calls.overrideBend).toEqual([{ a: 8e-5, c: -1.2e-5 }]);
    expect(stub.host.calls.overrideFov).toEqual([68, null]);
    expect(stub.host.calls.overrideFeel).toEqual([{ bloomGain: 0 }, null]);
  });

  it('setTier forces the governor, and stats shows it at once', () => {
    mv.setTier(1);
    mv.setTier('auto');
    expect(stub.host.calls.governorForce).toEqual([1, 'auto']);
    expect(mv.stats().tier).toBe(1);
  });

  it('forceSignalLost reaches the sim: PLAY only', () => {
    mv.forceSignalLost();
    expect(stub.host.sim.state.mode).toBe(SimMode.DEMO);
    stub.host.sim.command('launch');
    mv.forceSignalLost();
    expect(stub.host.sim.state.mode).toBe(SimMode.SIGNAL_LOST);
  });

  it('stats has its whole shape, read fresh', () => {
    const s = mv.stats();
    expect(Object.keys(s).sort()).toEqual([
      'calls', 'chunk', 'geometries', 'height', 'local', 'mode', 'programs', 'textures', 'tick', 'tier', 'triangles', 'warpSerial', 'width',
    ]);
    expect(s.width).toBe(64);
    expect(s.height).toBe(32);
    expect(s.tier).toBe(3);
    expect(s.chunk).toBe(1);
    expect(s.mode).toBe(SimMode.DEMO);
    mv.manual(true);
    mv.stepFrames(2, 1 / 60);
    const after = mv.stats();
    expect(after.tick).toBe(4);
    stub.width = 128;
    expect(mv.stats().width).toBe(128);
  });

  it('pixels returns a fresh array of the whole frame, bottom-up', () => {
    mv.manual(true);
    mv.renderAt(1, 2, 3);
    const a = mv.pixels();
    const b = mv.pixels();
    expect(a.length).toBe(64 * 32 * 4);
    expect(a).not.toBe(b);
    expect(stub.reads[stub.reads.length - 1]).toEqual({ x: 0, y: 0, w: 64, h: 32, offset: 0 });
  });
});

describe('crack mode', () => {
  it('shows terrain alone, sets the magenta clear and zero pitch, and restores', () => {
    stub.host.ctx.renderer.setClearColor(0x102030, 0.5);
    mv.setCrackMode(true);
    expect(stub.host.calls.debugMode).toEqual(NAMES.map((n) => [n, 'crack']));
    expect(stub.host.calls.layerVisible).toEqual(NAMES.map((n) => [n, n === 'terrain']));
    expect(stub.clearColour).toBe(DebugPaint.CLEAR);
    expect(stub.clearAlpha).toBe(1);
    expect(stub.host.calls.overrideFeel).toEqual([{ shakeY: -CAMERA_PITCH }]);
    stub.host.calls.debugMode.length = 0;
    stub.host.calls.layerVisible.length = 0;
    mv.setCrackMode(false);
    expect(stub.host.calls.debugMode).toEqual(NAMES.map((n) => [n, 'none']));
    expect(stub.host.calls.layerVisible).toEqual(NAMES.map((n) => [n, true]));
    expect(stub.clearAlpha).toBe(0.5);
    expect(stub.host.calls.overrideFeel).toEqual([{ shakeY: -CAMERA_PITCH }, null]);
  });

  it('is idempotent: a second true does not overwrite what the first saved', () => {
    stub.host.ctx.renderer.setClearColor(0x102030, 0.5);
    mv.setCrackMode(true);
    mv.setCrackMode(true);
    expect(stub.host.calls.debugMode.length).toBe(4);
    mv.setCrackMode(false);
    expect(stub.clearAlpha).toBe(0.5);
    mv.setCrackMode(false);
    expect(stub.host.calls.debugMode.length).toBe(8);
  });

  it('keeps a held forceFeel, and restores it', () => {
    mv.forceFeel({ bloomGain: 0 });
    mv.setCrackMode(true);
    mv.setCrackMode(false);
    expect(stub.host.calls.overrideFeel).toEqual([{ bloomGain: 0 }, { bloomGain: 0, shakeY: -CAMERA_PITCH }, { bloomGain: 0 }]);
  });

  it('restores a layer a spec had hidden as hidden', () => {
    mv.setLayerVisible('props', false);
    stub.host.calls.layerVisible.length = 0;
    mv.setCrackMode(true);
    mv.setCrackMode(false);
    expect(stub.host.calls.layerVisible.slice(4)).toEqual(NAMES.map((n) => [n, n !== 'props']));
  });
});

describe('edge paint', () => {
  it('is crack mode with edge-paint and no pitch change', () => {
    mv.setEdgePaint(true);
    expect(stub.host.calls.debugMode).toEqual(NAMES.map((n) => [n, 'edge-paint']));
    expect(stub.host.calls.layerVisible).toEqual(NAMES.map((n) => [n, n === 'terrain']));
    expect(stub.host.calls.overrideFeel).toEqual([null]);
    mv.setEdgePaint(false);
    expect(stub.host.calls.debugMode.slice(4)).toEqual(NAMES.map((n) => [n, 'none']));
    expect(stub.host.calls.overrideFov).toEqual([]);
  });
});

describe('setCrackControl', () => {
  it('throws with no implementing layer, so the control cannot pass vacuously', () => {
    expect(() => { mv.setCrackControl(true); }).toThrow('no layer');
    expect(() => { mv.setCrackControl(false); }).not.toThrow();
  });

  it('grows every implementing layer by the contract constant, and returns it to 0', () => {
    const grown: number[] = [];
    const terrain = stub.host.layers.find((l) => l.name === 'terrain')!;
    terrain.setCrackControl = (n: number): void => { grown.push(n); };
    mv.setCrackControl(true);
    mv.setCrackControl(false);
    expect(grown).toEqual([CRACK_CONTROL_GROW, 0]);
  });
});

describe('guards', () => {
  it('renderAt outside manual mode throws', () => {
    expect(() => mv.renderAt(1, 2, 3)).toThrow('manual');
    expect(stub.host.calls.renderState).toEqual([]);
  });

  it('stepFrames outside manual mode throws', () => {
    expect(() => { mv.stepFrames(1, 1 / 60); }).toThrow('manual');
    expect(stub.host.calls.runFrame).toEqual([]);
  });

  it('stepFrames refuses a bad count or dt', () => {
    mv.manual(true);
    expect(() => { mv.stepFrames(1.5, 1 / 60); }).toThrow('non-negative integer');
    expect(() => { mv.stepFrames(-1, 1 / 60); }).toThrow('non-negative integer');
    expect(() => { mv.stepFrames(Number.NaN, 1 / 60); }).toThrow('non-negative integer');
    expect(() => { mv.stepFrames(1, 0); }).toThrow('dt');
    expect(() => { mv.stepFrames(1, -1); }).toThrow('dt');
    expect(() => { mv.stepFrames(1, Number.NaN); }).toThrow('dt');
    expect(stub.host.calls.runFrame).toEqual([]);
  });

  it('renderAt refuses a chunk outside [0, CHUNK_LIMIT + 1024) with a RangeError, and draws and reads nothing (DI-93)', () => {
    mv.manual(true);
    for (const c of OUT_OF_RANGE) {
      expect(() => mv.renderAt(c, 2, 3), String(c)).toThrow(RangeError);
      expect(() => mv.renderAt(c, 2, 3), String(c)).toThrow('CHUNK_LIMIT + 1024');
    }
    expect(stub.host.calls.renderState).toEqual([]);
    expect(stub.reads).toEqual([]);
    expect(() => mv.pixels()).toThrow('same run');
  });

  it('renderAt accepts both ends of the range: 0 and CHUNK_LIMIT + 1023 (DI-93)', () => {
    mv.manual(true);
    mv.renderAt(0, 2, 3);
    mv.renderAt(RENDER_END - 1, 2, 3);
    expect(stub.host.calls.renderState).toEqual([[0, 2, 3], [RENDER_END - 1, 2, 3]]);
  });

  it('an out-of-range chunk is a RangeError while the context is lost too, not NaN (DI-93)', () => {
    mv.manual(true);
    stub.lost = true;
    expect(() => mv.renderAt(2 ** 49 + 5, 2, 3)).toThrow(RangeError);
    expect(() => mv.renderAt(-1, 2, 3)).toThrow(RangeError);
    expect(mv.renderAt(5, 2, 3)).toBeNaN();
    expect(stub.host.calls.renderState).toEqual([]);
  });

  it('the core renderState, the one route to the host for every harness frame, refuses the same range (DI-93)', () => {
    const core = createCore(stub.host);
    for (const c of OUT_OF_RANGE) expect(() => { core.renderState(c, 2, 3); }, String(c)).toThrow(RangeError);
    core.renderState(RENDER_END - 1, 2, 3);
    expect(stub.host.calls.renderState).toEqual([[RENDER_END - 1, 2, 3]]);
  });

  it('a lab sweep past the range throws a RangeError and never asks the host for that chunk (DI-93)', () => {
    mv.manual(true);
    const lab = (globalThis as unknown as { __mvLab: HarnessLab }).__mvLab;
    const near = { chunk: 5, local: 12.5, tick: 120 };
    const far = { chunk: 2 ** 49 + 5, local: 12.5, tick: 120 };
    expect(() => lab.compareAt(near, far, { attempts: 1 })).toThrow(RangeError);
    expect(() => { lab.refill(far); }).toThrow(RangeError);
    expect(() => { lab.settle(far, 50); }).toThrow(RangeError);
    expect(() => lab.sequence(near, far, 2, 1, 1, { attempts: 1 })).toThrow(RangeError);
    const chunks = stub.host.calls.renderState.map(([c]) => c);
    expect(chunks.length, 'compareAt drew the near frames before it reached the far one').toBeGreaterThan(0);
    expect(chunks.filter((c) => !(c >= 0 && c < RENDER_END))).toEqual([]);
  });

  it('pixels with no render throws', () => {
    expect(() => mv.pixels()).toThrow('same run');
  });

  it('pixels after an await throws, and in the same run it does not', async () => {
    mv.manual(true);
    mv.renderAt(1, 2, 3);
    expect(mv.pixels().length).toBeGreaterThan(0);
    await Promise.resolve();
    expect(() => mv.pixels()).toThrow('same run');
    mv.stepFrames(1, 1 / 60);
    expect(mv.pixels().length).toBeGreaterThan(0);
    await macrotask();
    expect(() => mv.pixels()).toThrow('same run');
  });

  it('restoreContext before any loss rejects and touches no GL', async () => {
    await expect(mv.restoreContext()).rejects.toThrow('loss event');
    expect(stub.restores).toEqual([]);
  });

  it('restoreContext while the loss is still unresolved rejects and touches no GL', async () => {
    const lost = mv.loseContext();
    await expect(mv.restoreContext()).rejects.toThrow('loss event');
    expect(stub.restores).toEqual([]);
    await lost;
  });

  it('a second loseContext while lost rejects', async () => {
    await mv.loseContext();
    expect(stub.losses.length).toBe(1);
    await expect(mv.loseContext()).rejects.toThrow('not live');
    expect(stub.losses.length).toBe(1);
  });

  it('a second loseContext before the first resolves also rejects', async () => {
    const first = mv.loseContext();
    await expect(mv.loseContext()).rejects.toThrow('not live');
    await first;
  });

  it('the right order works, and the cycle can repeat', async () => {
    for (let i = 1; i <= 2; i++) {
      await mv.loseContext();
      expect(stub.lost).toBe(true);
      await mv.restoreContext();
      expect(stub.lost).toBe(false);
      expect(stub.restores.length).toBe(i);
    }
  });

  it('loseContext resolves a macrotask after the event, never inside the dispatch', async () => {
    const order: string[] = [];
    (stub.host.ctx.renderer.domElement as unknown as EventTarget).addEventListener('webglcontextlost', () => {
      order.push('event');
      queueMicrotask(() => { order.push('microtask'); });
    });
    const lost = mv.loseContext().then(() => { order.push('resolved'); });
    await lost;
    expect(order).toEqual(['event', 'microtask', 'resolved']);
  });
});

describe('forceFov stays the frozen member', () => {
  it('takes a number or null, and leaves feel alone', () => {
    mv.forceFov(CAMERA_FOV);
    expect(stub.host.calls.overrideFeel).toEqual([]);
  });
});
