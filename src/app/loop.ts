// The frame loop, section 3.3, exactly. One rAF callback timed by its own timestamp, plus the two harness entry points
// that share its body (section 8.1): runFrame steps the sim, renderState draws one exact state and steps nothing.
// Nothing between BODY START and BODY END allocates: no new, closures, spread, template strings, map, slice or
// subarray (tests/unit/app/structure.test.ts). Doubles that change every frame are fields of one object.
import type { PerspectiveCamera } from 'three';
import {
  CAMERA_FOV, CHUNK_LEN, SIM_HZ,
  type AudioEngine, type ControlFrame, type FatalReason, type Feel, type FeelState, type Governor, type HeroMode, type InputSource,
  type PostStack, type RenderLayer, type SharedUniforms, type Sim, type Travel, type Ui, type WorldSource,
} from '../contracts/index';
import { createNeutralFeel } from '../core/alloc';
import { between } from '../core/coords';
import { writePhases } from '../core/motion';
import { writeCameraPose, writeSharedUniforms, type CameraPose } from '../core/uniforms';
import { applyFeelOverride, copyFeel, writeCamAt, writeCamStep, type AppView } from './view';

/** Harness overrides (HarnessHost). Persist across frames until cleared, and apply in every entry point. */
export interface Overrides {
  /** floats: the palette's PALETTE_FLOATS linear values, written once by host.ts through writePalette. */
  zone: { palette: number; biome: number; hero: HeroMode; floats: Float32Array } | null;
  bend: { a: number; c: number } | null;
  fov: number | null;
  feel: Partial<FeelState> | null;
}
export function createOverrides(): Overrides {
  return { zone: null, bend: null, fov: null, feel: null };
}

/** Shared with lifecycle.ts. tierHeld: a tier change arrived while the context was lost, applied once it is live. */
export interface LoopFlags { contextOk: boolean; restorePending: boolean; tierHeld: boolean }
export function createFlags(): LoopFlags {
  return { contextOk: true, restorePending: false, tierHeld: false };
}

export interface LoopCounters { frames: number; rendered: number; rebuilds: number; restores: number; resizes: number }
export function createCounters(): LoopCounters {
  return { frames: 0, rendered: 0, rebuilds: 0, restores: 0, resizes: 0 };
}

/** What the loop needs of sizing.ts. */
export interface LoopSizing {
  readonly gainX: number;
  applyIfDirty(camera: PerspectiveCamera, post: PostStack): boolean;
}

export interface LoopDeps {
  raf(cb: (t: number) => void): number; caf(h: number): void;
  input: InputSource; sim: Sim; world: WorldSource; feel: Feel; neutralFeel: Readonly<FeelState>;
  layers: readonly RenderLayer[]; post: PostStack; ui: Ui; audio: AudioEngine;
  /** Property read each frame: renderer.info is a new object after a restore (section 10.2). */
  renderer: { readonly info: { reset(): void } };
  camera: PerspectiveCamera; shared: SharedUniforms; sizing: LoopSizing; view: AppView; control: ControlFrame;
  flags: LoopFlags;
  overrides: Overrides;
  counters: LoopCounters;
  /** Read each frame; the final governor replaces the boot one. */
  governor(): Governor;
  onFatal(r: FatalReason, e: unknown): void;
  /** Once, after the first rAF frame that drew. */
  onFirstFrame(): void;
}

export interface Loop {
  start(): void;
  /** Cancels the pending frame for good. Idempotent. */
  stop(): void;
  /** The next rAF frame takes rawDt = 0. */
  resetClock(): void;
  /** true cancels the pending frame with no re-arm; false resets the clock and re-arms. Both idempotent. */
  setManual(on: boolean): void;
  readonly manual: boolean;
  runFrame(dt: number): void;
  renderState(chunk: number, local: number, tick: number): void;
  /** Steps 5 to 9 with dt 0 and no sizing, so shared uniforms and the camera are valid before anything draws (boot). */
  prepare(): void;
  /** Every layer.rebuild(view), then post.rebuild(). Records the warp serial. */
  rebuildAll(): void;
  /** view.quality = governor().profile, then setQuality on every layer and on post. */
  applyQuality(): void;
  readonly counters: LoopCounters;
  /** rawDt of the last rAF frame, in s. */
  readonly lastRawDt: number;
}

const STEP = 1 / SIM_HZ;
const MAX_STEPS = 30;
const MAX_DT = 0.25;

export function createLoop(d: LoopDeps): Loop {
  // Every double the body passes between its own functions lives here, so no internal call boxes an argument.
  const st = {
    acc: 0, dt: 0, lastMs: 0, lastRawDt: 0, handle: 0,
    reset: true, started: false, manual: false, dead: false, firstDone: false, hasDrawn: false, tierPending: false,
    humanLatch: false,
    lastWarp: d.sim.state.warpSerial,
  };
  const counters = d.counters;
  const flags = d.flags;
  const view = d.view;
  // Stable objects, mutated in place by the sim (T02's seam). Methods are always reached by property lookup instead.
  const state = d.sim.state;
  const events = d.sim.events;
  const lastDrawn: Travel = { chunk: 0, local: 0 };
  const pose: CameraPose = { x: 0, y: 0, z: 0, rotX: 0, rotY: 0, rotZ: 0, fovDeg: CAMERA_FOV };
  const feelScratch: FeelState = createNeutralFeel();

  // BODY START
  /**
   * Step 4. Called unconditionally by onFrame and runFrame; the only sim.step in this file. DI-80 (D-010): a `human`
   * sampled on a frame that takes no step is latched into the next frame's sample, so human = sampled or latched, and
   * the latch clears once a step has consumed it. Section 3.3's order is unchanged.
   */
  function advanceSim(): void {
    d.control.human = d.control.human || st.humanLatch;
    st.acc += st.dt;
    let n = 0;
    while (st.acc >= STEP && n < MAX_STEPS) {
      d.sim.step(d.control);
      st.acc -= STEP;
      n += 1;
    }
    st.humanLatch = d.control.human && n === 0;
  }

  /** Step 7, then the zone and bend overrides straight after it (section 8.1). */
  function zoneStep(): void {
    d.world.zoneAt(view.cam, view.zone);
    d.world.bendAt(view.cam, view.bend);
    const oz = d.overrides.zone;
    if (oz !== null) {
      const z = view.zone;
      z.palette.set(oz.floats);
      z.paletteA = oz.palette; z.paletteB = oz.palette; z.paletteMix = 0;
      z.biomeA = oz.biome; z.biomeB = oz.biome; z.biomeMix = 0;
      z.heroA = oz.hero; z.heroB = oz.hero; z.heroMix = 0;
    }
    const ob = d.overrides.bend;
    if (ob !== null) {
      view.bend.a = ob.a;
      view.bend.c = ob.c;
    }
  }

  /** End of step 8: view.feel is base, or the scratch filled from base, the feel override, then the fov override. */
  function pointFeel(base: Readonly<FeelState>): void {
    const of = d.overrides.feel;
    const ov = d.overrides.fov;
    if (of === null && ov === null) {
      view.feel = base;
      return;
    }
    copyFeel(base, feelScratch);
    if (of !== null) applyFeelOverride(of, feelScratch);
    if (ov !== null) feelScratch.fovDeg = ov;
    view.feel = feelScratch;
  }

  /**
   * Camera part of step 9: position, rotation, fov with the section 6.4 cap; projection only when fov changed. The
   * position is written by field, not through set(x, y, z), whose three double arguments are boxed when it is not inlined.
   */
  function poseCamera(): void {
    const cam = d.camera;
    writeCameraPose(view, cam.aspect, pose);
    const p = cam.position;
    p.x = pose.x;
    p.y = pose.y;
    p.z = pose.z;
    cam.rotation.set(pose.rotX, pose.rotY, pose.rotZ);
    if (cam.fov !== pose.fovDeg) {
      cam.fov = pose.fovDeg;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }

  /** Step 9. Runs while the context is lost too. info.reset first, so the sky's nebula draw is counted (section 6.6). */
  function cameraStep(): void {
    d.renderer.info.reset();
    if (d.sizing.applyIfDirty(d.camera, d.post)) counters.resizes += 1;
    writeSharedUniforms(view, d.shared);
    poseCamera();
  }

  function rebuildAll(): void {
    const layers = d.layers;
    for (let i = 0; i < layers.length; i++) layers[i]!.rebuild(view);
    d.post.rebuild();
    st.lastWarp = state.warpSerial;
    counters.rebuilds += 1;
  }

  /**
   * Steps 10 to 12, only with a live context. Rebuilds first on a warp, after a restore, and on any backward camera move
   * or forward jump over CHUNK_LEN (section 8.1). A skipped warp catches up here, because the serials stay unequal.
   */
  function drawStep(): void {
    if (!flags.contextOk) return;
    let jumped = false;
    if (st.hasDrawn) {
      const moved = between(view.cam, lastDrawn);
      jumped = moved < 0 || moved > CHUNK_LEN;
    }
    if (jumped || state.warpSerial !== st.lastWarp || flags.restorePending) {
      rebuildAll();
      flags.restorePending = false;
    }
    const layers = d.layers;
    for (let i = 0; i < layers.length; i++) layers[i]!.frame(view);
    d.post.frame(view);
    d.post.render(st.dt);
    lastDrawn.chunk = view.cam.chunk;
    lastDrawn.local = view.cam.local;
    st.hasDrawn = true;
    counters.rendered += 1;
  }

  function applyQuality(): void {
    const q = d.governor().profile;
    view.quality = q;
    const layers = d.layers;
    for (let i = 0; i < layers.length; i++) layers[i]!.setQuality(q);
    d.post.setQuality(q);
  }

  /** Steps 13 to 15. A tier change is held while the context is lost, and applied on the first live frame after. */
  function tailStep(): void {
    d.ui.frame(view);
    d.audio.frame(view);
    events.count = 0;
    if (st.tierPending || flags.tierHeld) {
      st.tierPending = false;
      if (flags.contextOk) {
        flags.tierHeld = false;
        applyQuality();
      } else {
        flags.tierHeld = true;
      }
    }
    counters.frames += 1;
  }

  /** Steps 5 to 15 after a step, shared by onFrame and runFrame, at st.dt. */
  function body(): void {
    writeCamStep(view, state, st, d.sizing);
    view.dt = st.dt;
    writePhases(view.tick, view.alpha, view.phases);
    zoneStep();
    d.feel.update(st.dt, state, events, view.reducedMotion);
    pointFeel(d.feel.out);
    cameraStep();
    drawStep();
    tailStep();
  }

  function fail(e: unknown): void {
    stop();
    d.onFatal('runtime-error', e);
  }

  function onFrame(nowMs: number): void {
    st.handle = d.raf(onFrame);
    try {
      let rawDt = 0;
      if (st.reset) st.reset = false;
      else rawDt = (nowMs - st.lastMs) / 1000;
      st.lastMs = nowMs;
      if (rawDt < 0) rawDt = 0;
      st.lastRawDt = rawDt;
      st.dt = rawDt < MAX_DT ? rawDt : MAX_DT;
      if (d.governor().sample(rawDt * 1000) !== null) st.tierPending = true;
      d.input.sample(d.control);
      advanceSim();
      body();
      if (!st.firstDone && counters.rendered > 0) {
        st.firstDone = true;
        d.onFirstFrame();
      }
    } catch (e) {
      fail(e);
    }
  }

  function runFrame(rawDt: number): void {
    try {
      st.dt = rawDt < MAX_DT ? rawDt : MAX_DT;
      if (d.governor().sample(0) !== null) st.tierPending = true;
      d.input.sample(d.control);
      advanceSim();
      body();
    } catch (e) {
      fail(e);
      throw e;
    }
  }

  function renderState(chunk: number, local: number, tick: number): void {
    try {
      if (d.governor().sample(0) !== null) st.tierPending = true;
      st.dt = 0;
      view.cam.chunk = chunk;
      view.cam.local = local;
      view.tick = tick;
      writeCamAt(view, state, d.sizing);
      writePhases(tick, 0, view.phases);
      zoneStep();
      pointFeel(d.neutralFeel);
      cameraStep();
      drawStep();
      tailStep();
    } catch (e) {
      fail(e);
      throw e;
    }
  }
  // BODY END

  function stop(): void {
    st.dead = true;
    d.caf(st.handle);
  }

  return {
    start() {
      if (st.started || st.dead) return;
      st.started = true;
      st.reset = true;
      if (!st.manual) st.handle = d.raf(onFrame);
    },
    stop,
    resetClock() { st.reset = true; },
    setManual(on) {
      if (on) {
        if (st.manual) return;
        st.manual = true;
        d.caf(st.handle);
        return;
      }
      if (!st.manual) return;
      st.manual = false;
      if (st.dead || !st.started) return;
      st.reset = true;
      st.handle = d.raf(onFrame);
    },
    get manual() { return st.manual; },
    runFrame,
    renderState,
    prepare() {
      writeCamStep(view, state, st, d.sizing);
      view.dt = 0;
      writePhases(view.tick, view.alpha, view.phases);
      zoneStep();
      pointFeel(d.feel.out);
      writeSharedUniforms(view, d.shared);
      poseCamera();
    },
    rebuildAll,
    applyQuality,
    counters,
    get lastRawDt() { return st.lastRawDt; },
  };
}
