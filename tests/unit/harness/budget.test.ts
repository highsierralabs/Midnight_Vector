import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness } from '../../../src/harness/index';
import type { HarnessLab } from '../../../src/harness/lab';
import { callCountProblems, type BudgetReport } from '../../../src/harness/budget';
import { probeFrame, probeState, slotsFor } from '../../../src/harness/hotProbe';
import type { RenderLayer } from '../../../src/contracts/index';
import { createGlStub, type GlStub } from './support/glStub';

interface MemoryPerf { memory?: { usedJSHeapSize: number } }

let stub: GlStub;
let lab: HarnessLab;

beforeEach(() => {
  stub = createGlStub();
  createHarness(stub.host).manual(true);
  lab = (globalThis as unknown as { __mvLab: HarnessLab }).__mvLab;
});

afterEach(() => {
  delete (performance as unknown as MemoryPerf).memory;
  delete (globalThis as unknown as { gc?: unknown }).gc;
  lab.controls.allocProbe(0);
  lab.controls.leakProbe(0);
  lab.instrument(false);
});

describe('timedFrames', () => {
  it('runs n frames, each synced, and returns one time per frame', () => {
    const ms = lab.timedFrames(5, 1 / 60);
    expect(ms.length).toBe(5);
    for (const t of ms) expect(t).toBeGreaterThanOrEqual(0);
    expect(stub.host.calls.runFrame.length).toBe(5);
    expect(stub.reads.filter((r) => r.w === 1).length).toBe(5);
  });
});

describe('instrument', () => {
  /** A clock the wrapped functions advance, so sums are exact and the test cannot flake. */
  function fakeClock(): { tick(ms: number): void; restore(): void } {
    const real = performance.now.bind(performance);
    let t = 0;
    performance.now = () => t;
    return { tick(ms: number): void { t += ms; }, restore(): void { performance.now = real; } };
  }

  it('attributes time to sim, layers, streaming, post and residual', () => {
    const clock = fakeClock();
    try {
      const host = stub.host;
      const cost: Record<string, number> = { sky: 0.2, terrain: 0.5, props: 0.3, fx: 0.1 };
      const step = host.sim.step.bind(host.sim);
      host.sim.step = (c): void => {
        clock.tick(0.25);
        step(c);
      };
      const layers = host.layers as RenderLayer[];
      for (const layer of layers) layer.frame = (): void => { clock.tick(cost[layer.name]!); };
      host.post.frame = (): void => { clock.tick(0.05); };
      host.post.render = (): void => { clock.tick(2); };
      const run = host.runFrame.bind(host);
      host.runFrame = (dt): void => {
        run(dt);
        for (const layer of host.layers) layer.frame({} as never);
        host.post.frame({} as never);
        host.post.render(dt);
        clock.tick(0.4);
      };
      lab.instrument(true);
      lab.timedFrames(10, 1 / 60);
      const b = lab.budgets();
      expect(b.frames).toBe(10);
      // Two steps at 1/60.
      expect(b.sim.p50).toBeCloseTo(0.5, 9);
      expect(b.layers.p50).toBeCloseTo(1.1, 9);
      expect(b.streaming.p50).toBeCloseTo(0.8, 9);
      expect(b.postFrame.p95).toBeCloseTo(0.05, 9);
      expect(b.postRender.p99).toBeCloseTo(2, 9);
      expect(b.residual.max).toBeCloseTo(0.4, 9);
      expect(b.minCalls).toEqual({ sim: 2, layers: 4, streaming: 2, postFrame: 1, postRender: 1 });
      lab.resetBudgets();
      expect(lab.budgets().frames).toBe(0);
      expect(lab.budgets().minCalls).toEqual({ sim: 0, layers: 0, streaming: 0, postFrame: 0, postRender: 0 });
    } finally {
      clock.restore();
    }
  });

  it('a host that keeps a captured method bypasses the wrappers, and the count says so (B18)', () => {
    const host = stub.host;
    // Captured before instrument, as a host against the seam would hold them.
    const step = host.sim.step;
    const render = host.post.render;
    host.runFrame = (dt): void => {
      step.call(host.sim, { moveX: 0, moveY: 0, absolute: false, boost: false, human: false });
      render.call(host.post, dt);
    };
    lab.instrument(true);
    lab.timedFrames(3, 1 / 60);
    const b = lab.budgets();
    expect(b.frames).toBe(3);
    expect(b.minCalls).toMatchObject({ sim: 0, streaming: 0, postRender: 0 });
  });

  it('counts per frame: one frame with no post.render reads 0', () => {
    const host = stub.host;
    let n = 0;
    host.runFrame = (dt): void => {
      host.sim.step({ moveX: 0, moveY: 0, absolute: false, boost: false, human: false });
      if (n++ !== 1) host.post.render(dt);
    };
    lab.instrument(true);
    lab.timedFrames(3, 1 / 60);
    expect(lab.budgets().minCalls).toMatchObject({ sim: 1, postRender: 0 });
  });

  // V2-T09: with the sim and streaming counts the same in every frame, a minimum flipped to a maximum survived.
  it('the sim count is the fewest steps in any frame, not the most', () => {
    const host = stub.host;
    const steps = [2, 0, 3];
    let n = 0;
    host.runFrame = (dt): void => {
      for (let i = 0; i < steps[n]!; i++) host.sim.step({ moveX: 0, moveY: 0, absolute: false, boost: false, human: false });
      n++;
      host.post.render(dt);
    };
    lab.instrument(true);
    lab.timedFrames(3, 1 / 60);
    expect(lab.budgets().minCalls.sim).toBe(0);
  });

  it('the streaming count is the fewest terrain and props frames in any frame, not the most', () => {
    const host = stub.host;
    const terrain = host.layers.find((l) => l.name === 'terrain')!;
    const props = host.layers.find((l) => l.name === 'props')!;
    let n = 0;
    host.runFrame = (): void => {
      terrain.frame({} as never);
      // Frame 1 skips props, so it has 1 streaming call where the others have 2.
      if (n++ !== 1) props.frame({} as never);
    };
    lab.instrument(true);
    lab.timedFrames(3, 1 / 60);
    expect(lab.budgets().minCalls.streaming).toBe(1);
  });

  it('reports how many layers it wrapped, and minCalls.layers reaches it when every layer runs', () => {
    lab.instrument(true);
    lab.timedFrames(2, 1 / 60);
    const b = lab.budgets();
    expect(b.layerCount).toBe(stub.host.layers.length);
    expect(b.layerCount).toBe(4);
  });

  it('restores every method when switched off', () => {
    const host = stub.host;
    const sim = host.sim.step;
    const frame = host.layers[1]!.frame;
    const render = host.post.render;
    lab.instrument(true);
    expect(host.sim.step).not.toBe(sim);
    expect(host.layers[1]!.frame).not.toBe(frame);
    expect(host.post.render).not.toBe(render);
    lab.instrument(false);
    expect(host.sim.step).toBe(sim);
    expect(host.layers[1]!.frame).toBe(frame);
    expect(host.post.render).toBe(render);
  });

  it('is idempotent, so a second true cannot wrap a wrapper', () => {
    lab.instrument(true);
    const wrapped = stub.host.sim.step;
    lab.instrument(true);
    expect(stub.host.sim.step).toBe(wrapped);
  });

  it('throws on a frozen object, because the seam says none is', () => {
    Object.freeze(stub.host.post);
    expect(() => { lab.instrument(true); }).toThrow('post is frozen');
  });

  it('throws on a frozen layer, naming it', () => {
    Object.freeze(stub.host.layers[2]);
    expect(() => { lab.instrument(true); }).toThrow('layer props is frozen');
  });

  it('wraps by property lookup, so a method on the prototype is left as it was', () => {
    class Post { frame(): void { /* nothing */ } render(): void { /* nothing */ } }
    const host = stub.host;
    const inst = new Post();
    Object.assign(host.post, { frame: inst.frame, render: inst.render });
    lab.instrument(true);
    lab.instrument(false);
    expect(typeof host.post.frame).toBe('function');
  });
});

describe('callCountProblems, B18 (V2-T09)', () => {
  const NONE = { sim: 0, layers: 0, streaming: 0, postFrame: 0, postRender: 0 };
  /** Every layer's frame and the sim, then post, per frame: the shape T10's runFrame has. */
  function honest(): void {
    const host = stub.host;
    host.runFrame = (dt): void => {
      host.sim.step({ moveX: 0, moveY: 0, absolute: false, boost: false, human: false });
      for (const layer of host.layers) layer.frame({} as never);
      host.post.frame({} as never);
      host.post.render(dt);
    };
  }

  it('is empty when every wrapper fired in every frame', () => {
    honest();
    lab.instrument(true);
    lab.timedFrames(4, 1 / 60);
    expect(lab.budgets().minCalls).toEqual({ sim: 1, layers: 4, streaming: 2, postFrame: 1, postRender: 1 });
    expect(callCountProblems(lab.budgets())).toEqual([]);
  });

  it('flags props reached through a captured method, which the streaming count alone passes', () => {
    const host = stub.host;
    const props = host.layers.find((l) => l.name === 'props')!;
    const captured = props.frame;
    honest();
    const run = host.runFrame;
    host.runFrame = (dt): void => {
      // As honest, but props through the reference taken before instrument.
      const real = props.frame;
      props.frame = captured;
      run(dt);
      props.frame = real;
    };
    lab.instrument(true);
    lab.timedFrames(3, 1 / 60);
    const b = lab.budgets();
    expect(b.minCalls.streaming, 'terrain alone keeps streaming at 1').toBe(1);
    const problems = callCountProblems(b);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('fewer than the 4 layers');
  });

  it('flags a sky or fx layer skipped in one frame', () => {
    const host = stub.host;
    let n = 0;
    host.runFrame = (dt): void => {
      host.sim.step({ moveX: 0, moveY: 0, absolute: false, boost: false, human: false });
      for (const layer of host.layers) if (!(layer.name === 'sky' && n === 2)) layer.frame({} as never);
      n++;
      host.post.render(dt);
    };
    lab.instrument(true);
    lab.timedFrames(3, 1 / 60);
    expect(callCountProblems(lab.budgets())).toEqual([expect.stringContaining('3 layer frame calls, fewer than the 4')]);
  });

  it('flags each line separately, and an empty report', () => {
    const empty = { frames: 0, minCalls: NONE, layerCount: 4 } as unknown as BudgetReport;
    const all = callCountProblems(empty);
    expect(all).toHaveLength(5);
    expect(all[0]).toContain('no instrumented frame');
    const one = (k: keyof typeof NONE): string[] => callCountProblems({ frames: 3, layerCount: 4, minCalls: { sim: 1, layers: 4, streaming: 2, postFrame: 1, postRender: 1, [k]: 0 } } as unknown as BudgetReport);
    expect(one('sim')).toEqual([expect.stringContaining('no sim.step')]);
    expect(one('streaming')).toEqual([expect.stringContaining('no terrain or props')]);
    expect(one('postRender')).toEqual([expect.stringContaining('no post.render')]);
    expect(one('layers')).toEqual([expect.stringContaining('0 layer frame calls')]);
  });
});

describe('allocWindows', () => {
  it('reads the heap around each window, and drops a scavenge', () => {
    let heap = 1_000_000;
    let calls = 0;
    Object.defineProperty(performance, 'memory', {
      configurable: true,
      get: () => ({
        get usedJSHeapSize(): number {
          calls++;
          // A window costs 1000 bytes. The third window holds a scavenge.
          if (calls === 6) heap -= 500_000;
          else if (calls % 2 === 0) heap += 1000;
          return heap;
        },
      }),
    });
    const r = lab.allocWindows(5, 10, 1 / 60);
    expect(r).toEqual({ median: 100, dropped: 1, windows: 5 });
    expect(stub.host.calls.runFrame.length).toBe(50);
  });

  it('reads NaN without memory info, rather than a false zero', () => {
    expect(lab.allocWindows(2, 1, 1 / 60).median).toBeNaN();
  });
});

describe('allocPairs, B19s interleaved windows control (DI-84)', () => {
  /** Records every allocProbe call, and models the heap: 1000 B a window, plus 10 B a frame per probe byte while on. */
  function modelled(scavengeAtRead = -1): { seen: number[] } {
    const seen: number[] = [];
    const original = lab.controls.allocProbe;
    lab.controls.allocProbe = (bytes: number): void => {
      seen.push(bytes);
      original(bytes);
    };
    let heap = 1_000_000;
    let reads = 0;
    Object.defineProperty(performance, 'memory', {
      configurable: true,
      get: () => ({
        get usedJSHeapSize(): number {
          reads++;
          if (reads === scavengeAtRead) heap -= 500_000;
          else if (reads % 2 === 0) heap += 1000 + 10 * (seen[seen.length - 1] ?? 0);
          return heap;
        },
      }),
    });
    return { seen };
  }

  it('alternates probe-on and probe-off windows over one stretch, and leaves the probe off', () => {
    const { seen } = modelled();
    const r = lab.allocPairs(4, 10, 1 / 60, 256);
    expect(r.on).toEqual({ median: 356, dropped: 0, windows: 4 });
    expect(r.off).toEqual({ median: 100, dropped: 0, windows: 4 });
    expect(r.moved).toBe(256);
    expect(seen).toEqual([256, 0, 256, 0, 256, 0, 256, 0, 0]);
    expect(stub.host.calls.runFrame.length).toBe(80);
  });

  it('control: a probe of 0 moves nothing', () => {
    const { seen } = modelled();
    const r = lab.allocPairs(3, 10, 1 / 60, 0);
    expect(r.moved).toBe(0);
    expect(seen.every((b) => b === 0)).toBe(true);
  });

  it('drops a scavenge on its own side', () => {
    // Read 6 is the after-read of the third window, which is the second pair's probe-on window.
    modelled(6);
    const r = lab.allocPairs(3, 10, 1 / 60, 256);
    expect(r.on.dropped).toBe(1);
    expect(r.off.dropped).toBe(0);
    expect(r.on.median).toBe(356);
  });

  it('leaves the probe off when a frame throws inside a probe-on window', () => {
    const { seen } = modelled();
    const run = stub.host.runFrame;
    let frames = 0;
    stub.host.runFrame = (dt: number): void => {
      if (++frames === 5) throw new Error('frame 5 threw');
      run.call(stub.host, dt);
    };
    expect(() => lab.allocPairs(4, 10, 1 / 60, 256)).toThrow('frame 5 threw');
    expect(seen).toEqual([256, 0]);
  });

  it('reads NaN without memory info, rather than a false zero, and still leaves the probe off', () => {
    const seen: number[] = [];
    const original = lab.controls.allocProbe;
    lab.controls.allocProbe = (bytes: number): void => {
      seen.push(bytes);
      original(bytes);
    };
    expect(lab.allocPairs(2, 1, 1 / 60, 256).moved).toBeNaN();
    expect(seen[seen.length - 1]).toBe(0);
  });
});

describe('heapCalibration', () => {
  it('reads 0 without memory info', () => {
    expect(lab.heapCalibration()).toBe(0);
  });

  it('reads 0 when the reading is bucketed, as without the flag', () => {
    Object.defineProperty(performance, 'memory', { configurable: true, value: { usedJSHeapSize: 5_000_000 } });
    expect(lab.heapCalibration()).toBe(0);
  });

  it('reads what the known array cost, net of the read itself', () => {
    let heap = 0;
    let reads = 0;
    Object.defineProperty(performance, 'memory', {
      configurable: true,
      get: () => {
        reads++;
        // Every read costs 64 bytes. Read 1 only asks whether memory info exists, then each run reads three times, and
        // the probe allocates 1032 just before the second read of a run: reads 3, 6, 9 and so on.
        heap += 64;
        if (reads % 3 === 0) heap += 1032;
        return { usedJSHeapSize: heap };
      },
    });
    expect(lab.heapCalibration()).toBe(1032);
  });
});

describe('heapAfterGc', () => {
  it('throws without gc, so a wrong project fails loudly', () => {
    expect(() => lab.heapAfterGc()).toThrow('gpu-timing');
  });

  it('collects twice and reads the heap', () => {
    let collected = 0;
    (globalThis as unknown as { gc: () => void }).gc = () => { collected++; };
    Object.defineProperty(performance, 'memory', { configurable: true, value: { usedJSHeapSize: 1234 } });
    expect(lab.heapAfterGc()).toBe(1234);
    expect(collected).toBe(2);
  });
});

describe('probes', () => {
  it('sizes follow 4n + 24', () => {
    expect(slotsFor(1032)).toBe(252);
    expect(slotsFor(256)).toBe(58);
    expect(slotsFor(1024)).toBe(250);
    expect(slotsFor(10)).toBe(0);
  });

  it('run once per frame while on, and not at all when off', () => {
    lab.controls.leakProbe(256);
    const before = probeState().retained;
    lab.timedFrames(3, 1 / 60);
    expect(probeState().retained).toBe(before + 3);
    lab.controls.leakProbe(0);
    expect(probeState().retained).toBe(0);
    lab.timedFrames(3, 1 / 60);
    expect(probeState().retained).toBe(0);
  });

  it('a negative slot count is off, and zero is a real empty array', () => {
    probeFrame(-1, -1);
    expect(probeState().retained).toBe(0);
    probeFrame(-1, 0);
    expect(probeState().retained).toBe(1);
    lab.controls.leakProbe(0);
    expect(probeState().retained).toBe(0);
  });

  it('allocProbe leaves nothing retained', () => {
    lab.controls.allocProbe(256);
    lab.timedFrames(3, 1 / 60);
    const s = probeState();
    expect(s.sink).toBe(true);
    expect(s.retained).toBe(0);
  });
});
