// window.__mvLab: T09's page-side toolbox. window.__mv is the frozen contract, and this is an implementation detail that
// T09's and T11's specs use. Sweeps, audits, budgets and controls live in their own files; this composes them and holds
// the trap drills, which do the wrong thing on purpose and report what happened. No three as a value.
import { DebugPaint, type HarnessHost } from '../contracts/index';
import type { ClearSaver, HarnessCore, InternalApi } from './api';
import { auditScene, finiteReport, findBiomeChunk, nonFlat, type Audit, type FiniteReport, type NonFlat } from './audit';
import { createBudget, type AllocPairs, type AllocWindows, type BudgetReport } from './budget';
import { createControls, type Controls } from './controls';
import * as metrics from './metrics';
import {
  createSweeps, type CompareOptions, type CompareResult, type CrackSweep, type FrameKey, type SequenceResult, type ShimmerResult, type Tolerance,
  type WashoutResult,
} from './sweeps';

export type {
  Audit, AllocPairs, AllocWindows, BudgetReport, CompareOptions, CompareResult, Controls, CrackSweep, FrameKey, SequenceResult, ShimmerResult, Tolerance, WashoutResult,
};
export type { CallCounts, Quant } from './budget';

export interface TrapDrills {
  rawReadLater(): Promise<{ nonZero: number; total: number }>;
  rawDirectNoClear(): { autoClear: boolean; magenta: number; total: number };
  restoreInDispatch(): Promise<{ restoredWithin3s: number | null; secondCallRestoredAt: number | null }>;
  /** The stale upload of section 10.2. differ is the bytes between the stale frame and the full upload's frame. */
  rawStaleUpload(key: FrameKey): { differ: number; pendingVisible: number };
}

export interface HarnessLab {
  readonly metrics: typeof import('./metrics');
  rendererInfo(): { webgl2: boolean; renderer: string; depthBits: number };
  settle(key: FrameKey, ms?: number): void;
  /** A frame two chunks ahead, then key, so every props ring is rebuilt at key before a reference frame (V2-T09). */
  refill(key: FrameKey): void;
  /** Steps the sim one step per frame to exactly this tick, so the camera pose no longer depends on boot time (V2-T09). */
  stepToTick(tick: number): number;
  compareAt(a: FrameKey, b: FrameKey, o?: CompareOptions): CompareResult;
  sequence(near: FrameKey, far: FrameKey, frames: number, stepU: number, stepTicks: number, o?: CompareOptions): SequenceResult;
  shimmer(start: FrameKey, o?: { frames?: number; stepU?: number; r0?: number; r1?: number }): ShimmerResult;
  washoutAt(key: FrameKey): WashoutResult;
  crackSweep(start: FrameKey, frames: number, stepU: number): CrackSweep;
  edgePaintAt(key: FrameKey): metrics.EdgeCounts;
  audit(): Audit;
  finite(): FiniteReport;
  nonFlat(chunk: number): NonFlat;
  findBiomeChunk(biome: number, fromChunk: number): number;
  timedFrames(n: number, dt: number): number[];
  instrument(on: boolean): void;
  budgets(): BudgetReport;
  resetBudgets(): void;
  allocWindows(windows: number, framesPerWindow: number, dt: number): AllocWindows;
  /** B19's windows control on the app (DI-84): allocProbe(bytes) on in every other window over one stretch, off at the end. */
  allocPairs(pairs: number, framesPerWindow: number, dt: number, bytes: number): AllocPairs;
  heapCalibration(): number;
  heapAfterGc(): number;
  links(): number;
  readonly controls: Controls;
  readonly traps: TrapDrills;
}

const DRILL_KEY: FrameKey = { chunk: 5, local: 12.5, tick: 28800 };
const RESTORE_WAIT_MS = 3000;

function createTraps(host: HarnessHost, core: HarnessCore, api: InternalApi, controls: Controls, clear: ClearSaver): TrapDrills {
  const { renderer, scene, camera } = host.ctx;
  const { sync } = core;

  function rawRead(): Uint8Array {
    const gl = renderer.getContext();
    renderer.setRenderTarget(null);
    const out = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return out;
  }

  function nextEvent(type: string): Promise<void> {
    return new Promise((resolve) => {
      renderer.domElement.addEventListener(type, () => { resolve(); }, { once: true });
    });
  }

  function within(p: Promise<void>, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { resolve(false); }, ms);
      void p.then(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  return {
    async rawReadLater(): Promise<{ nonZero: number; total: number }> {
      api.renderAt(DRILL_KEY.chunk, DRILL_KEY.local, DRILL_KEY.tick);
      // A presented frame, then a macrotask. The buffer is gone by now, and nothing here says so.
      await new Promise<void>((resolve) => { requestAnimationFrame(() => { setTimeout(resolve, 0); }); });
      const px = rawRead();
      return { nonZero: metrics.nonZeroCount(px), total: px.length / 4 };
    },

    rawDirectNoClear(): { autoClear: boolean; magenta: number; total: number } {
      api.setPost('full');
      api.renderAt(DRILL_KEY.chunk, DRILL_KEY.local, DRILL_KEY.tick);
      api.renderAt(DRILL_KEY.chunk, DRILL_KEY.local, DRILL_KEY.tick);
      const autoClear = renderer.autoClear;
      clear.save();
      for (const layer of host.layers) layer.setVisible(false);
      renderer.setClearColor(DebugPaint.CLEAR, 1);
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      const px = rawRead();
      for (const layer of host.layers) layer.setVisible(true);
      clear.restore();
      return { autoClear, magenta: metrics.skyCount(px), total: px.length / 4 };
    },

    async restoreInDispatch(): Promise<{ restoredWithin3s: number | null; secondCallRestoredAt: number | null }> {
      const start = performance.now();
      const lost = nextEvent('webglcontextlost');
      renderer.forceContextLoss();
      await lost;
      // Still inside the event's dispatch. This is the mistake: Chromium refuses it, with a console message only.
      const restored = nextEvent('webglcontextrestored');
      renderer.forceContextRestore();
      if (await within(restored, RESTORE_WAIT_MS)) return { restoredWithin3s: performance.now() - start, secondCallRestoredAt: null };
      renderer.forceContextRestore();
      if (await within(restored, RESTORE_WAIT_MS)) return { restoredWithin3s: null, secondCallRestoredAt: performance.now() - start };
      return { restoredWithin3s: null, secondCallRestoredAt: null };
    },

    rawStaleUpload(key: FrameKey): { differ: number; pendingVisible: number } {
      controls.staleUpload(true);
      api.renderAt(key.chunk, key.local, key.tick);
      controls.staleRewrite(true);
      api.renderAt(key.chunk, key.local, key.tick);
      const staleFrame = sync.full();
      controls.staleRewrite(false);
      api.renderAt(key.chunk, key.local, key.tick);
      const fullFrame = sync.full();
      const pendingVisible = auditScene(scene).pendingVisible;
      controls.staleUpload(false);
      return { differ: metrics.byteDiff(staleFrame, fullFrame).bytes, pendingVisible };
    },
  };
}

export function createLab(core: HarnessCore, api: InternalApi, clear: ClearSaver): HarnessLab {
  const { host } = core;
  const { ctx } = host;
  const sweeps = createSweeps(core, api);
  const budget = createBudget(core);
  const controls = createControls(core);
  return {
    metrics,
    rendererInfo(): { webgl2: boolean; renderer: string; depthBits: number } {
      const gl = ctx.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext,
        renderer: ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER)),
        depthBits: Number(gl.getParameter(gl.DEPTH_BITS)),
      };
    },
    settle: sweeps.settle,
    refill: sweeps.refill,
    stepToTick: sweeps.stepToTick,
    compareAt: sweeps.compareAt,
    sequence: sweeps.sequence,
    shimmer: sweeps.shimmer,
    washoutAt: sweeps.washoutAt,
    crackSweep: sweeps.crackSweep,
    edgePaintAt: sweeps.edgePaintAt,
    audit(): Audit {
      return auditScene(ctx.scene);
    },
    finite(): FiniteReport {
      return finiteReport(host);
    },
    nonFlat(chunk: number): NonFlat {
      return nonFlat(ctx.world, chunk);
    },
    findBiomeChunk(biome: number, fromChunk: number): number {
      return findBiomeChunk(ctx.world, biome, fromChunk);
    },
    timedFrames: budget.timedFrames,
    instrument: budget.instrument,
    budgets: budget.budgets,
    resetBudgets: budget.resetBudgets,
    allocWindows: budget.allocWindows,
    allocPairs(pairs: number, framesPerWindow: number, dt: number, bytes: number): AllocPairs {
      // Looked up on controls at each toggle, never captured, so a test may wrap it.
      return budget.allocPairs(pairs, framesPerWindow, dt, (on) => { controls.allocProbe(on ? bytes : 0); });
    },
    heapCalibration: budget.heapCalibration,
    heapAfterGc: budget.heapAfterGc,
    links(): number {
      const n = (globalThis as unknown as { __mvLinks?: number }).__mvLinks;
      return typeof n === 'number' ? n : -1;
    },
    controls,
    traps: createTraps(host, core, api, controls, clear),
  };
}
