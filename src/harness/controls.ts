// Scene-injected negative controls. Each adds its own mesh to ctx.scene, so it works on any layer set with no access to
// T03, T05 or T06 internals, and it exercises the real composer path. Every shader goes through COMMON_VERT and
// COMMON_FRAG, spreads ctx.shared by reference and applies bendV to render-space positions, so the GLSL gate stays clean.
// All are off by default, compile on first use, and leave the scene as they found it when switched off.
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, InstancedBufferAttribute, InstancedBufferGeometry, Mesh,
  NormalBlending, ShaderMaterial, type IUniform,
} from 'three';
import { COMMON_FRAG, COMMON_VERT } from '../contracts/glsl';
import { CHUNK_LEN, RenderOrder, type RenderContext } from '../contracts/index';
import type { ClearSaver, HarnessCore } from './api';
import { leakClear, probeFrame, slotsFor } from './hotProbe';

export interface Controls {
  absCoord(on: boolean): void;
  naiveGrid(on: boolean): void;
  floodLines(k: number): void;
  veil(l: number): void;
  gpuLoad(n: number): void;
  /** Adds the probe mesh, its attribute uploaded in full on the next frame. */
  staleUpload(on: boolean): void;
  /** Rewrites every instance of the probe. stale true keeps one small update range, so only that range uploads. */
  staleRewrite(stale: boolean): void;
  allocProbe(bytes: number): void;
  leakProbe(bytes: number): void;
}

const CONTROL_ORDER = RenderOrder.SPEED_LINES + 10;

const FULLSCREEN_VERT = `${COMMON_VERT}
void main() { gl_Position = vec4(position.xy, 1., 1.); }`;

const FLOOR_VERT = `${COMMON_VERT}
out float vForward;
out vec2 vGrid;
void main() {
  float forward = -position.z;
  vForward = forward;
  vGrid = vec2(position.x, forward + uTravel.x) / 8.;
  gl_Position = projectionMatrix * viewMatrix * vec4(bendV(position), 1.);
}`;

// The mistake identity exists to catch: an absolute distance held in a float32, and used for a world pattern.
const ABS_FRAG = `${COMMON_FRAG}
uniform float uAbs;
in float vForward;
in vec2 vGrid;
void main() {
  float f = fract((vForward + uAbs) / 16.);
  float line = f < .25 ? 1. : 0.;
  gl_FragColor = vec4(emit(uPal[5], 1.4) * line, 1.);
}`;

// The mistake shimmer exists to catch: a hard-edged grid with no filtering.
const NAIVE_FRAG = `${COMMON_FRAG}
in float vForward;
in vec2 vGrid;
void main() {
  vec2 f = fract(vGrid);
  float line = (f.x < .04 || f.y < .04) ? 1. : 0.;
  gl_FragColor = vec4(emit(uPal[5], 1.45) * line, 1.);
}`;

const FLOOD_FRAG = `${COMMON_FRAG}
uniform float uK;
void main() {
  float line = mod(floor(gl_FragCoord.y), uK) < .5 ? 1. : 0.;
  gl_FragColor = vec4(emit(uPal[5], 2.4) * line, 1.);
}`;

const VEIL_FRAG = `${COMMON_FRAG}
uniform float uL;
void main() { gl_FragColor = vec4(emit(vec3(1.), uL), 1.); }`;

// Known-linear in the iteration count, and its result reaches the frame, so a compiler cannot remove it. Each iteration is
// heavy enough to land near section 11.4's calibration, where 1024 iterations cost 5.8 ms at 1080p.
const LOAD_FRAG = `${COMMON_FRAG}
uniform int uN;
void main() {
  float x = fract(gl_FragCoord.x * .013 + gl_FragCoord.y * .007);
  for (int i = 0; i < uN; i++) {
    x = fract(sin(x * 3.1 + .7) * 1.61803 + cos(x * 5.3) * .27 + exp(-x) * .13 + sqrt(x + .5) * .19 + pow(x + .25, 1.3) * .11);
  }
  gl_FragColor = vec4(vec3(x * .001), 1.);
}`;

const STALE_VERT = `${COMMON_VERT}
in float aLevel;
out float vLevel;
void main() {
  float id = float(gl_InstanceID);
  vec2 cell = vec2(mod(id, 8.), floor(id / 8.));
  vec2 p = (position.xy * .5 + .5 + cell) / 8.;
  vLevel = aLevel;
  gl_Position = vec4(p * 2. - 1., 0., 1.);
}`;

const STALE_FRAG = `${COMMON_FRAG}
in float vLevel;
void main() { gl_FragColor = vec4(vec3(vLevel), 1.); }`;

const STALE_INSTANCES = 64;
const STALE_BEFORE = 0.2;
const STALE_AFTER = 0.8;

function sharedOf(ctx: RenderContext): Record<string, IUniform> {
  return { ...ctx.shared };
}

function fullscreenGeometry(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  return g;
}

/** Rows bunch toward the camera, so the bend stays smooth, as on T00's proof floor. */
function floorGeometry(): BufferGeometry {
  const cols = 32;
  const rows = 192;
  const positions = new Float32Array((cols + 1) * (rows + 1) * 3);
  const index = new Uint32Array(cols * rows * 6);
  let p = 0;
  for (let r = 0; r <= rows; r++) {
    const f = r / rows;
    const z = -4300 * f * f;
    for (let c = 0; c <= cols; c++) {
      positions[p++] = -4096 + (8192 * c) / cols;
      positions[p++] = 0;
      positions[p++] = z;
    }
  }
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c;
      const b = a + 1;
      const d = a + cols + 1;
      const e = d + 1;
      index[i++] = a; index[i++] = b; index[i++] = d;
      index[i++] = b; index[i++] = e; index[i++] = d;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.setIndex(new BufferAttribute(index, 1));
  return g;
}

function additive(vertexShader: string, fragmentShader: string, uniforms: Record<string, IUniform>): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader, fragmentShader, uniforms, transparent: true, blending: AdditiveBlending, depthTest: false, depthWrite: false, side: DoubleSide,
  });
}

/** A control's one mesh. show adds it and hide removes and frees it, so an off control leaves nothing behind. */
class Injected {
  private mesh: Mesh | null = null;
  readonly uniforms: Record<string, IUniform>;

  constructor(
    private readonly ctx: RenderContext,
    extra: Record<string, IUniform>,
    private readonly build: (uniforms: Record<string, IUniform>) => { geometry: BufferGeometry; material: ShaderMaterial },
  ) {
    this.uniforms = { ...sharedOf(ctx), ...extra };
  }

  get on(): boolean {
    return this.mesh !== null;
  }

  show(): void {
    if (this.mesh) return;
    const { geometry, material } = this.build(this.uniforms);
    const m = new Mesh(geometry, material);
    m.frustumCulled = false;
    m.renderOrder = CONTROL_ORDER;
    this.ctx.scene.add(m);
    this.mesh = m;
  }

  hide(): void {
    if (!this.mesh) return;
    this.ctx.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
    this.mesh = null;
  }

  geometry(): BufferGeometry | null {
    return this.mesh ? this.mesh.geometry : null;
  }
}

export function createClearSaver(ctx: RenderContext): ClearSaver {
  const colour = new Color();
  let alpha = 0;
  return {
    save(): void {
      ctx.renderer.getClearColor(colour);
      alpha = ctx.renderer.getClearAlpha();
    },
    restore(): void {
      ctx.renderer.setClearColor(colour, alpha);
    },
  };
}

export function createControls(core: HarnessCore): Controls {
  const { ctx } = core.host;

  const abs = new Injected(ctx, { uAbs: { value: 0 } }, (uniforms) => ({
    geometry: floorGeometry(), material: additive(FLOOR_VERT, ABS_FRAG, uniforms),
  }));
  const naive = new Injected(ctx, {}, (uniforms) => ({
    geometry: floorGeometry(), material: additive(FLOOR_VERT, NAIVE_FRAG, uniforms),
  }));
  const flood = new Injected(ctx, { uK: { value: 16 } }, (uniforms) => ({
    geometry: fullscreenGeometry(), material: additive(FULLSCREEN_VERT, FLOOD_FRAG, uniforms),
  }));
  const veiled = new Injected(ctx, { uL: { value: 0 } }, (uniforms) => ({
    geometry: fullscreenGeometry(), material: additive(FULLSCREEN_VERT, VEIL_FRAG, uniforms),
  }));
  const load = new Injected(ctx, { uN: { value: 0 } }, (uniforms) => ({
    geometry: fullscreenGeometry(), material: additive(FULLSCREEN_VERT, LOAD_FRAG, uniforms),
  }));
  const stale = new Injected(ctx, {}, (uniforms) => {
    const g = new InstancedBufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setAttribute('aLevel', new InstancedBufferAttribute(new Float32Array(STALE_INSTANCES).fill(STALE_BEFORE), 1));
    g.instanceCount = STALE_INSTANCES;
    return {
      geometry: g,
      material: new ShaderMaterial({
        vertexShader: STALE_VERT, fragmentShader: STALE_FRAG, uniforms, transparent: true, blending: NormalBlending,
        depthTest: false, depthWrite: false, side: DoubleSide,
      }),
    };
  });

  // The control reads the frame's position through this hook, which only exists while the control is on.
  function absHook(chunk: number, local: number): void {
    abs.uniforms['uAbs']!.value = chunk * CHUNK_LEN + local;
  }

  let allocSlots = -1;
  let leakSlots = -1;

  function probeHook(): void {
    probeFrame(allocSlots, leakSlots);
  }

  function updateProbes(): void {
    core.onFrame = allocSlots >= 0 || leakSlots >= 0 ? probeHook : null;
  }

  return {
    absCoord(on: boolean): void {
      if (on) {
        abs.show();
        core.onRender = absHook;
      } else {
        abs.hide();
        core.onRender = null;
      }
    },

    naiveGrid(on: boolean): void {
      if (on) naive.show();
      else naive.hide();
    },

    floodLines(k: number): void {
      if (k > 0) {
        flood.uniforms['uK']!.value = k;
        flood.show();
      } else {
        flood.hide();
      }
    },

    veil(l: number): void {
      if (l > 0) {
        veiled.uniforms['uL']!.value = l;
        veiled.show();
      } else {
        veiled.hide();
      }
    },

    gpuLoad(n: number): void {
      if (n > 0) {
        load.uniforms['uN']!.value = n;
        load.show();
      } else {
        load.hide();
      }
    },

    staleUpload(on: boolean): void {
      if (on) stale.show();
      else stale.hide();
    },

    staleRewrite(keepStale: boolean): void {
      const g = stale.geometry();
      if (!g) throw new Error('staleRewrite: staleUpload(true) comes first');
      const attr = g.getAttribute('aLevel') as InstancedBufferAttribute;
      (attr.array as Float32Array).fill(STALE_AFTER);
      attr.clearUpdateRanges();
      // A non-empty updateRanges suppresses the full upload (section 10.2), so only the first instance reaches the GPU.
      if (keepStale) attr.addUpdateRange(0, 1);
      attr.needsUpdate = true;
    },

    allocProbe(bytes: number): void {
      allocSlots = bytes > 0 ? slotsFor(bytes) : -1;
      updateProbes();
    },

    leakProbe(bytes: number): void {
      leakSlots = bytes > 0 ? slotsFor(bytes) : -1;
      if (leakSlots < 0) leakClear();
      updateProbes();
    },
  };
}
