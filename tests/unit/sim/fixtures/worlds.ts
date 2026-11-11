// Worlds for T02's tests. None imports src/world: lint forbids it, and T01 tuning must not be able to flip a golden hash.
import {
  CHUNK_LEN, ItemKind, ITEM_STRIDE, MAX_ITEMS_PER_CHUNK, Objective, ZONE_CHUNKS,
  type BendState, type ItemRow, type PropRow, type Travel, type WorldSource, type ZoneState,
} from '../../../../src/contracts/index';
import { createItemRow } from '../../../../src/core/alloc';
import { hash01 } from '../../../../src/core/hash';

const TAU = 2 * Math.PI;
const UNIT_MAX = 0.99999994;

export interface ScriptedItem { kind: number; x: number; y: number; z: number; radius: number; a?: number; b?: number; seed?: number }
export interface ScriptedZone { index?: number; objective?: Objective; objectiveTarget?: number }

function put(out: ItemRow, n: number, kind: number, x: number, y: number, z: number, radius: number, a: number, b: number, seed: number): number {
  if (n >= MAX_ITEMS_PER_CHUNK) return n;
  const o = n * ITEM_STRIDE;
  const d = out.data;
  d[o] = kind; d[o + 1] = x; d[o + 2] = y; d[o + 3] = z; d[o + 4] = radius; d[o + 5] = a; d[o + 6] = b; d[o + 7] = seed;
  return n + 1;
}

function writeZone(chunk: number, out: ZoneState, zone?: ScriptedZone): ZoneState {
  out.index = zone?.index ?? Math.floor(chunk / ZONE_CHUNKS);
  out.objective = zone?.objective ?? Objective.GATES;
  out.objectiveTarget = zone?.objectiveTarget ?? 10;
  return out;
}

function base(fillItems: (chunk: number, out: ItemRow) => void, zoneAt: (at: Readonly<Travel>, out: ZoneState) => ZoneState): WorldSource {
  return {
    seed: 1,
    height: () => 0,
    fillProps(chunk: number, out: PropRow): void { out.chunk = chunk; },
    fillItems,
    zoneAt,
    bendAt(_at: Readonly<Travel>, out: BendState): BendState { out.a = 0; out.c = -1.2e-5; out.vMax = 1500; return out; },
  };
}

export function emptyWorld(): WorldSource {
  return base((chunk, out) => { out.chunk = chunk; out.count = 0; }, (at, out) => writeZone(at.chunk, out));
}

export function scriptedWorld(rows: (chunk: number) => readonly ScriptedItem[], zones?: (chunk: number) => ScriptedZone): WorldSource {
  return base((chunk, out) => {
    out.chunk = chunk;
    let n = 0;
    for (const it of rows(chunk)) n = put(out, n, it.kind, it.x, it.y, it.z, it.radius, it.a ?? 0, it.b ?? 0, it.seed ?? 0.5);
    out.count = n;
  }, (at, out) => writeZone(at.chunk, out, zones?.(at.chunk)));
}

export interface GauntletOptions { seed: number; density: number; gateRadius?: number }

/** The rehearsal's synthetic world, kept exact so its numbers mean something (T02 section 5, M4). */
export function gauntletWorld({ seed, density, gateRadius = 7 }: GauntletOptions): WorldSource {
  const gx = (g: number): number => 28 * (2 * hash01(seed, g, 901, 0) - 1);
  const gy = (g: number): number => 6 + 4 * hash01(seed, g, 902, 0);
  return base((chunk, out) => {
    out.chunk = chunk;
    const h = (a: number, i: number): number => hash01(seed, chunk, a, i);
    const s = (kind: number, i: number): number => Math.min(hash01(seed, chunk, 10 + kind, i), UNIT_MAX);
    const g = Math.floor(chunk / 3);
    const m = ((chunk % 3) + 3) % 3;
    let n = 0;
    const x0 = gx(g);
    const x1 = gx(g + 1);
    const y0 = gy(g);
    const y1 = gy(g + 1);
    const first = (12 - ((m * CHUNK_LEN) % 12)) % 12;
    for (let z = first, i = 0; z < CHUNK_LEN && i < 12; z += 12, i++) {
      if (h(2, i) >= 0.45) continue;
      const u = (m * CHUNK_LEN + z) / 192;
      const w = u * u * (3 - 2 * u);
      n = put(out, n, ItemKind.SHARD, x0 + (x1 - x0) * w + 6 * Math.sin(TAU * 2 * u), y0 + (y1 - y0) * w, z, 2.5, 0, 0, s(ItemKind.SHARD, i));
    }
    if (m === 0) n = put(out, n, ItemKind.GATE, x0, y0, 0, gateRadius, 0, 0, s(ItemKind.GATE, 0));
    const spikes = Math.floor(density * 4 * h(6, 0) + 0.3);
    for (let i = 0; i < spikes; i++) {
      n = put(out, n, ItemKind.SPIKE, 38 * (2 * h(7, i) - 1), 2 + 12 * h(8, i), 4 + 56 * h(9, i), 2.2, 0, 0, s(ItemKind.SPIKE, i));
    }
    if (m === 1 && h(11, 0) < density * 0.8) {
      n = put(out, n, ItemKind.FENCE, 0, 8, 32, 40, 30 * (2 * h(12, 0) - 1), 7 + 4 * h(13, 0), s(ItemKind.FENCE, 0));
    }
    const drones = Math.floor(density * 3 * h(15, 0) + 0.2);
    for (let i = 0; i < drones; i++) {
      n = put(out, n, ItemKind.DRONE, 28 * (2 * h(16, i) - 1), 3 + 10 * h(17, i), 4 + 56 * h(18, i), 2.5, 5 + 7 * h(19, i), 1, s(ItemKind.DRONE, i));
    }
    const cars = Math.floor(density * 4 * h(21, 0) + 0.2);
    const lanes = [-16, -6, 6, 16] as const;
    for (let i = 0; i < cars; i++) {
      const lane = lanes[Math.floor(4 * h(22, i))]!;
      n = put(out, n, ItemKind.TRAFFIC, lane, 3, 4 + 56 * h(23, i), 3.5, 128, 30 + Math.floor(20 * h(24, i)), s(ItemKind.TRAFFIC, i));
    }
    out.count = n;
  }, (at, out) => writeZone(at.chunk, out, { objective: Math.floor(at.chunk / ZONE_CHUNKS) % 5 as Objective }));
}

/** 32 hazards per chunk across the play box, so shields always run out. */
export function carpetWorld(): WorldSource {
  return base((chunk, out) => {
    out.chunk = chunk;
    let n = 0;
    for (let i = 0; i < MAX_ITEMS_PER_CHUNK; i++) {
      n = put(out, n, ItemKind.SPIKE, -40 + (80 * (i % 8 + 0.5)) / 8, 8, i * 2, 8, 0, 0, 0.5);
    }
    out.count = n;
  }, (at, out) => writeZone(at.chunk, out));
}

/** NaN, Infinity, negative and zero radius, kind 99, objectiveTarget 0, and a zone index that changes every chunk. */
export function poisonWorld(): WorldSource {
  return base((chunk, out) => {
    out.chunk = chunk;
    const m = ((chunk % 4) + 4) % 4;
    let n = 0;
    n = put(out, n, 99, 0, 8, 2, 5, 0, 0, 0.5);
    n = put(out, n, ItemKind.SHARD, NaN, 8, 4, 2, 0, 0, 0.5);
    n = put(out, n, ItemKind.SHARD, 0, Infinity, 6, Infinity, 0, 0, 0.5);
    n = put(out, n, ItemKind.GATE, 0, 8, 8, -3, 0, 0, 0.5);
    n = put(out, n, ItemKind.GATE, 0, 8, 10, 0, m === 0 ? 1 : 0, 0, 0.5);
    n = put(out, n, ItemKind.SPIKE, 0, NaN, 12, 3, 0, 0, 0.5);
    n = put(out, n, ItemKind.SPIKE, Infinity, 8, 14, -Infinity, 0, 0, 0.5);
    n = put(out, n, ItemKind.SPIKE, 0, 8, NaN, 3, 0, 0, 0.5);
    n = put(out, n, ItemKind.FENCE, 0, 8, 18, 40, NaN, NaN, 0.5);
    n = put(out, n, ItemKind.FENCE, NaN, 8, 20, -1, 0, 1e30, 0.5);
    n = put(out, n, ItemKind.DRONE, 0, 8, 22, 2, NaN, 1, NaN);
    n = put(out, n, ItemKind.DRONE, 0, 8, 24, 0, Infinity, Infinity, 0.5);
    n = put(out, n, ItemKind.TRAFFIC, 0, 3, 26, 3, Infinity, 40, 0.5);
    n = put(out, n, ItemKind.TRAFFIC, 0, 3, 28, 3, NaN, NaN, NaN);
    n = put(out, n, ItemKind.TRAFFIC, 0, 3, 30, 3, -128, -40, 0.5);
    out.count = n;
  }, (at, out) => writeZone(at.chunk, out, { index: at.chunk, objective: (at.chunk % 5) as Objective, objectiveTarget: 0 }));
}

/** Precomputed rows copied with set, so the world side of a measurement allocates nothing. */
export function frozenWorld(inner: WorldSource, period = 1024): WorldSource {
  const rows: ItemRow[] = [];
  for (let c = 0; c < period; c++) {
    const r = createItemRow();
    inner.fillItems(c, r);
    rows.push(r);
  }
  const zone = inner.zoneAt({ chunk: 0, local: 0 }, createZoneScratch());
  return base((chunk, out) => {
    const r = rows[((chunk % period) + period) % period]!;
    out.chunk = chunk;
    out.data.set(r.data);
    out.count = r.count;
  }, (at, out) => {
    out.index = Math.floor(at.chunk / ZONE_CHUNKS);
    out.objective = zone.objective;
    out.objectiveTarget = zone.objectiveTarget;
    return out;
  });
}

function createZoneScratch(): ZoneState {
  return {
    index: 0, biomeA: 0, biomeB: 0, biomeMix: 0, paletteA: 0, paletteB: 0, paletteMix: 0, palette: new Float32Array(21),
    heroA: 0, heroB: 0, heroMix: 0, objective: Objective.GATES, objectiveTarget: 0, musicKey: 0, dayPhase: 0,
  };
}

export interface CountingWorld extends WorldSource { fillItemsCalls: number; zoneAtCalls: number }

export function countingWorld(inner: WorldSource): CountingWorld {
  const w: CountingWorld = {
    ...inner,
    fillItemsCalls: 0,
    zoneAtCalls: 0,
    fillItems(chunk, out): void { w.fillItemsCalls += 1; inner.fillItems(chunk, out); },
    zoneAt(at, out): ZoneState { w.zoneAtCalls += 1; return inner.zoneAt(at, out); },
  };
  return w;
}

export function throwingWorld(inner: WorldSource, chunk: number): WorldSource {
  return {
    ...inner,
    fillItems(c, out): void {
      if (c === chunk) throw new Error(`throwingWorld: chunk ${c}`);
      inner.fillItems(c, out);
    },
  };
}

/** The sim must never ask for the bend or the terrain. */
export function noBendWorld(inner: WorldSource): WorldSource {
  return {
    ...inner,
    height(): number { throw new Error('noBendWorld: height called'); },
    bendAt(): BendState { throw new Error('noBendWorld: bendAt called'); },
  };
}
