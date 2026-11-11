// src/world/items.ts -- section 5.8. One row of gameplay records, a pure function of (seed, chunk). Hazards keep clear of
// the lane by construction, so a straight line between lane nodes, in x and in height (DI-118), threads every gate and misses
// every hazard (T02's autopilot depends on it). Hazard rates live here, not in biomes.ts: section 12 does not give them to T11.
// Hot path: hash draws reach the body through the D register, so no double crosses a non-inlined call.
import {
  Biome, CHUNK_LEN, ITEM_SPEC, ITEM_STRIDE, ItemField, ItemKind, ZONE_CHUNKS, ZONE_FADE_CHUNKS,
  type ItemRow,
} from '../contracts/index';
import { drawInto } from './draws';
import { laneHeightPair, laneNodePair } from './lanes';
import { DIFFICULTY_CAP_ZONE, floorMod, type Zones } from './zones';

const TAU = 2 * Math.PI;
const UNIT_MAX = 0.99999994;
const ZLOCAL_MAX = 63.99999;
const BASE_SALT = 0x6000;
const NODE_CHUNKS = 3;
const NODE_SPAN = NODE_CHUNKS * CHUNK_LEN;
const LATTICE = 12;
const LATTICE_PER_INTERVAL = 16;
const RAIL = 5;
const FADE_START = ZONE_CHUNKS - ZONE_FADE_CHUNKS;

/** The checkpoint arch's height, and the fence record's. Gates and shards follow the lane's own height since DI-118. */
const ROAD_Y = 8;
const SHARD_RADIUS = 2.5;
/**
 * DI-118: 9 until the operator's swooping path. At the lane's heights, 8 to 13, a gate's inner rim is 0 to 5 u off the floor, so
 * the high gates float and the low ones touch the road. Smaller rings float higher but alias more: with the heights, A16b's props
 * shimmer share read .222 at radius 6 and .200 at 7, against its .2 limit; 8 reads .184, and the old road .10. A unit higher
 * throughout, at 8, also read .200.
 */
const GATE_RADIUS = 8;
const CHECKPOINT_RADIUS = 42;
const SPIKE_RADIUS = 3.5;
const SPIKE_CLEAR = 8.5;
const SPIKE_SPREAD = 12;
const SPIKE_X_MAX = 38;
const SPIKE_MIN_Z_AFTER_GATE = 16;
const FENCE_RADIUS = 42;
const FENCE_LANE_MAX = 28;
const FENCE_MIN_GAP = 24;
const FENCE_Z_BEFORE_GATE = 32;
const DRONE_RADIUS = 2.5;
/**
 * Clear distance from the lane to a drone's swing, centre to centre. Section 4 asks for radius + 3. A straight line between
 * nodes strays up to 2.5 u from the lane and the ship is up to 2 u wide, so radius + 4.5 is what the road's promise needs.
 */
const DRONE_CLEAR = DRONE_RADIUS + 4.5;
const DRONE_SPREAD = 6;
const DRONE_X_LIMIT = 40;
const TRAFFIC_RADIUS = 3;
const TRAFFIC_Y = 2.5;
const LANE_POS = [-15, -7, 7, 15] as const;
const TRAVELS = [64, 96, 128] as const;
const TRAFFIC_SPEED_MIN = 21;
const TRAFFIC_SPEED_SPAN = 18;
const TRAFFIC_K_UNIT = 256;

const SPIKE_CAP = ITEM_SPEC[ItemKind.SPIKE]!.perChunk;
const FENCE_CAP = ITEM_SPEC[ItemKind.FENCE]!.perChunk;
const DRONE_CAP = ITEM_SPEC[ItemKind.DRONE]!.perChunk;
const TRAFFIC_CAP = ITEM_SPEC[ItemKind.TRAFFIC]!.perChunk;

// Hoisted from the imports. This is the per-sample path, and every read of an imported binding is a getter on a module
// object under Vitest's transform, which measured 3 to 5 times slower than the same code in a plain bundle.
const I_KIND = ItemField.KIND;
const I_X = ItemField.X;
const I_Y = ItemField.Y;
const I_Z = ItemField.Z_LOCAL;
const I_RADIUS = ItemField.RADIUS;
const I_A = ItemField.A;
const I_B = ItemField.B;
const I_SEED = ItemField.SEED;
const K_SHARD = ItemKind.SHARD;
const K_GATE = ItemKind.GATE;
const K_SPIKE = ItemKind.SPIKE;
const K_FENCE = ItemKind.FENCE;
const K_DRONE = ItemKind.DRONE;
const K_TRAFFIC = ItemKind.TRAFFIC;
const STRIDE = ITEM_STRIDE;
const CHUNK = CHUNK_LEN;
const ZONE = ZONE_CHUNKS;
const FADE = ZONE_FADE_CHUNKS;
const BOULEVARD = Biome.BOULEVARD;
const CAP_ZONE = DIFFICULTY_CAP_ZONE;
const draw = drawInto;
const lanePair = laneNodePair;
const heightPair = laneHeightPair;


export function createItems(seed: number, periodChunks: number, zones: Zones): (chunk: number, out: ItemRow) => void {
  const D = new Float64Array(8);
  const G = new Float64Array(9);
  // Registers: reduced chunk, zone, node, and the chunk after this one.
  const C = new Float64Array(4);
  // Zone memo: z, biome A, biome B.
  const zoneMemo = new Float64Array(3).fill(NaN);

  function lanesAt(): void {
    G[0] = C[2]!;
    lanePair(seed, G);
    heightPair(seed, G);
  }
  function biomesOf(): void {
    const z = C[1]!;
    if (zoneMemo[0] === z) return;
    zoneMemo[0] = z;
    zones.biomePair(zoneMemo);
  }
  /** Does the chunk in register reg hold an arch? */
  function hasArch(reg: number): boolean {
    const c = C[reg]!;
    return c % NODE_CHUNKS === 0 || c % ZONE === 0;
  }

  return function fillItems(chunk: number, out: ItemRow): void {
    const data = out.data;
    const c = periodChunks > 0 ? floorMod(chunk, periodChunks) : chunk;
    C[0] = c;
    const zi = Math.floor(c / ZONE);
    C[1] = zi;
    biomesOf();
    const d = Math.max(Math.min(zi, CAP_ZONE), 0) / CAP_ZONE;
    const node = Math.floor(c / NODE_CHUNKS);
    C[2] = node;
    const zBase = (c - node * NODE_CHUNKS) * CHUNK;
    lanesAt();
    const g0 = G[1]!;
    const dg = G[2]! - g0;
    const h0 = G[6]!;
    const dh = G[7]! - h0;
    const archHere = hasArch(0);
    let w = 0;

    // ---- SHARD: on the world 12 u lattice, so a chunk's first is 0, 8, 4 for chunk % 3 = 0, 1, 2. At most 12 per chunk.
    // The pattern belongs to the interval, so it is keyed by node, not by chunk.
    draw(seed, C, 2, BASE_SALT, 0, D, 0, 1);
    const pattern = Math.floor(D[0]! * 4);
    for (let z = (LATTICE - (zBase % LATTICE)) % LATTICE; z < CHUNK; z += LATTICE) {
      const j = (zBase + z) / LATTICE;
      if (pattern === 1 && j % 2 !== 0) continue;
      const t = (zBase + z) / NODE_SPAN;
      const ease = t * t * (3 - 2 * t);
      const lane = g0 + dg * ease;
      const y = h0 + dh * ease + (pattern === 2 ? 2.5 * Math.sin(TAU * j / LATTICE_PER_INTERVAL) : 0);
      const copies = pattern === 3 ? 2 : 1;
      draw(seed, C, 0, BASE_SALT, 1 + j * 2, D, 0, copies);
      for (let q = 0; q < copies; q++) {
        const o = w * STRIDE;
        data[o + I_KIND] = K_SHARD;
        data[o + I_X] = pattern === 3 ? (q === 0 ? lane - RAIL : lane + RAIL) : lane;
        data[o + I_Y] = y;
        data[o + I_Z] = z;
        data[o + I_RADIUS] = SHARD_RADIUS;
        data[o + I_A] = 0;
        data[o + I_B] = 0;
        data[o + I_SEED] = Math.min(D[q]!, UNIT_MAX);
        w++;
      }
    }

    // ---- GATE: a checkpoint arch at c % 100 === 0 takes the place of a normal gate.
    if (archHere) {
      const checkpoint = c % ZONE === 0;
      draw(seed, C, 0, BASE_SALT + K_GATE, 0, D, 0, 1);
      const o = w * STRIDE;
      data[o + I_KIND] = K_GATE;
      data[o + I_X] = checkpoint ? 0 : g0;
      // Two stores, not a conditional: a conditional of the integer ROAD_Y and the double h0 is boxed (5.3 B a row, perf.test).
      if (checkpoint) data[o + I_Y] = ROAD_Y;
      else data[o + I_Y] = h0;
      data[o + I_Z] = 0;
      data[o + I_RADIUS] = checkpoint ? CHECKPOINT_RADIUS : GATE_RADIUS;
      data[o + I_A] = checkpoint ? 1 : 0;
      data[o + I_B] = 0;
      data[o + I_SEED] = Math.min(D[0]!, UNIT_MAX);
      w++;
    }

    // ---- SPIKE: at least radius + 5 from the lane at its z, on the outer side when the lane is off-centre.
    {
      const salt = BASE_SALT + K_SPIKE;
      draw(seed, C, 0, salt, 0, D, 0, 1);
      let n = Math.floor(0.4 + 1.6 * d + D[0]!);
      if (n > SPIKE_CAP) n = SPIKE_CAP;
      const lo = archHere ? SPIKE_MIN_Z_AFTER_GATE : 0;
      for (let i = 0; i < n; i++) {
        draw(seed, C, 0, salt, 8 + i * 8, D, 0, 4);
        const z = Math.fround(Math.min(lo + (i + D[0]!) / n * (CHUNK - lo), ZLOCAL_MAX));
        const t = (zBase + z) / NODE_SPAN;
        const lane = g0 + dg * (t * t * (3 - 2 * t));
        const side = Math.abs(lane) >= 10 ? (lane > 0 ? 1 : -1) : (D[1]! < 0.5 ? -1 : 1);
        const raw = lane + side * (SPIKE_CLEAR + D[2]! * SPIKE_SPREAD);
        const o = w * STRIDE;
        data[o + I_KIND] = K_SPIKE;
        data[o + I_X] = Math.max(Math.min(raw, SPIKE_X_MAX), -SPIKE_X_MAX);
        data[o + I_Y] = SPIKE_RADIUS;
        data[o + I_Z] = z;
        data[o + I_RADIUS] = SPIKE_RADIUS;
        data[o + I_A] = 0;
        data[o + I_B] = 0;
        data[o + I_SEED] = Math.min(D[3]!, UNIT_MAX);
        w++;
      }
    }

    // ---- FENCE: never in a gate chunk, and never within 32 u before a gate.
    if (!archHere) {
      const salt = BASE_SALT + K_FENCE;
      draw(seed, C, 0, salt, 0, D, 0, 1);
      let n = Math.floor(0.15 + 0.35 * d + D[0]!);
      if (n > FENCE_CAP) n = FENCE_CAP;
      if (n > 0) {
        C[3] = periodChunks > 0 ? floorMod(c + 1, periodChunks) : c + 1;
        const hi = hasArch(3) ? FENCE_Z_BEFORE_GATE : CHUNK;
        const slot = (hi - FENCE_MIN_GAP * (n - 1)) / n;
        const halfGap = 12 - 5 * d;
        for (let i = 0; i < n; i++) {
          draw(seed, C, 0, salt, 8 + i * 8, D, 0, 2);
          const z = Math.fround(Math.min(i * (slot + FENCE_MIN_GAP) + D[0]! * slot, ZLOCAL_MAX));
          const t = (zBase + z) / NODE_SPAN;
          const lane = g0 + dg * (t * t * (3 - 2 * t));
          const o = w * STRIDE;
          data[o + I_KIND] = K_FENCE;
          data[o + I_X] = 0;
          data[o + I_Y] = ROAD_Y;
          data[o + I_Z] = z;
          data[o + I_RADIUS] = FENCE_RADIUS;
          data[o + I_A] = Math.max(Math.min(lane, FENCE_LANE_MAX), -FENCE_LANE_MAX);
          data[o + I_B] = halfGap;
          data[o + I_SEED] = Math.min(D[1]!, UNIT_MAX);
          w++;
        }
      }
    }

    // ---- DRONE: its whole swing stays clear of the lane and inside the play window.
    {
      const salt = BASE_SALT + K_DRONE;
      draw(seed, C, 0, salt, 0, D, 0, 1);
      let n = Math.floor(0.2 + 1.2 * d + D[0]!);
      if (n > DRONE_CAP) n = DRONE_CAP;
      for (let i = 0; i < n; i++) {
        draw(seed, C, 0, salt, 8 + i * 8, D, 0, 6);
        const z = Math.fround(Math.min((i + D[0]!) / n * CHUNK, ZLOCAL_MAX));
        const t = (zBase + z) / NODE_SPAN;
        const lane = g0 + dg * (t * t * (3 - 2 * t));
        const amp = 3 + 5 * D[1]!;
        const side = Math.abs(lane) >= 10 ? (lane > 0 ? 1 : -1) : (D[2]! < 0.5 ? -1 : 1);
        const reach = amp + DRONE_CLEAR + D[3]! * DRONE_SPREAD;
        const outer = lane + side * reach;
        // On a lane near the window's edge the outer side has no room for the swing, so it goes on the inner side.
        const x = Math.abs(outer) + amp <= DRONE_X_LIMIT ? outer : lane - side * reach;
        const o = w * STRIDE;
        data[o + I_KIND] = K_DRONE;
        data[o + I_X] = x;
        data[o + I_Y] = 5 + 7 * D[4]!;
        data[o + I_Z] = z;
        data[o + I_RADIUS] = DRONE_RADIUS;
        data[o + I_A] = amp;
        data[o + I_B] = 1;
        data[o + I_SEED] = Math.min(D[5]!, UNIT_MAX);
        w++;
      }
    }

    // ---- TRAFFIC: a conveyor along a road lane, denser on the Boulevard. Its top stays under a ship at y = 8.
    {
      const salt = BASE_SALT + K_TRAFFIC;
      const zoneT = (c - zi * ZONE + 0.5 - FADE_START) / FADE;
      const ft = zoneT <= 0 ? 0 : zoneT >= 1 ? 1 : zoneT;
      const m = ft * ft * (3 - 2 * ft);
      const wA = zoneMemo[1] === BOULEVARD ? 1.5 + 1.5 * d : 0.3 + 0.7 * d;
      const wB = zoneMemo[2] === BOULEVARD ? 1.5 + 1.5 * d : 0.3 + 0.7 * d;
      draw(seed, C, 0, salt, 0, D, 0, 1);
      let n = Math.floor(wA + (wB - wA) * m + D[0]!);
      if (n > TRAFFIC_CAP) n = TRAFFIC_CAP;
      for (let i = 0; i < n; i++) {
        draw(seed, C, 0, salt, 8 + i * 8, D, 0, 5);
        const travel = TRAVELS[Math.floor(D[2]! * 3)]!;
        const speed = TRAFFIC_SPEED_MIN + TRAFFIC_SPEED_SPAN * D[3]!;
        const o = w * STRIDE;
        data[o + I_KIND] = K_TRAFFIC;
        data[o + I_X] = LANE_POS[Math.floor(D[1]! * 4)]!;
        data[o + I_Y] = TRAFFIC_Y;
        data[o + I_Z] = Math.fround(Math.min((i + D[0]!) / n * CHUNK, ZLOCAL_MAX));
        data[o + I_RADIUS] = TRAFFIC_RADIUS;
        data[o + I_A] = travel;
        data[o + I_B] = Math.round(speed * TRAFFIC_K_UNIT / travel);
        data[o + I_SEED] = Math.min(D[4]!, UNIT_MAX);
        w++;
      }
    }

    data.fill(0, w * STRIDE);
    out.count = w;
    out.chunk = chunk;
  };
}
