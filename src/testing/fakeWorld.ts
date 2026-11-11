// A flat valley with simple hills, good enough to judge a look and to test against. Pure and allocation-free,
// and imports no three, so T07's and T08's three-free pages can load it. Not a stub of T01: no real noise,
// palette crossfade or biome. Records follow PropField, ItemField and T01's RING, PYLON and GATE rows (S-07).
import {
  ARCHETYPE_COUNT, ARCHETYPE_SPEC, Archetype, BIOME_COUNT, CHUNK_LEN, ITEM_KIND_COUNT, ITEM_SPEC, ITEM_STRIDE, ItemField, ItemKind,
  MAX_ITEMS_PER_CHUNK, PALETTE_COUNT, PALETTE_FLOATS, PROP_STRIDE, PropField, WORLD_PERIOD, ZONE_CHUNKS, DAY_CHUNKS,
  Objective,
  type BendState, type ItemRow, type PropRow, type Travel, type WorldSource, type ZoneState,
} from '../contracts/index';
import { travelMod } from '../core/coords';
import { hash01 } from '../core/hash';

const TAU = 2 * Math.PI;
/** The largest values below 1 and below CHUNK_LEN that survive Float32 storage, so [0, 1) and [0, 64) stay true. */
const UNIT_MAX = 0.99999994;
const ZLOCAL_MAX = 63.999996;

export interface FakeWorldOptions { seed?: number; periodChunks?: number; archetypes?: readonly Archetype[]; items?: readonly ItemKind[] }

function smooth(x: number): number {
  const t = x <= 0 ? 0 : x >= 1 ? 1 : x;
  return t * t * (3 - 2 * t);
}

function floorMod(a: number, m: number): number {
  return ((a % m) + m) % m;
}

function unit(v: number): number {
  return Math.min(v, UNIT_MAX);
}

/** The six section 6.8 tables, in sRGB: top, mid, horizon, discTop, discBottom, grid, accent. */
const PALETTE_HEX: readonly (readonly number[])[] = [
  [0x0d0221, 0x3a0f6b, 0xfd3777, 0xffd319, 0xf6019d, 0xf6019d, 0x2de2e6],   // Sunset Drive
  [0x120458, 0x7a04eb, 0xff2a6d, 0xffe66d, 0xff6c11, 0x05d9e8, 0xff2a6d],   // Miami Dusk
  [0x03001c, 0x301e67, 0x8a2be2, 0xe0d4ff, 0x7b2ff7, 0xb026ff, 0x00ffc8],   // Ultraviolet
  [0x020f0d, 0x0b3d2e, 0x00ff9f, 0xd1f7ff, 0x00b8ff, 0x00ff9f, 0xff00a0],   // Toxic Arcade
  [0x1a0005, 0x5c0a2e, 0xff4500, 0xffb000, 0xff0054, 0xff0054, 0xffb000],   // Ember
  [0x020b2e, 0x0f3c8c, 0x7df9ff, 0xd8f6ff, 0x4cc9f0, 0x4cc9f0, 0xf72585],   // Arctic Laser
];

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function buildPalette(hex: readonly number[]): Float32Array {
  const out = new Float32Array(PALETTE_FLOATS);
  hex.forEach((h, i) => {
    out[i * 3] = srgbToLinear(((h >> 16) & 255) / 255);
    out[i * 3 + 1] = srgbToLinear(((h >> 8) & 255) / 255);
    out[i * 3 + 2] = srgbToLinear((h & 255) / 255);
  });
  return out;
}

const PALETTES_LINEAR: readonly Float32Array[] = PALETTE_HEX.map(buildPalette);

/** Writes a section 6.8 table, converted to linear, into out. index is reduced modulo PALETTE_COUNT. */
export function writeFakePalette(index: number, out: Float32Array): void {
  out.set(PALETTES_LINEAR[floorMod(index, PALETTE_COUNT)]!);
}

/** Small archetypes stand beside the road; the rest stand on the slopes. */
function isSmall(a: number): boolean {
  return a === Archetype.PALM || a === Archetype.REFLECTOR || a === Archetype.CHEVRON || a === Archetype.CACTUS
    || a === Archetype.TOTEM || a === Archetype.COLONNADE || a === Archetype.BILLBOARD || a === Archetype.ORB;
}

/** Constant hover for the floating types, in u above the true height. */
function hoverOf(a: number): number {
  if (a === Archetype.ORB) return 6;
  if (a === Archetype.CRYSTAL) return 8;
  if (a === Archetype.SAUCER) return 40;
  return 0;
}

/** Rows without a pylon pair, so a line starts and stops and the wire flag has both values. */
function pylonRow(chunk: number): boolean {
  return floorMod(chunk, 32) < 28;
}

const TRAFFIC_LANES = [-15, -7, 7, 15] as const;
const TRAFFIC_TRAVEL = [64, 96, 128] as const;
const TRAFFIC_K = [100, 64, 48] as const;   // a * k / 256 stays in 20 to 40 u/s

/** The fake world's seed when none is given. It stays 1985 when the product's DEFAULT_SEED moves (DI-102), so every
 * dev page, baseline and fixture calibrated on a fake world keeps its scene. */
export const FAKE_SEED = 1985;

export function createFakeWorld(o: FakeWorldOptions = {}): WorldSource {
  const seed = o.seed ?? FAKE_SEED;
  const period = o.periodChunks ?? 0;
  const allowProp = new Array<boolean>(ARCHETYPE_COUNT).fill(o.archetypes === undefined);
  for (const a of o.archetypes ?? []) allowProp[a] = true;
  const allowItem = new Array<boolean>(ITEM_KIND_COUNT).fill(o.items === undefined);
  for (const k of o.items ?? []) allowItem[k] = true;

  function reduce(chunk: number): number {
    return period > 0 ? floorMod(chunk, period) : chunk;
  }

  function height(x: number, iz: number, zs: number, zLocal: number): number {
    const d = Math.abs(x);
    const k = smooth((d - 85) / 430);
    if (k === 0) return 0;
    let row = iz;
    if (period > 0) {
      const rows = (period * CHUNK_LEN) / zs;
      row = floorMod(row, rows);
    }
    const p = WORLD_PERIOD / zs;
    const z = (((row % p) + p) % p) * zs + zLocal;
    return k * (135 + 250 * smooth((d - 260) / 1100))
      * (0.5 + 0.2 * Math.sin((TAU * x) / 1024) * Math.sin((TAU * z) / 2048) + 0.08 * Math.sin((TAU * x) / 256) * Math.sin((TAU * z) / 512));
  }

  function writeProp(data: Float32Array, at: number, x: number, y: number, zLocal: number, yaw: number, scale: number, keep: number, tintSeed: number, variant: number): void {
    data[at + PropField.X] = x;
    data[at + PropField.Y] = y;
    data[at + PropField.Z_LOCAL] = zLocal;
    data[at + PropField.YAW] = yaw;
    data[at + PropField.SCALE] = scale;
    data[at + PropField.KEEP] = keep;
    data[at + PropField.TINT_SEED] = tintSeed;
    data[at + PropField.VARIANT] = variant;
  }

  function fillProps(chunk: number, out: PropRow): void {
    out.chunk = chunk;
    out.data.fill(0);
    const c = reduce(chunk);
    let n = 0;
    for (let a = 0; a < ARCHETYPE_COUNT; a++) {
      out.start[a] = n;
      if (!allowProp[a]) continue;
      if (a === Archetype.RING) {
        if (floorMod(c, 48) === 0) {
          writeProp(out.data, n * PROP_STRIDE, 0, 65.14, 32, 0, 1, 0, unit(hash01(seed, c, a, 0)), unit(hash01(seed, c, a, 1)));
          n++;
        }
        continue;
      }
      if (a === Archetype.PYLON) {
        if (pylonRow(c)) {
          const variant = pylonRow(reduce(c + 1)) ? 0.75 : 0.25;
          writeProp(out.data, n * PROP_STRIDE, -100, 0, 0, 0, 1, 0.1, unit(hash01(seed, c, a, 0)), variant);
          n++;
          writeProp(out.data, n * PROP_STRIDE, 100, 0, 0, 0, 1, 0.6, unit(hash01(seed, c, a, 1)), variant);
          n++;
        }
        continue;
      }
      const count = ARCHETYPE_SPEC[a]!.perChunk;
      const small = isSmall(a);
      for (let i = 0; i < count; i++) {
        const salt = i * 8;
        const side = hash01(seed, c, a, salt) < 0.5 ? -1 : 1;
        const u = hash01(seed, c, a, salt + 1);
        const x = side * (small ? 44 + 41 * u : 120 + 380 * u);
        // Stratified, so zLocal is non-decreasing inside an archetype.
        const zLocal = Math.min(((i + hash01(seed, c, a, salt + 2)) * CHUNK_LEN) / count, ZLOCAL_MAX);
        const y = height(x, c, CHUNK_LEN, zLocal) + hoverOf(a);
        const yaw = hash01(seed, c, a, salt + 3) * TAU;
        const scale = 0.8 + 0.4 * hash01(seed, c, a, salt + 4);
        writeProp(out.data, n * PROP_STRIDE, x, y, zLocal, yaw, scale,
          unit(hash01(seed, c, a, salt + 5)), unit(hash01(seed, c, a, salt + 6)), unit(hash01(seed, c, a, salt + 7)));
        n++;
      }
    }
    out.start[ARCHETYPE_COUNT] = n;
  }

  function writeItem(data: Float32Array, at: number, kind: number, x: number, y: number, zLocal: number, radius: number, a: number, b: number, itemSeed: number): void {
    data[at + ItemField.KIND] = kind;
    data[at + ItemField.X] = x;
    data[at + ItemField.Y] = y;
    data[at + ItemField.Z_LOCAL] = zLocal;
    data[at + ItemField.RADIUS] = radius;
    data[at + ItemField.A] = a;
    data[at + ItemField.B] = b;
    data[at + ItemField.SEED] = itemSeed;
  }

  function fillItems(chunk: number, out: ItemRow): void {
    out.chunk = chunk;
    out.data.fill(0);
    const c = reduce(chunk);
    const gateRow = floorMod(c, 3) === 0;
    let n = 0;
    // Records ascend by kind, then zLocal: each loop below walks zLocal upward.
    if (allowItem[ItemKind.SHARD]) {
      // World 12 u lattice: first value 0, 8, 4 for chunk % 3 = 0, 1, 2.
      const first = (12 - 4 * floorMod(c, 3)) % 12;
      const lane = -24 + 48 * hash01(seed, c, 100, 0);
      for (let z = first, i = 0; z < CHUNK_LEN && i < ITEM_SPEC[ItemKind.SHARD].perChunk; z += 12, i++) {
        const y = 5.5 + 5 * hash01(seed, c, 100, i + 1);
        writeItem(out.data, n * ITEM_STRIDE, ItemKind.SHARD, lane, y, z, 2.5, 0, 0, unit(hash01(seed, c, 101, i)));
        n++;
      }
    }
    if (allowItem[ItemKind.GATE] && gateRow) {
      writeItem(out.data, n * ITEM_STRIDE, ItemKind.GATE, -26 + 52 * hash01(seed, c, 102, 0), 8, 0, 9, 0, 0, unit(hash01(seed, c, 102, 1)));
      n++;
    }
    if (allowItem[ItemKind.SPIKE]) {
      const count = hash01(seed, c, 103, 0) < 0.35 ? 2 : 0;
      for (let i = 0; i < count; i++) {
        const zLocal = Math.min(16 + ((i + hash01(seed, c, 103, i + 1)) * 48) / count, ZLOCAL_MAX);
        const x = -40 + 80 * hash01(seed, c, 104, i);
        writeItem(out.data, n * ITEM_STRIDE, ItemKind.SPIKE, x, 3.5, zLocal, 3.5, 0, 0, unit(hash01(seed, c, 105, i)));
        n++;
      }
    }
    if (allowItem[ItemKind.FENCE] && !gateRow && hash01(seed, c, 106, 0) < 0.25) {
      const zLocal = 8 + 48 * hash01(seed, c, 106, 1);
      const gapX = -28 + 56 * hash01(seed, c, 106, 2);
      writeItem(out.data, n * ITEM_STRIDE, ItemKind.FENCE, 0, 8, zLocal, 42, gapX, 12, unit(hash01(seed, c, 106, 3)));
      n++;
    }
    if (allowItem[ItemKind.DRONE] && hash01(seed, c, 107, 0) < 0.25) {
      const amp = 3 + 5 * hash01(seed, c, 107, 1);
      const x = -30 + 60 * hash01(seed, c, 107, 2);
      const y = 5 + 7 * hash01(seed, c, 107, 3);
      const zLocal = Math.min(CHUNK_LEN * hash01(seed, c, 107, 4), ZLOCAL_MAX);
      writeItem(out.data, n * ITEM_STRIDE, ItemKind.DRONE, x, y, zLocal, 2.5, amp, 1, unit(hash01(seed, c, 107, 5)));
      n++;
    }
    if (allowItem[ItemKind.TRAFFIC] && hash01(seed, c, 108, 0) < 0.25) {
      const lane = TRAFFIC_LANES[Math.floor(hash01(seed, c, 108, 1) * TRAFFIC_LANES.length)]!;
      const pick = Math.floor(hash01(seed, c, 108, 2) * TRAFFIC_TRAVEL.length);
      const zLocal = Math.min(CHUNK_LEN * hash01(seed, c, 108, 3), ZLOCAL_MAX);
      writeItem(out.data, n * ITEM_STRIDE, ItemKind.TRAFFIC, lane, 2.5, zLocal, 3, TRAFFIC_TRAVEL[pick]!, TRAFFIC_K[pick]!, unit(hash01(seed, c, 108, 4)));
      n++;
    }
    out.count = Math.min(n, MAX_ITEMS_PER_CHUNK);
  }

  function zoneAt(at: Readonly<Travel>, out: ZoneState): ZoneState {
    const c = reduce(at.chunk);
    const index = Math.floor(c / ZONE_CHUNKS);
    out.index = index;
    out.biomeA = out.biomeB = floorMod(index, BIOME_COUNT);
    out.biomeMix = 0;
    out.paletteA = out.paletteB = floorMod(index, PALETTE_COUNT);
    out.paletteMix = 0;
    writeFakePalette(index, out.palette);
    out.heroA = out.heroB = 0;
    out.heroMix = 0;
    out.objective = floorMod(index, 5) as Objective;
    out.objectiveTarget = 10;
    out.musicKey = floorMod(index, 12);
    out.dayPhase = floorMod(c, DAY_CHUNKS) / DAY_CHUNKS;
    return out;
  }

  const reduced: Travel = { chunk: 0, local: 0 };

  function bendAt(at: Readonly<Travel>, out: BendState): BendState {
    reduced.chunk = reduce(at.chunk);
    reduced.local = at.local;
    out.a = 8e-5 * (0.7 * Math.sin((TAU * travelMod(reduced, 16384)) / 16384) + 0.3 * Math.sin((TAU * travelMod(reduced, 65536)) / 65536));
    out.c = -1.2e-5;
    out.vMax = 1500;
    return out;
  }

  return { seed, height, fillProps, fillItems, zoneAt, bendAt };
}
