// Recording fakes for every LoopDeps member, plus a real PerspectiveCamera (three's math loads in Node). Recording is a
// switch, so the allocation gate can run the same fakes with no push per call.
import { PerspectiveCamera } from 'three';
import {
  CAMERA_FAR, CAMERA_FOV, CAMERA_NEAR, CHUNK_LEN, SIM_HZ, SPEED_CRUISE, SimMode,
  type AudioEngine, type BendState, type ControlFrame, type EventBuffer, type FatalReason, type Feel, type FeelState, type Governor,
  type InputSource, type LayerName, type PostStack, type QualityProfile, type RenderLayer, type Sim, type SimCommand, type SimState, type Tier,
  type Travel, type Ui, type WorldSource, type ZoneState,
} from '../../../../src/contracts/index';
import { createEventBuffer, createNeutralFeel } from '../../../../src/core/alloc';
import { advance, canWarp } from '../../../../src/core/coords';
import { createSharedUniforms } from '../../../../src/core/uniforms';
import { fakeProfile } from '../../../../src/testing/scriptedFrame';
import { createCounters, createFlags, createLoop, createOverrides, type Loop, type LoopDeps } from '../../../../src/app/loop';
import { createAppView, type AppView } from '../../../../src/app/view';

export interface Rec { on: boolean; log: string[] }
export function rec(r: Rec, s: string): void {
  if (r.on) r.log.push(s);
}

export interface FakeRaf {
  readonly pending: ((t: number) => void) | null;
  readonly armed: number;
  readonly cancelled: number;
  raf(cb: (t: number) => void): number;
  caf(h: number): void;
  /** Runs the pending callback at time t, if any. */
  fire(t: number): boolean;
}

export function createFakeRaf(r: Rec): FakeRaf {
  const s = { pending: null as ((t: number) => void) | null, handle: 0, armed: 0, cancelled: 0 };
  return {
    get pending() { return s.pending; },
    get armed() { return s.armed; },
    get cancelled() { return s.cancelled; },
    raf(cb) {
      rec(r, 'raf');
      s.pending = cb;
      s.handle += 1;
      s.armed += 1;
      return s.handle;
    },
    caf(h) {
      if (h === s.handle && s.pending !== null) {
        s.pending = null;
        s.cancelled += 1;
      }
    },
    fire(t) {
      const cb = s.pending;
      if (cb === null) return false;
      s.pending = null;
      cb(t);
      return true;
    },
  };
}

/** A sim that flies forward at state.speed, weaving x, and records step. Allocation-free while recording is off. */
export interface FakeSim extends Sim {
  readonly state: SimState;
  readonly steps: number;
  readonly commands: SimCommand[];
  readonly reduced: boolean[];
  /** When set, every step retains one object (the allocation gate's negative control). */
  leak: boolean;
}

export function createFakeSim(r: Rec): FakeSim {
  const state: SimState = {
    tick: 0, travel: { chunk: 3, local: 0 }, stepDist: SPEED_CRUISE / SIM_HZ, speed: SPEED_CRUISE,
    x: 0, y: 6, prevX: 0, prevY: 6, mode: SimMode.DEMO,
    score: 0, sync: 1, shields: 3, overdrive: 0, ghost: 0, beat: 0, sectorIndex: 0, objectiveProgress: 0,
    autopilot: true, warpSerial: 0,
  };
  const events: EventBuffer = createEventBuffer();
  let count = 0;
  Object.defineProperty(events, 'count', {
    get() { return count; },
    set(v: number) {
      count = v;
      if (v === 0) rec(r, 'events.count=0');
    },
  });
  const s = { steps: 0, leak: false };
  const retained: { i: number }[] = [];
  const commands: SimCommand[] = [];
  const reduced: boolean[] = [];
  return {
    state,
    events,
    get steps() { return s.steps; },
    commands,
    reduced,
    get leak() { return s.leak; },
    set leak(on: boolean) { s.leak = on; },
    step() {
      rec(r, 'step');
      s.steps += 1;
      state.tick += 1;
      state.prevX = state.x;
      state.prevY = state.y;
      state.x = 20 * Math.sin(state.tick / 97);
      state.stepDist = state.speed / SIM_HZ;
      advance(state.travel, state.stepDist);
      if (s.leak) retained.push({ i: state.tick });
    },
    command(c) {
      commands.push(c);
      if (c === 'launch' && state.mode === SimMode.DEMO) state.mode = SimMode.PLAY;
      else if (c === 'pause' && state.mode === SimMode.PLAY) state.mode = SimMode.CRUISE;
      else if (c === 'resume' && state.mode === SimMode.CRUISE) state.mode = SimMode.PLAY;
    },
    warpTo(chunk, local) {
      if (!canWarp(chunk, local)) return false;
      state.travel.chunk = chunk;
      state.travel.local = local;
      state.warpSerial += 1;
      return true;
    },
    setReducedMotion(on) { reduced.push(on); },
    forceSignalLost() {
      if (state.mode === SimMode.PLAY) state.mode = SimMode.SIGNAL_LOST;
    },
  };
}

export interface FakeWorld extends WorldSource { paletteAWritten: number }
export function createRecWorld(r: Rec): FakeWorld {
  const w = {
    seed: 1,
    paletteAWritten: 4,
    height: () => 0,
    fillProps() { /* not used by the loop */ },
    fillItems() { /* not used by the loop */ },
    zoneAt(_at: Readonly<Travel>, out: ZoneState) {
      rec(r, 'zoneAt');
      // Every field, as the real zoneAt writes them.
      out.paletteA = w.paletteAWritten; out.paletteB = 1; out.paletteMix = 0.5;
      out.biomeA = 4; out.biomeB = 2; out.biomeMix = 0.25;
      out.heroA = 1; out.heroB = 2; out.heroMix = 0.75;
      out.palette.fill(0.5);
      return out;
    },
    bendAt(_at: Readonly<Travel>, out: BendState) {
      rec(r, 'bendAt');
      out.a = 1e-5;
      out.c = -1.2e-5;
      out.vMax = 1500;
      return out;
    },
  };
  return w;
}

export interface FakeFeel extends Feel {
  readonly dts: number[];
  /** Called inside update, for a test that inspects view state at step 8. */
  probe: (() => void) | null;
}
export function createRecFeel(r: Rec): FakeFeel {
  const out: FeelState = createNeutralFeel();
  const dts: number[] = [];
  const f = {
    out,
    dts,
    probe: null as (() => void) | null,
    update(dt: number) {
      rec(r, 'feel.update');
      if (r.on) dts.push(dt);
      f.probe?.();
    },
  };
  return f;
}

export interface FakeLayer extends RenderLayer { throwOnFrame: boolean; readonly frames: number }
export function createRecLayer(r: Rec, name: LayerName): FakeLayer {
  const F = `${name}.frame`;
  const Q = `${name}.setQuality`;
  const B = `${name}.rebuild`;
  const s = { throwOnFrame: false, frames: 0 };
  return {
    name,
    get throwOnFrame() { return s.throwOnFrame; },
    set throwOnFrame(on: boolean) { s.throwOnFrame = on; },
    get frames() { return s.frames; },
    attach() { rec(r, `${name}.attach`); },
    setQuality() { rec(r, Q); },
    frame() {
      rec(r, F);
      s.frames += 1;
      if (s.throwOnFrame) throw new Error(`${name} frame failed`);
    },
    rebuild() { rec(r, B); },
    setVisible() { /* harness only */ },
    setDebugMode() { /* harness only */ },
    dispose() { /* nothing */ },
  };
}

export function createRecPost(r: Rec): PostStack {
  return {
    attach() { rec(r, 'post.attach'); },
    precompile() { rec(r, 'post.precompile'); return Promise.resolve(); },
    setQuality() { rec(r, 'post.setQuality'); },
    resize() { rec(r, 'post.resize'); },
    frame() { rec(r, 'post.frame'); },
    render() { rec(r, 'post.render'); },
    rebuild() { rec(r, 'post.rebuild'); },
    forceVariant() { /* harness only */ },
    forceMsaa() { /* harness only */ },
    dispose() { /* nothing */ },
  };
}

export interface FakeGovernor extends Governor {
  readonly samples: number[];
  /** The next sample returns this tier once, then null. */
  pend(t: Tier): void;
}
export function createRecGovernor(r: Rec, tier: Tier = 3): FakeGovernor {
  const s = { profile: fakeProfile(tier) as Readonly<QualityProfile>, pending: null as Tier | null };
  const samples: number[] = [];
  return {
    get profile() { return s.profile; },
    samples,
    pend(t) {
      s.profile = fakeProfile(t);
      s.pending = t;
    },
    sample(ms) {
      rec(r, 'governor.sample');
      if (r.on) samples.push(ms);
      const p = s.pending;
      s.pending = null;
      return p;
    },
    force(t) {
      if (t !== 'auto') {
        s.profile = fakeProfile(t);
        s.pending = t;
      }
    },
  };
}

export interface Rig {
  readonly r: Rec;
  readonly raf: FakeRaf;
  readonly sim: FakeSim;
  readonly world: FakeWorld;
  readonly feel: FakeFeel;
  readonly layers: FakeLayer[];
  readonly post: PostStack;
  readonly gov: FakeGovernor;
  readonly camera: PerspectiveCamera;
  readonly view: AppView;
  readonly deps: LoopDeps;
  readonly loop: Loop;
  readonly fatal: [FatalReason, unknown][];
  readonly firstFrames: number;
  /** Fires the pending rAF frame at t ms. */
  frame(t: number): boolean;
}

export function createRig(o: { record?: boolean } = {}): Rig {
  const r: Rec = { on: o.record ?? true, log: [] };
  const raf = createFakeRaf(r);
  const sim = createFakeSim(r);
  const world = createRecWorld(r);
  const feel = createRecFeel(r);
  const layers = (['sky', 'terrain', 'props', 'fx'] as const).map((n) => createRecLayer(r, n));
  const post = createRecPost(r);
  const gov = createRecGovernor(r);
  const camera = new PerspectiveCamera(CAMERA_FOV, 16 / 9, CAMERA_NEAR, CAMERA_FAR);
  const updateMatrixWorld = camera.updateMatrixWorld.bind(camera);
  camera.updateMatrixWorld = (force?: boolean) => {
    rec(r, 'camera.updateMatrixWorld');
    updateMatrixWorld(force);
  };
  const shared = createSharedUniforms();
  const phases = shared.uPhases.value;
  const setPhases = Float32Array.prototype.set;
  phases.set = function set(this: Float32Array, a: ArrayLike<number>, off?: number) {
    rec(r, 'writeUniforms');
    setPhases.call(this, a, off);
  };
  const ui: Ui = {
    mount() { /* boot only */ },
    frame() { rec(r, 'ui.frame'); },
    showContextLost() { /* lifecycle only */ },
    showFatal() { /* lifecycle only */ },
  };
  const audio: AudioEngine = {
    unlock() { return Promise.resolve(); },
    frame() { rec(r, 'audio.frame'); },
    setVolume() { /* commands only */ },
    suspend() { /* lifecycle only */ },
    resume() { /* lifecycle only */ },
    dispose() { /* lifecycle only */ },
  };
  const input: InputSource = {
    attach() { /* boot only */ },
    sample() { rec(r, 'input.sample'); },
    detach() { /* lifecycle only */ },
  };
  const renderer = { info: { reset() { rec(r, 'info.reset'); } } };
  const sizing = { gainX: 0.72, applyIfDirty: () => false };
  const control: ControlFrame = { moveX: 0, moveY: 0, absolute: false, boost: false, human: false };
  const view = createAppView(sim.state, sim.events, feel.out, gov.profile);
  const fatal: [FatalReason, unknown][] = [];
  const s = { firstFrames: 0 };
  const deps: LoopDeps = {
    raf: raf.raf, caf: raf.caf,
    input, sim, world, feel, neutralFeel: createNeutralFeel(),
    layers, post, ui, audio, renderer, camera, shared, sizing, view, control,
    flags: createFlags(), overrides: createOverrides(), counters: createCounters(),
    governor: () => gov,
    onFatal: (reason, e) => { fatal.push([reason, e]); },
    onFirstFrame: () => { s.firstFrames += 1; },
  };
  const loop = createLoop(deps);
  return {
    r, raf, sim, world, feel, layers, post, gov, camera, view, deps, loop, fatal,
    get firstFrames() { return s.firstFrames; },
    frame: (t) => raf.fire(t),
  };
}

/** Exact distance a - b in u, as between does, for chunk-crossing checks. */
export function gap(a: Readonly<Travel>, b: Readonly<Travel>): number {
  return (a.chunk - b.chunk) * CHUNK_LEN + (a.local - b.local);
}
