// Identity, shimmer, wash-out and crack sweeps. Each runs in one synchronous run of the page, through the same renderAt
// a spec would call. No three.
import { CHUNK_LIMIT, SIM_HZ, type Travel } from '../contracts/index';
import { advance } from '../core/coords';
import type { HarnessCore, InternalApi } from './api';
import {
  bandDiff, byteDiff, byteDiffRange, crackCount, edgeCounts, hazeLift, meanLuma, shimmerBand, silhouetteStd, washout, type EdgeCounts,
} from './metrics';

export interface FrameKey { chunk: number; local: number; tick: number }
/**
 * selfBytes, selfMax, crossBytes and crossMax are the last attempt's. worstCrossMax is the largest crossMax over every
 * attempt, so a gate can hold "max diff at most 1 even in failed attempts" (B4).
 */
export interface CompareResult {
  pass: boolean; attempts: number; selfBytes: number; selfMax: number; crossBytes: number; crossMax: number; worstCrossMax: number; meanLuma: number;
}
export interface SequenceResult { pass: boolean; attempts: number; worstBytes: number; worstMax: number; worstFrame: number; store: 'ok' | 'failed' }
export interface ShimmerResult { mean: number; perFrame: number[] }
export interface WashoutResult { nearWhitePct: number; meanChroma: number; blackP10: number; meanLuma: number; hazeLift: number }
export interface CrackSweep { bad: number; worstFrame: number; silhouetteStd: number }
/** When two renders of one state count as the same frame: at most `bytes` differing bytes, none by more than `max`. */
export interface Tolerance { bytes: number; max: number }
export interface CompareOptions { attempts?: number; tolerance?: Tolerance }

/** The most the post-on driver flake has ever touched: a few bytes, each by 1 code value (plan section 10). */
export const NOISE_BYTES = 16;
export const NOISE_MAX = 1;
/** No difference at all. The default, and the software project's bound (DI-58). */
export const EXACT: Readonly<Tolerance> = { bytes: 0, max: 0 };
/**
 * DI-58: on the gpu project two renders of one state match when at most 64 bytes differ and none by more than 1 level.
 * The RTX through D3D11 moves 1 to 41 fixed pixels by 1 once other states were rendered in between, and the change can
 * persist, so a self-compare cannot remove it. A byte over 1 level still fails at once.
 */
export const GPU_SAME_STATE: Readonly<Tolerance> = { bytes: 64, max: 1 };

function within(d: { bytes: number; max: number }, t: Tolerance): boolean {
  return d.bytes <= t.bytes && d.max <= t.max;
}

const SETTLE_MS = 3000;
const COMPARE_ATTEMPTS = 5;
const SEQUENCE_ATTEMPTS = 3;
const FRAMES_BETWEEN_ATTEMPTS = 64;
const SHIMMER_FRAMES = 48;
const SHIMMER_STEP = 1.17;
/**
 * T05's props hide each shard the sim collects (feeder.hideItem) until that ring refills, and a ring refills only when
 * the camera chunk moves backward or by more than one (src/render/props/layer.ts). So a reference frame taken straight
 * after DEMO can lack shards that any jump and return shows (V2-T09). A frame this many chunks ahead and then the key
 * makes the return a backward move, which rebuilds every ring at the key from pure state.
 */
export const REFILL_JUMP_CHUNKS = 2;

export interface Sweeps {
  settle(key: FrameKey, ms?: number): void;
  /** One frame REFILL_JUMP_CHUNKS ahead of key, then one at key. Before any reference frame of a same-state compare. */
  refill(key: FrameKey): void;
  /**
   * Steps the sim, one sim step per frame, until its tick is exactly `tick`, and returns it. The sim is deterministic
   * from boot, so this fixes the camera pose DEMO had reached, whatever time the page took to get here. Throws if the
   * sim is already past `tick`, or if a frame stepped twice and overshot it.
   */
  stepToTick(tick: number): number;
  compareAt(a: FrameKey, b: FrameKey, o?: CompareOptions): CompareResult;
  sequence(near: FrameKey, far: FrameKey, frames: number, stepU: number, stepTicks: number, o?: CompareOptions): SequenceResult;
  shimmer(start: FrameKey, o?: { frames?: number; stepU?: number; r0?: number; r1?: number }): ShimmerResult;
  washoutAt(key: FrameKey): WashoutResult;
  crackSweep(start: FrameKey, frames: number, stepU: number): CrackSweep;
  edgePaintAt(key: FrameKey): EdgeCounts;
}

export function createSweeps(core: HarnessCore, api: InternalApi): Sweeps {
  const { sync } = core;

  function draw(chunk: number, local: number, tick: number): void {
    const ms = api.renderAt(chunk, local, tick);
    if (Number.isNaN(ms)) throw new Error('a sweep cannot run while the context is lost');
  }

  function settle(key: FrameKey, ms = SETTLE_MS): void {
    const until = performance.now() + ms;
    while (performance.now() < until) draw(key.chunk, key.local, key.tick);
  }

  function refill(key: FrameKey): void {
    // Ahead, so the return is backward; behind only where ahead would pass the warp limit.
    const away = key.chunk + REFILL_JUMP_CHUNKS < CHUNK_LIMIT ? key.chunk + REFILL_JUMP_CHUNKS : key.chunk - REFILL_JUMP_CHUNKS;
    draw(away, key.local, key.tick);
    draw(key.chunk, key.local, key.tick);
  }

  return {
    settle,
    refill,

    stepToTick(tick: number): number {
      if (!Number.isInteger(tick) || tick < 0) throw new Error(`stepToTick: ${tick} is not a non-negative integer`);
      const sim = core.host.sim;
      const from = sim.state.tick;
      if (from > tick) throw new Error(`stepToTick: the sim is already at tick ${from}, past ${tick}, so this page cannot reach that pose; raise the target`);
      // One sim step per frame at dt 1/SIM_HZ. The guard stops a host that does not step at all.
      for (let frames = 0; sim.state.tick < tick; frames++) {
        if (frames > tick - from) throw new Error(`stepToTick: ${frames} frames moved the sim from tick ${from} only to ${sim.state.tick}, short of ${tick}`);
        api.stepFrames(1, 1 / SIM_HZ);
      }
      if (sim.state.tick !== tick) throw new Error(`stepToTick: a frame stepped more than once and overshot to tick ${sim.state.tick}, past ${tick}`);
      return sim.state.tick;
    },

    compareAt(a: FrameKey, b: FrameKey, o?: CompareOptions): CompareResult {
      const limit = o?.attempts ?? COMPARE_ATTEMPTS;
      const tol = o?.tolerance ?? EXACT;
      // Past this many bytes a difference is not driver noise, whatever the tolerance.
      const noiseBytes = Math.max(NOISE_BYTES, tol.bytes);
      const result: CompareResult = { pass: false, attempts: 0, selfBytes: 0, selfMax: 0, crossBytes: 0, crossMax: 0, worstCrossMax: 0, meanLuma: 0 };
      for (let attempt = 1; attempt <= limit; attempt++) {
        // Every reference frame comes after a refill, so shards hidden by sim steps before the compare cannot make A1
        // differ from B and A2, which the jumps between them rebuild (V2-T09).
        refill(a);
        if (attempt > 1) for (let i = 0; i < FRAMES_BETWEEN_ATTEMPTS; i++) draw(a.chunk, a.local, a.tick);
        draw(a.chunk, a.local, a.tick);
        const a1 = sync.full();
        draw(b.chunk, b.local, b.tick);
        const other = sync.full();
        draw(a.chunk, a.local, a.tick);
        const a2 = sync.full();
        const self = byteDiff(a1, a2);
        const cross = byteDiff(a1, other);
        result.attempts = attempt;
        result.selfBytes = self.bytes;
        result.selfMax = self.max;
        result.crossBytes = cross.bytes;
        result.crossMax = cross.max;
        if (cross.max > result.worstCrossMax) result.worstCrossMax = cross.max;
        result.meanLuma = meanLuma(a1);
        if (within(self, tol) && within(cross, tol)) {
          result.pass = true;
          return result;
        }
        // DI-58: a byte that differs by more than 1 level fails at once, in either compare.
        if (self.max > NOISE_MAX || cross.max > NOISE_MAX) return result;
        // A frame is a function of its state. A real difference repeats in every attempt, so it fails now rather than
        // being averaged away; driver noise does not repeat, so it gets another attempt.
        if (within(self, tol) && cross.bytes > noiseBytes) return result;
      }
      return result;
    },

    sequence(near: FrameKey, far: FrameKey, frames: number, stepU: number, stepTicks: number, o?: CompareOptions): SequenceResult {
      const limit = o?.attempts ?? SEQUENCE_ATTEMPTS;
      const tol = o?.tolerance ?? EXACT;
      const noiseBytes = Math.max(NOISE_BYTES, tol.bytes);
      const bytes = sync.width() * sync.height() * 4;
      const result: SequenceResult = { pass: false, attempts: 0, worstBytes: 0, worstMax: 0, worstFrame: -1, store: 'ok' };
      let store: Uint8Array;
      let scratch: Uint8Array;
      try {
        store = new Uint8Array(bytes * frames);
        scratch = new Uint8Array(bytes);
      } catch (e) {
        if (!(e instanceof RangeError)) throw e;
        result.store = 'failed';
        return result;
      }
      const at: Travel = { chunk: 0, local: 0 };
      for (let attempt = 1; attempt <= limit; attempt++) {
        // The near run is the reference, and its steps forward are single-chunk crossings, which refill nothing.
        refill(near);
        settle(near);
        at.chunk = near.chunk;
        at.local = near.local;
        let tick = near.tick;
        for (let i = 0; i < frames; i++) {
          draw(at.chunk, at.local, tick);
          sync.fullInto(store, i * bytes);
          advance(at, stepU);
          tick += stepTicks;
        }
        at.chunk = far.chunk;
        at.local = far.local;
        tick = far.tick;
        let dirty = 0;
        result.attempts = attempt;
        result.worstBytes = 0;
        result.worstMax = 0;
        result.worstFrame = -1;
        for (let i = 0; i < frames; i++) {
          draw(at.chunk, at.local, tick);
          sync.fullInto(scratch, 0);
          const d = byteDiffRange(store, i * bytes, scratch, bytes);
          if (d.bytes > result.worstBytes) {
            result.worstBytes = d.bytes;
            result.worstFrame = i;
          }
          if (d.max > result.worstMax) result.worstMax = d.max;
          // Beyond the signature fails at once, on any frame. Inside it, a frame outside the tolerance is dirty, and only
          // an attempt with no dirty frame passes.
          if (d.bytes > noiseBytes || d.max > NOISE_MAX) return result;
          if (!within(d, tol)) dirty++;
          advance(at, stepU);
          tick += stepTicks;
        }
        if (dirty === 0) {
          result.pass = true;
          return result;
        }
      }
      return result;
    },

    shimmer(start: FrameKey, o?: { frames?: number; stepU?: number; r0?: number; r1?: number }): ShimmerResult {
      const frames = o?.frames ?? SHIMMER_FRAMES;
      const stepU = o?.stepU ?? SHIMMER_STEP;
      const w = sync.width();
      const h = sync.height();
      const band = shimmerBand(h);
      const r0 = o?.r0 ?? band[0];
      const r1 = o?.r1 ?? band[1];
      let prev = new Uint8Array(w * h * 4);
      let next = new Uint8Array(w * h * 4);
      const at: Travel = { chunk: start.chunk, local: start.local };
      const perFrame: number[] = [];
      draw(at.chunk, at.local, start.tick);
      sync.fullInto(prev, 0);
      let sum = 0;
      for (let i = 1; i < frames; i++) {
        advance(at, stepU);
        // The tick is held: a moving tick would also measure grain changing (T06 seam).
        draw(at.chunk, at.local, start.tick);
        sync.fullInto(next, 0);
        const d = bandDiff(prev, next, w, h, r0, r1);
        perFrame.push(d);
        sum += d;
        const swap = prev;
        prev = next;
        next = swap;
      }
      return { mean: perFrame.length > 0 ? sum / perFrame.length : 0, perFrame };
    },

    washoutAt(key: FrameKey): WashoutResult {
      const w = sync.width();
      const h = sync.height();
      draw(key.chunk, key.local, key.tick);
      const on = sync.full();
      let off: Uint8Array = on;
      api.withFeel({ bloomGain: 0 }, () => {
        draw(key.chunk, key.local, key.tick);
        off = sync.full();
      });
      const m = washout(on, w, h);
      return { nearWhitePct: m.nearWhitePct, meanChroma: m.meanChroma, blackP10: m.blackP10, meanLuma: m.meanLuma, hazeLift: hazeLift(on, off, w, h) };
    },

    crackSweep(start: FrameKey, frames: number, stepU: number): CrackSweep {
      const w = sync.width();
      const h = sync.height();
      const px = new Uint8Array(w * h * 4);
      const at: Travel = { chunk: start.chunk, local: start.local };
      const out: CrackSweep = { bad: 0, worstFrame: -1, silhouetteStd: 0 };
      let worst = 0;
      let silhouette = 0;
      for (let i = 0; i < frames; i++) {
        draw(at.chunk, at.local, start.tick);
        sync.fullInto(px, 0);
        const n = crackCount(px, w, h);
        out.bad += n;
        if (n > worst) {
          worst = n;
          out.worstFrame = i;
        }
        silhouette += silhouetteStd(px, w, h);
        advance(at, stepU);
      }
      out.silhouetteStd = frames > 0 ? silhouette / frames : 0;
      return out;
    },

    edgePaintAt(key: FrameKey): EdgeCounts {
      draw(key.chunk, key.local, key.tick);
      return edgeCounts(sync.full(), sync.width(), sync.height());
    },
  };
}
