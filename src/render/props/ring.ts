// RingStore: one archetype's or item kind's ring. Pure, no three. Most rings are strict FIFOs: new records overwrite the oldest
// slots, wrapping per record at `modulus`, so a row can split across the wrap and no fragmentation can occur. Rings with an additive
// draw (SAUCER, SEARCHLIGHT and FENCE, `plan.slides`) slide instead, as section 6.5 says (DI-62): the row leaving the window is
// removed and the live slots shift down, so slot order equals a rebuild's, because additive blending into a half-float target
// depends on instance order. Vacated slots are zeroed and dead, so the whole buffer equals a rebuild's (DI-70, feeder.test.ts).
// Capacity is the same either way.
// Layout, 12 floats per slot:   aInstA x, y, zLocal, row | aInstB yaw, scale, keep', tintSeed | aInstC variant, 0, 0, 0
//                       items   aInstA x, y, zLocal, row | aInstB TAU * seed, radius or 1, 0 (2 hidden), seed | aInstC seed, a, b, radius
import { ITEM_STRIDE, ItemField, ItemKind, MAX_PROPS_PER_CHUNK, PROP_STRIDE, PropField, ROW_MOD } from '../../contracts/index';
import type { RingPlanEntry } from './plan';

export const INST_STRIDE = 12;
/** A slot's keep once dead: above any density, so the shader always collapses it. */
export const DEAD_KEEP = 2;
export const INST_KEEP = 6;
const TAU = 2 * Math.PI;

// One thread, and writeRow does not re-enter, so one set of scratch serves every ring.
const sortKeep = new Float32Array(MAX_PROPS_PER_CHUNK);
const sortOrder = new Int32Array(MAX_PROPS_PER_CHUNK);
const rankOf = new Int32Array(MAX_PROPS_PER_CHUNK);

export class RingStore {
  readonly plan: Readonly<RingPlanEntry>;
  readonly arr: Float32Array;
  readonly cap: number;
  /** Rows the ring spans, reach + 1 + rear. */
  readonly span: number;
  head = 0;
  modulus: number;
  filter = 1;
  clamp: number;
  liveRecords = 0;
  truncated = 0;
  /** Every float must go to the GPU: a reset or the idle transition happened since the layer last looked. */
  fullDirty = true;
  /** The one or two slot ranges the last write touched, in slots. */
  rangeCount = 0;
  readonly rangeStart = new Int32Array(2);
  readonly rangeLen = new Int32Array(2);
  private readonly rowCount: Int32Array;
  private slid = false;

  constructor(plan: Readonly<RingPlanEntry>) {
    this.plan = plan;
    this.cap = plan.cap;
    this.span = plan.reach + 1 + plan.rear;
    this.arr = new Float32Array(plan.cap * INST_STRIDE);
    this.modulus = plan.cap;
    this.clamp = plan.perChunk;
    this.rowCount = new Int32Array(this.span);
    this.markAllDead();
  }

  /** Marks every slot dead, sets head to 0 and forgets the row counts. A rebuild from equal rows then gives the same slot order. */
  reset(): void {
    this.head = 0;
    this.rowCount.fill(0);
    this.liveRecords = 0;
    this.rangeCount = 0;
    // Zeroed as well as dead, so identical rows give identical buffers, whatever came before.
    this.arr.fill(0);
    this.markAllDead();
  }

  /** Takes effect from the next write. The caller resets first when records already stored must obey it too. */
  setDensity(filter: number, clamp: number, modulus: number): void {
    this.filter = filter;
    this.clamp = clamp;
    this.modulus = modulus;
  }

  private markAllDead(): void {
    const a = this.arr;
    for (let i = INST_KEEP; i < a.length; i += INST_STRIDE) a[i] = DEAD_KEEP;
    this.fullDirty = true;
  }

  /** Idle transition: a slot untouched for 65536 chunks would otherwise alias back to live through rowDelta. Protected, so a test subclass can disable it. */
  protected onIdle(): void {
    this.markAllDead();
  }

  /** A sliding ring: the row leaving the window goes, and the rest moves down. Its rows stay ascending from slot 0, as a rebuild writes them. */
  private slideOut(chunk: number): void {
    const removed = this.rowCount[chunk % this.span]!;
    if (removed === 0) return;
    const a = this.arr;
    const end = this.head * INST_STRIDE;
    a.copyWithin(0, removed * INST_STRIDE, end);
    this.head -= removed;
    // Zeroed as well as dead, as reset leaves a slot, so the buffer equals a rebuild's byte for byte at every density (DI-70).
    a.fill(0, this.head * INST_STRIDE, (this.head + removed) * INST_STRIDE);
    for (let s = this.head; s < this.head + removed; s++) a[s * INST_STRIDE + INST_KEEP] = DEAD_KEEP;
    this.slid = true;
  }

  /** oldEnd: where the ring's used slots ended before this row, which a slide also dirtied. */
  private endRow(chunk: number, firstSlot: number, accepted: number, oldEnd: number): void {
    // Record the one or two ranges the row landed on.
    if (this.slid) {
      this.slid = false;
      this.rangeStart[0] = 0;
      this.rangeLen[0] = Math.max(firstSlot + accepted, oldEnd);
      this.rangeCount = 1;
    } else if (accepted > 0) {
      const toEnd = this.modulus - firstSlot;
      if (accepted <= toEnd) {
        this.rangeStart[0] = firstSlot;
        this.rangeLen[0] = accepted;
        this.rangeCount = 1;
      } else {
        this.rangeStart[0] = firstSlot;
        this.rangeLen[0] = toEnd;
        this.rangeStart[1] = 0;
        this.rangeLen[1] = accepted - toEnd;
        this.rangeCount = 2;
      }
    }
    const at = chunk % this.span;
    const was = this.liveRecords;
    this.liveRecords += accepted - this.rowCount[at]!;
    this.rowCount[at] = accepted;
    if (was > 0 && this.liveRecords === 0) {
      this.rangeCount = 0;
      this.onIdle();
    }
  }

  /** Copies a prop row's records start .. end - 1 that pass the ring's filter (DI-41). */
  writeRow(chunk: number, src: Float32Array, start: number, end: number): void {
    this.rangeCount = 0;
    const count = end - start;
    const rowValue = ((chunk % ROW_MOD) + ROW_MOD) % ROW_MOD;
    // Rank the slice by ascending keep, ties by ordinal: an insertion sort on preallocated scratch.
    for (let i = 0; i < count; i++) {
      const k = src[(start + i) * PROP_STRIDE + PropField.KEEP]!;
      let j = i - 1;
      while (j >= 0 && sortKeep[j]! > k) {
        sortKeep[j + 1] = sortKeep[j]!;
        sortOrder[j + 1] = sortOrder[j]!;
        j--;
      }
      sortKeep[j + 1] = k;
      sortOrder[j + 1] = i;
    }
    for (let r = 0; r < count; r++) rankOf[sortOrder[r]!] = r;

    const a = this.arr;
    const div = this.plan.perChunk * 1.25;
    const filter = Math.fround(this.filter);
    const clamp = this.clamp;
    const oldEnd = this.head;
    const slides = this.plan.slides;
    if (slides) this.slideOut(chunk);
    const firstSlot = this.head;
    const modulus = this.modulus;
    let head = firstSlot;
    let accepted = 0;
    for (let i = 0; i < count; i++) {
      const at = (start + i) * PROP_STRIDE;
      const keep = src[at + PropField.KEEP]!;
      const lift = rankOf[i]! / div;
      const ringKeep = Math.fround(keep > lift ? keep : lift);
      if (!(ringKeep < filter)) continue;
      if (accepted >= clamp) {
        this.truncated++;
        continue;
      }
      const o = head * INST_STRIDE;
      a[o] = src[at + PropField.X]!;
      a[o + 1] = src[at + PropField.Y]!;
      a[o + 2] = src[at + PropField.Z_LOCAL]!;
      a[o + 3] = rowValue;
      a[o + 4] = src[at + PropField.YAW]!;
      a[o + 5] = src[at + PropField.SCALE]!;
      a[o + 6] = ringKeep;
      a[o + 7] = src[at + PropField.TINT_SEED]!;
      a[o + 8] = src[at + PropField.VARIANT]!;
      a[o + 9] = 0;
      a[o + 10] = 0;
      a[o + 11] = 0;
      head++;
      if (head >= modulus && !slides) head = 0;
      accepted++;
    }
    this.head = head;
    this.endRow(chunk, firstSlot, accepted, oldEnd);
  }

  /** Copies an item row's records of this ring's kind. slot[ordinal] receives the ring slot. */
  writeItems(chunk: number, src: Float32Array, count: number, slot: Int16Array): void {
    this.rangeCount = 0;
    const a = this.arr;
    const kind = this.plan.kind;
    const rowValue = ((chunk % ROW_MOD) + ROW_MOD) % ROW_MOD;
    const clamp = this.clamp;
    const oldEnd = this.head;
    const slides = this.plan.slides;
    if (slides) this.slideOut(chunk);
    const firstSlot = this.head;
    const modulus = this.modulus;
    let head = firstSlot;
    let accepted = 0;
    for (let i = 0; i < count; i++) {
      const at = i * ITEM_STRIDE;
      if (src[at + ItemField.KIND]! !== kind) continue;
      if (accepted >= clamp) {
        this.truncated++;
        continue;
      }
      const o = head * INST_STRIDE;
      const seed = src[at + ItemField.SEED]!;
      const radius = src[at + ItemField.RADIUS]!;
      a[o] = src[at + ItemField.X]!;
      a[o + 1] = src[at + ItemField.Y]!;
      a[o + 2] = src[at + ItemField.Z_LOCAL]!;
      a[o + 3] = rowValue;
      a[o + 4] = TAU * seed;
      // SHARD draws at a fixed size: its radius is a generous pickup radius (S-10).
      a[o + 5] = kind === ItemKind.SHARD ? 1 : radius;
      a[o + 6] = 0;
      a[o + 7] = seed;
      a[o + 8] = seed;
      a[o + 9] = src[at + ItemField.A]!;
      a[o + 10] = src[at + ItemField.B]!;
      a[o + 11] = radius;
      slot[i] = head;
      head++;
      if (head >= modulus && !slides) head = 0;
      accepted++;
    }
    this.head = head;
    this.endRow(chunk, firstSlot, accepted, oldEnd);
  }
}
