// Dev only. window.__skyDev: sheet builder, float probe, link spy and context-loss helper for dev/sky.html and the spec.
// Sheets are built from pixels() in the same task as the frame, because the shell does not set preserveDrawingBuffer.
// It may not import src/testing (section 3.2), so the shell arrives as an argument, typed here by what is used.
import {
  BufferAttribute, BufferGeometry, Camera, FloatType, Mesh, NearestFilter, NoBlending, RGBAFormat, Scene, ShaderMaterial, WebGLRenderTarget,
} from 'three';
import type { RenderContext, Tier } from '../../../contracts/index';
import type { SkyCore } from '../skyLayer';
import { commonFragWith } from '../skyMaterial';
import {
  bandChanges, countPeaks, diffBytes, findStars, firstEdgeRow, hashBytes, lumaImage, meanRadius, peakRow, photometry, pixelAt, trackStars,
  type ChannelBanding, type Diff, type Frame, type Photometry, type StarTrack,
} from './metrics';

/** A ScriptedFrameOptions value, plus t in seconds. Stays JSON, so a spec can build it on the Node side. */
export type FrameSpec = Record<string, unknown> & { t?: number };
export type Rect = readonly [number, number, number, number];   // x, row from the top, width, height

export interface SheetCell { frame: FrameSpec; label?: string; rect?: Rect; stretch?: boolean }
export interface SheetSpec { cols: number; cellW: number; cellH: number; cells: readonly SheetCell[] }
export interface CellStats extends Photometry { label: string; w: number; h: number }
export interface ProbeCase { label: string; heroA: number; heroB: number; heroMix: number }
export interface ProbeResult { label: string; skyNonFinite: number; discNonFinite: number; discMinRgb: number; discMinA: number; discMaxA: number }
/** One frame's change in sunDisc over the whole sphere. encoded is in 8-bit sRGB on black, the worst case for a reflection. */
export interface AddedLight { pixels: number; peak: number; peakAdded: number }
export interface DiscStep { label: string; maxLinear: number; maxEncoded: number; over1: number; over4: number; rearMaxEncoded: number; samples: number }

interface ShellLike {
  readonly ctx: RenderContext;
  frameAt(t: number, o?: object): number;
  pixels(): Uint8Array;
  stats(): { width: number; height: number; calls: number; programs: number };
  setTier(t: Tier): void;
  rebuild(): void;
}

export interface SkyDev {
  readonly core: SkyCore;
  readonly grabCount: number;
  hash(f: FrameSpec): string;
  /** The frame's RGBA bytes in base64, so a spec can compare frames from two pages (DI-58 needs counts, not a hash). */
  bytes(f: FrameSpec): string;
  diff(a: FrameSpec, b: FrameSpec): Diff;
  /** f after primeA against f after primeB: a frame must not depend on what was drawn before it. */
  diffAfter(primeA: FrameSpec, primeB: FrameSpec, f: FrameSpec): Diff;
  /**
   * Where withIt adds over minAdded of luminance to without: pixel count, peak luminance there and peak added. Linear HDR,
   * read from a float target, so a clipped channel cannot hide a blown source.
   */
  addedLight(withIt: FrameSpec, without: FrameSpec, minAdded: number): AddedLight;
  column(f: FrameSpec, x: number, rows: readonly number[]): [number, number, number][];
  photometry(f: FrameSpec): Photometry;
  banding(f: FrameSpec, x0: number, x1: number, row0: number, row1: number): ChannelBanding[];
  edges(f: FrameSpec, x: number, row0: number, row1: number, minStep: number): { firstEdge: number; peak: number };
  sheet(s: SheetSpec): { url: string; stats: CellStats[] };
  trackStars(f: FrameSpec, axis: 'shakeX' | 'shakeY', frames: number, pxPerFrame: number, pxPerRad: number): StarTrack;
  starCensus(f: FrameSpec, region: Rect, minPeak: number): { peaks: number; radius: number };
  probe(cases: readonly ProbeCase[]): ProbeResult[];
  /** How far sunDisc moves between heroMix values, across every direction a chrome orb can reflect. */
  discStep(label: string, heroA: number, heroB: number, mix0: number, mix1: number): DiscStep;
  /** Counts gl.linkProgram from now on, on every context. Idempotent. */
  spyLinks(): void;
  readonly links: number;
  loseAndRestore(): Promise<void>;
}
declare global { interface Window { __skyDev?: SkyDev } }

const PROBE_VERT = `
out vec2 vUv;
void main() { vUv = position.xy * .5 + .5; gl_Position = vec4(position.xy, 0., 1.); }
`;
const PROBE_FRAG = `
in vec2 vUv;
uniform float uProbeY;
void main() {
  float lon = (vUv.x - .5) * TAU, lat = (vUv.y - .5) * TAU * .5;
  gl_FragColor = sunDisc(vec3(cos(lat) * sin(lon), sin(lat), -cos(lat) * cos(lon)), uProbeY);
}
`;

function frameOf(shell: ShellLike, f: FrameSpec): Frame {
  shell.frameAt(f.t ?? 0, f);
  const { width, height } = shell.stats();
  return { data: shell.pixels(), w: width, h: height };
}

/** Averages the source pixels under each destination pixel: a box filter when shrinking, nearest when enlarging. */
function blit(src: Frame, rect: Rect, out: ImageData, dx: number, dy: number, dw: number, dh: number, stretch: boolean): void {
  const [sx, sr, sw, sh] = rect;
  const lo = [255, 255, 255], hi = [0, 0, 0];
  if (stretch) {
    for (let r = sr; r < sr + sh; r++) {
      for (let x = sx; x < sx + sw; x++) {
        const p = pixelAt(src, x, r);
        for (let k = 0; k < 3; k++) {
          if (p[k]! < lo[k]!) lo[k] = p[k]!;
          if (p[k]! > hi[k]!) hi[k] = p[k]!;
        }
      }
    }
  }
  for (let y = 0; y < dh; y++) {
    const r0 = sr + Math.floor((y * sh) / dh), r1 = Math.max(r0 + 1, sr + Math.floor(((y + 1) * sh) / dh));
    for (let x = 0; x < dw; x++) {
      const x0 = sx + Math.floor((x * sw) / dw), x1 = Math.max(x0 + 1, sx + Math.floor(((x + 1) * sw) / dw));
      let a = 0, b = 0, c = 0, n = 0;
      for (let r = r0; r < r1; r++) {
        for (let q = x0; q < x1; q++) {
          const i = ((src.h - 1 - r) * src.w + q) * 4;
          a += src.data[i]!; b += src.data[i + 1]!; c += src.data[i + 2]!; n++;
        }
      }
      const o = ((dy + y) * out.width + dx + x) * 4;
      const v = [a / n, b / n, c / n];
      for (let k = 0; k < 3; k++) {
        out.data[o + k] = stretch ? ((v[k]! - lo[k]!) * 255) / Math.max(hi[k]! - lo[k]!, 1) : v[k]!;
      }
      out.data[o + 3] = 255;
    }
  }
}

export function installSkyDev(core: SkyCore, shell: ShellLike, heroSource?: string): SkyDev {
  const scene = new Scene();
  scene.matrixWorldAutoUpdate = false;
  const camera = new Camera();
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  let probeMaterial: ShaderMaterial | null = null;
  let links = 0;
  let spied = false;
  let grabs = 0;

  function grab(f: FrameSpec): Frame {
    grabs++;
    return frameOf(shell, f);
  }

  function readFloat(target: WebGLRenderTarget): Float32Array {
    const out = new Float32Array(target.width * target.height * 4);
    shell.ctx.renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, out);
    return out;
  }

  function probeUniforms(): ShaderMaterial['uniforms'] {
    if (!probeMaterial) {
      probeMaterial = new ShaderMaterial({
        uniforms: { ...shell.ctx.shared, uProbeY: { value: 1 } },
        vertexShader: PROBE_VERT,
        fragmentShader: commonFragWith(heroSource) + PROBE_FRAG,
        depthTest: false,
        depthWrite: false,
        blending: NoBlending,
      });
      const mesh = new Mesh(geometry, probeMaterial);
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      scene.add(mesh);
    }
    return probeMaterial.uniforms;
  }

  /** Writes the shared uniforms for this mode state and draws nothing else that matters. */
  function setHero(heroA: number, heroB: number, heroMix: number): void {
    shell.frameAt(0, { tick: 600, palette: 0, biome: 0, at: { chunk: 1, local: 0 }, camX: 0, zone: { dayPhase: 0, heroA, heroB, heroMix } });
  }

  function floatTarget(w: number, h: number): WebGLRenderTarget {
    return new WebGLRenderTarget(w, h, { type: FloatType, format: RGBAFormat, depthBuffer: false, stencilBuffer: false, minFilter: NearestFilter, magFilter: NearestFilter, generateMipmaps: false });
  }

  const dev: SkyDev = {
    core,
    get grabCount(): number { return grabs; },
    hash: (f) => hashBytes(grab(f).data),
    bytes(f) {
      const data = grab(f).data;
      let s = '';
      for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000));
      return btoa(s);
    },
    diff(a, b) {
      const first = grab(a).data;
      return diffBytes(first, grab(b).data);
    },
    diffAfter(primeA, primeB, f) {
      grab(primeA);
      const first = grab(f).data;
      grab(primeB);
      return diffBytes(first, grab(f).data);
    },
    addedLight(withIt, without, minAdded) {
      const { ctx } = shell;
      const { renderer } = ctx;
      const { width, height } = shell.stats();
      const target = floatTarget(width, height);
      const auto = renderer.autoClear;
      renderer.autoClear = true;
      // frameAt writes the uniforms and draws the nebula; the scene drawn again into the float target is the sky unclamped.
      const read = (f: FrameSpec): Float32Array => {
        shell.frameAt(f.t ?? 0, f);
        renderer.setRenderTarget(target);
        renderer.render(ctx.scene, ctx.camera);
        return readFloat(target);
      };
      const a = read(withIt), b = read(without);
      renderer.autoClear = auto;
      renderer.setRenderTarget(null);
      target.dispose();
      let pixels = 0, peak = 0, peakAdded = 0;
      for (let i = 0; i < a.length; i += 4) {
        const la = 0.2126 * a[i]! + 0.7152 * a[i + 1]! + 0.0722 * a[i + 2]!;
        const added = la - (0.2126 * b[i]! + 0.7152 * b[i + 1]! + 0.0722 * b[i + 2]!);
        if (added > minAdded) {
          pixels++;
          peak = Math.max(peak, la);
          peakAdded = Math.max(peakAdded, added);
        }
      }
      return { pixels, peak, peakAdded };
    },
    column(f, x, rows) {
      const frame = grab(f);
      return rows.map((r) => pixelAt(frame, x, r));
    },
    photometry: (f) => photometry(grab(f)),
    banding: (f, x0, x1, row0, row1) => bandChanges(grab(f), x0, x1, row0, row1),
    edges(f, x, row0, row1, minStep) {
      const frame = grab(f);
      return { firstEdge: firstEdgeRow(frame, x, row0, row1, minStep), peak: peakRow(frame, x, row0, row1) };
    },
    sheet(s) {
      const rows = Math.ceil(s.cells.length / s.cols);
      const canvas = document.createElement('canvas');
      canvas.width = s.cols * s.cellW;
      canvas.height = rows * s.cellH;
      const c2 = canvas.getContext('2d');
      if (!c2) throw new Error('no 2d context');
      const image = c2.createImageData(canvas.width, canvas.height);
      const stats: CellStats[] = [];
      const anchors: [number, number, string][] = [];
      s.cells.forEach((cell, i) => {
        const frame = grab(cell.frame);
        const dx = (i % s.cols) * s.cellW, dy = Math.floor(i / s.cols) * s.cellH;
        blit(frame, cell.rect ?? [0, 0, frame.w, frame.h], image, dx, dy, s.cellW, s.cellH, cell.stretch ?? false);
        const label = cell.label ?? '';
        stats.push({ ...photometry(frame), label, w: frame.w, h: frame.h });
        anchors.push([dx, dy, label]);
      });
      c2.putImageData(image, 0, 0);
      c2.font = '14px monospace';
      for (const [dx, dy, label] of anchors) {
        c2.fillStyle = 'rgba(0,0,0,.65)';
        c2.fillRect(dx, dy, Math.min(label.length * 8.5 + 8, s.cellW), label === '' ? 0 : 20);
        c2.fillStyle = '#fff';
        c2.fillText(label, dx + 4, dy + 15);
      }
      return { url: canvas.toDataURL('image/png'), stats };
    },
    trackStars(f, axis, frames, pxPerFrame, pxPerRad) {
      const images: Float32Array[] = [];
      let w = 0, h = 0;
      for (let i = 0; i < frames; i++) {
        const feel = { [axis]: (pxPerFrame * i) / pxPerRad };
        const frame = grab({ ...f, feel });
        w = frame.w;
        h = frame.h;
        images.push(lumaImage(frame));
      }
      const stars = findStars(images[0]!, w, h, { x0: 500, x1: w - 500, y0: h - 460, y1: h - 30, minPeak: 50, maxNeighbour: 10, radius: 9 });
      // Pitch up moves stars down the screen, and buffer y rises upward. Yaw left moves them right.
      return trackStars(images, w, h, stars, axis === 'shakeX' ? pxPerFrame : 0, axis === 'shakeY' ? -pxPerFrame : 0);
    },
    starCensus(f, region, minPeak) {
      const frame = grab(f);
      const l = lumaImage(frame);
      const [x, row, width, height] = region;
      const y0 = frame.h - row - height, y1 = frame.h - row;
      const isolated = findStars(l, frame.w, frame.h, { x0: x, x1: x + width, y0, y1, minPeak, maxNeighbour: 10, radius: 9 });
      return {
        peaks: countPeaks(l, frame.w, frame.h, x, x + width, y0, y1, minPeak),
        radius: meanRadius(l, frame.w, isolated, 7),
      };
    },
    probe(cases) {
      const { ctx } = shell;
      const { renderer } = ctx;
      const { width, height } = shell.stats();
      const skyTarget = floatTarget(width, height);
      const discTarget = floatTarget(512, 512);
      const uniforms = probeUniforms();
      const out: ProbeResult[] = [];
      const auto = renderer.autoClear;
      renderer.autoClear = true;
      for (const c of cases) {
        setHero(c.heroA, c.heroB, c.heroMix);
        renderer.setRenderTarget(skyTarget);
        renderer.render(ctx.scene, ctx.camera);
        const sky = readFloat(skyTarget);
        let skyBad = 0;
        for (let i = 0; i < sky.length; i++) if (!Number.isFinite(sky[i]!)) skyBad++;
        let discBad = 0, minRgb = Infinity, minA = Infinity, maxA = -Infinity;
        for (const y of [1, 0.55]) {
          uniforms['uProbeY']!.value = y;
          renderer.setRenderTarget(discTarget);
          renderer.render(scene, camera);
          const disc = readFloat(discTarget);
          for (let i = 0; i < disc.length; i += 4) {
            for (let k = 0; k < 4; k++) if (!Number.isFinite(disc[i + k]!)) discBad++;
            minRgb = Math.min(minRgb, disc[i]!, disc[i + 1]!, disc[i + 2]!);
            minA = Math.min(minA, disc[i + 3]!);
            maxA = Math.max(maxA, disc[i + 3]!);
          }
        }
        out.push({ label: c.label, skyNonFinite: skyBad, discNonFinite: discBad, discMinRgb: minRgb, discMinA: minA, discMaxA: maxA });
      }
      renderer.autoClear = auto;
      renderer.setRenderTarget(null);
      skyTarget.dispose();
      discTarget.dispose();
      return out;
    },
    discStep(label, heroA, heroB, mix0, mix1) {
      const { renderer } = shell.ctx;
      const target = floatTarget(1024, 512);
      const uniforms = probeUniforms();
      uniforms['uProbeY']!.value = 1;
      const auto = renderer.autoClear;
      renderer.autoClear = true;
      const read = (m: number): Float32Array => {
        setHero(heroA, heroB, m);
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
        return readFloat(target);
      };
      const a = read(mix0), b = read(mix1);
      renderer.autoClear = auto;
      renderer.setRenderTarget(null);
      target.dispose();
      const encode = (v: number): number => 255 * (v <= 0.0031308 ? 12.92 * Math.max(v, 0) : 1.055 * Math.pow(Math.min(v, 1), 1 / 2.4) - 0.055);
      let maxLinear = 0, maxEncoded = 0, rearMaxEncoded = 0, over1 = 0, over4 = 0;
      for (let row = 0; row < 512; row++) {
        for (let x = 0; x < 1024; x++) {
          const i = (row * 1024 + x) * 4;
          let top = 0;
          for (let k = 0; k < 3; k++) {
            maxLinear = Math.max(maxLinear, Math.abs(a[i + k]! - b[i + k]!));
            top = Math.max(top, Math.abs(encode(a[i + k]!) - encode(b[i + k]!)));
          }
          maxEncoded = Math.max(maxEncoded, top);
          if (top > 1) over1++;
          if (top > 4) over4++;
          // PROBE_FRAG: lon = (u - .5) * TAU and z = -cos(lat) * cos(lon), so |lon| > 90 degrees faces behind the camera.
          const u = (x + 0.5) / 1024;
          if (u < 0.25 || u > 0.75) rearMaxEncoded = Math.max(rearMaxEncoded, top);
        }
      }
      return { label, maxLinear, maxEncoded, over1, over4, rearMaxEncoded, samples: 1024 * 512 };
    },
    spyLinks() {
      if (spied) return;
      spied = true;
      const proto = WebGL2RenderingContext.prototype;
      const original = proto.linkProgram;
      proto.linkProgram = function linkProgram(this: WebGL2RenderingContext, p: WebGLProgram): void {
        links++;
        original.call(this, p);
      };
    },
    get links(): number { return links; },
    async loseAndRestore() {
      const { renderer } = shell.ctx;
      const canvas = renderer.domElement;
      const lost = new Promise((resolve) => { canvas.addEventListener('webglcontextlost', resolve, { once: true }); });
      const back = new Promise((resolve) => { canvas.addEventListener('webglcontextrestored', resolve, { once: true }); });
      renderer.forceContextLoss();
      await lost;
      // Restoring inside the loss event is one of section 11.3's traps.
      await new Promise((resolve) => { setTimeout(resolve, 50); });
      renderer.forceContextRestore();
      await back;
      await new Promise((resolve) => { setTimeout(resolve, 50); });
    },
  };
  window.__skyDev = dev;
  return dev;
}
