// The model check of plan M1: after a crossing, at a given camera local and phase, the set of live records computed from
// ring slots must equal the set computed from the world's own rows, with no missing record, no extra and no duplicate.
// Hashes keep it fast. A mismatch recomputes the sets and reports counts.
import {
  ARCHETYPE_COUNT, ITEM_STRIDE, ItemField, ItemKind, PROP_STRIDE, PropField, ROW_MOD,
  type WorldSource,
} from '../../../src/contracts/index';
import { createItemRow, createPropRow } from '../../../src/core/alloc';
import { RING_PLAN } from '../../../src/render/props/plan';
import { INST_STRIDE, type RingStore } from '../../../src/render/props/ring';

const BITS = new Float32Array(1);
const BITS_I = new Int32Array(BITS.buffer);
function bits(v: number): number {
  BITS[0] = v;
  return BITS_I[0]!;
}

function rowMod(c: number): number {
  return ((c % ROW_MOD) + ROW_MOD) % ROW_MOD;
}

function fract(x: number): number {
  return x - Math.floor(x);
}

/** One record, as the row gives it. */
interface Rec { x: number; y: number; z: number; row: number; keep: number; a: number; b: number; seed: number; radius: number }

/** Records per ring per row, cached, so the check does not call the world twice for one row. */
export class Truth {
  private readonly cache = new Map<number, Rec[][]>();
  private readonly world: Pick<WorldSource, 'fillProps' | 'fillItems'>;
  constructor(world: Pick<WorldSource, 'fillProps' | 'fillItems'>) {
    this.world = world;
  }

  rows(chunk: number): Rec[][] {
    const got = this.cache.get(chunk);
    if (got) return got;
    const out: Rec[][] = [];
    for (let i = 0; i < RING_PLAN.length; i++) out.push([]);
    const p = createPropRow();
    this.world.fillProps(chunk, p);
    const rowValue = rowMod(chunk);
    for (let a = 0; a < ARCHETYPE_COUNT; a++) {
      const perChunk = RING_PLAN[a]!.perChunk;
      const count = p.start[a + 1]! - p.start[a]!;
      const slice: { keep: number; ord: number }[] = [];
      for (let i = 0; i < count; i++) slice.push({ keep: p.data[(p.start[a]! + i) * PROP_STRIDE + PropField.KEEP]!, ord: i });
      slice.sort((m, n) => m.keep - n.keep || m.ord - n.ord);
      const rank = new Array<number>(count);
      slice.forEach((s, r) => { rank[s.ord] = r; });
      for (let i = 0; i < count; i++) {
        const o = (p.start[a]! + i) * PROP_STRIDE;
        const keep = RING_PLAN[a]!.filtered
          ? Math.max(p.data[o + PropField.KEEP]!, rank[i]! / (perChunk * 1.25))
          : p.data[o + PropField.KEEP]!;
        out[a]!.push({
          x: p.data[o + PropField.X]!, y: p.data[o + PropField.Y]!, z: p.data[o + PropField.Z_LOCAL]!, row: rowValue,
          keep: Math.fround(keep), a: 0, b: 0, seed: 0, radius: 0,
        });
      }
    }
    const it = createItemRow();
    this.world.fillItems(chunk, it);
    for (let i = 0; i < it.count; i++) {
      const o = i * ITEM_STRIDE;
      const k = it.data[o + ItemField.KIND]!;
      out[ARCHETYPE_COUNT + k]!.push({
        x: it.data[o + ItemField.X]!, y: it.data[o + ItemField.Y]!, z: it.data[o + ItemField.Z_LOCAL]!, row: rowValue,
        keep: 0, a: it.data[o + ItemField.A]!, b: it.data[o + ItemField.B]!, seed: it.data[o + ItemField.SEED]!, radius: it.data[o + ItemField.RADIUS]!,
      });
    }
    this.cache.set(chunk, out);
    return out;
  }

  /** Drops rows behind the camera so a long walk holds little. */
  prune(chunk: number): void {
    for (const k of this.cache.keys()) if (k < chunk - 16) this.cache.delete(k);
  }
}

function recHash(x: number, y: number, z: number, row: number): number {
  let h = Math.imul(bits(x), 0x9E3779B1);
  h = Math.imul(h ^ bits(y), 0x85EBCA6B);
  h = Math.imul(h ^ bits(z), 0xC2B2AE35);
  h = Math.imul(h ^ row, 0x27D4EB2F);
  return h ^ (h >>> 15);
}

export interface Violation { ring: string; chunk: number; local: number; missing: number; extra: number; duplicate: number }

export interface CheckOptions {
  /** Camera chunk and local the live test uses. */
  chunk: number; local: number;
  /** Phase 7 for TRAFFIC's forward offset. */
  phase7: number;
  /** Records must have keep' below this. 2 means no density test. */
  density?: number;
  /** Only these ring ids; default every ring in rings. */
}

/** rowDelta as the shader computes it. */
function rowDelta(row: number, camRow: number): number {
  const v = row - camRow + 32768;
  return v - 65536 * Math.floor(v / 65536) - 32768;
}

/** Compares one ring with the truth. rings[i].plan may be mutated, but the truth uses RING_PLAN's reach. */
export function checkRing(ring: RingStore, truth: Truth, o: CheckOptions): Violation | null {
  const id = ring.plan.id;
  const real = RING_PLAN[id]!;
  // The same comparison the ring and the shader make: both sides Float32.
  const d = Math.fround(o.density ?? 2);
  const isTraffic = real.source === 'item' && real.kind === ItemKind.TRAFFIC;
  const camRow = rowMod(o.chunk);

  // From the slots: what the vertex shader would keep alive.
  let sumA = 0;
  let xorA = 0;
  let countA = 0;
  const a = ring.arr;
  for (let s = 0; s < ring.cap; s++) {
    const off = s * INST_STRIDE;
    const keep = a[off + 6]!;
    if (keep >= 1.5) continue;   // dead
    if (keep >= d) continue;
    const fwd = isTraffic ? a[off + 9]! * fract(a[off + 10]! * o.phase7 + a[off + 7]!) : 0;
    const zf = rowDelta(a[off + 3]!, camRow) * 64 + a[off + 2]! + fwd - o.local;
    if (zf < -30 || zf > real.maxDist) continue;
    const h = recHash(a[off]!, a[off + 1]!, a[off + 2]!, a[off + 3]!);
    sumA = (sumA + h) | 0;
    xorA ^= Math.imul(h, 0x2F0B4C87);
    countA++;
  }

  // From the rows.
  let sumB = 0;
  let xorB = 0;
  let countB = 0;
  const first = o.chunk - real.rear - 2;
  const last = o.chunk + real.reach + 2;
  for (let r = first; r <= last; r++) {
    if (r < 0) continue;
    const list = truth.rows(r)[id]!;
    for (let n = 0; n < list.length; n++) {
      const t = list[n]!;
      if (t.keep >= d) continue;
      const fwd = isTraffic ? t.a * fract(t.b * o.phase7 + t.seed) : 0;
      const zf = (r - o.chunk) * 64 + t.z + fwd - o.local;
      if (zf < -30 || zf > real.maxDist) continue;
      const h = recHash(t.x, t.y, t.z, t.row);
      sumB = (sumB + h) | 0;
      xorB ^= Math.imul(h, 0x2F0B4C87);
      countB++;
    }
  }
  if (countA === countB && sumA === sumB && xorA === xorB) return null;

  // Spell the difference out.
  const slots = new Map<number, number>();
  for (let s = 0; s < ring.cap; s++) {
    const off = s * INST_STRIDE;
    const keep = a[off + 6]!;
    if (keep >= 1.5 || keep >= d) continue;
    const fwd = isTraffic ? a[off + 9]! * fract(a[off + 10]! * o.phase7 + a[off + 7]!) : 0;
    const zf = rowDelta(a[off + 3]!, camRow) * 64 + a[off + 2]! + fwd - o.local;
    if (zf < -30 || zf > real.maxDist) continue;
    const h = recHash(a[off]!, a[off + 1]!, a[off + 2]!, a[off + 3]!);
    slots.set(h, (slots.get(h) ?? 0) + 1);
  }
  const rowsSet = new Map<number, number>();
  for (let r = first; r <= last; r++) {
    if (r < 0) continue;
    for (const t of truth.rows(r)[id]!) {
      if (t.keep >= d) continue;
      const fwd = isTraffic ? t.a * fract(t.b * o.phase7 + t.seed) : 0;
      const zf = (r - o.chunk) * 64 + t.z + fwd - o.local;
      if (zf < -30 || zf > real.maxDist) continue;
      const h = recHash(t.x, t.y, t.z, t.row);
      rowsSet.set(h, (rowsSet.get(h) ?? 0) + 1);
    }
  }
  let missing = 0;
  let extra = 0;
  let duplicate = 0;
  for (const [h, n] of rowsSet) {
    const got = slots.get(h) ?? 0;
    if (got < n) missing += n - got;
    if (got > n) duplicate += got - n;
  }
  for (const [h, n] of slots) if (!rowsSet.has(h)) extra += n;
  return { ring: ring.plan.name, chunk: o.chunk, local: o.local, missing, extra, duplicate };
}

export const LOCALS = [0, 7.25, 19.5, 31.75, 40, 48.5, 56.25, 63.75] as const;
export const PHASES = [0, 0.13, 0.31, 0.47, 0.62, 0.77, 0.89, 0.97] as const;
