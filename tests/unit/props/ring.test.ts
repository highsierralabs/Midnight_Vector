// A2i and the RingStore's own rules: per-record wrap, ranges, dead slots, truncation, the idle transition.
import { describe, expect, it } from 'vitest';
import { ARCHETYPE_COUNT, PROP_STRIDE, PropField, ROW_MOD, type ItemRow, type PropRow, type WorldSource } from '../../../src/contracts/index';
import { createPropRow } from '../../../src/core/alloc';
import { createFeeder } from '../../../src/render/props/feeder';
import { RING_PLAN } from '../../../src/render/props/plan';
import { DEAD_KEEP, INST_KEEP, INST_STRIDE, RingStore } from '../../../src/render/props/ring';

const PYRAMID = RING_PLAN[2]!;

function rowWith(n: number, keep: (i: number) => number = () => 0.5): PropRow {
  const row = createPropRow();
  for (let i = 0; i < n; i++) {
    const o = i * PROP_STRIDE;
    row.data[o + PropField.X] = 100 + i;
    row.data[o + PropField.Z_LOCAL] = i;
    row.data[o + PropField.SCALE] = 1;
    row.data[o + PropField.KEEP] = keep(i);
  }
  return row;
}

function deadSlots(r: RingStore): number {
  let n = 0;
  for (let s = 0; s < r.cap; s++) if (r.arr[s * INST_STRIDE + INST_KEEP] === DEAD_KEEP) n++;
  return n;
}

describe('RingStore', () => {
  it('starts with every slot dead', () => {
    const r = new RingStore(PYRAMID);
    expect(deadSlots(r)).toBe(PYRAMID.cap);
    expect(r.fullDirty).toBe(true);
  });

  it('wraps per record, reporting two ranges when a row splits', () => {
    const r = new RingStore({ ...PYRAMID, cap: 5, perChunk: 3 });
    const row = rowWith(3);
    r.writeRow(10, row.data, 0, 3);
    expect(r.rangeCount).toBe(1);
    expect([r.rangeStart[0], r.rangeLen[0]]).toEqual([0, 3]);
    r.writeRow(11, row.data, 0, 3);
    expect(r.rangeCount).toBe(2);
    expect([r.rangeStart[0], r.rangeLen[0], r.rangeStart[1], r.rangeLen[1]]).toEqual([3, 2, 0, 1]);
    expect(r.head).toBe(1);
  });

  it('stores chunk mod 65536 as the row', () => {
    const r = new RingStore(PYRAMID);
    const row = rowWith(1);
    r.writeRow(2 ** 40 + 7, row.data, 0, 1);
    expect(r.arr[3]).toBe(7);
    r.writeRow(ROW_MOD - 1, row.data, 0, 1);
    expect(r.arr[INST_STRIDE + 3]).toBe(ROW_MOD - 1);
  });

  it('lifts keep by rank, ties by ordinal, and stores what it tested', () => {
    const r = new RingStore({ ...PYRAMID, perChunk: 2 });
    const row = rowWith(2, () => 0.01);
    r.writeRow(1, row.data, 0, 2);
    expect(r.arr[INST_KEEP]).toBeCloseTo(0.01, 6);
    expect(r.arr[INST_STRIDE + INST_KEEP]).toBeCloseTo(1 / 2.5, 6);
  });

  it('reset makes a rebuild from equal rows give the same order', () => {
    const r = new RingStore(PYRAMID);
    const row = rowWith(2);
    for (let c = 0; c < 70; c++) r.writeRow(c, row.data, 0, 2);
    r.reset();
    expect(r.head).toBe(0);
    expect(r.liveRecords).toBe(0);
    expect(deadSlots(r)).toBe(PYRAMID.cap);
  });

  it('counts records over the clamp, and accepts no more than it', () => {
    const r = new RingStore({ ...PYRAMID, perChunk: 4 });
    r.setDensity(1, 2, 8);
    const row = rowWith(4, () => 0);
    r.writeRow(1, row.data, 0, 4);
    expect(r.liveRecords).toBe(2);
    expect(r.truncated).toBe(2);
  });
});

/** Records only in rows 0..40, on the PYRAMID ring, nothing afterwards. */
const burst: Pick<WorldSource, 'fillProps' | 'fillItems'> = {
  fillProps(c: number, out: PropRow) {
    out.chunk = c;
    out.start.fill(0);
    if (c >= 0 && c <= 40) {
      out.data[PropField.X] = 300;
      out.data[PropField.Z_LOCAL] = 10;
      out.data[PropField.SCALE] = 1;
      out.data[PropField.KEEP] = 0;
      for (let a = 3; a <= ARCHETYPE_COUNT; a++) out.start[a] = 1;
    }
  },
  fillItems(c: number, out: ItemRow) {
    out.chunk = c;
    out.count = 0;
  },
};

function liveSlotsAt(ring: RingStore, chunk: number): number {
  const camRow = ((chunk % ROW_MOD) + ROW_MOD) % ROW_MOD;
  let n = 0;
  for (let s = 0; s < ring.cap; s++) {
    const o = s * INST_STRIDE;
    if (ring.arr[o + INST_KEEP]! >= 1.5) continue;
    const v = ring.arr[o + 3]! - camRow + 32768;
    const delta = v - 65536 * Math.floor(v / 65536) - 32768;
    const zf = delta * 64 + ring.arr[o + 2]!;
    if (zf >= -30 && zf <= ring.plan.maxDist) n++;
  }
  return n;
}

class NoIdleMark extends RingStore {
  protected override onIdle(): void { /* the mutated subclass: slots keep their stale rows */ }
}

describe('idle transition (A2i)', () => {
  function idleWalk(make: (p: typeof PYRAMID) => RingStore): number {
    const onlyPyramid = [PYRAMID];
    const f = createFeeder(burst, onlyPyramid, make);
    f.rebuild(0);
    const ring = f.rings[0]!;
    let ghostFrames = 0;
    // Past the burst and on for a full wrap of the row counter, so every stale row would alias.
    for (let c = 1; c <= 65536 + 200; c++) {
      f.cross(c);
      if (c > 40 + PYRAMID.reach + 2 && ring.liveRecords === 0 && liveSlotsAt(ring, c) > 0) ghostFrames++;
    }
    return ghostFrames;
  }

  it('has zero live slots at every row once idle', { timeout: 120_000 }, () => {
    expect(idleWalk((p) => new RingStore(p))).toBe(0);
  });

  it('shows ghosts at +65536 with dead marking disabled', { timeout: 120_000 }, () => {
    const ghosts = idleWalk((p) => new NoIdleMark(p));
    console.log(`A2i ghost frames with marking disabled: ${ghosts}`);
    expect(ghosts).toBeGreaterThan(0);
  });
});
