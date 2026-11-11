// Timing and allocation measurement. Frame time comes from the 1x1 readPixels sync in a tight loop, never from rAF deltas
// or page.clock (section 11.4). performance.now resolves .1 ms on these pages, so sub-budgets are sums per frame, read
// as percentiles (section 9.2). No three.
import { allocTick } from './hotProbe';
import type { HarnessCore } from './api';
import { percentile, windowMedian } from './metrics';

export interface AllocWindows { median: number; dropped: number; windows: number }
/** moved is on.median minus off.median. */
export interface AllocPairs { on: AllocWindows; off: AllocWindows; moved: number }
export interface Quant { p50: number; p95: number; p99: number; max: number }
/**
 * The fewest calls any recorded frame made to each wrapped method. A host that reaches sim, a layer or post through a
 * captured reference, against the seam, bypasses the wrappers, and that line would read 0 ms and pass. So a gate on a
 * line first asserts its count is at least 1 (B18).
 */
export interface CallCounts { sim: number; layers: number; streaming: number; postFrame: number; postRender: number }
/** layerCount is how many layers instrument wrapped, so minCalls.layers can be held to one frame call per layer. */
export interface BudgetReport {
  frames: number; sim: Quant; layers: Quant; streaming: Quant; postFrame: Quant; postRender: Quant; residual: Quant; minCalls: CallCounts;
  layerCount: number;
}

/**
 * B18's guard, as one pure function so the unit suite can hold it to its job. Empty when every gated line had its
 * wrappers fire in every recorded frame; otherwise one message per line that would read 0 and pass. Streaming counts
 * terrain and props together, so at least one of them per frame satisfies it even with the other bypassed, and the
 * layers line is held to every wrapped layer's frame in every frame (V2-T09).
 */
export function callCountProblems(b: Readonly<BudgetReport>): string[] {
  const out: string[] = [];
  if (b.frames < 1) out.push('no instrumented frame was recorded');
  if (b.minCalls.sim < 1) out.push('a frame with no sim.step seen; check that runFrame reaches sim by property lookup');
  if (b.minCalls.layers < b.layerCount) out.push(`a frame with ${b.minCalls.layers} layer frame calls, fewer than the ${b.layerCount} layers; a layer is reached through a captured method`);
  if (b.minCalls.streaming < 1) out.push('a frame with no terrain or props frame seen');
  if (b.minCalls.postRender < 1) out.push('a frame with no post.render seen');
  return out;
}

export interface Budget {
  timedFrames(n: number, dt: number): number[];
  instrument(on: boolean): void;
  budgets(): BudgetReport;
  resetBudgets(): void;
  allocWindows(windows: number, framesPerWindow: number, dt: number): AllocWindows;
  /**
   * B19's interleaved windows control (DI-84): pairs of windows over one stretch of route, set(true) before each first
   * window and set(false) before each second, so both medians see the same route. set(false) runs last, even on a throw.
   */
  allocPairs(pairs: number, framesPerWindow: number, dt: number, set: (on: boolean) => void): AllocPairs;
  heapCalibration(): number;
  /** gc(); gc(); then usedJSHeapSize. Throws without --expose-gc, so a wrong project fails loudly. */
  heapAfterGc(): number;
}

/** A week of soak would still fit; frames past this are not recorded. */
const CAPACITY = 1 << 17;
/** new Array(252) is 4 * 252 + 24 = 1032 bytes in Chrome (hotProbe.ts). */
const CALIBRATION_SLOTS = 252;
const CALIBRATION_RUNS = 9;

interface MemoryPerformance { memory?: { usedJSHeapSize: number } }

function usedHeap(): number {
  const m = (performance as unknown as MemoryPerformance).memory;
  return m ? m.usedJSHeapSize : Number.NaN;
}

function quant(values: Float64Array): Quant {
  return { p50: percentile(values, 0.5), p95: percentile(values, 0.95), p99: percentile(values, 0.99), max: percentile(values, 1) };
}

/** Replaces one single-argument method, reached by property lookup, and returns how to undo that. */
function wrapMethod(o: object, key: string, add: (ms: number) => void): () => void {
  const target = o as Record<string, unknown>;
  const own = Object.prototype.hasOwnProperty.call(target, key);
  const original = target[key] as (a: unknown) => unknown;
  target[key] = function wrapped(a: unknown): unknown {
    const start = performance.now();
    const r = original.call(o, a);
    add(performance.now() - start);
    return r;
  };
  return () => {
    if (own) target[key] = original;
    else delete target[key];
  };
}

export function createBudget(core: HarnessCore): Budget {
  const { host, sync } = core;
  const series = {
    sim: new Float64Array(CAPACITY), layers: new Float64Array(CAPACITY), streaming: new Float64Array(CAPACITY),
    postFrame: new Float64Array(CAPACITY), postRender: new Float64Array(CAPACITY), residual: new Float64Array(CAPACITY),
  };
  let frames = 0;
  let sim = 0, layers = 0, streaming = 0, postFrame = 0, postRender = 0;
  // Calls in the current frame, and the fewest seen in any recorded frame.
  const calls: CallCounts = { sim: 0, layers: 0, streaming: 0, postFrame: 0, postRender: 0 };
  const minCalls: CallCounts = { sim: 0, layers: 0, streaming: 0, postFrame: 0, postRender: 0 };
  let undo: (() => void)[] = [];

  function requireWritable(name: string, o: object): void {
    if (Object.isFrozen(o)) throw new Error(`instrument: ${name} is frozen, and the seam says it must not be, because timing wraps its methods`);
  }

  function take(n: number, s: Float64Array): Float64Array {
    return s.subarray(0, n);
  }

  /** usedJSHeapSize across one window of frames, each synced. Negative when a scavenge fell inside it. */
  function oneWindow(framesPerWindow: number, dt: number): number {
    const before = usedHeap();
    for (let f = 0; f < framesPerWindow; f++) {
      core.runFrame(dt);
      sync.one();
    }
    return usedHeap() - before;
  }

  return {
    timedFrames(n: number, dt: number): number[] {
      const out = new Array<number>(n);
      for (let i = 0; i < n; i++) {
        const start = performance.now();
        core.runFrame(dt);
        sync.one();
        out[i] = performance.now() - start;
      }
      sync.arm();
      return out;
    },

    instrument(on: boolean): void {
      if (on === (undo.length > 0)) return;
      if (!on) {
        for (const u of undo) u();
        undo = [];
        core.frameWrap = null;
        return;
      }
      requireWritable('sim', host.sim);
      requireWritable('post', host.post);
      for (const layer of host.layers) requireWritable(`layer ${layer.name}`, layer);
      undo.push(wrapMethod(host.sim, 'step', (ms) => { sim += ms; calls.sim++; }));
      for (const layer of host.layers) {
        const counted = layer.name === 'terrain' || layer.name === 'props';
        undo.push(wrapMethod(layer, 'frame', counted
          ? (ms): void => { layers += ms; streaming += ms; calls.layers++; calls.streaming++; }
          : (ms): void => { layers += ms; calls.layers++; }));
      }
      undo.push(wrapMethod(host.post, 'frame', (ms) => { postFrame += ms; calls.postFrame++; }));
      undo.push(wrapMethod(host.post, 'render', (ms) => { postRender += ms; calls.postRender++; }));
      core.frameWrap = (run, dt): void => {
        sim = 0;
        layers = 0;
        streaming = 0;
        postFrame = 0;
        postRender = 0;
        calls.sim = calls.layers = calls.streaming = calls.postFrame = calls.postRender = 0;
        const start = performance.now();
        run(dt);
        const total = performance.now() - start;
        if (frames < CAPACITY) {
          series.sim[frames] = sim;
          series.layers[frames] = layers;
          series.streaming[frames] = streaming;
          series.postFrame[frames] = postFrame;
          series.postRender[frames] = postRender;
          series.residual[frames] = total - sim - layers - postFrame - postRender;
          if (frames === 0 || calls.sim < minCalls.sim) minCalls.sim = calls.sim;
          if (frames === 0 || calls.layers < minCalls.layers) minCalls.layers = calls.layers;
          if (frames === 0 || calls.streaming < minCalls.streaming) minCalls.streaming = calls.streaming;
          if (frames === 0 || calls.postFrame < minCalls.postFrame) minCalls.postFrame = calls.postFrame;
          if (frames === 0 || calls.postRender < minCalls.postRender) minCalls.postRender = calls.postRender;
          frames++;
        }
      };
    },

    budgets(): BudgetReport {
      return {
        frames,
        sim: quant(take(frames, series.sim)),
        layers: quant(take(frames, series.layers)),
        streaming: quant(take(frames, series.streaming)),
        postFrame: quant(take(frames, series.postFrame)),
        postRender: quant(take(frames, series.postRender)),
        residual: quant(take(frames, series.residual)),
        // 0 with no frame recorded, so an empty report cannot pass a count check either.
        minCalls: frames > 0 ? { ...minCalls } : { sim: 0, layers: 0, streaming: 0, postFrame: 0, postRender: 0 },
        layerCount: host.layers.length,
      };
    },

    resetBudgets(): void {
      frames = 0;
    },

    allocWindows(windows: number, framesPerWindow: number, dt: number): AllocWindows {
      const deltas = new Float64Array(windows);
      for (let w = 0; w < windows; w++) deltas[w] = oneWindow(framesPerWindow, dt);
      const m = windowMedian(deltas, framesPerWindow);
      return { median: m.median, dropped: m.dropped, windows };
    },

    allocPairs(pairs: number, framesPerWindow: number, dt: number, set: (on: boolean) => void): AllocPairs {
      const on = new Float64Array(pairs);
      const off = new Float64Array(pairs);
      try {
        for (let p = 0; p < pairs; p++) {
          set(true);
          on[p] = oneWindow(framesPerWindow, dt);
          set(false);
          off[p] = oneWindow(framesPerWindow, dt);
        }
      } finally {
        set(false);
      }
      const a = windowMedian(on, framesPerWindow);
      const b = windowMedian(off, framesPerWindow);
      return {
        on: { median: a.median, dropped: a.dropped, windows: pairs },
        off: { median: b.median, dropped: b.dropped, windows: pairs },
        moved: a.median - b.median,
      };
    },

    heapCalibration(): number {
      if (Number.isNaN(usedHeap())) return 0;
      const seen = new Array<number>(CALIBRATION_RUNS);
      for (let i = 0; i < CALIBRATION_RUNS; i++) {
        const a = usedHeap();
        allocTick(CALIBRATION_SLOTS);
        const b = usedHeap();
        const c = usedHeap();
        // Reading the heap size allocates too, so a read alone is subtracted.
        seen[i] = b - a - (c - b);
      }
      return Math.max(0, percentile(seen, 0.5));
    },

    heapAfterGc(): number {
      const gc = (globalThis as unknown as { gc?: () => void }).gc;
      if (typeof gc !== 'function') throw new Error('heapAfterGc: gc() is not exposed. This belongs under the gpu-timing project');
      gc();
      gc();
      return usedHeap();
    },
  };
}
