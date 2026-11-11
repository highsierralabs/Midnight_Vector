// Dev only. index.ts does not import this file, so it never reaches a production bundle.
// createStandInSky: the minimum sky needed to judge fog and the horizon. T04's real sky is a sibling, so this is built from
// contract GLSL plus section 6.3's below-horizon lines, with no stars or nebula.
// withRefHeight: a copy of the exact section 4.4 and 5.2 function, because T01 may be half-written and section 14 risk 9 asks for
// far-mountain review on this function, not on the fake.
// flatWorld: the negative control for the non-flat check. readHdr: scene statistics from a half-float target, before any post.
import {
  BufferAttribute, BufferGeometry, DataUtils, HalfFloatType, Mesh, RGBAFormat, ShaderMaterial, WebGLRenderTarget, type IUniform,
} from 'three';
import { COMMON_FRAG, COMMON_VERT } from '../../../contracts/glsl';
import { RenderOrder, type RenderContext, type RenderLayer, type WorldSource } from '../../../contracts/index';
import { hash01 } from '../../../core/hash';

const SKY_VERT = `${COMMON_VERT}
out vec3 vRd;
void main() {
  vec3 rdView = vec3(position.x / projectionMatrix[0][0], position.y / projectionMatrix[1][1], -1.);
  vRd = transpose(mat3(viewMatrix)) * rdView;
  gl_Position = vec4(position.xy, 1., 1.);
}`;

// The last three lines of main are section 6.3's rule, exactly. 6016 is terrain's forward limit, on which that rule relies.
const SKY_FRAG = `${COMMON_FRAG}
in vec3 vRd;
void main() {
  vec3 rd = normalize(vRd);
  vec3 c = skyGrad(rd.y);
  vec4 s = sunDisc(rd, 1.);
  c = c * (1. - s.a) + s.rgb;
  vec2 g = rd.xy / max(-rd.z, 1e-3);
  float cy = max(cameraPosition.y, 1.), cc = max(-uBend.y, 0.), vm = uBend.z;
  float gb = (sqrt(cy / max(cc, 1e-12)) <= vm ? -2. * sqrt(cy * cc) : -(cy + cc * (vm * vm + 2. * vm * (6016. - vm))) / 6016.) - .004;
  c = mix(uPal[0] * .25, c, smoothstep(gb - .016, gb, g.y));
  gl_FragColor = vec4(c, 1.);
}`;

export function createStandInSky(): RenderLayer {
  let mesh: Mesh<BufferGeometry, ShaderMaterial> | null = null;
  let scene: RenderContext['scene'] | null = null;
  return {
    name: 'sky',
    attach(ctx: RenderContext): void {
      scene = ctx.scene;
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(Float32Array.of(-1, -1, 0, 3, -1, 0, -1, 3, 0), 3));
      const uniforms: Record<string, IUniform> = { ...ctx.shared };
      const material = new ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms, depthTest: false, depthWrite: false });
      mesh = new Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = RenderOrder.SKY;
      ctx.scene.add(mesh);
    },
    setQuality(): void { /* one look at every tier */ },
    frame(): void { /* everything it reads is in ctx.shared */ },
    rebuild(): void { /* no state */ },
    setVisible(on: boolean): void {
      if (mesh) mesh.visible = on;
    },
    setDebugMode(): void { /* the harness hides it instead */ },
    dispose(): void {
      if (!mesh || !scene) return;
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh = null;
    },
  };
}

function smooth(x: number): number {
  const t = x <= 0 ? 0 : x >= 1 ? 1 : x;
  return t * t * (3 - 2 * t);
}

export interface RefHeightOptions { period?: number; riseWidth?: number }

/** The exact section 4.4 and 5.2 code, seeded from base.seed, with every other method delegating to base. */
export function withRefHeight(base: WorldSource, o: RefHeightOptions = {}): WorldSource {
  const period = o.period ?? 0;
  const riseWidth = o.riseWidth ?? 430;
  const GX = new Float64Array(256);
  const GZ = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    const t = hash01(base.seed, 0, i, 0) * 2 * Math.PI;
    GX[i] = Math.cos(t);
    GZ[i] = Math.sin(t);
  }
  function hsh(ix: number, iz: number): number {
    const lo = (iz % 4294967296) | 0;
    const hi = Math.floor(iz / 4294967296) | 0;
    let m = Math.imul(lo, 0x9E3779B1) ^ Math.imul(hi, 0x85EBCA77) ^ Math.imul(ix, 0xC2B2AE3D);
    m ^= m >>> 15;
    m = Math.imul(m, 0x2C1B3C6D);
    m ^= m >>> 13;
    return m & 255;
  }
  // Quintic fade and no extra scaling: the statistics in section 5.2 depend on this amplitude.
  function gradP(ix: number, fx: number, iz: number, fz: number, P: number): number {
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const v = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
    const z1 = P > 0 ? (iz + 1) % P : iz + 1;
    const a = hsh(ix, iz), b = hsh(ix + 1, iz), c = hsh(ix, z1), d = hsh(ix + 1, z1);
    const n00 = GX[a]! * fx + GZ[a]! * fz;
    const n10 = GX[b]! * (fx - 1) + GZ[b]! * fz;
    const n01 = GX[c]! * fx + GZ[c]! * (fz - 1);
    const n11 = GX[d]! * (fx - 1) + GZ[d]! * (fz - 1);
    const k0 = n00 + (n10 - n00) * u;
    const k1 = n01 + (n11 - n01) * u;
    return k0 + (k1 - k0) * v;
  }
  // World z = iz * zs + zLocal; integer iz; zs and wl are powers of two.
  function oct(x: number, iz: number, zs: number, zLocal: number, wl: number): number {
    let zc: number;
    let fz: number;
    if (wl >= zs) {
      const ra = wl / zs;
      const q = Math.floor(iz / ra);
      const rem = iz - q * ra;
      const fr = (rem * zs + zLocal) / wl;
      const fl = Math.floor(fr);
      zc = q + fl;
      fz = fr - fl;
    } else {
      const ra = zs / wl;
      const fr = zLocal / wl;
      const fl = Math.floor(fr);
      zc = iz * ra + fl;
      fz = fr - fl;
    }
    const xf = x / wl;
    const xc = Math.floor(xf);
    if (period > 0) {
      const P = (period * 64) / wl;
      zc = ((zc % P) + P) % P;
      return gradP(xc, xf - xc, zc, fz, P);
    }
    return gradP(xc, xf - xc, zc, fz, 0);
  }
  function height(x: number, iz: number, zs: number, zLocal: number): number {
    const d = Math.abs(x);
    const k = smooth((d - 85) / riseWidth);
    if (k === 0) return 0;
    let a = 1, wl = 512, v = 0, w = 0;
    for (let i = 0; i < 5; i++) {
      const n = 1 - Math.abs(oct(x + 37, iz, zs, zLocal, wl)) * 1.6;
      v += a * n * n;
      w += a;
      a *= 0.52;
      wl /= 2;
    }
    return k * (v / w) * (135 + 250 * smooth((d - 260) / 1100));
  }
  return {
    seed: base.seed,
    height,
    fillProps: (chunk, out) => base.fillProps(chunk, out),
    fillItems: (chunk, out) => base.fillItems(chunk, out),
    zoneAt: (at, out) => base.zoneAt(at, out),
    bendAt: (at, out) => base.bendAt(at, out),
  };
}

/** Height always 0: the negative control for the non-flat check. */
export function flatWorld(base: WorldSource): WorldSource {
  return {
    seed: base.seed,
    height: () => 0,
    fillProps: (chunk, out) => base.fillProps(chunk, out),
    fillItems: (chunk, out) => base.fillItems(chunk, out),
    zoneAt: (at, out) => base.zoneAt(at, out),
    bendAt: (at, out) => base.bendAt(at, out),
  };
}

export interface HdrRect { name: string; x0: number; x1: number; y0: number; y1: number }   // half-open pixels, y counted from the top
export interface HdrRegion { name: string; maxL: number; meanL: number }
export interface HdrStats { width: number; height: number; nonFinite: number; negative: number; regions: HdrRegion[] }

/**
 * Renders the current scene to a half-float target with depth and reports it before tone mapping. A FloatType target would need
 * EXT_float_blend for the floor's blending [M], and half-float is what the real chain uses.
 */
export function readHdr(ctx: RenderContext, rects: readonly HdrRect[]): HdrStats {
  const { renderer, scene, camera } = ctx;
  const gl = renderer.getContext();
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  const target = new WebGLRenderTarget(width, height, { type: HalfFloatType, format: RGBAFormat, depthBuffer: true });
  const auto = renderer.autoClear;
  const previous = renderer.getRenderTarget();
  renderer.autoClear = true;
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  const raw = new Uint16Array(width * height * 4);
  renderer.readRenderTargetPixels(target, 0, 0, width, height, raw);
  renderer.setRenderTarget(previous);
  renderer.autoClear = auto;
  target.dispose();

  let nonFinite = 0;
  let negative = 0;
  const luminance = new Float32Array(width * height);
  for (let i = 0, p = 0; p < luminance.length; i += 4, p++) {
    const r = DataUtils.fromHalfFloat(raw[i]!);
    const g = DataUtils.fromHalfFloat(raw[i + 1]!);
    const b = DataUtils.fromHalfFloat(raw[i + 2]!);
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) nonFinite++;
    if (r < 0 || g < 0 || b < 0) negative++;
    luminance[p] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const regions = rects.map((rect): HdrRegion => {
    let maxL = -Infinity;
    let sum = 0;
    let n = 0;
    for (let y = rect.y0; y < rect.y1; y++) {
      const row = height - 1 - y;
      for (let x = rect.x0; x < rect.x1; x++) {
        const l = luminance[row * width + x]!;
        if (l > maxL) maxL = l;
        sum += l;
        n++;
      }
    }
    return { name: rect.name, maxL, meanL: sum / n };
  });
  return { width, height, nonFinite, negative, regions };
}
