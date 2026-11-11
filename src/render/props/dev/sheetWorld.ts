// A mutable WorldSource wrapper for sheets and single-object tests: select() makes it emit exactly one record of the chosen
// archetype or item, at a stated forward distance, lateral offset and height. Row and zLocal come from the camera position.
// Other functions delegate to the base world. The layer never imports this.
import {
  ARCHETYPE_COUNT, CHUNK_LEN, ITEM_STRIDE, ItemField, PROP_STRIDE, PropField,
  type ItemRow, type PropRow, type Travel, type WorldSource,
} from '../../../contracts/index';

export interface Placement {
  /** Camera position the distance is measured from. */
  at: Travel;
  /** Forward distance of the record's origin from the camera plane. */
  distance: number;
  x: number;
  y: number;
  yaw?: number;
  scale?: number;
  keep?: number;
  tintSeed?: number;
  variant?: number;
  /** Items. */
  radius?: number;
  a?: number;
  b?: number;
  seed?: number;
  /** A second record of the same kind, offset in x and in forward distance. */
  twin?: { dx: number; dz: number };
}

export interface Selection { source: 'prop' | 'item'; kind: number; place: Placement }

export interface SheetWorld extends WorldSource {
  select(s: Selection | null): void;
  /** Replaces what is emitted with several at once. */
  selectMany(list: readonly Selection[]): void;
  /** When set, rows come from this world instead of any selection. */
  setBase(w: WorldSource): void;
  useBaseRows(on: boolean): void;
}

function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

function rowOf(s: Selection, extra: number): { row: number; zLocal: number } {
  const abs = s.place.at.local + s.place.distance + extra;
  const rows = floorDiv(abs, CHUNK_LEN);
  return { row: s.place.at.chunk + rows, zLocal: abs - rows * CHUNK_LEN };
}

export function createSheetWorld(base: WorldSource): SheetWorld {
  let world = base;
  let baseRows = false;
  let chosen: readonly Selection[] = [];
  return {
    get seed() { return world.seed; },
    height: (x, iz, zs, zLocal) => world.height(x, iz, zs, zLocal),
    zoneAt: (at, out) => world.zoneAt(at, out),
    bendAt: (at, out) => world.bendAt(at, out),
    fillProps(chunk: number, out: PropRow): void {
      if (baseRows) {
        world.fillProps(chunk, out);
        return;
      }
      out.chunk = chunk;
      out.start.fill(0);
      let n = 0;
      for (let a = 0; a < ARCHETYPE_COUNT; a++) {
        out.start[a] = n;
        for (const s of chosen) {
          if (s.source !== 'prop' || s.kind !== a) continue;
          const copies = s.place.twin ? 2 : 1;
          for (let c = 0; c < copies; c++) {
            const { row, zLocal } = rowOf(s, c === 1 ? s.place.twin!.dz : 0);
            if (row !== chunk) continue;
            const o = n * PROP_STRIDE;
            out.data[o + PropField.X] = s.place.x + (c === 1 ? s.place.twin!.dx : 0);
            out.data[o + PropField.Y] = s.place.y;
            out.data[o + PropField.Z_LOCAL] = zLocal;
            out.data[o + PropField.YAW] = s.place.yaw ?? 0;
            out.data[o + PropField.SCALE] = s.place.scale ?? 1;
            out.data[o + PropField.KEEP] = s.place.keep ?? 0;
            out.data[o + PropField.TINT_SEED] = s.place.tintSeed ?? 0.1;
            out.data[o + PropField.VARIANT] = s.place.variant ?? 0.75;
            n++;
          }
        }
      }
      out.start[ARCHETYPE_COUNT] = n;
    },
    fillItems(chunk: number, out: ItemRow): void {
      if (baseRows) {
        world.fillItems(chunk, out);
        return;
      }
      out.chunk = chunk;
      let n = 0;
      for (const s of chosen) {
        if (s.source !== 'item') continue;
        const copies = s.place.twin ? 2 : 1;
        for (let c = 0; c < copies; c++) {
          const { row, zLocal } = rowOf(s, c === 1 ? s.place.twin!.dz : 0);
          if (row !== chunk) continue;
          const o = n * ITEM_STRIDE;
          out.data[o + ItemField.KIND] = s.kind;
          out.data[o + ItemField.X] = s.place.x + (c === 1 ? s.place.twin!.dx : 0);
          out.data[o + ItemField.Y] = s.place.y;
          out.data[o + ItemField.Z_LOCAL] = zLocal;
          out.data[o + ItemField.RADIUS] = s.place.radius ?? 1;
          out.data[o + ItemField.A] = s.place.a ?? 0;
          out.data[o + ItemField.B] = s.place.b ?? 0;
          out.data[o + ItemField.SEED] = s.place.seed ?? 0.25;
          n++;
        }
      }
      out.count = n;
    },
    select(s: Selection | null): void {
      baseRows = false;
      chosen = s ? [s] : [];
    },
    selectMany(list: readonly Selection[]): void {
      baseRows = false;
      chosen = list;
    },
    setBase(w: WorldSource): void {
      world = w;
    },
    useBaseRows(on: boolean): void {
      baseRows = on;
    },
  };
}
