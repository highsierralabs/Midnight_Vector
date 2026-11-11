// A world that emits exactly perChunk of everything, everywhere, with an independent hashed keep per record, the harder
// case for the clamp. RING and PYLON copy T01's values. Used by the model check and the worst-case budgets. The layer never imports this.
import {
  ARCHETYPE_COUNT, ARCHETYPE_SPEC, Archetype, CHUNK_LEN, ITEM_KIND_COUNT, ITEM_SPEC, ItemKind, ITEM_STRIDE, ItemField, PROP_STRIDE, PropField,
  TRAFFIC_TRAVEL_MAX,
  type ItemRow, type PropRow, type WorldSource,
} from '../../../contracts/index';
import { hash01 } from '../../../core/hash';

const TAU = 2 * Math.PI;
const UNIT_MAX = 0.99999994;
const ZLOCAL_MAX = 63.999996;
const SEED = 7741;
const SMALL_BAND: ReadonlySet<number> = new Set<number>([
  Archetype.PALM, Archetype.REFLECTOR, Archetype.CHEVRON, Archetype.CACTUS, Archetype.TOTEM, Archetype.COLONNADE, Archetype.BILLBOARD, Archetype.ORB,
]);

function floorMod(a: number, m: number): number {
  return ((a % m) + m) % m;
}

export interface WorstCaseOptions { archetypes?: readonly number[]; items?: readonly number[] }

export function worstCaseRows(o: WorstCaseOptions = {}): Pick<WorldSource, 'fillProps' | 'fillItems'> {
  const allowProp = new Array<boolean>(ARCHETYPE_COUNT).fill(o.archetypes === undefined);
  for (const a of o.archetypes ?? []) allowProp[a] = true;
  const allowItem = new Array<boolean>(ITEM_KIND_COUNT).fill(o.items === undefined);
  for (const k of o.items ?? []) allowItem[k] = true;

  function fillProps(chunk: number, out: PropRow): void {
    out.chunk = chunk;
    const d = out.data;
    let n = 0;
    for (let a = 0; a < ARCHETYPE_COUNT; a++) {
      out.start[a] = n;
      if (!allowProp[a]) continue;
      if (a === Archetype.RING) {
        if (floorMod(chunk, 48) === 0) {
          const at = n * PROP_STRIDE;
          d[at + PropField.X] = 0;
          d[at + PropField.Y] = 65.14;
          d[at + PropField.Z_LOCAL] = 32;
          d[at + PropField.YAW] = 0;
          d[at + PropField.SCALE] = 1;
          d[at + PropField.KEEP] = 0;
          d[at + PropField.TINT_SEED] = Math.min(hash01(SEED, chunk, a, 0), UNIT_MAX);
          d[at + PropField.VARIANT] = Math.min(hash01(SEED, chunk, a, 1), UNIT_MAX);
          n++;
        }
        continue;
      }
      const count = ARCHETYPE_SPEC[a]!.perChunk;
      for (let i = 0; i < count; i++) {
        const at = n * PROP_STRIDE;
        if (a === Archetype.PYLON) {
          d[at + PropField.X] = i === 0 ? -100 : 100;
          d[at + PropField.Y] = 0;
          d[at + PropField.Z_LOCAL] = 0;
          d[at + PropField.YAW] = 0;
          d[at + PropField.SCALE] = 1;
          d[at + PropField.KEEP] = i === 0 ? 0.1 : 0.6;
          d[at + PropField.TINT_SEED] = Math.min(hash01(SEED, chunk, a, i), UNIT_MAX);
          d[at + PropField.VARIANT] = 0.75;
          n++;
          continue;
        }
        const salt = i * 8;
        const side = hash01(SEED, chunk, a, salt) < 0.5 ? -1 : 1;
        const u = hash01(SEED, chunk, a, salt + 1);
        d[at + PropField.X] = side * (SMALL_BAND.has(a) ? 44 + 41 * u : 120 + 380 * u);
        d[at + PropField.Y] = ARCHETYPE_SPEC[a]!.floats ? 30 : 0;
        d[at + PropField.Z_LOCAL] = Math.min(((i + hash01(SEED, chunk, a, salt + 2)) * CHUNK_LEN) / count, ZLOCAL_MAX);
        d[at + PropField.YAW] = hash01(SEED, chunk, a, salt + 3) * TAU;
        d[at + PropField.SCALE] = 0.8 + 0.4 * hash01(SEED, chunk, a, salt + 4);
        d[at + PropField.KEEP] = Math.min(hash01(SEED, chunk, a, salt + 5), UNIT_MAX);
        d[at + PropField.TINT_SEED] = Math.min(hash01(SEED, chunk, a, salt + 6), UNIT_MAX);
        d[at + PropField.VARIANT] = Math.min(hash01(SEED, chunk, a, salt + 7), UNIT_MAX);
        n++;
      }
    }
    out.start[ARCHETYPE_COUNT] = n;
  }

  function fillItems(chunk: number, out: ItemRow): void {
    out.chunk = chunk;
    const d = out.data;
    let n = 0;
    for (let k = 0; k < ITEM_KIND_COUNT; k++) {
      if (!allowItem[k]) continue;
      const count = ITEM_SPEC[k]!.perChunk;
      for (let i = 0; i < count; i++) {
        const at = n * ITEM_STRIDE;
        const salt = 200 + k * 16 + i;
        const zLocal = Math.min(((i + hash01(SEED, chunk, salt, 0)) * CHUNK_LEN) / count, ZLOCAL_MAX);
        const seed = Math.min(hash01(SEED, chunk, salt, 1), UNIT_MAX);
        d[at + ItemField.KIND] = k;
        d[at + ItemField.Z_LOCAL] = zLocal;
        d[at + ItemField.SEED] = seed;
        d[at + ItemField.A] = 0;
        d[at + ItemField.B] = 0;
        d[at + ItemField.X] = -30 + 60 * hash01(SEED, chunk, salt, 2);
        d[at + ItemField.Y] = 5 + 6 * hash01(SEED, chunk, salt, 3);
        d[at + ItemField.RADIUS] = 2.5;
        if (k === ItemKind.GATE) {
          d[at + ItemField.RADIUS] = 9;
          d[at + ItemField.Y] = 8;
        } else if (k === ItemKind.SPIKE) {
          d[at + ItemField.RADIUS] = 3.5;
          d[at + ItemField.Y] = 3.5;
        } else if (k === ItemKind.FENCE) {
          d[at + ItemField.X] = 0;
          d[at + ItemField.Y] = 8;
          d[at + ItemField.RADIUS] = 42;
          d[at + ItemField.A] = -28 + 56 * hash01(SEED, chunk, salt, 4);
          d[at + ItemField.B] = 12;
        } else if (k === ItemKind.DRONE) {
          d[at + ItemField.A] = 3 + 5 * hash01(SEED, chunk, salt, 4);
          d[at + ItemField.B] = 1;
        } else if (k === ItemKind.TRAFFIC) {
          d[at + ItemField.Y] = 2.5;
          d[at + ItemField.RADIUS] = 3;
          d[at + ItemField.A] = TRAFFIC_TRAVEL_MAX;
          d[at + ItemField.B] = 48;
        }
        n++;
      }
    }
    out.count = n;
  }

  return { fillProps, fillItems };
}

/** A whole WorldSource: rows from worstCaseRows, everything else from base. */
export function createWorstCaseWorld(base: WorldSource, o: WorstCaseOptions = {}): WorldSource {
  const rows = worstCaseRows(o);
  return {
    seed: base.seed,
    height: (x, iz, zs, zLocal) => base.height(x, iz, zs, zLocal),
    fillProps: rows.fillProps,
    fillItems: rows.fillItems,
    zoneAt: (at, out) => base.zoneAt(at, out),
    bendAt: (at, out) => base.bendAt(at, out),
  };
}
