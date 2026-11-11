// The item ring, the swept crossing of the ship plane, and the shape tests. Pure: every outcome comes from the rows,
// the state and the tick, and goes out through a sink. Nothing here touches a rule, so overflow cannot change one.
import {
  ITEM_STRIDE, ItemField, ItemKind, SHIP_FORWARD, TRAFFIC_FADE,
  type ItemRow, type SimState, type Travel, type WorldSource,
} from '../contracts/index';
import { between } from '../core/coords';
import { createItemRow } from '../core/alloc';
import { droneOffset, phaseOf } from '../core/motion';
import type { Tuning } from './tuning';

const { KIND, X, Y, Z_LOCAL, RADIUS, A, B, SEED } = ItemField;

/** What happened to one record as it crossed the ship plane. Shape only: mode, ghost and scoring live in rules.ts. */
export const Crossing = {
  SHARD_TAKEN: 0, SHARD_MISSED: 1, GATE_THREADED: 2, GATE_MISSED: 3, CHECKPOINT: 4, HAZARD_HIT: 5, HAZARD_GRAZE: 6, HAZARD_CLEAR: 7,
} as const;
export type Crossing = (typeof Crossing)[keyof typeof Crossing];

export interface CrossingSink {
  /** Integer arguments and a row reference only, so a call that is not inlined still allocates nothing. */
  crossing(outcome: Crossing, kind: number, row: Readonly<ItemRow>, index: number): void;
}

/** Rows c - back .. c + ahead, in a ring indexed by chunk, so a crossing refills one row. */
export interface ItemRing {
  rowOf(chunk: number): ItemRow;
  /** At create and warp. A negative chunk gets an empty row and no world call. */
  fillAll(c: number): void;
  /** After one crossing into chunk c: only the newest row is new. */
  fillAhead(c: number): void;
}

export function createItemRing(world: WorldSource, t: Tuning): ItemRing {
  const size = t.ITEM_ROWS_BACK + 1 + t.ITEM_ROWS_AHEAD;
  const rows: ItemRow[] = [];
  for (let i = 0; i < size; i++) rows.push(createItemRow());

  function rowOf(chunk: number): ItemRow {
    return rows[((chunk % size) + size) % size]!;
  }
  function fill(chunk: number): void {
    const row = rowOf(chunk);
    if (chunk < 0) {
      row.chunk = chunk;
      row.count = 0;
      return;
    }
    world.fillItems(chunk, row);
  }
  return {
    rowOf,
    fillAll(c: number): void {
      for (let rc = c - t.ITEM_ROWS_BACK; rc <= c + t.ITEM_ROWS_AHEAD; rc++) fill(rc);
    },
    fillAhead(c: number): void {
      fill(c + t.ITEM_ROWS_AHEAD);
    },
  };
}

/**
 * Returns the per-step sweep over home chunks c - back .. c + sweepAhead, rows ascending, records in order.
 * `before` is the travel at the start of this step. An item crosses when its distance past the plane goes from
 * above 0 to at most 0, and both distances come from one expression over the two travels, so this step's "after" is
 * bit-identical to the next step's "before": rounding can neither double-count an item nor lose one. A NaN never crosses.
 */
export function createSweep(ring: ItemRing, s: Readonly<SimState>, before: Readonly<Travel>, t: Tuning, sink: CrossingSink): () => void {
  const origin: Travel = { chunk: 0, local: 0 };
  const hitRadius = t.SHIP_HIT_RADIUS;
  const pickupRadius = t.SHIP_PICKUP_RADIUS;
  const grazeFactor = t.GRAZE_RADIUS_FACTOR;
  const fenceMargin = t.FENCE_GRAZE_MARGIN;
  const back = t.ITEM_ROWS_BACK;
  const ahead = t.SWEEP_ROWS_AHEAD;

  return function sweep(): void {
    const c = s.travel.chunk;
    const sx = s.x;
    const sy = s.y;
    const tick = s.tick;
    for (let rc = c - back; rc <= c + ahead; rc++) {
      const row = ring.rowOf(rc);
      const n = row.count;
      if (n === 0) continue;
      const d = row.data;
      origin.chunk = rc;
      const rowRel = between(origin, s.travel) - SHIP_FORWARD;
      const rowPrev = between(origin, before) - SHIP_FORWARD;
      for (let index = 0; index < n; index++) {
        const o = index * ITEM_STRIDE;
        const kind = d[o + KIND]!;
        let rel = rowRel + d[o + Z_LOCAL]!;
        let relPrev = rowPrev + d[o + Z_LOCAL]!;
        if (kind === ItemKind.TRAFFIC) {
          const b = d[o + B]!;
          const seed = d[o + SEED]!;
          const q = b * phaseOf(tick, 0, 7) + seed;
          const f = q - Math.floor(q);
          const qp = b * phaseOf(tick - 1, 0, 7) + seed;
          const fp = qp - Math.floor(qp);
          // A car's wrap sits inside the fade band, so it cannot fake a crossing, and a faded car cannot hit.
          if (f < TRAFFIC_FADE || f > 1 - TRAFFIC_FADE || fp < TRAFFIC_FADE || fp > 1 - TRAFFIC_FADE) continue;
          const travel = d[o + A]!;
          rel += travel * f;
          relPrev += travel * fp;
        }
        if (!(relPrev > 0 && rel <= 0)) continue;

        const radius = d[o + RADIUS]!;
        const a = d[o + A]!;
        const y = d[o + Y]!;
        let x = d[o + X]!;
        let outcome: Crossing;
        if (kind === ItemKind.SHARD) {
          const dx = sx - x;
          const dy = sy - y;
          const reach = radius + pickupRadius;
          outcome = dx * dx + dy * dy <= reach * reach && reach >= 0 ? Crossing.SHARD_TAKEN : Crossing.SHARD_MISSED;
        } else if (kind === ItemKind.GATE) {
          if (a === 1) {
            outcome = Crossing.CHECKPOINT;
          } else {
            const dx = sx - x;
            const dy = sy - y;
            outcome = dx * dx + dy * dy <= radius * radius && radius >= 0 ? Crossing.GATE_THREADED : Crossing.GATE_MISSED;
          }
        } else if (kind === ItemKind.FENCE) {
          const gapHalf = d[o + B]!;
          const span = Math.abs(sx - x) <= radius;
          const edge = gapHalf - hitRadius - Math.abs(sx - a);
          outcome = !span ? Crossing.HAZARD_CLEAR : edge < 0 ? Crossing.HAZARD_HIT : edge <= fenceMargin ? Crossing.HAZARD_GRAZE : Crossing.HAZARD_CLEAR;
        } else if (kind === ItemKind.SPIKE || kind === ItemKind.DRONE || kind === ItemKind.TRAFFIC) {
          if (kind === ItemKind.DRONE) x += droneOffset(a, d[o + B]!, d[o + SEED]!, phaseOf(tick, 0, 3));
          const dx = sx - x;
          const dy = sy - y;
          const dd = dx * dx + dy * dy;
          const hitR = radius + hitRadius;
          const grazeR = grazeFactor * hitR;
          outcome = hitR < 0 ? Crossing.HAZARD_CLEAR : dd <= hitR * hitR ? Crossing.HAZARD_HIT : dd <= grazeR * grazeR ? Crossing.HAZARD_GRAZE : Crossing.HAZARD_CLEAR;
        } else {
          continue;   // An unknown kind is ignored.
        }
        sink.crossing(outcome, kind, row, index);
      }
    }
  };
}
