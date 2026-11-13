// A HarnessHost for T09 to build against before T10 exists. Works in Node and in a browser. ctx.renderer is real
// when document exists and a minimal stub otherwise. Fake layers and post only record into calls.
import {
  BufferAttribute, BufferGeometry, Mesh, PerspectiveCamera, Scene, ShaderMaterial, WebGLRenderer,
} from 'three';
import {
  CAMERA_FAR, CAMERA_FOV, CAMERA_NEAR, SIM_HZ, SPEED_CRUISE, SimMode,
  type ControlFrame, type DebugMode, type EventBuffer, type Governor, type HarnessHost, type HeroMode, type LayerName, type PostStack,
  type PostVariant, type RenderContext, type RenderLayer, type Sim, type SimCommand, type SimState, type Tier,
} from '../contracts/index';
import { createEventBuffer } from '../core/alloc';
import { advance, canWarp, rowMod } from '../core/coords';
import { hash01 } from '../core/hash';
import { createSharedUniforms } from '../core/uniforms';
import { createFakeWorld } from './fakeWorld';
import { fakeProfile } from './scriptedFrame';

export interface FakeHostCalls {
  setManual: boolean[]; runFrame: number[]; renderState: [number, number, number][];
  overrideZone: unknown[]; overrideBend: unknown[]; overrideFov: (number | null)[]; overrideFeel: unknown[];
  overrideCam: (number | null)[];
  forceVariant: unknown[]; forceMsaa: unknown[]; layerVisible: [LayerName, boolean][]; debugMode: [LayerName, DebugMode][];
  governorForce: (Tier | 'auto')[];
}
export interface FakeHost extends HarnessHost { readonly calls: FakeHostCalls }

const STATE_BITS = new Float64Array(1);
const STATE_WORDS = new Uint32Array(STATE_BITS.buffer);

/**
 * The colour renderState draws: a pure function of (rowMod(chunk) mod 1024, local, tick), written to out as three
 * bytes of hash, so nearby states differ by far more than one 8-bit level.
 */
function stateColour(chunk: number, local: number, tick: number, out: Float32Array): void {
  STATE_BITS[0] = local;
  const h = hash01(rowMod(chunk) % 1024, tick, STATE_WORDS[0]!, STATE_WORDS[1]!);
  const bits = Math.floor(h * 16777216);
  out[0] = ((bits >> 16) & 255) / 255;
  out[1] = ((bits >> 8) & 255) / 255;
  out[2] = (bits & 255) / 255;
}

function stubRenderer(): WebGLRenderer {
  const info = {
    autoReset: false,
    memory: { geometries: 0, textures: 0 },
    render: { calls: 0, triangles: 0, frame: 0, lines: 0, points: 0 },
    programs: [] as unknown[],
    reset(): void { /* nothing to reset */ },
  };
  const gl = { drawingBufferWidth: 64, drawingBufferHeight: 64, isContextLost: () => false };
  const stub = {
    info,
    getContext: () => gl,
    domElement: { width: 64, height: 64 },
    setRenderTarget(): void { /* no GL */ },
    compile(): void { /* no GL */ },
    render(): void { /* no GL */ },
  };
  return stub as unknown as WebGLRenderer;
}

function realRenderer(): WebGLRenderer {
  const renderer = new WebGLRenderer({ powerPreference: 'high-performance', antialias: false, stencil: false, depth: false });
  renderer.info.autoReset = false;
  renderer.setPixelRatio(1);
  renderer.setSize(320, 180);
  document.body.append(renderer.domElement);
  return renderer;
}

function createFakeSim(events: EventBuffer): Sim {
  const stepDist = SPEED_CRUISE / SIM_HZ;
  const state: SimState = {
    tick: 0, travel: { chunk: 1, local: 0 }, stepDist, speed: SPEED_CRUISE,
    x: 0, y: 6, prevX: 0, prevY: 6, mode: SimMode.DEMO,
    score: 0, sync: 1, shields: 3, overdrive: 0, ghost: 0, beat: 0, sectorIndex: 0, objectiveProgress: 0,
    autopilot: true, warpSerial: 0,
  };
  return {
    state,
    events,
    step(): void {
      advance(state.travel, stepDist);
      state.stepDist = stepDist;
      state.tick += 1;
      state.beat = state.tick / 72;
    },
    command(c: SimCommand): void {
      if (c === 'launch' && state.mode === SimMode.DEMO) state.mode = SimMode.PLAY;
      else if (c === 'pause' && state.mode === SimMode.PLAY) state.mode = SimMode.CRUISE;
      else if (c === 'resume' && state.mode === SimMode.CRUISE) state.mode = SimMode.PLAY;
    },
    warpTo(chunk: number, local: number): boolean {
      if (!canWarp(chunk, local)) return false;
      state.travel.chunk = chunk;
      state.travel.local = local;
      state.warpSerial += 1;
      return true;
    },
    setReducedMotion(): void { /* the fake sim has no speed rules */ },
    forceSignalLost(): void {
      if (state.mode === SimMode.PLAY) state.mode = SimMode.SIGNAL_LOST;
    },
  };
}

function fakeLayer(name: LayerName, calls: FakeHostCalls): RenderLayer {
  return {
    name,
    attach(): void { /* records nothing */ },
    setQuality(): void { /* records nothing */ },
    frame(): void { /* records nothing */ },
    rebuild(): void { /* records nothing */ },
    setVisible(on: boolean): void { calls.layerVisible.push([name, on]); },
    setDebugMode(m: DebugMode): void { calls.debugMode.push([name, m]); },
    dispose(): void { /* records nothing */ },
  };
}

function fakePost(calls: FakeHostCalls): PostStack {
  return {
    attach(): void { /* records nothing */ },
    precompile(): Promise<void> { return Promise.resolve(); },
    setQuality(): void { /* records nothing */ },
    resize(): void { /* records nothing */ },
    frame(): void { /* records nothing */ },
    render(): void { /* records nothing */ },
    rebuild(): void { /* records nothing */ },
    forceVariant(v: PostVariant | 'off' | null): void { calls.forceVariant.push(v); },
    forceMsaa(n: 0 | 2 | 4 | null): void { calls.forceMsaa.push(n); },
    dispose(): void { /* records nothing */ },
  };
}

function fakeGovernor(calls: FakeHostCalls): Governor {
  let profile = fakeProfile(3);
  let pending: Tier | null = null;
  return {
    get profile() { return profile; },
    sample(): Tier | null {
      const p = pending;
      pending = null;
      return p;
    },
    force(t: Tier | 'auto'): void {
      calls.governorForce.push(t);
      if (t !== 'auto') {
        profile = fakeProfile(t);
        pending = t;
      }
    },
  };
}

const VERTEX = 'void main() { gl_Position = vec4(position.xy, 0., 1.); }';
const FRAGMENT = 'uniform vec3 uColour; void main() { gl_FragColor = vec4(uColour, 1.); }';

export function createFakeHost(): FakeHost {
  const calls: FakeHostCalls = {
    setManual: [], runFrame: [], renderState: [],
    overrideZone: [], overrideBend: [], overrideFov: [], overrideFeel: [],
    overrideCam: [],
    forceVariant: [], forceMsaa: [], layerVisible: [], debugMode: [],
    governorForce: [],
  };
  const browser = typeof document !== 'undefined';
  const renderer = browser ? realRenderer() : stubRenderer();
  const scene = new Scene();
  const camera = new PerspectiveCamera(CAMERA_FOV, 16 / 9, CAMERA_NEAR, CAMERA_FAR);
  const ctx: RenderContext = { renderer, scene, camera, shared: createSharedUniforms(), world: createFakeWorld() };

  const colour = new Float32Array(3);
  if (browser) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    const material = new ShaderMaterial({
      vertexShader: VERTEX, fragmentShader: FRAGMENT, depthTest: false, depthWrite: false, uniforms: { uColour: { value: colour } },
    });
    const triangle = new Mesh(geometry, material);
    triangle.frustumCulled = false;
    scene.add(triangle);
  }

  const events = createEventBuffer();
  const sim = createFakeSim(events);
  const layers: readonly RenderLayer[] = [
    fakeLayer('sky', calls), fakeLayer('terrain', calls), fakeLayer('props', calls), fakeLayer('fx', calls),
  ];

  function draw(chunk: number, local: number, tick: number): void {
    stateColour(chunk, local, tick, colour);
    renderer.info.reset();
    renderer.render(scene, camera);
  }

  return {
    calls,
    sim,
    ctx,
    layers,
    post: fakePost(calls),
    governor: fakeGovernor(calls),
    setManual(on: boolean): void { calls.setManual.push(on); },
    runFrame(dt: number): void {
      calls.runFrame.push(dt);
      const steps = Math.floor(dt * SIM_HZ);
      const control: ControlFrame = { moveX: 0, moveY: 0, absolute: false, boost: false, human: false };
      for (let i = 0; i < steps; i++) sim.step(control);
      const t = sim.state.travel;
      draw(t.chunk, t.local, sim.state.tick);
    },
    renderState(chunk: number, local: number, tick: number): void {
      calls.renderState.push([chunk, local, tick]);
      draw(chunk, local, tick);
    },
    overrideZone(o: { palette: number; biome: number; hero: HeroMode } | null): void { calls.overrideZone.push(o); },
    overrideBend(o: { a: number; c: number } | null): void { calls.overrideBend.push(o); },
    overrideFov(deg: number | null): void { calls.overrideFov.push(deg); },
    overrideFeel(o): void { calls.overrideFeel.push(o); },
    overrideCam(m): void { calls.overrideCam.push(m); },
  };
}
