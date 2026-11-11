// window.__mv: HarnessApi over HarnessHost. Each member maps to one host call and its guard, per the plan's section 4
// table. No three as a value: the clear colour goes through a helper the caller passes in.
import {
  CAMERA_PITCH, CHUNK_LIMIT, CRACK_CONTROL_GROW, DebugPaint,
  type FeelState, type HarnessApi, type HarnessHost, type HarnessStats, type HeroMode, type LayerName, type PostVariant, type RenderLayer, type Tier,
} from '../contracts/index';
import { createSync, type Sync } from './sync';

/** How often stepFrames waits for the GPU inside a long batch, so a soak cannot queue an unbounded amount of work. */
const STEP_SYNC_EVERY = 64;

/**
 * DI-93: the first chunk a harness frame may not render. R1 is exact only below 2^48, which is this, and from about 2^49
 * T03's atlas row loop cannot advance (q + 2 rounds to q), so a render there hung the app's tab [VI-r1]. warp refuses
 * chunk >= CHUNK_LIMIT; a render gets the 1024 chunks above it, for sweeps and refills near the warp limit.
 */
const RENDER_CHUNK_END = CHUNK_LIMIT + 1024;

/** Throws a RangeError unless chunk is an integer in [0, RENDER_CHUNK_END), as warp's own check does below CHUNK_LIMIT. */
function requireRenderChunk(what: string, chunk: number): void {
  if (Number.isInteger(chunk) && chunk >= 0 && chunk < RENDER_CHUNK_END) return;
  throw new RangeError(`${what}: chunk must be an integer in [0, CHUNK_LIMIT + 1024), got ${chunk}. Past 2^48 a frame is not exact, and from about 2^49 a render cannot finish (DI-93)`);
}

/** Saves and restores the renderer's clear colour and alpha. Lives in controls.ts, which may use three's Color. */
export interface ClearSaver { save(): void; restore(): void }

/**
 * What the API and the lab share. runFrame and renderState are the only routes to the host's frame methods, so probes
 * and control hooks need nothing from the host, and T10's host object can be anything.
 */
export interface HarnessCore {
  readonly host: HarnessHost;
  readonly sync: Sync;
  /** Called before each renderState with the frame's position, for controls that read an absolute coordinate. */
  onRender: ((chunk: number, local: number) => void) | null;
  /** Called once per runFrame. Null unless a probe is on. */
  onFrame: (() => void) | null;
  /** Replaces host.runFrame while instrumented. */
  frameWrap: ((run: (dt: number) => void, dt: number) => void) | null;
  runFrame(dt: number): void;
  renderState(chunk: number, local: number, tick: number): void;
}

export function createCore(host: HarnessHost): HarnessCore {
  const hostRun = (dt: number): void => { host.runFrame(dt); };
  const core: HarnessCore = {
    host,
    sync: createSync(host.ctx),
    onRender: null,
    onFrame: null,
    frameWrap: null,
    runFrame(dt: number): void {
      if (core.onFrame) core.onFrame();
      if (core.frameWrap) core.frameWrap(hostRun, dt);
      else host.runFrame(dt);
    },
    renderState(chunk: number, local: number, tick: number): void {
      // The one route to host.renderState, so no lab sweep or control can render where renderAt would refuse.
      requireRenderChunk('renderState', chunk);
      if (core.onRender) core.onRender(chunk, local);
      host.renderState(chunk, local, tick);
    },
  };
  return core;
}

type LossState = 'live' | 'losing' | 'lost' | 'restoring';
type DebugState = 'none' | 'crack' | 'edge-paint';

/** The API plus the two feel routes the lab needs, so a held override survives a sweep's reference frame. */
export interface InternalApi extends HarnessApi {
  /** Applies a feel override for one reference frame without forgetting what forceFeel holds. */
  withFeel(extra: Partial<FeelState>, run: () => void): void;
}

export function createApi(core: HarnessCore, clear: ClearSaver): InternalApi {
  const { host, sync } = core;
  const { renderer } = host.ctx;

  let isManual = false;
  let loss: LossState = 'live';
  let debug: DebugState = 'none';
  let heldFeel: Partial<FeelState> | null = null;
  let sweepFeel: Partial<FeelState> | null = null;
  const visible = new Map<LayerName, boolean>();
  for (const layer of host.layers) visible.set(layer.name, true);

  function layersNamed(name: LayerName): RenderLayer[] {
    const found = host.layers.filter((l) => l.name === name);
    if (found.length === 0) throw new Error(`setLayerVisible: no layer named ${String(name)}`);
    return found;
  }

  /** One place decides the host's feel override, so crack mode, forceFeel and a sweep's reference compose. */
  function applyFeel(): void {
    const pitch = debug === 'crack' ? { shakeY: -CAMERA_PITCH } : null;
    if (!heldFeel && !sweepFeel && !pitch) {
      host.overrideFeel(null);
      return;
    }
    host.overrideFeel({ ...heldFeel, ...sweepFeel, ...pitch });
  }

  function enterDebug(mode: 'crack' | 'edge-paint'): void {
    if (debug === mode) return;
    if (debug === 'none') clear.save();
    debug = mode;
    for (const layer of host.layers) {
      layer.setDebugMode(mode);
      layer.setVisible(layer.name === 'terrain');
    }
    renderer.setClearColor(DebugPaint.CLEAR, 1);
    applyFeel();
  }

  function exitDebug(mode: 'crack' | 'edge-paint'): void {
    if (debug !== mode) return;
    debug = 'none';
    for (const layer of host.layers) {
      layer.setDebugMode('none');
      layer.setVisible(visible.get(layer.name) ?? true);
    }
    clear.restore();
    applyFeel();
  }

  function requireManual(what: string): void {
    if (!isManual) throw new Error(`${what} needs manual(true): a rAF frame between a render and a read would give a false result`);
  }

  const api: InternalApi = {
    ready: true,

    manual(on: boolean): void {
      isManual = on;
      host.setManual(on);
    },

    // Returned as is: the warp-guard test exercises the sim's own check, so T09 validates nothing here.
    warp(chunk: number, local: number): boolean {
      return host.sim.warpTo(chunk, local);
    },

    renderAt(chunk: number, local: number, tick: number): number {
      requireManual('renderAt');
      // Before the loss check, so a bad argument is an exception whether or not the context is live.
      requireRenderChunk('renderAt', chunk);
      if (renderer.getContext().isContextLost()) return Number.NaN;
      const start = performance.now();
      core.renderState(chunk, local, tick);
      sync.one();
      const ms = performance.now() - start;
      sync.arm();
      return ms;
    },

    stepFrames(n: number, dt: number): void {
      requireManual('stepFrames');
      if (!Number.isInteger(n) || n < 0) throw new RangeError(`stepFrames: n must be a non-negative integer, got ${n}`);
      if (!(dt > 0)) throw new RangeError(`stepFrames: dt must be above 0, got ${dt}`);
      for (let i = 0; i < n; i++) {
        core.runFrame(dt);
        if ((i + 1) % STEP_SYNC_EVERY === 0) sync.one();
      }
      sync.one();
      sync.arm();
    },

    setPost(variant: PostVariant | 'off'): void {
      host.post.forceVariant(variant);
    },

    setMsaa(n: 0 | 2 | 4): void {
      host.post.forceMsaa(n);
    },

    setLayerVisible(name: LayerName, on: boolean): void {
      const found = layersNamed(name);
      // A change under a debug mode lasts until the mode ends, which restores what was there before it began.
      if (debug === 'none') visible.set(name, on);
      for (const layer of found) layer.setVisible(on);
    },

    setCrackMode(on: boolean): void {
      if (on) enterDebug('crack');
      else exitDebug('crack');
    },

    setEdgePaint(on: boolean): void {
      if (on) enterDebug('edge-paint');
      else exitDebug('edge-paint');
    },

    setCrackControl(on: boolean): void {
      let reached = 0;
      for (const layer of host.layers) {
        if (layer.setCrackControl) {
          layer.setCrackControl(on ? CRACK_CONTROL_GROW : 0);
          reached++;
        }
      }
      // With nothing to grow, the crack test would run clean and call that a pass.
      if (on && reached === 0) throw new Error('setCrackControl: no layer implements it, so the control would pass vacuously');
    },

    forceZone(palette: number, biome: number, hero: HeroMode): void {
      host.overrideZone({ palette, biome, hero });
    },

    forceBend(a: number, c: number): void {
      host.overrideBend({ a, c });
    },

    forceFov(deg: number | null): void {
      host.overrideFov(deg);
    },

    forceFeel(o: Partial<FeelState> | null): void {
      heldFeel = o;
      applyFeel();
    },

    setTier(t: Tier | 'auto'): void {
      host.governor.force(t);
    },

    forceSignalLost(): void {
      host.sim.forceSignalLost();
    },

    loseContext(): Promise<void> {
      if (loss !== 'live') return Promise.reject(new Error(`loseContext: the context is not live (${loss})`));
      loss = 'losing';
      return new Promise<void>((resolve) => {
        const canvas = renderer.domElement;
        const onLost = (): void => {
          canvas.removeEventListener('webglcontextlost', onLost);
          // One macrotask, so the restore that follows is outside the event dispatch (section 11.3, fourth trap).
          setTimeout(() => {
            loss = 'lost';
            resolve();
          }, 0);
        };
        canvas.addEventListener('webglcontextlost', onLost);
        renderer.forceContextLoss();
      });
    },

    restoreContext(): Promise<void> {
      if (loss !== 'lost') {
        return Promise.reject(new Error(`restoreContext: no resolved loss event yet (${loss}). A restore inside the loss event's dispatch is ignored, so this refuses and touches no GL`));
      }
      loss = 'restoring';
      return new Promise<void>((resolve) => {
        const canvas = renderer.domElement;
        const onRestored = (): void => {
          canvas.removeEventListener('webglcontextrestored', onRestored);
          loss = 'live';
          resolve();
        };
        canvas.addEventListener('webglcontextrestored', onRestored);
        renderer.forceContextRestore();
      });
    },

    // renderer.info is read fresh on every call: it is a new object after a restore (Agents.md).
    stats(): HarnessStats {
      const gl = renderer.getContext();
      const { render, memory, programs } = renderer.info;
      const s = host.sim.state;
      return {
        calls: render.calls,
        triangles: render.triangles,
        geometries: memory.geometries,
        textures: memory.textures,
        programs: programs?.length ?? 0,
        chunk: s.travel.chunk,
        local: s.travel.local,
        tier: host.governor.profile.tier,
        width: gl.drawingBufferWidth,
        height: gl.drawingBufferHeight,
        tick: s.tick,
        warpSerial: s.warpSerial,
        mode: s.mode,
      };
    },

    pixels(): Uint8Array {
      return sync.full();
    },

    withFeel(extra: Partial<FeelState>, run: () => void): void {
      sweepFeel = extra;
      applyFeel();
      try {
        run();
      } finally {
        sweepFeel = null;
        applyFeel();
      }
    },
  };
  return api;
}
