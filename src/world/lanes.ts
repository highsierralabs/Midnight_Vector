// src/world/lanes.ts -- the pure gate lane. A value-noise lateral walk with a node every 3 chunks, one bar at cruise.
import { CHUNK_LEN } from '../contracts/index';
import { hash01 } from '../core/hash';
import { drawInto } from './draws';
import { floorMod, smooth } from './zones';

const LANE_AMP = 26;
const NODE_CHUNKS = 3;
const SALT_LANE = 0x6100;

/** G(n), the lane at node n, in [-26, 26]. Exact for any integer n: the division by 3 goes through an integer remainder. */
export function laneNode(seed: number, n: number): number {
  const r = floorMod(n, 3);
  const node = (n - r) / 3;
  const h0 = hash01(seed, node, SALT_LANE, 0);
  const h1 = hash01(seed, node + 1, SALT_LANE, 0);
  return LANE_AMP * (2 * (h0 + (h1 - h0) * smooth(r / 3)) - 1);
}

/** io[0] is a node n. Writes G(n) to io[1] and G(n + 1) to io[2], equal to laneNode. Allocates nothing. Scratch in io[3..8]. */
export function laneNodePair(seed: number, io: Float64Array): void {
  const n = io[0]!;
  const r = ((n % 3) + 3) % 3;
  const node = (n - r) / 3;
  io[3] = node;
  drawInto(seed, io, 3, SALT_LANE, 0, io, 4, 1);
  io[3] = node + 1;
  drawInto(seed, io, 3, SALT_LANE, 0, io, 5, 1);
  const h0 = io[4]!;
  const h1 = io[5]!;
  const t0 = r / 3;
  io[1] = LANE_AMP * (2 * (h0 + (h1 - h0) * (t0 * t0 * (3 - 2 * t0))) - 1);
  if (r === 2) {
    // The next node opens the next value-noise cell, at its own first value.
    io[2] = LANE_AMP * (2 * h1 - 1);
  } else {
    const t1 = (r + 1) / 3;
    io[2] = LANE_AMP * (2 * (h0 + (h1 - h0) * (t1 * t1 * (3 - 2 * t1))) - 1);
  }
}

/**
 * DI-118, the operator's swooping path: the lane has a height, and gates stand at it, so the path climbs and dives from gate to
 * gate. Even nodes draw from the low band [8, 10) and odd nodes from the high band [11, 13), so every gate is 1 to 5 u above or
 * below the one before (3 on average), with no recurrence: a pure function of the node, O(1) at any chunk. The floor is 8, the
 * old fixed height, because traffic (y 2.5, radius 3) is cleared by height alone: its top plus T02's 2 u ship plus .5. A unit
 * higher throughout was tried and put A16b's props shimmer share at its .2 limit with radius-8 gates (items.ts).
 */
export const LANE_Y_MIN = 8;
export const LANE_Y_MAX = 13;
const LANE_Y_HIGH = 11;
const LANE_BAND = 2;
const LANE_SALT_Y = 0x6102;

/** H(n), the lane's height at node n: in [8, 10) for even n, [11, 13) for odd n. */
export function laneHeight(seed: number, n: number): number {
  const odd = floorMod(n, 2);
  return (odd === 1 ? LANE_Y_HIGH : LANE_Y_MIN) + LANE_BAND * hash01(seed, n, LANE_SALT_Y, 0);
}

/** io[0] is a node n. Writes H(n) to io[6] and H(n + 1) to io[7], equal to laneHeight. Allocates nothing. Scratch in io[3]. */
export function laneHeightPair(seed: number, io: Float64Array): void {
  const n = io[0]!;
  io[3] = n;
  drawInto(seed, io, 3, LANE_SALT_Y, 0, io, 6, 1);
  io[3] = n + 1;
  drawInto(seed, io, 3, LANE_SALT_Y, 0, io, 7, 1);
  const odd = ((n % 2) + 2) % 2;
  io[6] = (odd === 1 ? LANE_Y_HIGH : LANE_Y_MIN) + LANE_BAND * io[6]!;
  io[7] = (odd === 1 ? LANE_Y_MIN : LANE_Y_HIGH) + LANE_BAND * io[7]!;
}

/** Lateral position of the lane at a point of a chunk. Chunk is reduced by periodChunks first. */
export function laneX(seed: number, periodChunks: number, chunk: number, zLocal: number): number {
  const c = periodChunks > 0 ? floorMod(chunk, periodChunks) : chunk;
  const n = Math.floor(c / NODE_CHUNKS);
  const t = (zLocal + (c - NODE_CHUNKS * n) * CHUNK_LEN) / (NODE_CHUNKS * CHUNK_LEN);
  const g0 = laneNode(seed, n);
  const g1 = laneNode(seed, n + 1);
  return g0 + (g1 - g0) * smooth(t);
}
