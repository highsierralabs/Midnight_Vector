// A2: the crossing schedule and the FIFO model check, in Node. A2n: mutated plans that must make the check report a violation.
import { describe, expect, it } from 'vitest';
import { CHUNK_LIMIT, ITEM_STRIDE, ItemField, ItemKind, type ItemRow, type PropRow, type WorldSource } from '../../../src/contracts/index';
import { ringClamp, ringFilter, ringModulus } from '../../../src/render/props/density';
import { worstCaseRows } from '../../../src/render/props/dev/worstCaseWorld';
import { createFeeder, type Feeder } from '../../../src/render/props/feeder';
import { RING_PLAN, type RingPlanEntry } from '../../../src/render/props/plan';
import { RingStore, INST_KEEP, INST_STRIDE } from '../../../src/render/props/ring';
import { checkRing, LOCALS, PHASES, Truth, type Violation } from './modelCheck';

const BASES = [0, 65400, 2 ** 40 - 100, 2 ** 48 - 2024];

function counted(base: Pick<WorldSource, 'fillProps' | 'fillItems'>) {
  const asked = { props: [] as number[], items: [] as number[] };
  const world: Pick<WorldSource, 'fillProps' | 'fillItems'> = {
    fillProps(c: number, out: PropRow) { asked.props.push(c); base.fillProps(c, out); },
    fillItems(c: number, out: ItemRow) { asked.items.push(c); base.fillItems(c, out); },
  };
  return { asked, world };
}

/** Walks crossings and runs the check. Returns the first violation, or null. */
function walk(plan: readonly RingPlanEntry[], base: number, crossings: number, feedBeforeMoving = false): Violation | null {
  const world = worstCaseRows();
  const truth = new Truth(world);
  const feeder = createFeeder(world, plan);
  feeder.rebuild(base);
  for (let n = 1; n <= crossings; n++) {
    const c = base + n;
    feeder.cross(c);
    const cam = feedBeforeMoving ? c - 1 : c;
    for (let i = 0; i < LOCALS.length; i++) {
      for (const ring of feeder.rings) {
        const v = checkRing(ring, truth, { chunk: cam, local: LOCALS[i]!, phase7: PHASES[i]! });
        if (v) return v;
      }
    }
    truth.prune(c);
  }
  return null;
}

describe('crossing schedule', () => {
  it('asks for one row each per cross, and 96 and 29 per rebuild', () => {
    const { asked, world } = counted(worstCaseRows());
    const f = createFeeder(world, RING_PLAN);
    f.rebuild(1000);
    expect(asked.props.length).toBe(96);
    expect(asked.items.length).toBe(29);
    expect(Math.min(...asked.props)).toBe(999);
    expect(Math.max(...asked.props)).toBe(1094);
    expect(Math.min(...asked.items)).toBe(997);
    expect(Math.max(...asked.items)).toBe(1025);
    asked.props.length = 0;
    asked.items.length = 0;
    for (let c = 1001; c <= 1040; c++) {
      f.cross(c);
      expect(asked.props).toEqual([c + 94]);
      expect(asked.items).toEqual([c + 25]);
      asked.props.length = 0;
      asked.items.length = 0;
    }
    // Nothing between crossings: the feeder has no per-frame path.
    expect(asked.props.length).toBe(0);
  });

  it('never requests a row below 0 at chunk 0', () => {
    const { asked, world } = counted(worstCaseRows());
    const f = createFeeder(world, RING_PLAN);
    f.rebuild(0);
    expect(Math.min(...asked.props)).toBe(0);
    expect(Math.min(...asked.items)).toBe(0);
    expect(asked.props.length).toBe(95);
    f.rebuild(-1);
    expect(Math.min(...asked.props)).toBe(0);
    f.cross(0);
    expect(Math.min(...asked.props)).toBe(0);
  });

  it('keeps rows requested near CHUNK_LIMIT below 2^53', () => {
    const { asked, world } = counted(worstCaseRows());
    const f = createFeeder(world, RING_PLAN);
    f.rebuild(CHUNK_LIMIT - 1);
    f.cross(CHUNK_LIMIT);
    expect(Math.max(...asked.props)).toBeLessThan(2 ** 53);
    expect(Math.max(...asked.items)).toBeLessThan(2 ** 53);
    for (const r of asked.props) expect(Number.isInteger(r)).toBe(true);
  });

  it('gives identical buffers from a rebuild whatever came before', () => {
    const w = worstCaseRows();
    const a = createFeeder(w, RING_PLAN);
    const b = createFeeder(w, RING_PLAN);
    a.rebuild(500);
    for (let c = 501; c <= 700; c++) a.cross(c);
    a.rebuild(70000);
    b.rebuild(70000);
    a.rings.forEach((r, i) => expect(Buffer.from(r.arr.buffer).equals(Buffer.from(b.rings[i]!.arr.buffer))).toBe(true));
  });
});

describe('model check', () => {
  for (const base of BASES) {
    it(`holds over 2000 crossings from ${base}`, { timeout: 180_000 }, () => {
      expect(walk(RING_PLAN, base, 2000)).toBeNull();
    });
  }
});

describe('negative controls: each must make the model check report a violation', () => {
  function mutated(change: (p: RingPlanEntry) => RingPlanEntry): RingPlanEntry[] {
    return RING_PLAN.map(change);
  }
  const SPAN = 200;

  it('reach - 1 loses records ahead', () => {
    const plan = mutated((p) => (p.name === 'PALM' ? { ...p, reach: p.reach - 1, cap: p.perChunk * (p.reach + p.rear) } : p));
    const v = walk(plan, 1000, SPAN);
    console.log('A2n reach-1:', JSON.stringify(v));
    expect(v).not.toBeNull();
    expect(v!.missing).toBeGreaterThan(0);
  });

  it('cap - perChunk overwrites live records', () => {
    const plan = mutated((p) => (p.name === 'PALM' ? { ...p, cap: p.cap - p.perChunk } : p));
    const v = walk(plan, 1000, SPAN);
    console.log('A2n cap-perChunk:', JSON.stringify(v));
    expect(v).not.toBeNull();
    expect(v!.missing).toBeGreaterThan(0);
  });

  it('TRAFFIC at 108, without its third rear row, loses cars while live', () => {
    const plan = mutated((p) => (p.name === 'TRAFFIC' ? { ...p, rear: 2, cap: 108 } : p));
    const v = walk(plan, 1000, SPAN);
    console.log('A2n traffic108:', JSON.stringify(v));
    expect(v).not.toBeNull();
    expect(v!.ring).toBe('TRAFFIC');
    expect(v!.missing).toBeGreaterThan(0);
  });

  it('rear = 0 loses records behind', () => {
    const plan = mutated((p) => (p.name === 'CRYSTAL' ? { ...p, rear: 0, cap: p.perChunk * (p.reach + 1) } : p));
    const v = walk(plan, 1000, SPAN);
    console.log('A2n rear0:', JSON.stringify(v));
    expect(v).not.toBeNull();
    expect(v!.missing).toBeGreaterThan(0);
  });

  it('feeding before moving the camera loses the rear row', () => {
    const v = walk(RING_PLAN, 1000, SPAN, true);
    console.log('A2n feed-first:', JSON.stringify(v));
    expect(v).not.toBeNull();
    expect(v!.missing).toBeGreaterThan(0);
  });
});

// DI-70: the GPU-free gate on DI-62's slide. A sliding ring walked through N crossings must hold the same bytes as a rebuild at the
// end chunk, slot by slot, because additive blending depends on instance order. The plan is a parameter, so the control is a plan.
describe('slot order (DI-70): a sliding ring after N crossings equals a rebuild, byte for byte', () => {
  const SLIDING = ['SAUCER', 'SEARCHLIGHT', 'FENCE'] as const;
  // None is a multiple of a sliding ring's span (49, 49 and 15), so a strict FIFO's head is off a rebuild's at all but chance cases.
  const CROSSINGS = [1, 2, 37, 301, 2003] as const;
  // Every tier's propDensity: tier 0, 1, 2 and 3 to 4.
  const DENSITIES = [1, 0.7, 0.4, 0.08] as const;

  function atDensity(f: Feeder, d: number): void {
    f.rings.forEach((ring, i) => f.refill(i, ringFilter(ring.plan, d), ringClamp(ring.plan, d), ringModulus(ring.plan, d)));
  }

  /** firstSlot below both heads means a drawable slot differs; at or above them, only dead slots do. */
  interface Mismatch { ring: string; base: number; n: number; bytes: number; firstSlot: number; head: [number, number] }
  const drawable = (m: Mismatch): boolean => m.head[0] !== m.head[1] || (m.firstSlot >= 0 && m.firstSlot < m.head[0]);

  /** From each base at density d, walks the crossings and, at each N, compares the named rings with a fresh rebuild at base + N. */
  function compare(plan: readonly RingPlanEntry[], d: number): { compares: number; mismatches: Mismatch[] } {
    const world = worstCaseRows();
    const ids = SLIDING.map((name) => plan.findIndex((p) => p.name === name));
    const mismatches: Mismatch[] = [];
    let compares = 0;
    for (const base of BASES) {
      const walked = createFeeder(world, plan);
      walked.rebuild(base);
      atDensity(walked, d);
      let n = 0;
      for (const target of CROSSINGS) {
        while (n < target) walked.cross(base + ++n);
        const rebuilt = createFeeder(world, plan);
        rebuilt.rebuild(base + n);
        atDensity(rebuilt, d);
        for (const id of ids) {
          const w = walked.rings[id]!;
          const r = rebuilt.rings[id]!;
          const a = new Uint8Array(w.arr.buffer);
          const b = new Uint8Array(r.arr.buffer);
          let bytes = 0;
          let first = -1;
          for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) {
              bytes++;
              if (first < 0) first = i;
            }
          }
          compares++;
          if (bytes > 0 || a.length !== b.length || w.head !== r.head) {
            mismatches.push({ ring: plan[id]!.name, base, n, bytes, firstSlot: first < 0 ? -1 : Math.floor(first / (INST_STRIDE * 4)), head: [w.head, r.head] });
          }
        }
      }
    }
    return { compares, mismatches };
  }

  function equalCases(mismatches: readonly Mismatch[]): string[] {
    const out: string[] = [];
    for (const base of BASES) for (const n of CROSSINGS) for (const name of SLIDING) {
      if (!mismatches.some((m) => m.ring === name && m.base === base && m.n === n)) out.push(`${name} ${base}+${n}`);
    }
    return out;
  }

  it('holds for SAUCER, SEARCHLIGHT and FENCE at every tier density', { timeout: 120_000 }, () => {
    const spans = SLIDING.map((name) => { const p = RING_PLAN.find((q) => q.name === name)!; return `${name} ${p.reach + 1 + p.rear}`; });
    const lines: string[] = [];
    const all: Mismatch[] = [];
    for (const d of DENSITIES) {
      const { compares, mismatches } = compare(RING_PLAN, d);
      lines.push(`d ${d}: ${compares - mismatches.length} of ${compares} equal, ${mismatches.filter(drawable).length} with a drawable slot differing`);
      all.push(...mismatches);
    }
    console.log(`DI-70 slot order, spans ${spans.join(', ')}; after ${CROSSINGS.join(', ')} crossings from ${BASES.length} bases: ${lines.join('; ')}`);
    if (all.length > 0) console.log(`DI-70 first mismatches: ${JSON.stringify(all.slice(0, 3))}`);
    expect(all.length, 'compares where a walked sliding ring differs from a rebuild').toBe(0);
  });

  // From base 0 a rebuild skips row -1, so a FIFO's head can land where a rebuild's does after k * span + 1 crossings, by chance.
  it('no-slide control: with slides false the same check finds a drawable slot differing, for every ring at every density', { timeout: 120_000 }, () => {
    const noSlide = RING_PLAN.map((p) => ((SLIDING as readonly string[]).includes(p.name) ? { ...p, slides: false } : p));
    const lines: string[] = [];
    for (const d of DENSITIES) {
      const { compares, mismatches } = compare(noSlide, d);
      const equal = d === 1 ? ` (equal: ${JSON.stringify(equalCases(mismatches))})` : '';
      lines.push(`d ${d}: ${mismatches.length} of ${compares} differ, ${mismatches.filter(drawable).length} in a drawable slot${equal}`);
      for (const name of SLIDING) expect(mismatches.some((m) => m.ring === name && drawable(m)), `${name} at d ${d}`).toBe(true);
    }
    console.log(`DI-70 no-slide control: ${lines.join('; ')}`);
  });
});

describe('hideItem', () => {
  /** Two shards in row 10, nothing else. */
  const world: Pick<WorldSource, 'fillProps' | 'fillItems'> = {
    fillProps(c, out) { out.chunk = c; out.start.fill(0); },
    fillItems(c, out) {
      out.chunk = c;
      out.count = 0;
      if (c !== 10) return;
      for (let i = 0; i < 2; i++) {
        const o = i * ITEM_STRIDE;
        out.data[o + ItemField.KIND] = ItemKind.SHARD;
        out.data[o + ItemField.X] = i;
        out.data[o + ItemField.Y] = 6;
        out.data[o + ItemField.Z_LOCAL] = 8 + i;
        out.data[o + ItemField.RADIUS] = 2.5;
        out.data[o + ItemField.SEED] = 0.5;
      }
      out.count = 2;
    },
  };
  const SHARD_RING = 20;

  it('hides that record alone and reports one float', () => {
    const f = createFeeder(world, RING_PLAN);
    f.rebuild(5);
    f.hideItem(10, 1);
    expect(f.hideRing).toBe(SHARD_RING);
    const ring = f.rings[SHARD_RING]!;
    const keeps = [];
    for (let s = 0; s < 2; s++) keeps.push(ring.arr[s * INST_STRIDE + INST_KEEP]);
    expect(keeps).toEqual([0, 2]);
    expect(f.hideFloat).toBe(1 * INST_STRIDE + INST_KEEP);
  });

  it('ignores an unknown row and an unfed record, without throwing', () => {
    const f = createFeeder(world, RING_PLAN);
    f.rebuild(5);
    f.hideItem(4000, 0);
    expect(f.hideRing).toBe(-1);
    f.hideItem(10, 5);
    expect(f.hideRing).toBe(-1);
    f.hideItem(10, 999);
    expect(f.hideRing).toBe(-1);
    // Row 10 is in the item cache but not yet fed to the SHARD ring from chunk -10.
    const g = createFeeder(world, RING_PLAN);
    g.rebuild(0);
    g.hideItem(10, 0);
    expect(g.hideRing).toBe(20);
    const h = createFeeder(world, RING_PLAN);
    h.rebuild(0);
    for (let c = 1; c <= 13; c++) h.cross(c);
    h.hideItem(10, 0);
    expect(h.hideRing).toBe(20);
  });

  it('does not hit a slot that a newer record has taken', () => {
    const rowsEverywhere: Pick<WorldSource, 'fillProps' | 'fillItems'> = {
      fillProps(c, out) { out.chunk = c; out.start.fill(0); },
      fillItems(c, out) {
        out.chunk = c;
        out.data[ItemField.KIND] = ItemKind.SHARD;
        out.data[ItemField.Z_LOCAL] = c % 64;
        out.data[ItemField.SEED] = 0.25;
        out.count = 1;
      },
    };
    const smaller = RING_PLAN.map((p) => (p.name === 'SHARD' ? { ...p, cap: 4 } : p));
    const f = createFeeder(rowsEverywhere, smaller);
    f.rebuild(100);
    for (let c = 101; c <= 120; c++) f.cross(c);
    f.hideItem(c0(), 0);
    expect(f.hideRing).toBe(-1);
    function c0(): number { return 118; }
  });
});

describe('ring accounting', () => {
  it('counts liveRecords over the span of rows', () => {
    const w = worstCaseRows({ archetypes: [2], items: [] });
    const f = createFeeder(w, RING_PLAN);
    f.rebuild(100);
    const r: RingStore = f.rings[2]!;
    expect(r.liveRecords).toBe(2 * (63 + 2));
    expect(r.truncated).toBe(0);
    expect(f.rings[0]!.liveRecords).toBe(0);
  });
});
