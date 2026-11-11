// A7: R1 in the loop. sim.step runs in every mode and while the context is lost, the clock clamps, and the camera never
// moves backward between frames.
import { describe, expect, it } from 'vitest';
import { SIM_HZ, SimMode, type SimMode as Mode } from '../../../src/contracts/index';
import { between } from '../../../src/core/coords';
import { createRig } from './fixtures/fakes';

const MODES: Mode[] = [SimMode.DEMO, SimMode.PLAY, SimMode.CRUISE, SimMode.SIGNAL_LOST];

describe('steps', () => {
  for (const mode of MODES) {
    for (const lost of [false, true]) {
      it(`mode ${mode}, context ${lost ? 'lost' : 'live'}: 60 frames of 1/60 s give 120 steps`, () => {
        const rig = createRig({ record: false });
        rig.sim.state.mode = mode;
        rig.deps.flags.contextOk = !lost;
        rig.loop.start();
        rig.frame(0);
        // 1000/60 ms is not exact in binary; 120 steps over exactly 1 s, give or take the final residual.
        for (let i = 1; i <= 60; i++) rig.frame((i * 1000) / 60);
        expect(rig.sim.steps).toBeGreaterThanOrEqual(119);
        expect(rig.sim.steps).toBeLessThanOrEqual(120);
        expect(rig.sim.state.mode).toBe(mode);
      });
    }
  }

  it('a 5 s frame is clamped: exactly 30 steps, dt passed on is .25, the governor sees 5000 ms', () => {
    const rig = createRig();
    rig.loop.start();
    rig.frame(1000);
    const before = rig.sim.steps;
    rig.frame(6000);
    expect(rig.sim.steps - before).toBe(30);
    expect(rig.feel.dts.at(-1)).toBe(0.25);
    expect(rig.gov.samples.at(-1)).toBe(5000);
    // Never more, over many long frames.
    for (let i = 2; i < 40; i++) {
      const b = rig.sim.steps;
      rig.frame(1000 + i * 5000 + (i % 7) * 0.37);
      expect(rig.sim.steps - b).toBeLessThanOrEqual(30);
    }
  });

  it('a 1 s frame feeds governor.sample(1000)', () => {
    const rig = createRig();
    rig.loop.start();
    rig.frame(500);
    rig.frame(1500);
    expect(rig.gov.samples).toEqual([0, 1000]);
  });

  it('the first frame and the frame after resetClock take rawDt 0: 0 steps, sample(0), no negative dt', () => {
    const rig = createRig();
    rig.loop.start();
    rig.frame(123456);
    expect(rig.sim.steps).toBe(0);
    expect(rig.gov.samples).toEqual([0]);
    expect(rig.feel.dts).toEqual([0]);
    rig.frame(123456 + 100);
    const s = rig.sim.steps;
    rig.loop.resetClock();
    // An event-handler clock can be later than the next rAF timestamp; the flag means no subtraction happens.
    rig.frame(123000);
    expect(rig.sim.steps).toBe(s);
    expect(rig.gov.samples.at(-1)).toBe(0);
    expect(rig.feel.dts.at(-1)).toBe(0);
    expect(rig.loop.lastRawDt).toBe(0);
    for (const dt of rig.feel.dts) expect(dt).toBeGreaterThanOrEqual(0);
  });

  it('setManual(false) resets the clock, and setManual is idempotent both ways', () => {
    const rig = createRig({ record: false });
    rig.loop.start();
    rig.frame(0);
    rig.loop.setManual(true);
    rig.loop.setManual(true);
    expect(rig.raf.pending).toBeNull();
    rig.loop.setManual(false);
    const armed = rig.raf.armed;
    rig.loop.setManual(false);
    expect(rig.raf.armed).toBe(armed);
    const s = rig.sim.steps;
    rig.frame(60_000);
    expect(rig.sim.steps).toBe(s);
    expect(rig.loop.lastRawDt).toBe(0);
  });
});

describe('camera', () => {
  it('view.cam never moves backward over 10,000 frames of varying dt and speed, and trails travel by at most stepDist', () => {
    const rig = createRig({ record: false });
    rig.loop.start();
    let t = 0;
    rig.frame(t);
    const prev = { chunk: rig.view.cam.chunk, local: rig.view.cam.local };
    let crossings = 0;
    for (let i = 0; i < 10_000; i++) {
      // Deterministic jitter: 2 to 40 ms frames, speed 27 to 150 u/s.
      t += 2 + ((i * 7919) % 38);
      rig.sim.state.speed = 27 + ((i * 104729) % 124);
      rig.frame(t);
      const cam = rig.view.cam;
      const moved = between(cam, prev);
      expect(moved).toBeGreaterThanOrEqual(0);
      const lag = between(rig.sim.state.travel, cam);
      expect(lag).toBeGreaterThanOrEqual(0);
      expect(lag).toBeLessThanOrEqual(rig.sim.state.stepDist + 1e-9);
      expect(cam.local).toBeGreaterThanOrEqual(0);
      expect(cam.local).toBeLessThan(64);
      if (cam.chunk !== prev.chunk) crossings += 1;
      prev.chunk = cam.chunk;
      prev.local = cam.local;
    }
    expect(crossings).toBeGreaterThan(100);
  });

  it('after warpTo(0, 0) cam.chunk reads -1 for one frame only, with no throw', () => {
    const rig = createRig({ record: false });
    rig.loop.start();
    rig.frame(0);
    rig.frame(1000 / SIM_HZ / 2);
    expect(rig.sim.warpTo(0, 0)).toBe(true);
    // A frame too short for a step: travel is (0, 0) and the camera trails it by (1 - alpha) of a step.
    rig.frame(1000 / SIM_HZ / 2 + 0.5);
    expect(rig.view.cam.chunk).toBe(-1);
    expect(rig.fatal).toEqual([]);
    rig.frame(1000 / SIM_HZ / 2 + 0.5 + 50);
    expect(rig.view.cam.chunk).toBe(0);
    expect(rig.fatal).toEqual([]);
  });

  it('camX and camY follow the interpolated ship with gainX and FOLLOW_Y', () => {
    const rig = createRig({ record: false });
    rig.loop.start();
    rig.frame(0);
    rig.frame(1000 / 120 * 3.5);
    const s = rig.sim.state;
    const a = rig.view.alpha;
    expect(a).toBeGreaterThan(0);
    expect(rig.view.camX).toBeCloseTo(0.72 * (s.prevX + (s.x - s.prevX) * a), 12);
    expect(rig.view.camY).toBeCloseTo(7 + 0.15 * (s.prevY + (s.y - s.prevY) * a - 6), 12);
  });
});

describe('fatal', () => {
  it('a throw in sky.frame calls onFatal(runtime-error) and the next rAF is cancelled', () => {
    const rig = createRig({ record: false });
    rig.loop.start();
    rig.frame(0);
    rig.layers[0]!.throwOnFrame = true;
    rig.frame(16);
    expect(rig.fatal.map((f) => f[0])).toEqual(['runtime-error']);
    expect(rig.raf.pending).toBeNull();
    expect(rig.raf.cancelled).toBeGreaterThanOrEqual(1);
    expect(rig.frame(32)).toBe(false);
  });

  it('runFrame and renderState rethrow after the fatal route', () => {
    for (const which of ['runFrame', 'renderState'] as const) {
      const rig = createRig({ record: false });
      rig.loop.start();
      rig.frame(0);
      rig.loop.setManual(true);
      rig.layers[2]!.throwOnFrame = true;
      const call = which === 'runFrame' ? () => { rig.loop.runFrame(1 / 60); } : () => { rig.loop.renderState(3, 0, 10); };
      expect(call).toThrow('props frame failed');
      expect(rig.fatal.map((f) => f[0])).toEqual(['runtime-error']);
    }
  });

  it('onFirstFrame fires once, on the first frame that drew', () => {
    const rig = createRig({ record: false });
    rig.deps.flags.contextOk = false;
    rig.loop.start();
    rig.frame(0);
    rig.frame(16);
    expect(rig.firstFrames).toBe(0);
    rig.deps.flags.contextOk = true;
    rig.frame(32);
    rig.frame(48);
    expect(rig.firstFrames).toBe(1);
  });
});
