import { describe, expect, it } from 'vitest';
import { CHUNK_LIMIT, CLIP_LEVELS, CLIP_ROWS, type Travel, type WorldSource } from '../../../src/contracts/index';
import { advance as advanceTravel } from '../../../src/core/coords';
import { AtlasWriter } from '../../../src/render/terrain/atlas';
import { withRefHeight } from '../../../src/render/terrain/dev/devTools';
import { baseRow, spacing } from '../../../src/render/terrain/layout';
import { createFakeWorld } from '../../../src/testing/fakeWorld';
import { gcDuring } from './gcWindow';

const W = 129;
const worlds: readonly (readonly [string, () => WorldSource])[] = [
  ['fake', () => createFakeWorld()],
  ['ref', () => withRefHeight(createFakeWorld())],
];

function atlasRowOf(k: number, q: number): number {
  return ((q % 128) + 128) % 128 + k * 128;
}
function R(data: Float32Array, k: number, q: number, c: number): number {
  return data[(atlasRowOf(k, q) * W + c) * 4]!;
}
function G(data: Float32Array, k: number, q: number, c: number): number {
  return data[(atlasRowOf(k, q) * W + c) * 4 + 1]!;
}

/** The parent's mesh surface at level k's (c, q), from parent R values, with the uniform diagonal (b-d). */
function parentSurface(data: Float32Array, k: number, c: number, q: number): number {
  const cp = (c - 64) / 2 + 64;
  const qp = q / 2;
  const c0 = Math.floor(cp), q0 = Math.floor(qp);
  const fx = cp - c0, fz = qp - q0;
  const h00 = R(data, k + 1, q0, c0);
  if (fx === 0 && fz === 0) return h00;
  const h10 = fx > 0 ? R(data, k + 1, q0, c0 + 1) : h00;
  const h01 = fz > 0 ? R(data, k + 1, q0 + 1, c0) : h00;
  if (fx + fz <= 1) return h00 + fx * (h10 - h00) + fz * (h01 - h00);
  const h11 = R(data, k + 1, q0 + 1, c0 + 1);
  return h11 + (1 - fx) * (h01 - h11) + (1 - fz) * (h10 - h11);
}

function liveRowsEqual(a: Float32Array, b: Float32Array, cam: Travel): number {
  let compared = 0;
  for (let k = 0; k < CLIP_LEVELS; k++) {
    const base = baseRow(k, cam);
    for (let q = base - 2; q <= base + CLIP_ROWS; q++) {
      const from = atlasRowOf(k, q) * W * 4;
      for (let i = from; i < from + W * 4; i++) {
        if (a[i] !== b[i]) throw new Error(`level ${k} row ${q} component ${i - from}: ${a[i]} vs ${b[i]}`);
      }
      compared++;
    }
  }
  return compared;
}

describe.each(worlds)('atlas on the %s world', (_name, make) => {
  it('morph value equals the parent mesh surface, to 1e-3 u, and even-even vertices are exact', () => {
    for (const cam of [{ chunk: 40, local: 21 }, { chunk: 15625000000000, local: 3.5 }]) {
      const writer = new AtlasWriter(make());
      writer.refill(cam);
      const d = writer.data;
      let compared = 0;
      let nonZero = 0;
      for (let k = 0; k < CLIP_LEVELS - 1; k++) {
        const base = baseRow(k, cam);
        for (let q = base; q <= base + CLIP_ROWS; q++) {
          for (let c = 0; c < W; c++) {
            const g = G(d, k, q, c);
            if (q % 2 === 0 && c % 2 === 0) expect(g).toBe(R(d, k, q, c));
            const diff = Math.abs(g - parentSurface(d, k, c, q));
            if (diff > 1e-3) throw new Error(`level ${k} row ${q} col ${c}: G ${g}, parent ${parentSurface(d, k, c, q)}`);
            compared++;
            if (g !== 0) nonZero++;
          }
        }
      }
      expect(compared).toBe(5 * 97 * W);
      expect(nonZero).toBeGreaterThan(compared / 4);
    }
  });

  it('incremental advance over 500 frames equals a fresh refill on all live rows', () => {
    const world = make();
    const writer = new AtlasWriter(world);
    const cam = { chunk: 7, local: 13.25 };
    writer.refill(cam);
    for (let i = 0; i < 500; i++) {
      advanceTravel(cam, 2.5);
      writer.advance(cam, () => undefined);
    }
    const fresh = new AtlasWriter(world);
    fresh.refill(cam);
    expect(liveRowsEqual(writer.data, fresh.data, cam)).toBe(6 * 99);
  });

  it('onRow fires once per row crossed, in the right level band', () => {
    const writer = new AtlasWriter(make());
    const cam = { chunk: 3, local: 0 };
    writer.refill(cam);
    const before = [0, 1, 2, 3, 4, 5].map((k) => baseRow(k, cam));
    const counts = new Array<number>(6).fill(0);
    for (let i = 0; i < 400; i++) {
      advanceTravel(cam, 1.33);
      const seen = new Set<number>();
      writer.advance(cam, (row) => {
        expect(seen.has(row)).toBe(false);
        seen.add(row);
        const k = Math.floor(row / 128);
        expect(k).toBeGreaterThanOrEqual(0);
        expect(k).toBeLessThan(6);
        expect(row).toBeGreaterThanOrEqual(k * 128);
        expect(row).toBeLessThan((k + 1) * 128);
        counts[k]!++;
      });
    }
    for (let k = 0; k < 6; k++) expect(counts[k]).toBe(baseRow(k, cam) - before[k]!);
    expect(counts[0]).toBeGreaterThan(0);
  });

  it('needs a refill only on a forward jump past the ring or a backward move past low', () => {
    const writer = new AtlasWriter(make());
    const cam = { chunk: 100, local: 0 };
    expect(writer.needsRefill(cam)).toBe(true);
    writer.refill(cam);
    expect(writer.needsRefill(cam)).toBe(false);
    // Small forward steps.
    for (let i = 0; i < 40; i++) {
      advanceTravel(cam, 2.5);
      expect(writer.needsRefill(cam)).toBe(false);
      writer.advance(cam, () => undefined);
    }
    // A forward jump past level 0's ring: 128 rows of 2 u is 256 u.
    const far = { chunk: cam.chunk + 8, local: cam.local };
    expect(writer.needsRefill(far)).toBe(true);
    // A backward move past low, on the fresh writer whose low is base - 2.
    const fresh = new AtlasWriter(make());
    fresh.refill(cam);
    expect(fresh.needsRefill({ chunk: cam.chunk - 1, local: cam.local })).toBe(true);
    expect(fresh.needsRefill(cam)).toBe(false);
  });
});

function constantWorld(): WorldSource {
  return { ...createFakeWorld(), height: () => 7.5 };
}

describe('precision limit (DI-93)', () => {
  // Level 0 has 32 rows per chunk, so its rows pass 2^54 just under chunk 2^49. There a double's spacing is 4, and q + 2 rounds back
  // to q (ties to even) at q = 2^54, and at every q that is 0 mod 8 above it. A row loop that cannot advance would spin forever,
  // so the height source counts its calls and throws a plain Error past a budget: without the guard these rows fail on that Error
  // instead of hanging the worker. The budget is about 26 refills.
  const BUDGET = 2_000_000;
  function budgetWorld(): WorldSource {
    let calls = 0;
    return {
      ...createFakeWorld(),
      height: () => {
        if (++calls > BUDGET) throw new Error(`height budget of ${BUDGET} calls spent: the row loop is not progressing`);
        return 7.5;
      },
    };
  }
  const STALL = 2 ** 54;

  it('the arithmetic the rows rest on', () => {
    expect(STALL + 2).toBe(STALL);
    expect(STALL - 2 + 2).toBe(STALL);
    expect(baseRow(0, { chunk: 2 ** 49 + 5, local: 0 })).toBeGreaterThan(STALL);
    // Below the warp limit every level-0 row ahead of the camera stays under 2^53 (contracts, CHUNK_LIMIT). At the top of DI-93's
    // harness range they pass 2^53, where odd rows round but q + 2 is still exact, and stay far under the stall.
    expect(baseRow(0, { chunk: CHUNK_LIMIT - 1, local: 63.9 }) + CLIP_ROWS).toBeLessThan(2 ** 53);
    expect(baseRow(0, { chunk: CHUNK_LIMIT + 1023, local: 63.9 }) + CLIP_ROWS).toBeLessThan(2 ** 53 + 128);
  });

  it('refill throws a RangeError at a chunk where q + 2 rounds to q, and does not hang', () => {
    // VI-r1's chunk, where the harness renderAt hung the tab.
    const writer = new AtlasWriter(budgetWorld());
    expect(() => writer.refill({ chunk: 2 ** 49 + 5, local: 0 })).toThrow(RangeError);
    expect(() => new AtlasWriter(budgetWorld()).refill({ chunk: 2 ** 49 + 5, local: 0 })).toThrow(/no progress/);
  });

  it('advance throws a RangeError when streaming reaches q = 2^54, and does not hang', () => {
    const writer = new AtlasWriter(budgetWorld());
    const cam = { chunk: 2 ** 49 - 8, local: 0 };
    writer.refill(cam);
    expect(baseRow(0, cam) + CLIP_ROWS).toBeLessThan(STALL);
    let thrown: unknown = null;
    let steps = 0;
    try {
      // 2.5 u a frame for up to 16 chunks, well past the stall at about chunk 2^49 - 3.
      for (; steps < 410; steps++) {
        advanceTravel(cam, 2.5);
        writer.advance(cam, () => undefined);
      }
    } catch (e) {
      thrown = e;
    }
    console.log(`DI93 advance threw after ${steps} steps at chunk 2^49${cam.chunk - 2 ** 49 >= 0 ? '+' : ''}${cam.chunk - 2 ** 49} local ${cam.local}: ${String(thrown)}`);
    expect(thrown).toBeInstanceOf(RangeError);
    expect(String(thrown)).toMatch(/no progress/);
    expect(baseRow(0, cam) + CLIP_ROWS).toBeGreaterThan(STALL);
  });

  it('inside R1\'s range the guard never fires: refill and 500 frames of advance at the top of the harness range', () => {
    for (const chunk of [CHUNK_LIMIT - 1, CHUNK_LIMIT + 1023 - 20]) {
      const writer = new AtlasWriter(budgetWorld());
      const cam = { chunk, local: 0 };
      expect(() => writer.refill(cam)).not.toThrow();
      expect(() => {
        for (let i = 0; i < 500; i++) {
          advanceTravel(cam, 2.5);
          writer.advance(cam, () => undefined);
        }
      }).not.toThrow();
    }
  });
});

describe('allocation', () => {

  it('advance allocates nothing, and the control shows the observer can see garbage', async () => {
    const writer = new AtlasWriter(constantWorld());
    const cam = { chunk: 0, local: 0 };
    writer.refill(cam);
    const noop = (): void => undefined;
    for (let i = 0; i < 20_000; i++) {
      advanceTravel(cam, 2.5);
      writer.advance(cam, noop);
    }
    const heapBefore = process.memoryUsage().heapUsed;
    // Only entries that start inside the body count (gcWindow.ts): a mark-compact in the trailing wait is not the body's.
    const clean = await gcDuring(() => {
      for (let i = 0; i < 200_000; i++) {
        advanceTravel(cam, 2.5);
        writer.advance(cam, noop);
      }
    });
    const growth = process.memoryUsage().heapUsed - heapBefore;
    // The control: the same loop allocating one Float64Array(129) per call. If it reads 0 inside its own window, the observer is not
    // working in this pool.
    let keep = 0;
    const control = await gcDuring(() => {
      for (let i = 0; i < 200_000; i++) {
        advanceTravel(cam, 2.5);
        writer.advance(cam, noop);
        keep += new Float64Array(129).length;
      }
    });
    console.log(`ALLOC clean gc=${clean.inBody} (outside ${clean.outside}: ${clean.detail}) growthMB=${(growth / 1048576).toFixed(3)} control gc=${control.inBody} (outside ${control.outside}) keep=${keep}`);
    expect(control.inBody).toBeGreaterThanOrEqual(1);
    expect(clean.inBody).toBe(0);
    expect(growth).toBeLessThan(1024 * 1024);
    expect(spacing(0)).toBe(2);
  });
});
