// Hosts render layers on the fake world in a browser page, through the same lifecycle T10 will use, so T03 to T06 get
// real GPU screenshots before integration. Query string: ?manual=1 ?tier=0..4 ?post=off ?t=<seconds> ?palette=0..5
// ?biome=0..5 ?hero=0..3. Renderer flags are exactly section 6.6.
import { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import {
  CAMERA_FAR, CAMERA_FOV, CAMERA_NEAR, CHUNK_LEN,
  type DebugMode, type FrameView, type HeroMode, type LayerName, type PostStack, type RenderContext, type RenderLayer, type Tier, type Travel, type WorldSource,
} from '../contracts/index';
import { between } from '../core/coords';
import { createSharedUniforms, writeCameraPose, writeSharedUniforms, type CameraPose } from '../core/uniforms';
import { createDevPost } from './devPost';
import { createFakeWorld } from './fakeWorld';
import { fakeProfile, scriptedFrame, type ScriptedFrameOptions } from './scriptedFrame';

export interface DevShellOptions { world?: WorldSource; tier?: Tier }
export interface DevShell {
  readonly ready: boolean;                       // attach, precompile and first frame are done
  readonly ctx: RenderContext;
  readonly shaderErrors: readonly string[];
  readonly warpSerial: number;
  setManual(on: boolean): void;                  // true stops the rAF loop
  frameAt(t: number, o?: ScriptedFrameOptions): number;   // renders exactly that frame in this task, returns 1x1 readPixels-synced ms
  pixels(): Uint8Array;                          // full-frame RGBA, rows bottom-up; call in the same task as frameAt (section 11.3)
  stats(): { calls: number; triangles: number; programs: number; geometries: number; textures: number; width: number; height: number };
  rendererInfo(): { webgl2: boolean; renderer: string; depthBits: number };   // unmasked, through WEBGL_debug_renderer_info
  setTier(t: Tier): void;
  setLayerVisible(name: LayerName, on: boolean): void;
  setDebugMode(m: DebugMode): void;
  rebuild(): void;
  dispose(): void;
}
declare global { interface Window { __shell?: DevShell } }

function queryInt(q: URLSearchParams, name: string, max: number): number | undefined {
  const raw = q.get(name);
  if (raw === null) return undefined;
  const v = Number(raw);
  return Number.isInteger(v) && v >= 0 && v <= max ? v : undefined;
}

function deadShell(): DevShell {
  const dead = (): never => { throw new Error('dev shell: WebGL renderer could not be created'); };
  return {
    ready: false,
    get ctx(): RenderContext { return dead(); },
    shaderErrors: [],
    warpSerial: 0,
    setManual: () => undefined,
    frameAt: dead,
    pixels: dead,
    stats: dead,
    rendererInfo: () => ({ webgl2: false, renderer: '', depthBits: 0 }),
    setTier: () => undefined,
    setLayerVisible: () => undefined,
    setDebugMode: () => undefined,
    rebuild: () => undefined,
    dispose: () => undefined,
  };
}

export function startDevShell(layers: RenderLayer[], post?: PostStack, o: DevShellOptions = {}): DevShell {
  const q = new URLSearchParams(location.search);
  const manualQuery = q.get('manual') === '1';
  const startT = Number(q.get('t') ?? 0) || 0;
  const paletteQuery = queryInt(q, 'palette', 5);
  const biomeQuery = queryInt(q, 'biome', 5);
  const heroQuery = queryInt(q, 'hero', 3);
  let tier = (queryInt(q, 'tier', 4) ?? o.tier ?? 3) as Tier;

  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ powerPreference: 'high-performance', antialias: false, stencil: false, depth: false });
  } catch (e) {
    delete window.__shell;
    console.error(`dev shell: WebGL renderer could not be created: ${String(e)}`);
    return deadShell();
  }

  const errors: string[] = [];
  renderer.info.autoReset = false;
  // The handler replaces three's own log, so it signals both the error list and the console.
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    const log = [gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment)].filter(Boolean).join('\n');
    errors.push(log);
    console.error(`SHADER_ERROR ${log}`);
  };

  document.body.style.margin = '0';
  document.body.style.background = '#000';
  renderer.domElement.style.display = 'block';
  document.body.append(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(CAMERA_FOV, window.innerWidth / window.innerHeight, CAMERA_NEAR, CAMERA_FAR);
  const shared = createSharedUniforms();
  const world = o.world ?? createFakeWorld();
  const stack = post ?? createDevPost();
  const ctx: RenderContext = { renderer, scene, camera, shared, world };
  const pose: CameraPose = { x: 0, y: 0, z: 0, rotX: 0, rotY: 0, rotZ: 0, fovDeg: CAMERA_FOV };
  const lastCam: Travel = { chunk: 0, local: 0 };

  let ready = false;
  let manual = manualQuery;
  let warpSerial = 0;
  let rafId = 0;
  let disposed = false;
  let cssW = window.innerWidth;
  let cssH = window.innerHeight;
  let cssDpr = window.devicePixelRatio;
  let hasCam = false;
  let latest: Readonly<FrameView> | null = null;

  // The no-override path reuses one object, so a tight frame loop allocates nothing here.
  const plainSim: { warpSerial: number } = { warpSerial: 0 };
  const plain: ScriptedFrameOptions = {
    world,
    tier,
    sim: plainSim,
    ...(paletteQuery !== undefined ? { palette: paletteQuery } : {}),
    ...(biomeQuery !== undefined ? { biome: biomeQuery } : {}),
    ...(heroQuery !== undefined ? { hero: heroQuery as HeroMode } : {}),
  };

  function options(extra: ScriptedFrameOptions | undefined): ScriptedFrameOptions {
    plain.tier = tier;
    plainSim.warpSerial = warpSerial;
    if (!extra) return plain;
    return { ...plain, ...extra, sim: { warpSerial, ...extra.sim } };
  }

  function applyCamera(v: Readonly<FrameView>): void {
    writeCameraPose(v, camera.aspect, pose);
    camera.position.set(pose.x, pose.y, pose.z);
    camera.rotation.set(pose.rotX, pose.rotY, pose.rotZ);
    if (camera.fov !== pose.fovDeg) {
      camera.fov = pose.fovDeg;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
  }

  // Compares sizes rather than waiting for the event: innerWidth changes before the resize event dispatches, so a
  // test that resizes and renders at once would otherwise draw at the old size, and pass or fail by timing.
  function applyResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = window.devicePixelRatio;
    if (w === cssW && h === cssH && dpr === cssDpr) return;
    cssW = w;
    cssH = h;
    cssDpr = dpr;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    stack.resize(w, h, dpr);
  }

  function frameAt(t: number, extra?: ScriptedFrameOptions): number {
    const start = performance.now();
    applyResize();
    let v = scriptedFrame(t, options(extra));
    // Any backward move, or a forward jump over CHUNK_LEN, rebuilds first, as section 3.3 step 10 does.
    let jumped = false;
    if (hasCam) {
      const d = between(v.cam, lastCam);
      jumped = d < 0 || d > CHUNK_LEN;
    }
    if (jumped) {
      warpSerial++;
      v = scriptedFrame(t, options(extra));
    }
    lastCam.chunk = v.cam.chunk;
    lastCam.local = v.cam.local;
    hasCam = true;
    latest = v;

    renderer.info.reset();
    writeSharedUniforms(v, shared);
    applyCamera(v);
    if (jumped) {
      for (const layer of layers) layer.rebuild(v);
      stack.rebuild();
    }
    for (const layer of layers) layer.frame(v);
    stack.frame(v);
    stack.render(v.dt);

    // The 1x1 readPixels sync of section 11.4. A later read would see an empty buffer without preserveDrawingBuffer.
    const gl = renderer.getContext();
    renderer.setRenderTarget(null);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, syncPixel);
    return performance.now() - start;
  }
  const syncPixel = new Uint8Array(4);

  // Time runs from the first rAF, so a slow boot does not read as a camera jump and rebuild on the first frame.
  let rafOrigin = -1;
  function loop(ms: number): void {
    if (disposed || manual) return;
    rafId = requestAnimationFrame(loop);
    if (rafOrigin < 0) rafOrigin = ms;
    frameAt(startT + (ms - rafOrigin) / 1000);
  }

  function setManual(on: boolean): void {
    if (manual === on) return;
    manual = on;
    if (on) {
      cancelAnimationFrame(rafId);
    } else if (ready) {
      rafId = requestAnimationFrame(loop);
    }
  }

  const shell: DevShell = {
    get ready() { return ready; },
    ctx,
    shaderErrors: errors,
    get warpSerial() { return warpSerial; },
    setManual,
    frameAt,
    pixels(): Uint8Array {
      const gl = renderer.getContext();
      renderer.setRenderTarget(null);
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const out = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
      return out;
    },
    stats() {
      const gl = renderer.getContext();
      const { render, memory, programs } = renderer.info;
      return {
        calls: render.calls,
        triangles: render.triangles,
        programs: programs?.length ?? 0,
        geometries: memory.geometries,
        textures: memory.textures,
        width: gl.drawingBufferWidth,
        height: gl.drawingBufferHeight,
      };
    },
    rendererInfo() {
      const gl = renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      renderer.setRenderTarget(null);
      return {
        webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext,
        renderer: ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER)),
        depthBits: Number(gl.getParameter(gl.DEPTH_BITS)),
      };
    },
    setTier(t: Tier): void {
      tier = t;
      const profile = fakeProfile(t);
      for (const layer of layers) layer.setQuality(profile);
      stack.setQuality(profile);
    },
    setLayerVisible(name: LayerName, on: boolean): void {
      for (const layer of layers) if (layer.name === name) layer.setVisible(on);
    },
    setDebugMode(m: DebugMode): void {
      for (const layer of layers) layer.setDebugMode(m);
    },
    rebuild(): void {
      if (!latest) return;
      for (const layer of layers) layer.rebuild(latest);
      stack.rebuild();
    },
    dispose(): void {
      disposed = true;
      cancelAnimationFrame(rafId);
      for (const layer of layers) layer.dispose();
      stack.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      delete window.__shell;
    },
  };
  window.__shell = shell;

  async function boot(): Promise<void> {
    const profile = fakeProfile(tier);
    const v0 = scriptedFrame(startT, options(undefined));
    writeSharedUniforms(v0, shared);
    applyCamera(v0);
    for (const layer of layers) {
      layer.attach(ctx);
      layer.setQuality(profile);
    }
    stack.attach(ctx);
    stack.setQuality(profile);
    if (q.get('post') === 'off') stack.forceVariant('off');
    stack.resize(cssW, cssH, cssDpr);
    await stack.precompile();
    if (disposed) return;
    const v1 = scriptedFrame(startT, options(undefined));
    latest = v1;
    for (const layer of layers) layer.rebuild(v1);
    frameAt(startT);
    ready = true;
    if (!manual) rafId = requestAnimationFrame(loop);
  }
  boot().catch((e: unknown) => {
    console.error(`dev shell: boot failed: ${String(e)}`);
  });

  return shell;
}
