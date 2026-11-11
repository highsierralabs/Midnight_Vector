// Row caches, crossing schedule, rebuild, item hide lookup. Pure, no three.
// A crossing calls fillProps once for the row 94 ahead and fillItems once for the row 25 ahead, then copies one slice
// per ring, from the row that has just reached that ring's reach. Call it after the camera has moved (plan section 2).
import { ARCHETYPE_COUNT, ITEM_STRIDE, ItemField, MAX_ITEMS_PER_CHUNK, ROW_MOD, type ItemRow, type PropRow, type WorldSource } from '../../contracts/index';
import { createItemRow, createPropRow } from '../../core/alloc';
import { ITEM_ROWS_AHEAD, PROP_ROWS_AHEAD, type RingPlanEntry } from './plan';
import { DEAD_KEEP, INST_KEEP, INST_STRIDE, RingStore } from './ring';

const PROP_CACHE = 96;
const ITEM_CACHE = 32;

export interface Feeder {
  /** Every row cache refilled, every ring reset and refilled in row order. */
  rebuild(chunk: number): void;
  /** Exactly one fillProps and one fillItems, then one slice per ring. */
  cross(chunk: number): void;
  /** Resets one ring under new density settings and rewrites it from the row caches. */
  refill(ring: number, filter: number, clamp: number, modulus: number): void;
  /** Writes keep = 2 on that record's slot. Unknown rows and unfed records are ignored. Afterwards hideRing is the ring touched or -1, and hideFloat the float index. */
  hideItem(chunk: number, index: number): void;
  readonly rings: readonly RingStore[];
  readonly hideRing: number;
  readonly hideFloat: number;
}

type RingFactory = (p: Readonly<RingPlanEntry>) => RingStore;

function floorMod(a: number, m: number): number {
  return ((a % m) + m) % m;
}

export function createFeeder(
  world: Pick<WorldSource, 'fillProps' | 'fillItems'>,
  plan: readonly RingPlanEntry[],
  makeRing: RingFactory = (p) => new RingStore(p),
): Feeder {
  const rings = plan.map(makeRing);
  const propRows: PropRow[] = [];
  for (let i = 0; i < PROP_CACHE; i++) propRows.push(createPropRow());
  const itemRows: ItemRow[] = [];
  const itemSlots: Int16Array[] = [];
  for (let i = 0; i < ITEM_CACHE; i++) {
    itemRows.push(createItemRow());
    itemSlots.push(new Int16Array(MAX_ITEMS_PER_CHUNK).fill(-1));
  }
  const propLoaded = new Float64Array(PROP_CACHE).fill(NaN);
  const itemLoaded = new Float64Array(ITEM_CACHE).fill(NaN);
  let camChunk = 0;
  let hideRing = -1;
  let hideFloat = -1;

  function loadProps(r: number): void {
    const at = floorMod(r, PROP_CACHE);
    world.fillProps(r, propRows[at]!);
    propLoaded[at] = r;
  }

  function loadItems(r: number): void {
    const at = floorMod(r, ITEM_CACHE);
    world.fillItems(r, itemRows[at]!);
    itemLoaded[at] = r;
    itemSlots[at]!.fill(-1);
  }

  function writeRing(ring: RingStore, r: number): void {
    const p = ring.plan;
    if (p.source === 'prop') {
      const at = floorMod(r, PROP_CACHE);
      if (propLoaded[at] !== r) return;
      const row = propRows[at]!;
      ring.writeRow(r, row.data, row.start[p.kind]!, row.start[p.kind + 1]!);
    } else {
      const at = floorMod(r, ITEM_CACHE);
      if (itemLoaded[at] !== r) return;
      const row = itemRows[at]!;
      ring.writeItems(r, row.data, row.count, itemSlots[at]!);
    }
  }

  return {
    rings,
    get hideRing() { return hideRing; },
    get hideFloat() { return hideFloat; },
    rebuild(chunk: number): void {
      camChunk = chunk;
      propLoaded.fill(NaN);
      itemLoaded.fill(NaN);
      // Rows c - 1 .. c + 94 and c - 3 .. c + 25. Row r < 0 is never requested.
      for (let r = chunk - 1; r <= chunk + PROP_ROWS_AHEAD; r++) if (r >= 0) loadProps(r);
      for (let r = chunk - 3; r <= chunk + ITEM_ROWS_AHEAD; r++) if (r >= 0) loadItems(r);
      for (let i = 0; i < rings.length; i++) {
        const ring = rings[i]!;
        ring.reset();
        const last = chunk + ring.plan.reach;
        for (let r = chunk - ring.plan.rear; r <= last; r++) if (r >= 0) writeRing(ring, r);
        ring.rangeCount = 0;
      }
    },
    cross(chunk: number): void {
      camChunk = chunk;
      const aheadProps = chunk + PROP_ROWS_AHEAD;
      const aheadItems = chunk + ITEM_ROWS_AHEAD;
      if (aheadProps >= 0) loadProps(aheadProps);
      if (aheadItems >= 0) loadItems(aheadItems);
      for (let i = 0; i < rings.length; i++) {
        const ring = rings[i]!;
        const r = chunk + ring.plan.reach;
        ring.rangeCount = 0;
        if (r >= 0) writeRing(ring, r);
      }
    },
    refill(index: number, filter: number, clamp: number, modulus: number): void {
      const ring = rings[index]!;
      ring.setDensity(filter, clamp, modulus);
      ring.reset();
      const last = camChunk + ring.plan.reach;
      for (let r = camChunk - ring.plan.rear; r <= last; r++) if (r >= 0) writeRing(ring, r);
      ring.rangeCount = 0;
    },
    hideItem(chunk: number, index: number): void {
      hideRing = -1;
      hideFloat = -1;
      if (index < 0 || index >= MAX_ITEMS_PER_CHUNK) return;
      const at = floorMod(chunk, ITEM_CACHE);
      if (itemLoaded[at] !== chunk) return;
      const slot = itemSlots[at]![index]!;
      if (slot < 0) return;
      const row = itemRows[at]!;
      const ringId = ARCHETYPE_COUNT + row.data[index * ITEM_STRIDE + ItemField.KIND]!;
      const ring = rings[ringId];
      if (!ring) return;
      // The row outlives its slots: a rear row can be gone from a ring whose rear is shorter than the cache's.
      const o = slot * INST_STRIDE;
      const rowValue = ((chunk % ROW_MOD) + ROW_MOD) % ROW_MOD;
      if (ring.arr[o + 3] !== rowValue || ring.arr[o + 2] !== row.data[index * ITEM_STRIDE + ItemField.Z_LOCAL]!) return;
      ring.arr[o + INST_KEEP] = DEAD_KEEP;
      hideRing = ringId;
      hideFloat = o + INST_KEEP;
    },
  };
}
