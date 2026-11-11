import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ARCHETYPE_COUNT, ARCHETYPE_SPEC, Archetype, ITEM_KIND_COUNT, ITEM_SPEC, ITEM_STRIDE, ItemField, ItemKind, MAX_ITEMS_PER_CHUNK, MAX_PROPS_PER_CHUNK,
  PALETTE_COUNT, PALETTE_FLOATS, PALETTE_NAMES, PROP_STRIDE, PropField, TRAFFIC_TRAVEL_MAX, VALLEY_HALF, ZONE_CHUNKS,
} from '../../../src/contracts/index';
import { createBendState, createItemRow, createPropRow, createZoneState } from '../../../src/core/alloc';
import { createFakeWorld, writeFakePalette } from '../../../src/testing/fakeWorld';

const arch = readFileSync('architecture.md', 'utf8');
const world = createFakeWorld();
const SAMPLE_CHUNKS = [0, 1, 2, 3, 47, 48, 96, 1000, 2 ** 20, 2 ** 40 + 3, 2 ** 48 - 1025, -1, -48];

describe('height', () => {
  it('is exactly 0 in the valley', () => {
    for (const x of [0, 1, -1, 44, -44, VALLEY_HALF, -VALLEY_HALF]) {
      for (const iz of [0, 1, 500, 2 ** 40, -3]) {
        expect(world.height(x, iz, 64, 12.5)).toBe(0);
      }
    }
  });

  it('rises above the valley, and never goes negative', () => {
    let peak = 0;
    for (let x = 85.5; x < 2000; x += 13.7) {
      for (let iz = 0; iz < 32; iz++) {
        const h = world.height(x, iz, 64, 7);
        expect(h).toBeGreaterThanOrEqual(0);
        peak = Math.max(peak, h / x);
      }
    }
    expect(peak).toBeGreaterThan(0.1);
    expect(peak).toBeLessThan(0.28);
  });

  it('gives the same height through different (iz, zs, zLocal) splits, and at iz = 2^40', () => {
    const x = 400;
    const z = 64 * 7 + 13;
    const a = world.height(x, 7, 64, 13);
    expect(world.height(x, 14, 32, 13)).toBeCloseTo(a, 9);
    expect(world.height(x, 28, 16, 13)).toBeCloseTo(a, 9);
    expect(world.height(x, Math.floor(z / 2), 2, z % 2)).toBeCloseTo(a, 9);
    expect(world.height(x, 7 + 2 ** 40, 64, 13)).toBe(a);
  });

  it('is continuous across a chunk boundary', () => {
    const a = world.height(400, 7, 64, 63.9999);
    const b = world.height(400, 8, 64, 0);
    expect(Math.abs(a - b)).toBeLessThan(0.01);
  });
});

function records(chunk: number, w = world): { row: ReturnType<typeof createPropRow>; of: (a: number) => Float32Array[] } {
  const row = createPropRow();
  w.fillProps(chunk, row);
  return {
    row,
    of: (a) => {
      const out: Float32Array[] = [];
      for (let i = row.start[a]!; i < row.start[a + 1]!; i++) out.push(row.data.slice(i * PROP_STRIDE, (i + 1) * PROP_STRIDE));
      return out;
    },
  };
}

describe('fillProps', () => {
  it('sets out.chunk as passed, even under a period', () => {
    const row = createPropRow();
    createFakeWorld({ periodChunks: 1024 }).fillProps(2048 + 5, row);
    expect(row.chunk).toBe(2048 + 5);
  });

  it('is equal in any call order, and does not depend on the prior contents of out', () => {
    const a = createPropRow();
    const b = createPropRow();
    world.fillProps(5, a);
    world.fillProps(700, b);
    world.fillProps(96, b);
    world.fillProps(5, b);
    expect(Array.from(b.data)).toEqual(Array.from(a.data));
    expect(Array.from(b.start)).toEqual(Array.from(a.start));
  });

  it('keeps start monotonic and the total under the cap, with a zero tail', () => {
    for (const c of SAMPLE_CHUNKS) {
      const { row } = records(c);
      for (let a = 0; a < ARCHETYPE_COUNT; a++) expect(row.start[a + 1]).toBeGreaterThanOrEqual(row.start[a]!);
      const total = row.start[ARCHETYPE_COUNT]!;
      expect(total).toBeLessThanOrEqual(MAX_PROPS_PER_CHUNK);
      for (let i = total * PROP_STRIDE; i < row.data.length; i++) expect(row.data[i]).toBe(0);
    }
  });

  it('keeps zLocal, keep, tintSeed and variant in range after Float32 storage, and scale above 0', () => {
    // One aggregated expect: one per field over these chunks took 4.7 s against a 5 s limit, and failed under load.
    const row = createPropRow();
    const unitFields = [PropField.KEEP, PropField.TINT_SEED, PropField.VARIANT];
    const bad: string[] = [];
    let seen = 0;
    for (let c = 0; c < 2000; c++) {
      world.fillProps(c, row);
      const total = row.start[ARCHETYPE_COUNT]!;
      seen += total;
      for (let i = 0; i < total; i++) {
        const r = i * PROP_STRIDE;
        const z = row.data[r + PropField.Z_LOCAL]!;
        if (!(z >= 0 && z < 64)) bad.push(`chunk ${c} record ${i} zLocal ${z}`);
        for (const f of unitFields) {
          const v = row.data[r + f]!;
          if (!(v >= 0 && v < 1)) bad.push(`chunk ${c} record ${i} field ${f} is ${v}`);
        }
        const scale = row.data[r + PropField.SCALE]!;
        if (!(scale > 0)) bad.push(`chunk ${c} record ${i} scale ${scale}`);
      }
    }
    expect(seen).toBeGreaterThan(100000);
    expect(bad).toEqual([]);
  });

  it('shows all 20 archetypes, and no row exceeds perChunk', () => {
    const seen = new Set<number>();
    for (let c = 0; c < 200; c++) {
      const { of } = records(c);
      for (let a = 0; a < ARCHETYPE_COUNT; a++) {
        const n = of(a).length;
        if (n > 0) seen.add(a);
        expect(n).toBeLessThanOrEqual(ARCHETYPE_SPEC[a]!.perChunk);
      }
    }
    expect(seen.size).toBe(ARCHETYPE_COUNT);
  });

  it('places small archetypes beside the road and the others on the slopes', () => {
    const { of } = records(9);
    for (const r of of(Archetype.PALM)) {
      expect(Math.abs(r[PropField.X]!)).toBeGreaterThanOrEqual(44);
      expect(Math.abs(r[PropField.X]!)).toBeLessThanOrEqual(85);
      expect(r[PropField.Y]).toBe(0);
    }
    for (const r of of(Archetype.ARCOLOGY)) {
      expect(Math.abs(r[PropField.X]!)).toBeGreaterThanOrEqual(120);
      expect(Math.abs(r[PropField.X]!)).toBeLessThanOrEqual(500);
    }
    for (const r of of(Archetype.ORB)) {
      expect(r[PropField.Y]).toBeGreaterThan(0);
    }
  });

  it('writes the RING record on chunks divisible by 48 only', () => {
    expect(records(49).of(Archetype.RING)).toEqual([]);
    const [ring] = records(96).of(Archetype.RING);
    expect(ring).toBeDefined();
    expect(ring![PropField.X]).toBe(0);
    expect(ring![PropField.Y]).toBe(Math.fround(65.14));
    expect(ring![PropField.Z_LOCAL]).toBe(32);
    expect(ring![PropField.YAW]).toBe(0);
    expect(ring![PropField.SCALE]).toBe(1);
    expect(ring![PropField.KEEP]).toBe(0);
  });

  it('writes PYLON pairs left first, with the wire flag following the next row', () => {
    const wired = records(0).of(Archetype.PYLON);
    expect(wired.length).toBe(2);
    expect(wired[0]![PropField.X]).toBe(-100);
    expect(wired[1]![PropField.X]).toBe(100);
    expect(wired[0]![PropField.KEEP]).toBe(Math.fround(0.1));
    expect(wired[1]![PropField.KEEP]).toBe(Math.fround(0.6));
    for (const r of wired) {
      expect(r[PropField.Y]).toBe(0);
      expect(r[PropField.Z_LOCAL]).toBe(0);
      expect(r[PropField.YAW]).toBe(0);
      expect(r[PropField.SCALE]).toBe(1);
      expect(r[PropField.VARIANT]).toBe(0.75);
    }
    // Row 27 is the last in its run, so its wires have nothing to reach.
    const last = records(27).of(Archetype.PYLON);
    expect(last.length).toBe(2);
    expect(last[0]![PropField.VARIANT]).toBe(0.25);
    expect(records(28).of(Archetype.PYLON)).toEqual([]);
  });

  it('adds a constant hover to the floating types and none to the rest', () => {
    const FLOATING = new Map<number, number>([[Archetype.ORB, 6], [Archetype.CRYSTAL, 8], [Archetype.SAUCER, 40]]);
    const seen = new Set<number>();
    const bad: string[] = [];
    for (const c of [0, 1, 7, 96, 1000]) {
      const { of } = records(c);
      for (let a = 0; a < ARCHETYPE_COUNT; a++) {
        // These two are written from T01's rows, with no height lookup.
        if (a === Archetype.RING || a === Archetype.PYLON) continue;
        for (const r of of(a)) {
          seen.add(a);
          const hover = r[PropField.Y]! - world.height(r[PropField.X]!, c, 64, r[PropField.Z_LOCAL]!);
          // The height is read back from Float32 fields, so the two sides differ by rounding only.
          if (Math.abs(hover - (FLOATING.get(a) ?? 0)) > 1e-2) bad.push(`chunk ${c} archetype ${a} hover ${hover}`);
        }
      }
    }
    expect(seen.size).toBe(ARCHETYPE_COUNT - 2);
    expect(bad).toEqual([]);
  });

  it('o.archetypes isolates one type', () => {
    const only = createFakeWorld({ archetypes: [Archetype.PALM] });
    const row = createPropRow();
    only.fillProps(96, row);
    expect(row.start[ARCHETYPE_COUNT]).toBe(ARCHETYPE_SPEC[Archetype.PALM].perChunk);
    expect(row.start[Archetype.PALM + 1]! - row.start[Archetype.PALM]!).toBe(ARCHETYPE_SPEC[Archetype.PALM].perChunk);
  });

  it('periodChunks = 1024 makes chunk k and k + 1024 * 2^37 equal', () => {
    const w = createFakeWorld({ periodChunks: 1024 });
    for (const k of [0, 5, 48, 777, 1023]) {
      const a = createPropRow();
      const b = createPropRow();
      w.fillProps(k, a);
      w.fillProps(k + 1024 * 2 ** 37, b);
      expect(Array.from(b.data)).toEqual(Array.from(a.data));
      expect(Array.from(b.start)).toEqual(Array.from(a.start));
      const ia = createItemRow();
      const ib = createItemRow();
      w.fillItems(k, ia);
      w.fillItems(k + 1024 * 2 ** 37, ib);
      expect(Array.from(ib.data)).toEqual(Array.from(ia.data));
      expect(ib.count).toBe(ia.count);
      expect(w.height(400, k + 1024 * 2 ** 37, 64, 3)).toBe(w.height(400, k, 64, 3));
    }
  });

  it('negative control: without a period those chunks differ', () => {
    const a = createPropRow();
    const b = createPropRow();
    world.fillProps(5, a);
    world.fillProps(5 + 1024 * 2 ** 37, b);
    expect(Array.from(b.data)).not.toEqual(Array.from(a.data));
  });
});

describe('fillItems', () => {
  function items(chunk: number, w = world): Float32Array[] {
    const row = createItemRow();
    w.fillItems(chunk, row);
    const out: Float32Array[] = [];
    for (let i = 0; i < row.count; i++) out.push(row.data.slice(i * ITEM_STRIDE, (i + 1) * ITEM_STRIDE));
    return out;
  }
  const ofKind = (r: Float32Array[], k: number) => r.filter((x) => x[ItemField.KIND] === k);

  it('shows all six kinds, with no kind over its perChunk and under 32 records', () => {
    const seen = new Set<number>();
    for (let c = 0; c < 400; c++) {
      const r = items(c);
      expect(r.length).toBeLessThan(MAX_ITEMS_PER_CHUNK);
      for (let k = 0; k < ITEM_KIND_COUNT; k++) {
        const n = ofKind(r, k).length;
        if (n > 0) seen.add(k);
        expect(n).toBeLessThanOrEqual(ITEM_SPEC[k]!.perChunk);
      }
    }
    expect(seen.size).toBe(ITEM_KIND_COUNT);
  });

  it('orders records by kind, then zLocal', () => {
    for (let c = 0; c < 400; c++) {
      const r = items(c);
      for (let i = 1; i < r.length; i++) {
        const a = r[i - 1]!;
        const b = r[i]!;
        const ordered = a[ItemField.KIND]! < b[ItemField.KIND]!
          || (a[ItemField.KIND] === b[ItemField.KIND] && a[ItemField.Z_LOCAL]! <= b[ItemField.Z_LOCAL]!);
        expect(ordered).toBe(true);
      }
    }
  });

  it('keeps every record in its ranges', () => {
    for (let c = 0; c < 400; c++) {
      for (const r of items(c)) {
        expect(r[ItemField.RADIUS]!).toBeGreaterThan(0);
        expect(r[ItemField.SEED]! >= 0 && r[ItemField.SEED]! < 1).toBe(true);
        expect(r[ItemField.Z_LOCAL]! >= 0 && r[ItemField.Z_LOCAL]! < 64).toBe(true);
        expect(Math.abs(r[ItemField.X]!)).toBeLessThanOrEqual(40);
        expect(r[ItemField.Y]! >= 2 && r[ItemField.Y]! <= 14).toBe(true);
      }
    }
  });

  it('writes a GATE on chunk % 3 === 0 only, at zLocal 0, y 8, radius 9', () => {
    for (let c = 0; c < 60; c++) {
      const gates = ofKind(items(c), ItemKind.GATE);
      expect(gates.length).toBe(c % 3 === 0 ? 1 : 0);
      for (const g of gates) {
        expect(g[ItemField.Z_LOCAL]).toBe(0);
        expect(g[ItemField.Y]).toBe(8);
        expect(g[ItemField.RADIUS]).toBe(9);
        expect(g[ItemField.A]).toBe(0);
        expect(g[ItemField.B]).toBe(0);
      }
    }
  });

  it('writes a FENCE at x 0, radius 42, y 8, never in a gate chunk, with a gap', () => {
    let found = 0;
    for (let c = 0; c < 400; c++) {
      for (const f of ofKind(items(c), ItemKind.FENCE)) {
        found++;
        expect(c % 3).not.toBe(0);
        expect(f[ItemField.X]).toBe(0);
        expect(f[ItemField.RADIUS]).toBe(42);
        expect(f[ItemField.Y]).toBe(8);
        expect(Math.abs(f[ItemField.A]!)).toBeLessThanOrEqual(28);
        expect(f[ItemField.B]).toBe(12);
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it('puts shards on the world 12 u lattice, with a = b = 0', () => {
    let found = 0;
    for (let c = 0; c < 90; c++) {
      for (const s of ofKind(items(c), ItemKind.SHARD)) {
        found++;
        expect((c * 64 + s[ItemField.Z_LOCAL]!) % 12).toBe(0);
        expect(s[ItemField.A]).toBe(0);
        expect(s[ItemField.B]).toBe(0);
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it('gives DRONE and TRAFFIC integer k, and TRAFFIC a legal travel', () => {
    let drones = 0;
    let cars = 0;
    for (let c = 0; c < 400; c++) {
      const r = items(c);
      for (const d of ofKind(r, ItemKind.DRONE)) {
        drones++;
        expect(d[ItemField.A]!).toBeGreaterThan(0);
        expect(Number.isInteger(d[ItemField.B])).toBe(true);
      }
      for (const t of ofKind(r, ItemKind.TRAFFIC)) {
        cars++;
        expect(t[ItemField.A]!).toBeGreaterThan(0);
        expect(t[ItemField.A]!).toBeLessThanOrEqual(TRAFFIC_TRAVEL_MAX);
        expect(Number.isInteger(t[ItemField.B])).toBe(true);
        const speed = (t[ItemField.A]! * t[ItemField.B]!) / 256;
        expect(speed >= 20 && speed <= 40).toBe(true);
      }
    }
    expect(drones).toBeGreaterThan(0);
    expect(cars).toBeGreaterThan(0);
  });

  it('o.items isolates one kind', () => {
    const only = createFakeWorld({ items: [ItemKind.GATE] });
    expect(items(3, only).length).toBe(1);
    expect(items(4, only).length).toBe(0);
  });
});

describe('zoneAt', () => {
  it('follows the plan and returns out', () => {
    const z = createZoneState();
    expect(world.zoneAt({ chunk: 712, local: 3 }, z)).toBe(z);
    expect(z.index).toBe(7);
    expect(z.biomeA).toBe(1);
    expect(z.biomeB).toBe(1);
    expect(z.biomeMix).toBe(0);
    expect(z.paletteA).toBe(1);
    expect(z.paletteB).toBe(1);
    expect(z.paletteMix).toBe(0);
    expect(z.heroA).toBe(0);
    expect(z.heroB).toBe(0);
    expect(z.heroMix).toBe(0);
    expect(z.objective).toBe(2);
    expect(z.objectiveTarget).toBe(10);
    expect(z.musicKey).toBe(7);
    expect(z.dayPhase).toBe(712 / 750);
  });

  it('o.at = 100 * k gives zone.index k, which T07 relies on', () => {
    const z = createZoneState();
    for (const k of [0, 1, 5, 12]) expect(world.zoneAt({ chunk: 100 * k, local: 0 }, z).index).toBe(k);
  });

  it('writes the Sunset Drive table, converted to linear', () => {
    const z = createZoneState();
    world.zoneAt({ chunk: 0, local: 0 }, z);
    // #0D0221 top, green channel: 2/255 is under the linear cut-off.
    expect(z.palette[1]).toBeCloseTo(2 / 255 / 12.92, 6);
    // #F6019D grid, red channel, slot 5.
    expect(z.palette[15]).toBeCloseTo(Math.pow((246 / 255 + 0.055) / 1.055, 2.4), 6);
  });

  it('matches every value of the section 6.8 table, through writeFakePalette and through zoneAt', () => {
    const start = arch.indexOf('### 6.8 Palette');
    const section = arch.slice(start, arch.indexOf('### 6.9 ', start));
    const rows = [...section.matchAll(/^\| ([^|]+?) \|((?: #[0-9A-Fa-f]{6} \|){7})\s*$/gm)];
    expect(rows.map((m) => m[1])).toEqual([...PALETTE_NAMES]);
    expect(rows.length).toBe(PALETTE_COUNT);

    const linear = (byte: number): number => {
      const c = byte / 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const direct = new Float32Array(PALETTE_FLOATS);
    const zone = createZoneState();
    const bad: string[] = [];
    let compared = 0;
    rows.forEach((m, p) => {
      const hexes = [...m[2]!.matchAll(/#([0-9A-Fa-f]{6})/g)].map((h) => parseInt(h[1]!, 16));
      writeFakePalette(p, direct);
      world.zoneAt({ chunk: p * ZONE_CHUNKS, local: 0 }, zone);
      hexes.forEach((hex, slot) => {
        [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].forEach((byte, channel) => {
          const at = slot * 3 + channel;
          const want = linear(byte);
          compared++;
          // One step of an 8-bit channel moves the linear value by at least 3e-4, so 1e-6 tells them apart.
          if (Math.abs(direct[at]! - want) > 1e-6) bad.push(`${m[1]} writeFakePalette slot ${slot} channel ${channel}: ${direct[at]} against ${want}`);
          if (Math.abs(zone.palette[at]! - want) > 1e-6) bad.push(`${m[1]} zoneAt slot ${slot} channel ${channel}: ${zone.palette[at]} against ${want}`);
        });
      });
    });
    expect(compared).toBe(PALETTE_COUNT * PALETTE_FLOATS);
    expect(compared).toBe(126);
    expect(bad).toEqual([]);
  });

  it('stays legal at chunk -1, and at the largest chunks', () => {
    const z = createZoneState();
    world.zoneAt({ chunk: -1, local: 0 }, z);
    expect(z.biomeA).toBeGreaterThanOrEqual(0);
    expect(z.paletteA).toBeGreaterThanOrEqual(0);
    expect(z.musicKey).toBeGreaterThanOrEqual(0);
    expect(z.dayPhase >= 0 && z.dayPhase < 1).toBe(true);
    world.zoneAt({ chunk: 2 ** 48 - 1025, local: 0 }, z);
    expect(Number.isInteger(z.index)).toBe(true);
    expect(z.dayPhase >= 0 && z.dayPhase < 1).toBe(true);
  });
});

describe('bendAt', () => {
  it('keeps abs(a) within 8e-5, c and vMax constant', () => {
    const b = createBendState();
    for (let c = 0; c < 2000; c += 7) {
      expect(world.bendAt({ chunk: c, local: 0 }, b)).toBe(b);
      expect(Math.abs(b.a)).toBeLessThanOrEqual(8e-5);
      expect(b.c).toBe(-1.2e-5);
      expect(b.vMax).toBe(1500);
    }
  });

  it('is exact at a distance: 2^40 chunks is a whole number of both periods', () => {
    const a = createBendState();
    const b = createBendState();
    world.bendAt({ chunk: 5, local: 12.5 }, a);
    world.bendAt({ chunk: 5 + 2 ** 40, local: 12.5 }, b);
    expect(b.a).toBe(a.a);
  });
});

describe('periodChunks, at a period that shares no factor with the functions own periods', () => {
  // 256 and 1024 chunks both divide 1024, so periodChunks 1024 cannot show that bendAt or height reduce the chunk.
  const PERIOD = 101;
  const w = createFakeWorld({ periodChunks: PERIOD });

  it('reduces the chunk in bendAt, height and zoneAt', () => {
    const k = 5;
    const a = w.bendAt({ chunk: k, local: 12.5 }, createBendState()).a;
    expect(w.bendAt({ chunk: k + PERIOD, local: 12.5 }, createBendState()).a).toBe(a);
    expect(w.bendAt({ chunk: k + PERIOD * 2 ** 30, local: 12.5 }, createBendState()).a).toBe(a);
    expect(w.height(400, k + PERIOD, 64, 3)).toBe(w.height(400, k, 64, 3));
    const z = createZoneState();
    w.zoneAt({ chunk: k + PERIOD, local: 0 }, z);
    expect(z.index).toBe(0);
    expect(z.dayPhase).toBe(k / 750);
  });

  it('negative control: without a period the same chunks differ', () => {
    const k = 5;
    expect(world.bendAt({ chunk: k + PERIOD, local: 12.5 }, createBendState()).a).not.toBe(world.bendAt({ chunk: k, local: 12.5 }, createBendState()).a);
    expect(world.height(400, k + PERIOD, 64, 3)).not.toBe(world.height(400, k, 64, 3));
    const z = createZoneState();
    world.zoneAt({ chunk: k + PERIOD, local: 0 }, z);
    expect(z.index).toBe(1);
  });
});
