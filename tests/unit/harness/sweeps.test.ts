import { beforeEach, describe, expect, it } from 'vitest';
import { createHarness } from '../../../src/harness/index';
import type { HarnessLab } from '../../../src/harness/lab';
import { CHUNK_LIMIT } from '../../../src/contracts/index';
import { EXACT, GPU_SAME_STATE, NOISE_BYTES, REFILL_JUMP_CHUNKS } from '../../../src/harness/sweeps';
import { createGlStub, type GlStub } from './support/glStub';

const NEAR = { chunk: 5, local: 12.5, tick: 120 };
const FAR = { chunk: 5 + 1024, local: 12.5, tick: 120 };

let stub: GlStub;
let lab: HarnessLab;
/** The state of the last render. The stub's picture is a pure function of this, like a real frame. */
let last: { chunk: number; local: number; tick: number };
/** Reads so far, so a test can make one read differ, as driver noise does. */
let readIndex = 0;
let tweak: (out: Uint8Array, offset: number, index: number) => void;

function stateByte(chunk: number, local: number, tick: number): number {
  return (Math.floor(local * 4) * 7 + (chunk % 1024) * 13 + tick) % 251;
}

beforeEach(() => {
  stub = createGlStub();
  const mv = createHarness(stub.host);
  mv.manual(true);
  lab = (globalThis as unknown as { __mvLab: HarnessLab }).__mvLab;
  last = { chunk: 0, local: 0, tick: 0 };
  readIndex = 0;
  tweak = () => undefined;
  const render = stub.host.renderState.bind(stub.host);
  stub.host.renderState = (c: number, l: number, t: number): void => {
    last = { chunk: c, local: l, tick: t };
    render(c, l, t);
  };
  stub.paint = (out: Uint8Array, offset: number, w: number, h: number): void => {
    const v = stateByte(last.chunk, last.local, last.tick);
    for (let i = 0; i < w * h * 4; i += 4) {
      out[offset + i] = v;
      out[offset + i + 1] = 40;
      out[offset + i + 2] = 40;
      out[offset + i + 3] = 255;
    }
    tweak(out, offset, readIndex);
    readIndex++;
  };
});

describe('compareAt', () => {
  it('passes first try when the states match', () => {
    const r = lab.compareAt(NEAR, FAR);
    expect(r).toMatchObject({ pass: true, attempts: 1, selfBytes: 0, crossBytes: 0, crossMax: 0 });
    expect(r.meanLuma).toBeGreaterThan(1);
  });

  it('fails at once when the states differ, with self clean', () => {
    const r = lab.compareAt(NEAR, { ...FAR, chunk: FAR.chunk + 1 });
    expect(r.pass).toBe(false);
    expect(r.attempts).toBe(1);
    expect(r.selfBytes).toBe(0);
    expect(r.crossBytes).toBe(64 * 32);
  });

  it('retries driver noise, and passes on the attempt that is clean', () => {
    // Read 1 is the far frame of attempt 1, 4 bytes by 1.
    tweak = (out, offset, i) => {
      if (i === 1) for (let b = 0; b < 4; b++) out[offset + b * 4] = (out[offset + b * 4]! + 1) & 255;
    };
    const r = lab.compareAt(NEAR, FAR);
    expect(r.pass).toBe(true);
    expect(r.attempts).toBe(2);
  });

  it('a noise signature that never clears uses every attempt and fails', () => {
    tweak = (out, offset, i) => {
      if (i % 3 === 1) out[offset] = (out[offset]! + 1) & 255;
    };
    const r = lab.compareAt(NEAR, FAR);
    expect(r.pass).toBe(false);
    expect(r.attempts).toBe(5);
    expect(r.crossBytes).toBe(1);
  });

  it('just past the byte limit is not noise: fails at once', () => {
    tweak = (out, offset, i) => {
      if (i === 1) for (let b = 0; b <= NOISE_BYTES; b++) out[offset + b * 4] = (out[offset + b * 4]! + 1) & 255;
    };
    const r = lab.compareAt(NEAR, FAR);
    expect(r.pass).toBe(false);
    expect(r.attempts).toBe(1);
    expect(r.crossBytes).toBe(NOISE_BYTES + 1);
  });

  it('a delta of 2 on one byte is not noise: fails at once', () => {
    tweak = (out, offset, i) => {
      if (i === 1) out[offset] = (out[offset]! + 2) & 255;
    };
    const r = lab.compareAt(NEAR, FAR);
    expect(r.pass).toBe(false);
    expect(r.attempts).toBe(1);
    expect(r.crossMax).toBe(2);
  });

  it('a self-compare that moves cannot pass, whatever the cross reads', () => {
    tweak = (out, offset, i) => {
      if (i % 3 === 2) out[offset] = (out[offset]! + 1) & 255;
    };
    const r = lab.compareAt(NEAR, FAR);
    expect(r.pass).toBe(false);
    expect(r.selfBytes).toBe(1);
  });

  it('honours attempts: 1', () => {
    tweak = (out, offset, i) => {
      if (i === 1) out[offset] = (out[offset]! + 1) & 255;
    };
    const r = lab.compareAt(NEAR, FAR, { attempts: 1 });
    expect(r.pass).toBe(false);
    expect(r.attempts).toBe(1);
  });

  it('keeps the largest crossMax over every attempt, not only the last (B4)', () => {
    tweak = (out, offset, i) => {
      if (i === 1) out[offset] = (out[offset]! + 1) & 255;
    };
    const r = lab.compareAt(NEAR, FAR);
    expect(r).toMatchObject({ pass: true, attempts: 2, crossMax: 0, worstCrossMax: 1 });
  });

  it('EXACT is the default: a tolerance has to be asked for', () => {
    tweak = (out, offset, i) => {
      if (i === 1) out[offset] = (out[offset]! + 1) & 255;
    };
    expect(lab.compareAt(NEAR, FAR, { attempts: 1 }).pass).toBe(false);
    readIndex = 0;
    expect(lab.compareAt(NEAR, FAR, { attempts: 1, tolerance: EXACT }).pass).toBe(false);
  });

  it('draws 64 settling frames between attempts', () => {
    tweak = (out, offset, i) => {
      if (i === 1) out[offset] = (out[offset]! + 1) & 255;
    };
    lab.compareAt(NEAR, FAR);
    // Each attempt: a refill of two frames (V2-T09), then the triple; the second also settles 64 frames first.
    expect(stub.host.calls.renderState.length).toBe(2 + 3 + 2 + 64 + 3);
  });
});

describe('refill before every reference frame (V2-T09)', () => {
  /**
   * T05's props layer, as far as identity cares: a shard the sim collected stays hidden until its ring refills, and a
   * ring refills only when the camera chunk moves backward or by more than one (src/render/props/layer.ts). Hidden shards
   * show in the picture as one byte, so the stub's frame is still a pure function of what is drawn.
   */
  let hidden = false;
  let lastChunk = Number.NaN;
  beforeEach(() => {
    hidden = false;
    lastChunk = Number.NaN;
    const render = stub.host.renderState.bind(stub.host);
    stub.host.renderState = (c: number, l: number, t: number): void => {
      if (!(c === lastChunk || c === lastChunk + 1)) hidden = false;
      lastChunk = c;
      render(c, l, t);
    };
    const paint = stub.paint;
    stub.paint = (out, offset, w, h): void => {
      paint(out, offset, w, h);
      if (hidden) out[offset + 1] = 41;
    };
  });

  /** DEMO left the camera one chunk behind the key and collected a shard ahead of it. */
  function afterDemo(): void {
    stub.host.renderState(NEAR.chunk - 1, 60, 40);
    hidden = true;
  }

  it('compareAt jumps two chunks ahead and back before A1, on every attempt', () => {
    tweak = (out, offset, i) => {
      if (i === 1) out[offset] = (out[offset]! + 1) & 255;
    };
    lab.compareAt(NEAR, FAR);
    const calls = stub.host.calls.renderState;
    expect(calls.slice(0, 3)).toEqual([[NEAR.chunk + 2, 12.5, 120], [NEAR.chunk, 12.5, 120], [NEAR.chunk, 12.5, 120]]);
    // Attempt 2 starts after the first triple.
    expect(calls.slice(5, 7)).toEqual([[NEAR.chunk + 2, 12.5, 120], [NEAR.chunk, 12.5, 120]]);
  });

  it('a frame taken straight after DEMO keeps the hidden shard, so without the refill it differs from its own repeat', () => {
    afterDemo();
    stub.host.renderState(NEAR.chunk, NEAR.local, NEAR.tick);
    expect(hidden, 'a one-chunk step forward refills nothing').toBe(true);
    stub.host.renderState(FAR.chunk, FAR.local, FAR.tick);
    expect(hidden, 'a jump refills, as B and A2 do').toBe(false);
  });

  it('compareAt at attempts 1 matches after DEMO hid a shard (B3, A9)', () => {
    afterDemo();
    const r = lab.compareAt(NEAR, FAR, { attempts: 1 });
    expect(r).toMatchObject({ pass: true, attempts: 1, selfBytes: 0, crossBytes: 0 });
  });

  it('the near control matches after DEMO hid a shard (A9)', () => {
    afterDemo();
    expect(lab.compareAt(NEAR, { ...NEAR, chunk: NEAR.chunk + 1024 }, { attempts: 1 }).pass).toBe(true);
  });

  it('refill alone leaves the rings rebuilt at the key', () => {
    afterDemo();
    lab.refill(NEAR);
    expect(hidden).toBe(false);
    expect(stub.host.calls.renderState.slice(-2)).toEqual([[NEAR.chunk + 2, 12.5, 120], [NEAR.chunk, 12.5, 120]]);
  });

  it('jumps behind instead where ahead would pass the warp limit', () => {
    const top = { chunk: CHUNK_LIMIT - 1, local: 3, tick: 9 };
    lab.refill(top);
    expect(stub.host.calls.renderState.slice(-2)).toEqual([[CHUNK_LIMIT - 1 - REFILL_JUMP_CHUNKS, 3, 9], [CHUNK_LIMIT - 1, 3, 9]]);
  });

  describe('sequence', () => {
    beforeEach(() => {
      const realNow = performance.now.bind(performance);
      let offset = 0;
      performance.now = () => {
        offset += 1000;
        return realNow() + offset;
      };
      return () => { performance.now = realNow; };
    });

    it('refills before the near run, so it matches the far run after DEMO hid a shard (B4)', () => {
      afterDemo();
      const r = lab.sequence(NEAR, FAR, 10, 1.33, 2, { attempts: 1 });
      expect(r).toMatchObject({ pass: true, attempts: 1, worstBytes: 0 });
    });
  });
});

describe('stepToTick (V2-T09)', () => {
  it('steps the sim one step a frame to exactly the tick asked', () => {
    const from = stub.host.sim.state.tick;
    expect(lab.stepToTick(from + 37)).toBe(from + 37);
    expect(stub.host.sim.state.tick).toBe(from + 37);
    expect(stub.host.calls.runFrame.length).toBe(37);
    for (const dt of stub.host.calls.runFrame) expect(dt).toBe(1 / 120);
  });

  it('two pages that start at different ticks end at the same one', () => {
    stub.host.runFrame(5 / 120);
    expect(lab.stepToTick(100)).toBe(100);
  });

  it('is a no-op at the tick itself', () => {
    const t = stub.host.sim.state.tick;
    expect(lab.stepToTick(t)).toBe(t);
    expect(stub.host.calls.runFrame.length).toBe(0);
  });

  it('throws when the sim is already past the tick, rather than measuring at another pose', () => {
    stub.host.runFrame(10 / 120);
    expect(() => lab.stepToTick(3)).toThrow('already at tick');
  });

  it('throws when a frame steps twice and overshoots', () => {
    const run = stub.host.runFrame.bind(stub.host);
    stub.host.runFrame = (dt: number): void => { run(2 * dt); };
    expect(() => lab.stepToTick(stub.host.sim.state.tick + 5)).toThrow('overshot');
  });

  it('throws when the host does not step at all', () => {
    stub.host.runFrame = (): void => undefined;
    expect(() => lab.stepToTick(stub.host.sim.state.tick + 5)).toThrow('short of');
  });

  it('throws outside manual, through stepFrames', () => {
    createHarness(stub.host);
    const fresh = (globalThis as unknown as { __mvLab: HarnessLab }).__mvLab;
    expect(() => fresh.stepToTick(stub.host.sim.state.tick + 1)).toThrow('manual');
  });
});

describe('compareAt under DI-58, the gpu tolerance', () => {
  /** n bytes of read `at`, each moved by d. R channels only, which stay under 251, so nothing wraps. */
  function bump(at: (i: number) => boolean, n: number, d: number): void {
    tweak = (out, offset, i) => {
      if (at(i)) for (let b = 0; b < n; b++) out[offset + b * 4] = out[offset + b * 4]! + d;
    };
  }

  it('64 bytes by 1 in the cross-compare is the same frame, first try', () => {
    bump((i) => i === 1, 64, 1);
    expect(lab.compareAt(NEAR, FAR, { tolerance: GPU_SAME_STATE })).toMatchObject({ pass: true, attempts: 1, crossBytes: 64, crossMax: 1 });
  });

  it('64 bytes by 1 in the self-compare is the same frame too', () => {
    bump((i) => i === 2, 64, 1);
    expect(lab.compareAt(NEAR, FAR, { tolerance: GPU_SAME_STATE })).toMatchObject({ pass: true, attempts: 1, selfBytes: 64, selfMax: 1 });
  });

  it('65 bytes by 1 with a matching self-compare is real: fails at once', () => {
    bump((i) => i === 1, 65, 1);
    expect(lab.compareAt(NEAR, FAR, { tolerance: GPU_SAME_STATE })).toMatchObject({ pass: false, attempts: 1, crossBytes: 65 });
  });

  it('one byte by 2 fails at once, though it is inside the byte bound', () => {
    bump((i) => i === 1, 1, 2);
    expect(lab.compareAt(NEAR, FAR, { tolerance: GPU_SAME_STATE })).toMatchObject({ pass: false, attempts: 1, crossMax: 2, worstCrossMax: 2 });
  });

  it('a self-compare moved by 2 fails at once', () => {
    bump((i) => i % 3 === 2, 1, 2);
    expect(lab.compareAt(NEAR, FAR, { tolerance: GPU_SAME_STATE })).toMatchObject({ pass: false, attempts: 1, selfMax: 2 });
  });

  it('a self-compare past the bound at 1 level is an unstable frame: every attempt, then fail', () => {
    bump((i) => i % 3 === 2, 65, 1);
    expect(lab.compareAt(NEAR, FAR, { tolerance: GPU_SAME_STATE })).toMatchObject({ pass: false, attempts: 5, selfBytes: 65 });
  });

  it('a real difference still fails at once: the absCoord control keeps its teeth', () => {
    const r = lab.compareAt(NEAR, { ...FAR, chunk: FAR.chunk + 1 }, { tolerance: GPU_SAME_STATE });
    expect(r).toMatchObject({ pass: false, attempts: 1, selfBytes: 0, crossBytes: 64 * 32 });
  });
});

describe('sequence', () => {
  // settle runs on a real clock, so a short one keeps the test quick without changing what is compared.
  beforeEach(() => {
    const realNow = performance.now.bind(performance);
    let offset = 0;
    performance.now = () => {
      offset += 1000;
      return realNow() + offset;
    };
    return () => { performance.now = realNow; };
  });

  it('passes when near and far match frame by frame, stepping both', () => {
    const r = lab.sequence(NEAR, FAR, 10, 1.33, 2);
    expect(r).toMatchObject({ pass: true, attempts: 1, worstBytes: 0, worstMax: 0, store: 'ok' });
    const states = stub.host.calls.renderState.slice(-10);
    expect(states[0]).toEqual([FAR.chunk, 12.5, 120]);
    expect(states[9]![0]).toBe(FAR.chunk);
    expect(states[9]![1]).toBeCloseTo(12.5 + 9 * 1.33, 9);
    expect(states[9]![2]).toBe(120 + 18);
  });

  it('crosses a chunk boundary while stepping', () => {
    lab.sequence({ ...NEAR, local: 63 }, { ...FAR, local: 63 }, 3, 1.33, 2);
    const last3 = stub.host.calls.renderState.slice(-3);
    expect(last3[1]![0]).toBe(FAR.chunk + 1);
    expect(last3[1]![1]).toBeCloseTo(0.33, 9);
  });

  it('fails at once on a real difference, naming the frame', () => {
    const r = lab.sequence(NEAR, { ...FAR, chunk: FAR.chunk + 1 }, 10, 1.33, 2);
    expect(r.pass).toBe(false);
    expect(r.attempts).toBe(1);
    expect(r.worstFrame).toBe(0);
    expect(r.worstBytes).toBe(64 * 32);
  });

  // Frames 10: each attempt reads 10 near frames, then 10 far ones, so read 20k + 10 is attempt k's first far frame.
  const firstFar = (i: number): boolean => i % 20 === 10;

  it('an attempt with a noisy frame inside the signature does not pass: every attempt dirty means fail (V1)', () => {
    tweak = (out, offset, i) => {
      if (firstFar(i)) out[offset] = (out[offset]! + 1) & 255;
    };
    const r = lab.sequence(NEAR, FAR, 10, 1.33, 2);
    expect(r).toMatchObject({ pass: false, attempts: 3, worstBytes: 1, worstMax: 1, worstFrame: 0 });
  });

  it('passes on the first attempt with no dirty frame', () => {
    tweak = (out, offset, i) => {
      if (i === 10) out[offset] = (out[offset]! + 1) & 255;
    };
    expect(lab.sequence(NEAR, FAR, 10, 1.33, 2)).toMatchObject({ pass: true, attempts: 2, worstBytes: 0 });
  });

  it('DI-58: under the gpu tolerance the same noisy frame matches, first try', () => {
    tweak = (out, offset, i) => {
      if (firstFar(i)) for (let b = 0; b < 64; b++) out[offset + b * 4] = out[offset + b * 4]! + 1;
    };
    expect(lab.sequence(NEAR, FAR, 10, 1.33, 2, { tolerance: GPU_SAME_STATE })).toMatchObject({ pass: true, attempts: 1, worstBytes: 64 });
  });

  it('DI-58: 65 bytes by 1, or one byte by 2, fails at once', () => {
    tweak = (out, offset, i) => {
      if (i === 13) for (let b = 0; b < 65; b++) out[offset + b * 4] = out[offset + b * 4]! + 1;
    };
    expect(lab.sequence(NEAR, FAR, 10, 1.33, 2, { tolerance: GPU_SAME_STATE })).toMatchObject({ pass: false, attempts: 1, worstBytes: 65, worstFrame: 3 });
    readIndex = 0;
    tweak = (out, offset, i) => {
      if (i === 13) out[offset] = out[offset]! + 2;
    };
    expect(lab.sequence(NEAR, FAR, 10, 1.33, 2, { tolerance: GPU_SAME_STATE })).toMatchObject({ pass: false, attempts: 1, worstMax: 2 });
  });

  it('reports a store it could not allocate, and does not fall back silently', () => {
    const RealArray = Uint8Array;
    (globalThis as { Uint8Array: unknown }).Uint8Array = new Proxy(RealArray, {
      construct(target, args: [number]) {
        if (args[0] > 1000) throw new RangeError('Array buffer allocation failed');
        return new target(args[0]);
      },
    });
    try {
      expect(lab.sequence(NEAR, FAR, 120, 1.33, 2)).toMatchObject({ pass: false, store: 'failed', attempts: 0 });
    } finally {
      (globalThis as { Uint8Array: unknown }).Uint8Array = RealArray;
    }
  });
});

describe('shimmer', () => {
  it('reads 0 at a zero step: the metric sees motion, not noise', () => {
    const r = lab.shimmer(NEAR, { stepU: 0 });
    expect(r.mean).toBe(0);
    expect(r.perFrame.length).toBe(47);
  });

  it('holds the tick, and advances local through the chunk', () => {
    lab.shimmer({ chunk: 5, local: 63.5, tick: 77 }, { frames: 3, stepU: 1 });
    expect(stub.host.calls.renderState).toEqual([[5, 63.5, 77], [6, 0.5, 77], [6, 1.5, 77]]);
  });

  it('is the mean of the band difference across frames', () => {
    const r = lab.shimmer(NEAR, { frames: 4, stepU: 1 });
    expect(r.perFrame.length).toBe(3);
    // stateByte moves by 4 * 7 = 28 on one R of three channels per u.
    for (const d of r.perFrame) expect(d).toBeCloseTo(28 / 3, 9);
    expect(r.mean).toBeCloseTo(28 / 3, 9);
  });

  it('uses T03 band unless told otherwise', () => {
    // Only row 0 from the top changes, which is the last row in a bottom-up frame.
    stub.paint = (out, offset, w, h): void => {
      out.fill(0, offset, offset + w * h * 4);
      const start = offset + (h - 1) * w * 4;
      out.fill(last.local * 10, start, start + w * 4);
    };
    expect(lab.shimmer(NEAR, { frames: 2, stepU: 1 }).mean).toBe(0);
    expect(lab.shimmer(NEAR, { frames: 2, stepU: 1, r0: 0, r1: 1 }).mean).toBeGreaterThan(0);
  });
});

describe('washoutAt', () => {
  it('takes its reference at bloomGain 0, and restores what forceFeel held', () => {
    const mv = (globalThis as unknown as { __mv: { forceFeel(o: unknown): void } }).__mv;
    mv.forceFeel({ roll: 0.1 });
    stub.host.calls.overrideFeel.length = 0;
    let gain: number | null = null;
    const set = stub.host.overrideFeel.bind(stub.host);
    stub.host.overrideFeel = (o): void => {
      gain = o && 'bloomGain' in o ? o.bloomGain ?? null : null;
      set(o);
    };
    stub.paint = (out, offset, w, h): void => {
      const v = gain === 0 ? 100 : 130;
      for (let i = 0; i < w * h * 4; i += 4) {
        out[offset + i] = v;
        out[offset + i + 1] = v;
        out[offset + i + 2] = v;
        out[offset + i + 3] = 255;
      }
    };
    const r = lab.washoutAt(NEAR);
    expect(r.hazeLift).toBeCloseTo(30, 6);
    expect(r.meanLuma).toBeCloseTo(130, 6);
    expect(r.blackP10).toBe(130);
    expect(stub.host.calls.overrideFeel).toEqual([{ roll: 0.1, bloomGain: 0 }, { roll: 0.1 }]);
  });
});

describe('crackSweep', () => {
  it('sums cracks over frames and names the worst', () => {
    let frame = 0;
    stub.paint = (out, offset, w, h): void => {
      // Terrain everywhere, with one sky pixel in the bottom row on frame 2, three on frame 3.
      for (let i = 0; i < w * h * 4; i += 4) {
        out[offset + i] = 20;
        out[offset + i + 1] = 120;
        out[offset + i + 2] = 60;
        out[offset + i + 3] = 255;
      }
      const n = frame === 2 ? 1 : frame === 3 ? 3 : 0;
      for (let p = 0; p < n; p++) {
        out[offset + p * 4] = 255;
        out[offset + p * 4 + 1] = 0;
        out[offset + p * 4 + 2] = 255;
      }
      frame++;
    };
    expect(lab.crackSweep(NEAR, 5, 2.5)).toMatchObject({ bad: 4, worstFrame: 3, silhouetteStd: 0 });
    const states = stub.host.calls.renderState;
    expect(states.length).toBe(5);
    expect(states[4]![1]).toBeCloseTo(12.5 + 10, 9);
    expect(states[4]![2]).toBe(NEAR.tick);
  });

  it('a clean frame reads no bad frame at all', () => {
    expect(lab.crackSweep(NEAR, 2, 2.5)).toMatchObject({ bad: 0, worstFrame: -1 });
  });
});

describe('edgePaintAt', () => {
  it('decodes one frame', () => {
    stub.paint = (out, offset, w, h): void => {
      for (let i = 0; i < w * h * 4; i += 4) {
        out[offset + i] = 0;
        out[offset + i + 1] = 255;
        out[offset + i + 2] = 0;
        out[offset + i + 3] = 255;
      }
    };
    expect(lab.edgePaintAt(NEAR)).toEqual({ ok: 64 * 32, bad: 0, interior: 0, clear: 0, other: 0 });
  });
});

describe('a sweep with no context', () => {
  it('throws rather than comparing nothing to nothing', () => {
    stub.lost = true;
    expect(() => lab.compareAt(NEAR, FAR)).toThrow('context is lost');
  });
});
