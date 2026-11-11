// A CPU-drawn stand-in for the game's picture: terrain as a height field, props as coloured outlines. It is a guide to
// placement and framing, with no shaders, bend, bloom, mirror or real meshes. Beauty is judged at T05 and T11.
import {
  ARCHETYPE_COUNT, ARCHETYPE_SPEC, Archetype, CAMERA_FOV, CAMERA_PITCH, CAMERA_Y, CHUNK_LEN, FOG_END, FOG_START,
  PROP_STRIDE, PropField, type PropRow, type Travel, type WorldSource,
} from '../../../../src/contracts/index';
import { newPropRow, newZoneState } from './rows';

const TAN_V = Math.tan((CAMERA_FOV / 2) * Math.PI / 180);
const HERO_X = 0;
const HERO_Y = 0.125;
const HERO_R = 0.215;
const LIVE_ROWS = 95;

/** Half-width at scale 1, in u, of the outline each archetype draws. The real meshes are T05's. */
const HALF_WIDTH: readonly number[] = [3, 12, 36, 3.5, 2.5, 7, 3, 0.3, 3.5, 6, 2, 2.5, 9, 100, 5, 20, 4, 9, 2.5, 2];
/** Linear RGB per archetype for the impostor's outlines, picked to tell silhouettes apart. */
const COLOUR: readonly (readonly [number, number, number])[] = [
  [0.1, 1, 0.4], [1, 0.35, 0.1], [1, 0.8, 0.1], [0.8, 0.85, 1], [0.95, 0.9, 0.7], [1, 0.1, 0.6], [0.35, 0.45, 1], [1, 0.1, 0.1],
  [0.2, 1, 1], [0.7, 1, 0.3], [1, 1, 0.5], [1, 0.3, 1], [0.55, 0.75, 1], [1, 1, 1], [0.9, 0.2, 1], [0.3, 0.8, 0.9],
  [0.95, 0.95, 1], [1, 0.55, 0.3], [0.4, 0.9, 0.2], [1, 0.9, 0.2],
];
const Shape = { BOX: 0, TRIANGLE: 1, ELLIPSE: 2, RING: 3 } as const;
const SHAPE: readonly number[] = [
  Shape.BOX, Shape.BOX, Shape.TRIANGLE, Shape.ELLIPSE, Shape.BOX, Shape.BOX, Shape.BOX, Shape.BOX,
  Shape.ELLIPSE, Shape.ELLIPSE, Shape.BOX, Shape.BOX, Shape.BOX, Shape.RING, Shape.TRIANGLE, Shape.ELLIPSE,
  Shape.BOX, Shape.BOX, Shape.BOX, Shape.BOX,
];

function clamp01(x: number): number {
  return x <= 0 ? 0 : x >= 1 ? 1 : x;
}
function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
function linearToByte(c: number): number {
  const v = c <= 0 ? 0 : c >= 1 ? 1 : c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(v * 255);
}
function mix3(out: number[], a: ArrayLike<number>, ao: number, b: ArrayLike<number>, bo: number, m: number): void {
  out[0] = a[ao]! + (b[bo]! - a[ao]!) * m;
  out[1] = a[ao + 1]! + (b[bo + 1]! - a[ao + 1]!) * m;
  out[2] = a[ao + 2]! + (b[bo + 2]! - a[ao + 2]!) * m;
}

/** Section 8.2's skyGrad on a palette. y is rd.y of the normalized view direction. */
function skyGrad(pal: Float32Array, y: number, out: number[]): void {
  const h = Math.max(y, 0);
  const low = [pal[6]! * 0.62, pal[7]! * 0.62, pal[8]! * 0.62];
  mix3(out, low, 0, pal, 3, smoothstep(0, 0.17, h));
  const mid = [out[0]!, out[1]!, out[2]!];
  mix3(out, mid, 0, pal, 0, smoothstep(0.09, 0.55, h));
  const k = Math.exp(-h * 30) * 0.34;
  out[0] = out[0]! + pal[6]! * k;
  out[1] = out[1]! + pal[7]! * k;
  out[2] = out[2]! + pal[8]! * k;
}

/** Writes section 8.2's banded disc, mode 0, over c. */
function sunDisc(pal: Float32Array, gx: number, gy: number, c: number[]): void {
  const px = (gx - HERO_X) / HERO_R;
  const py = (gy - HERO_Y) / HERO_R;
  const d = Math.hypot(px, py);
  const v = py;
  const f = v * 9 - Math.floor(v * 9);
  const w0 = clamp01((0.42 - v) / 1.42);
  const w = 0.04 + 0.8 * w0 * w0;
  const band = v > 0.42 ? 1 : (Math.abs(f - 0.5) * 2 > w ? 1 : 0);
  const m = d <= 1 ? band : 0;
  const t = smoothstep(-0.9, 0.75, v);
  const sr = pal[12]! + (pal[9]! - pal[12]!) * t;
  const sg = pal[13]! + (pal[10]! - pal[13]!) * t;
  const sb = pal[14]! + (pal[11]! - pal[14]!) * t;
  const e = Math.max(d - 1, 0);
  const halo = (Math.exp(-e * 2.4) * 0.3 + Math.exp(-e * 0.7) * 0.1) * (1 - m);
  c[0] = c[0]! * (1 - m) + sr * m + (pal[12]! + pal[6]!) * 0.5 * halo;
  c[1] = c[1]! * (1 - m) + sg * m + (pal[13]! + pal[7]!) * 0.5 * halo;
  c[2] = c[2]! * (1 - m) + sb * m + (pal[14]! + pal[8]!) * 0.5 * halo;
}

interface Placed { a: number; x: number; y: number; f: number; scale: number }

/** Every record a camera at `at` can see, nearest last. */
function collect(world: WorldSource, at: Readonly<Travel>, row: PropRow, maxF: number): Placed[] {
  const out: Placed[] = [];
  for (let r = 0; r < LIVE_ROWS; r++) {
    const chunk = at.chunk + r;
    world.fillProps(chunk, row);
    for (let a = 0; a < ARCHETYPE_COUNT; a++) {
      const reach = Math.min(ARCHETYPE_SPEC[a]!.maxDist, maxF);
      const end = row.start[a + 1]!;
      for (let i = row.start[a]!; i < end; i++) {
        const o = i * PROP_STRIDE;
        const f = r * CHUNK_LEN + row.data[o + PropField.Z_LOCAL]! - at.local;
        if (f < 2 || f > reach) continue;
        out.push({ a, x: row.data[o + PropField.X]!, y: row.data[o + PropField.Y]!, f, scale: row.data[o + PropField.SCALE]! });
      }
    }
  }
  out.sort((p, q) => q.f - p.f);
  return out;
}

export interface ImpostorImage { rgb: Uint8Array; width: number; height: number }

/** Renders one frame at `at`. W * H pixels, 8-bit sRGB. */
export function renderImpostor(world: WorldSource, at: Readonly<Travel>, W: number, H: number): ImpostorImage {
  const zone = newZoneState();
  world.zoneAt(at, zone);
  const pal = zone.palette;
  const frame = new Float64Array(W * H * 3);
  const tanH = TAN_V * W / H;
  const tanPitch = Math.tan(CAMERA_PITCH);
  const sx = (gx: number): number => W / 2 + gx / tanH * (W / 2);
  const sy = (gy: number): number => H / 2 + (tanPitch - gy) / TAN_V * (H / 2);
  const gxOf = (px: number): number => ((px + 0.5) / W * 2 - 1) * tanH;
  const gyOf = (py: number): number => tanPitch - ((py + 0.5) / H * 2 - 1) * TAN_V;

  // Sky and disc.
  const c = [0, 0, 0];
  for (let py = 0; py < H; py++) {
    const gy = gyOf(py);
    for (let px = 0; px < W; px++) {
      const gx = gxOf(px);
      skyGrad(pal, gy / Math.hypot(gx, gy, 1), c);
      sunDisc(pal, gx, gy, c);
      const o = (py * W + px) * 3;
      frame[o] = c[0]!;
      frame[o + 1] = c[1]!;
      frame[o + 2] = c[2]!;
    }
  }

  const row = newPropRow();
  const props = collect(world, at, row, FOG_END);
  let next = 0;
  const fogColour = [0, 0, 0];
  skyGrad(pal, 0.002, fogColour);

  function paint(p: Placed): void {
    const spec = ARCHETYPE_SPEC[p.a]!;
    const colour = COLOUR[p.a]!;
    const fog = smoothstep(FOG_START, FOG_END, p.f);
    const shape = SHAPE[p.a]!;
    const halfW = Math.max(HALF_WIDTH[p.a]! * p.scale / p.f / tanH * (W / 2), 0.6);
    const cx = sx(p.x / p.f);
    const floats = spec.floats;
    const top = floats ? p.y + spec.top * p.scale : p.y + spec.top * p.scale;
    const bottom = floats ? p.y - spec.top * p.scale : p.y;
    const y0 = sy((top - CAMERA_Y) / p.f);
    const y1 = sy((bottom - CAMERA_Y) / p.f);
    const ix0 = Math.floor(cx - halfW);
    const ix1 = Math.ceil(cx + halfW);
    const iy0 = Math.floor(y0);
    const iy1 = Math.ceil(y1);
    const cyMid = (y0 + y1) / 2;
    const ry = Math.max((y1 - y0) / 2, 0.6);
    for (let py = Math.max(iy0, 0); py < Math.min(iy1, H); py++) {
      for (let px = Math.max(ix0, 0); px < Math.min(ix1, W); px++) {
        const u = (px + 0.5 - cx) / halfW;
        const v = (py + 0.5 - y0) / Math.max(y1 - y0, 1);
        let inside: boolean;
        let edge: boolean;
        if (shape === Shape.TRIANGLE) {
          inside = Math.abs(u) <= v;
          edge = inside && Math.abs(u) >= v - 2.2 / Math.max(halfW, 1);
        } else if (shape === Shape.ELLIPSE || shape === Shape.RING) {
          const dy = (py + 0.5 - cyMid) / ry;
          const dd = Math.hypot(u, dy);
          inside = dd <= 1;
          edge = inside && dd >= 1 - 2.2 / Math.max(Math.min(halfW, ry), 1);
          if (shape === Shape.RING && !edge) continue;
        } else {
          inside = true;
          edge = Math.abs(u) >= 1 - 1.4 / Math.max(halfW, 1) || py === iy0 || py === iy1 - 1;
        }
        if (!inside) continue;
        const k = edge ? 1 : 0.12;
        const o = (py * W + px) * 3;
        frame[o] = (colour[0] * k) * (1 - fog) + fogColour[0]! * fog;
        frame[o + 1] = (colour[1] * k) * (1 - fog) + fogColour[1]! * fog;
        frame[o + 2] = (colour[2] * k) * (1 - fog) + fogColour[2]! * fog;
      }
    }
  }

  // Terrain back to front, with props painted between the slices they fall in.
  const gridR = pal[15]!;
  const gridG = pal[16]!;
  const gridB = pal[17]!;
  const bodyR = pal[0]! * 0.7 + 0.004;
  const bodyG = pal[1]! * 0.7 + 0.004;
  const bodyB = pal[2]! * 0.7 + 0.004;
  for (let z = FOG_END; z > 2; z /= 1.012) {
    while (next < props.length && props[next]!.f >= z) paint(props[next++]!);
    const p = at.local + z;
    const fl = Math.floor(p / CHUNK_LEN);
    const chunk = at.chunk + fl;
    const zLocal = p - fl * CHUNK_LEN;
    const fog = smoothstep(FOG_START, FOG_END, z);
    const rowLine = z < 900 && (p % 8) < Math.max(z * 0.012, 0.5) ? 1 : 0;
    const lineFade = 1 - smoothstep(300, 900, z);
    for (let px = 0; px < W; px++) {
      const gx = gxOf(px);
      const x = gx * z;
      const h = world.height(x, chunk, CHUNK_LEN, zLocal);
      const top = Math.max(Math.floor(sy((h - CAMERA_Y) / z)), 0);
      const shade = 0.25 + 0.75 * clamp01(h / 260);
      const colLine = z < 900 && Math.abs(x % 8) < Math.max(z * 0.0025, 0.12) ? 1 : 0;
      const line = (rowLine || colLine ? 1 : 0) * lineFade * (h <= 0.001 ? 1 : 0.7);
      const road = Math.abs(x) <= 22 ? 0.35 : 1;
      const r = (bodyR * shade + gridR * line * road) * (1 - fog) + fogColour[0]! * fog;
      const g = (bodyG * shade + gridG * line * road) * (1 - fog) + fogColour[1]! * fog;
      const b = (bodyB * shade + gridB * line * road) * (1 - fog) + fogColour[2]! * fog;
      // Only this slice's strip, down to where the next nearer slice takes over, so the fill stays cheap.
      const bottom = Math.min(H, Math.ceil(sy((-CAMERA_Y) / z)) + 2);
      for (let py = top; py < bottom; py++) {
        const o = (py * W + px) * 3;
        frame[o] = r;
        frame[o + 1] = g;
        frame[o + 2] = b;
      }
    }
  }
  while (next < props.length) paint(props[next++]!);

  const rgb = new Uint8Array(W * H * 3);
  for (let i = 0; i < rgb.length; i++) rgb[i] = linearToByte(frame[i]!);
  return { rgb, width: W, height: H };
}

const DISC_N = 96;

/**
 * Fraction of the disc above the horizon that terrain over .5 u or grounded props cover, in gnomonic coordinates.
 * Floating props and SEARCHLIGHT do not occlude, and RING floats.
 */
export function discOcclusion(world: WorldSource, at: Readonly<Travel>): number {
  const covered = new Uint8Array(DISC_N * DISC_N);
  const gxAt = (i: number): number => HERO_X + ((i + 0.5) / DISC_N * 2 - 1) * HERO_R;
  const gyAt = (j: number): number => HERO_Y + ((j + 0.5) / DISC_N * 2 - 1) * HERO_R;
  // Terrain: per column, the highest gnomonic y any ground reaches.
  const ridge = new Float64Array(DISC_N).fill(-Infinity);
  for (let z = FOG_END; z > 2; z /= 1.012) {
    const p = at.local + z;
    const fl = Math.floor(p / CHUNK_LEN);
    const chunk = at.chunk + fl;
    const zLocal = p - fl * CHUNK_LEN;
    for (let i = 0; i < DISC_N; i++) {
      const h = world.height(gxAt(i) * z, chunk, CHUNK_LEN, zLocal);
      if (h > 0.5) {
        const gy = (h - CAMERA_Y) / z;
        if (gy > ridge[i]!) ridge[i] = gy;
      }
    }
  }
  for (let i = 0; i < DISC_N; i++) {
    for (let j = 0; j < DISC_N; j++) if (gyAt(j) <= ridge[i]!) covered[j * DISC_N + i] = 1;
  }
  // Grounded props.
  const row = newPropRow();
  const props = collect(world, at, row, FOG_END);
  for (const p of props) {
    const spec = ARCHETYPE_SPEC[p.a]!;
    if (spec.floats || p.a === Archetype.SEARCHLIGHT) continue;
    const halfW = HALF_WIDTH[p.a]! * p.scale / p.f;
    const gx = p.x / p.f;
    if (gx + halfW < -HERO_R || gx - halfW > HERO_R) continue;
    const gyTop = (p.y + spec.top * p.scale - CAMERA_Y) / p.f;
    const gyBase = (p.y - CAMERA_Y) / p.f;
    if (gyTop < 0) continue;
    const triangle = SHAPE[p.a] === Shape.TRIANGLE;
    for (let i = 0; i < DISC_N; i++) {
      const dx = Math.abs(gxAt(i) - gx);
      if (dx > halfW) continue;
      const limit = triangle ? gyTop - (dx / halfW) * (gyTop - gyBase) : gyTop;
      for (let j = 0; j < DISC_N; j++) {
        const gy = gyAt(j);
        if (gy > limit) break;
        if (gy >= gyBase) covered[j * DISC_N + i] = 1;
      }
    }
  }
  let inside = 0;
  let hit = 0;
  for (let j = 0; j < DISC_N; j++) {
    const gy = gyAt(j);
    if (gy <= 0) continue;
    for (let i = 0; i < DISC_N; i++) {
      if (Math.hypot(gxAt(i) - HERO_X, gy - HERO_Y) > HERO_R) continue;
      inside++;
      if (covered[j * DISC_N + i] === 1) hit++;
    }
  }
  return hit / inside;
}
