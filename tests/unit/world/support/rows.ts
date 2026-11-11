// Caller-owned rows for the world tests, row comparison and the FNV-1a digest used by the goldens.
import {
  ARCHETYPE_COUNT, ITEM_STRIDE, MAX_ITEMS_PER_CHUNK, MAX_PROPS_PER_CHUNK, PALETTE_FLOATS, PROP_STRIDE, Objective,
  type ItemRow, type PropRow, type ZoneState,
} from '../../../../src/contracts/index';

export function newPropRow(): PropRow {
  return { chunk: 0, data: new Float32Array(PROP_STRIDE * MAX_PROPS_PER_CHUNK), start: new Uint16Array(ARCHETYPE_COUNT + 1) };
}

export function newItemRow(): ItemRow {
  return { chunk: 0, data: new Float32Array(ITEM_STRIDE * MAX_ITEMS_PER_CHUNK), count: 0 };
}

export function newZoneState(): ZoneState {
  return {
    index: 0, biomeA: 0, biomeB: 0, biomeMix: 0, paletteA: 0, paletteB: 0, paletteMix: 0,
    palette: new Float32Array(PALETTE_FLOATS), heroA: 0, heroB: 0, heroMix: 0,
    objective: Objective.GATES, objectiveTarget: 0, musicKey: 0, dayPhase: 0,
  };
}

/** A copy of everything fillProps writes except out.chunk, as bytes, tail included. */
export function propBytes(row: PropRow): Uint8Array {
  const data = new Uint8Array(row.data.buffer, row.data.byteOffset, row.data.byteLength);
  const start = new Uint8Array(row.start.buffer, row.start.byteOffset, row.start.byteLength);
  const out = new Uint8Array(data.length + start.length);
  out.set(data, 0);
  out.set(start, data.length);
  return out;
}

/** A copy of everything fillItems writes except out.chunk, as bytes, tail included. */
export function itemBytes(row: ItemRow): Uint8Array {
  const data = new Uint8Array(row.data.buffer, row.data.byteOffset, row.data.byteLength);
  const out = new Uint8Array(data.length + 4);
  out.set(data, 0);
  new DataView(out.buffer).setUint32(data.length, row.count, true);
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Count of bytes that differ. */
export function bytesDiffer(a: Uint8Array, b: Uint8Array): number {
  let n = Math.abs(a.length - b.length);
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) if (a[i] !== b[i]) n++;
  return n;
}

export function fnv1a(bytes: Uint8Array, seed = 0x811c9dc5): number {
  let h = seed;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
