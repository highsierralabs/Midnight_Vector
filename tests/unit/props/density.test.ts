// A2d: the tier change state machine, the per-row clamp, and the model check under each filter.
import { describe, expect, it } from 'vitest';
import { PROP_STRIDE, PropField, ROW_MOD, type ItemRow, type PropRow, type WorldSource } from '../../../src/contracts/index';
import { createPropRow } from '../../../src/core/alloc';
import { hash01 } from '../../../src/core/hash';
import { DensityMachine, densityUniform, FULL_DENSITY_UNIFORM, perRowClamp, RAMP_TICKS, ringClamp, ringFilter, ringModulus } from '../../../src/render/props/density';
import { worstCaseRows } from '../../../src/render/props/dev/worstCaseWorld';
import { createFeeder, type Feeder } from '../../../src/render/props/feeder';
import { RING_PLAN } from '../../../src/render/props/plan';
import { RingStore, INST_KEEP, INST_STRIDE } from '../../../src/render/props/ring';
import { checkRing, LOCALS, PHASES, Truth } from './modelCheck';

const DENSITIES = [0.7, 0.4, 0.08] as const;

function applyDensity(f: Feeder, d: number): void {
  f.rings.forEach((ring, i) => {
    const p = RING_PLAN[i]!;
    f.refill(i, ringFilter(p, d), ringClamp(p, d), ringModulus(p, d));
    void ring;
  });
}

describe('clamp and modulus', () => {
  it('evaluates left to right, so perChunk 6 at .4 gives 4', () => {
    expect(perRowClamp(6, 0.4)).toBe(4);
    expect(perRowClamp(10, 0.7)).toBe(9);
    expect(perRowClamp(2, 0.08)).toBe(1);
    expect(perRowClamp(32, 1)).toBe(32);
  });

  it('gives modulus(d) per ring, with RING and items unchanged', () => {
    for (const d of DENSITIES) {
      for (const p of RING_PLAN) {
        const m = ringModulus(p, d);
        if (!p.filtered) {
          expect(m).toBe(p.cap);
        } else {
          expect(m).toBe(Math.min(p.perChunk, Math.ceil(p.perChunk * d * 1.25)) * (p.reach + 1 + p.rear));
          expect(m).toBeLessThanOrEqual(p.cap);
        }
      }
    }
    expect(ringModulus(RING_PLAN[0]!, 0.4)).toBe(5 * 27);
    expect(ringModulus(RING_PLAN[13]!, 0.08)).toBe(4);
  });
});

describe('DensityMachine', () => {
  function run(m: DensityMachine, f: Float32Array, startTick: number, ticks: number): { phases: string[]; refills: number[]; ticksAt: number[] } {
    const phases: string[] = [];
    const refills: number[] = [];
    const ticksAt: number[] = [];
    for (let t = 0; t < ticks; t++) {
      const i = m.step(startTick + t, RING_PLAN, f);
      phases.push(m.phase);
      if (i >= 0) {
        f[i] = RING_PLAN[i]!.filtered ? m.target : 1;
        refills.push(i);
        ticksAt.push(startTick + t);
      }
    }
    return { phases, refills, ticksAt };
  }

  it('applies the first call and a rebuild at once, phase idle', () => {
    const m = new DensityMachine();
    m.applyNow(0.4);
    expect(m.current).toBe(0.4);
    expect(m.phase).toBe('idle');
    m.applyNow(1);
    expect(m.current).toBe(FULL_DENSITY_UNIFORM);
  });

  it('going down: ramp first over 90 ticks, then one ring per frame', () => {
    const m = new DensityMachine();
    m.applyNow(1);
    const f = new Float32Array(RING_PLAN.length).fill(1);
    m.request(0.4, 1000);
    expect(m.phase).toBe('ramp');
    m.step(1045, RING_PLAN, f);
    expect(m.current).toBeCloseTo((FULL_DENSITY_UNIFORM + 0.4) / 2, 6);
    expect(f.every((v) => v === 1)).toBe(true);
    const r = run(m, f, 1046, RAMP_TICKS + 40);
    expect(m.current).toBe(0.4);
    expect(m.phase).toBe('idle');
    // Filtered rings only, once each, in separate frames.
    expect(r.refills.length).toBe(RING_PLAN.filter((p) => p.filtered).length);
    expect(new Set(r.ticksAt).size).toBe(r.ticksAt.length);
    expect(r.ticksAt[0]!).toBeGreaterThanOrEqual(1090);
  });

  it('going up: refill first, one ring per frame, and only then the ramp', () => {
    const m = new DensityMachine();
    m.applyNow(0.4);
    const f = Float32Array.from(RING_PLAN.map((p) => (p.filtered ? 0.4 : 1)));
    m.request(1, 500);
    expect(m.phase).toBe('refill');
    const before = m.current;
    const first = m.step(500, RING_PLAN, f);
    expect(first).toBe(0);
    expect(m.current).toBe(before);
    f[0] = 1;
    const filtered = RING_PLAN.filter((p) => p.filtered).length;
    const rest = run(m, f, 501, filtered - 1);
    expect(m.current).toBe(before);
    expect(rest.refills.length).toBe(filtered - 1);
    run(m, f, 530, RAMP_TICKS + 5);
    expect(m.current).toBe(FULL_DENSITY_UNIFORM);
    expect(m.phase).toBe('idle');
  });

  it('finishes a ramp when the tick goes backwards', () => {
    const m = new DensityMachine();
    m.applyNow(1);
    const f = new Float32Array(RING_PLAN.length).fill(1);
    m.request(0.7, 1000);
    m.step(1010, RING_PLAN, f);
    expect(m.current).toBeGreaterThan(0.7);
    m.step(5, RING_PLAN, f);
    expect(m.current).toBe(0.7);
  });

  it('restarts from the current uDensity on a new request mid-ramp', () => {
    const m = new DensityMachine();
    m.applyNow(1);
    const f = new Float32Array(RING_PLAN.length).fill(1);
    m.request(0.4, 0);
    m.step(45, RING_PLAN, f);
    const mid = m.current;
    m.request(0.7, 45);
    expect(m.current).toBe(mid);
    expect(m.target).toBe(0.7);
    m.step(45 + RAMP_TICKS / 2, RING_PLAN, f);
    expect(m.current).toBeCloseTo(densityUniform((mid + 0.7) / 2), 6);
  });

  it('refills every ring whose filter differs after a mid-refill reversal, including perChunk 1 rings', () => {
    const m = new DensityMachine();
    m.applyNow(1);
    const f = new Float32Array(RING_PLAN.length).fill(1);
    m.request(0.4, 0);
    run(m, f, 0, RAMP_TICKS + 8);
    expect(m.phase).toBe('refill');
    const done = RING_PLAN.filter((p, i) => p.filtered && f[i] !== 1).map((p) => p.name);
    expect(done.length).toBeGreaterThan(0);
    m.request(1, 200);
    const back = run(m, f, 200, 60);
    expect(new Set(back.refills.map((i) => RING_PLAN[i]!.name))).toEqual(new Set(done));
    for (const v of f) expect(v).toBe(1);
  });
});

describe('model check under each filter', () => {
  it('finds the set keep\' < d, with truncated 0', { timeout: 120_000 }, () => {
    const world = worstCaseRows();
    const truth = new Truth(world);
    for (const d of DENSITIES) {
      const f = createFeeder(world, RING_PLAN);
      f.rebuild(3000);
      applyDensity(f, d);
      for (let c = 3001; c <= 3300; c++) {
        f.cross(c);
        for (let i = 0; i < LOCALS.length; i++) {
          f.rings.forEach((ring, id) => {
            const density = RING_PLAN[id]!.filtered ? d : 2;
            const v = checkRing(ring, truth, { chunk: c, local: LOCALS[i]!, phase7: PHASES[i]!, density });
            expect(v).toBeNull();
          });
        }
        truth.prune(c);
      }
      for (const ring of f.rings) expect(ring.truncated).toBe(0);
    }
  });

  it('still holds after a mid-refill reversal on a perChunk 1 ring', () => {
    const world = worstCaseRows();
    const truth = new Truth(world);
    const f = createFeeder(world, RING_PLAN);
    f.rebuild(4000);
    const dish = 12;
    const p = RING_PLAN[dish]!;
    expect(p.perChunk).toBe(1);
    expect(ringModulus(p, 0.4)).toBe(ringModulus(p, 1));
    f.refill(dish, ringFilter(p, 0.4), ringClamp(p, 0.4), ringModulus(p, 0.4));
    f.refill(dish, ringFilter(p, 1), ringClamp(p, 1), ringModulus(p, 1));
    for (let c = 4001; c <= 4040; c++) {
      f.cross(c);
      expect(checkRing(f.rings[dish]!, truth, { chunk: c, local: 12, phase7: 0 })).toBeNull();
    }
  });
});

describe('per-row sets', () => {
  it('stay within the clamp and nest as d rises, with RING and PYLON unmoved', () => {
    const world = worstCaseRows();
    const f = createFeeder(world, RING_PLAN);
    for (let c = 7000; c < 7600; c++) {
      f.rebuild(c);
      RING_PLAN.forEach((p, id) => {
        if (p.source !== 'prop') return;
        const ring = f.rings[id]!;
        const rowValue = ((c % ROW_MOD) + ROW_MOD) % ROW_MOD;
        const keeps: number[] = [];
        for (let s = 0; s < ring.cap; s++) {
          const o = s * INST_STRIDE;
          if (ring.arr[o + INST_KEEP]! < 1.5 && ring.arr[o + 3] === rowValue) keeps.push(ring.arr[o + INST_KEEP]!);
        }
        for (const d of DENSITIES) {
          if (!p.filtered) continue;
          expect(keeps.filter((k) => k < Math.fround(d)).length).toBeLessThanOrEqual(perRowClamp(p.perChunk, d));
        }
        if (p.name === 'RING') for (const k of keeps) expect(k).toBe(0);
        if (p.name === 'PYLON') {
          expect(keeps.length).toBe(2);
          expect(keeps.map((k) => Math.round(k * 10) / 10).sort()).toEqual([0.1, 0.6]);
        }
      });
    }
  });

  it('negative control: a ring storing plain keep overflows the clamp', () => {
    // Without the lift, independent hashed keeps put more than perRowClamp(d) of a row under d.
    let over = 0;
    let cases = 0;
    const row = createPropRow();
    for (let c = 0; c < 4000; c++) {
      for (const p of RING_PLAN) {
        if (p.source !== 'prop' || !p.filtered || p.perChunk < 2) continue;
        for (const d of DENSITIES) {
          let n = 0;
          for (let i = 0; i < p.perChunk; i++) {
            const k = hash01(99, c, p.id, i);
            row.data[i * PROP_STRIDE + PropField.KEEP] = k;
            if (k < d) n++;
          }
          cases++;
          if (n > perRowClamp(p.perChunk, d)) over++;
        }
      }
    }
    console.log(`A2d negative control: ${over} of ${cases} row-density cases overflow without the lift`);
    expect(over).toBeGreaterThan(0);
  });

  it('negative control: with keep\' = keep a mutated subclass truncates a live record', () => {
    class PlainKeep extends RingStore {
      override writeRow(chunk: number, src: Float32Array, start: number, end: number): void {
        // A row where every record passes the plain keep test at d: copies by hand, as if no rank lift existed.
        const before = this.truncated;
        let accepted = 0;
        for (let i = start; i < end; i++) {
          if (src[i * PROP_STRIDE + PropField.KEEP]! < this.filter) {
            if (accepted >= this.clamp) this.truncated++;
            else accepted++;
          }
        }
        void before;
        super.writeRow(chunk, src, start, end);
      }
    }
    const allLow: Pick<WorldSource, 'fillProps' | 'fillItems'> = {
      fillProps(c: number, out: PropRow) {
        out.chunk = c;
        out.start.fill(0);
        const n = RING_PLAN[0]!.perChunk;
        for (let i = 0; i < n; i++) {
          out.data[i * PROP_STRIDE + PropField.KEEP] = 0.01;
          out.data[i * PROP_STRIDE + PropField.SCALE] = 1;
        }
        for (let a = 1; a <= 20; a++) out.start[a] = n;
      },
      fillItems(c: number, out: ItemRow) { out.chunk = c; out.count = 0; },
    };
    const palm = RING_PLAN[0]!;
    const f = createFeeder(allLow, [palm], (p) => new PlainKeep(p));
    f.refill(0, ringFilter(palm, 0.4), ringClamp(palm, 0.4), ringModulus(palm, 0.4));
    f.rebuild(50);
    expect(f.rings[0]!.truncated).toBeGreaterThan(0);
    // The real store under the same world truncates nothing, because the lift moves the rest over the filter.
    const g = createFeeder(allLow, [palm]);
    g.refill(0, ringFilter(palm, 0.4), ringClamp(palm, 0.4), ringModulus(palm, 0.4));
    g.rebuild(50);
    expect(g.rings[0]!.truncated).toBe(0);
  });
});
