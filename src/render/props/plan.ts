// RING_PLAN: one entry per FIFO ring, 26 in all. Pure, no three. Ids 0..19 are Archetype values, 20..25 are 20 + ItemKind.
// The live-row model is in plans/T05-props.md section 2: a ring holds rows c - rear .. c + reach, so capacity
// perChunk * (reach + 1 + rear) holds every live record, provided a crossing feeds after the camera has moved.
import {
  ARCHETYPE_COUNT, ARCHETYPE_SPEC, Archetype, CHUNK_LEN, ITEM_KIND_COUNT, ITEM_SPEC, ItemKind, TRAFFIC_TRAVEL_MAX,
} from '../../contracts/index';

export interface RingPlanEntry {
  readonly id: number;
  readonly source: 'prop' | 'item';
  /** Archetype value or ItemKind value. */
  readonly kind: number;
  readonly name: string;
  readonly maxDist: number;
  readonly perChunk: number;
  /** ceil(maxDist / CHUNK_LEN), rows ahead of the camera chunk the ring must already hold. */
  readonly reach: number;
  /** Rows behind the camera chunk that can still hold a live record. */
  readonly rear: number;
  readonly cap: number;
  /** Drawn a second time with y flipped (section 6.5). */
  readonly mirror: boolean;
  /** Has a second, additive mesh (saucer beam, fence beam). */
  readonly beam: boolean;
  /** False for RING and items: they never filter by density. */
  readonly filtered: boolean;
  /**
   * Has an additive draw, whose result depends on instance order by a rounding step in the half-float target. Such a ring keeps its rows
   * in ascending order from slot 0, sliding left as the oldest row leaves, so its order is what a rebuild gives, and FIFO equals rebuild to
   * the byte (Decision log). A crossing then uploads the live part of the ring rather than one row.
   */
  readonly slides: boolean;
  /** Triangles per instance, the section 6.5 target. */
  readonly targetTris: number;
  /** A horizontal reach bound at scale 1, in u. A test bound, so a mesh cannot spill over T01's bands (C-37). */
  readonly radiusBound: number;
}

const ARCH_NAMES = [
  'PALM', 'ARCOLOGY', 'PYRAMID', 'ORB', 'COLONNADE', 'BILLBOARD', 'PYLON', 'REFLECTOR', 'CRYSTAL', 'SAUCER',
  'SEARCHLIGHT', 'TOTEM', 'DISH', 'RING', 'OBELISK', 'DOME', 'TURBINE', 'CASSETTE', 'CACTUS', 'CHEVRON',
] as const;
const ITEM_NAMES = ['SHARD', 'GATE', 'SPIKE', 'FENCE', 'DRONE', 'TRAFFIC'] as const;

const ARCH_TRIS = [300, 180, 16, 480, 200, 24, 160, 12, 24, 96, 24, 120, 160, 1152, 20, 160, 100, 60, 90, 16] as const;
const ITEM_TRIS = [8, 64, 20, 8, 60, 48] as const;
// Measured as the reach of any vertex from the y axis, so a square base counts at its corner: PYRAMID's half-width 28 is 39.6.
const ARCH_RADIUS = [9.1, 14, 39.7, 3.6, 7.1, 8.6, 7, 0.2, 3, 13.2, 300, 3.2, 8.5, 100.5, 3, 20.5, 16.5, 14.4, 2.8, 3.8] as const;
const ITEM_RADIUS = [1.3, 1.4, 1, 1.1, 1, 1.05] as const;

const ARCH_MIRROR: ReadonlySet<number> = new Set<number>([
  Archetype.PALM, Archetype.ORB, Archetype.COLONNADE, Archetype.REFLECTOR, Archetype.CRYSTAL, Archetype.TOTEM, Archetype.CACTUS,
]);
const ITEM_MIRROR: ReadonlySet<number> = new Set<number>([ItemKind.SHARD, ItemKind.GATE, ItemKind.SPIKE, ItemKind.FENCE, ItemKind.TRAFFIC]);

function buildPlan(): readonly RingPlanEntry[] {
  const out: RingPlanEntry[] = [];
  for (let a = 0; a < ARCHETYPE_COUNT; a++) {
    const s = ARCHETYPE_SPEC[a]!;
    const reach = Math.ceil(s.maxDist / CHUNK_LEN);
    const rear = 1;
    out.push({
      id: a, source: 'prop', kind: a, name: ARCH_NAMES[a]!, maxDist: s.maxDist, perChunk: s.perChunk,
      reach, rear,
      // RING's 4 holds with periodChunks = 1024, where a wrap can bring two records 16 chunks apart.
      cap: a === Archetype.RING ? 4 : s.perChunk * (reach + 1 + rear),
      mirror: ARCH_MIRROR.has(a), beam: a === Archetype.SAUCER, filtered: a !== Archetype.RING,
      slides: a === Archetype.SAUCER || a === Archetype.SEARCHLIGHT,
      targetTris: ARCH_TRIS[a]!, radiusBound: ARCH_RADIUS[a]!,
    });
  }
  for (let k = 0; k < ITEM_KIND_COUNT; k++) {
    const s = ITEM_SPEC[k]!;
    const reach = Math.ceil(s.maxDist / CHUNK_LEN);
    const rear = k === ItemKind.TRAFFIC ? Math.ceil((30 + TRAFFIC_TRAVEL_MAX) / CHUNK_LEN) : 1;
    out.push({
      id: ARCHETYPE_COUNT + k, source: 'item', kind: k, name: ITEM_NAMES[k]!, maxDist: s.maxDist, perChunk: s.perChunk,
      reach, rear, cap: s.perChunk * (reach + 1 + rear),
      mirror: ITEM_MIRROR.has(k), beam: k === ItemKind.FENCE, filtered: false, slides: k === ItemKind.FENCE,
      targetTris: ITEM_TRIS[k]!, radiusBound: ITEM_RADIUS[k]!,
    });
  }
  return out;
}

export const RING_PLAN: readonly RingPlanEntry[] = buildPlan();
export const RING_COUNT = RING_PLAN.length;
/** How far ahead of the camera chunk the two row caches read. */
export const PROP_ROWS_AHEAD = 94;
export const ITEM_ROWS_AHEAD = 25;
