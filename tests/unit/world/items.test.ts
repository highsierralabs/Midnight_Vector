import { describe, expect, it } from 'vitest';
import {
  CHUNK_LIMIT, ITEM_KIND_COUNT, ITEM_SPEC, ITEM_STRIDE, ItemField, ItemKind, MAX_ITEMS_PER_CHUNK, PLAY_HALF_X, TRAFFIC_TRAVEL_MAX,
  type ItemRow,
} from '../../../src/contracts/index';
import { LANE_Y_MAX, LANE_Y_MIN, laneHeight, laneHeightPair, laneNode, laneNodePair, laneX } from '../../../src/world/lanes';
import { fnv1a, itemBytes, newItemRow } from './support/rows';
import { composeWorld } from './support/worlds';

const SEED = 1985;
const LONG = 120_000;
const world = composeWorld(SEED, 0);

function schemaProblems(row: ItemRow, chunk: number): string[] {
  const out: string[] = [];
  const { data, count } = row;
  if (row.chunk !== chunk) out.push('out.chunk');
  if (count > MAX_ITEMS_PER_CHUNK) out.push('count');
  for (let i = count * ITEM_STRIDE; i < data.length; i++) {
    if (data[i] !== 0) { out.push('tail not zero'); break; }
  }
  const kinds = new Int32Array(ITEM_KIND_COUNT);
  let prevKind = -1;
  let prevZ = -Infinity;
  for (let i = 0; i < count; i++) {
    const o = i * ITEM_STRIDE;
    for (let f = 0; f < ITEM_STRIDE; f++) if (!Number.isFinite(data[o + f]!)) out.push('non-finite');
    const kind = data[o + ItemField.KIND]!;
    if (kind < prevKind) out.push('kind order');
    if (kind === prevKind && data[o + ItemField.Z_LOCAL]! < prevZ) out.push(`z order in kind ${kind}`);
    prevKind = kind;
    prevZ = data[o + ItemField.Z_LOCAL]!;
    kinds[kind] = kinds[kind]! + 1;
    const z = data[o + ItemField.Z_LOCAL]!;
    if (z < 0 || z >= 64) out.push('zLocal range');
    if (Math.abs(data[o + ItemField.X]!) > PLAY_HALF_X + 2) out.push(`kind ${kind} outside the play window`);
    if (!(data[o + ItemField.RADIUS]! > 0)) out.push('radius');
    const seed = data[o + ItemField.SEED]!;
    if (seed < 0 || seed >= 1) out.push('seed range');
    const a = data[o + ItemField.A]!;
    const b = data[o + ItemField.B]!;
    if (kind === ItemKind.SHARD || kind === ItemKind.SPIKE) {
      if (a !== 0 || b !== 0) out.push('a, b of a plain kind');
    }
    if (kind === ItemKind.DRONE) {
      if (a < 3 || a > 8 || b !== 1) out.push('drone amp or k');
      if (Math.abs(data[o + ItemField.X]!) + a > 40 + 1e-5) out.push('drone swing outside the window');
      const y = data[o + ItemField.Y]!;
      if (y < 5 || y > 12) out.push('drone y');
    }
    if (kind === ItemKind.TRAFFIC) {
      if (a > TRAFFIC_TRAVEL_MAX) out.push('traffic travel');
      if (![64, 96, 128].includes(a)) out.push('traffic travel set');
      if (!Number.isInteger(b)) out.push('traffic k');
      const speed = a * b / 256;
      if (speed < 20 || speed > 40) out.push(`traffic speed ${speed}`);
      if (z + a >= 192) out.push('traffic reach');
      if (![-15, -7, 7, 15].includes(data[o + ItemField.X]!)) out.push('traffic lane');
      if (data[o + ItemField.Y] !== 2.5 || data[o + ItemField.RADIUS] !== 3) out.push('traffic y or radius');
    }
    if (kind === ItemKind.FENCE) {
      if (data[o + ItemField.X] !== 0 || data[o + ItemField.RADIUS] !== 42 || data[o + ItemField.Y] !== 8) out.push('fence span');
      if (b < 7 || b > 12) out.push('fence gap');
      if (Math.abs(a) > 28) out.push('fence gap centre');
    }
    if (kind === ItemKind.SPIKE) {
      if (data[o + ItemField.Y] !== 3.5 || data[o + ItemField.RADIUS] !== 3.5) out.push('spike y or radius');
    }
  }
  for (let k = 0; k < ITEM_KIND_COUNT; k++) {
    if (kinds[k]! > ITEM_SPEC[k]!.perChunk) out.push(`perChunk of kind ${k}`);
  }
  return out;
}

/** Straight lines between lane nodes: the path T02's autopilot flies. */
function pathX(chunk: number, zLocal: number): number {
  const n = Math.floor(chunk / 3);
  const t = (zLocal + (chunk - 3 * n) * 64) / 192;
  const g0 = laneNode(SEED, n);
  return g0 + (laneNode(SEED, n + 1) - g0) * t;
}

/** DI-118: the same straight path in height, between the nodes' heights, in place of the fixed y 8 it had. */
function pathY(chunk: number, zLocal: number): number {
  const n = Math.floor(chunk / 3);
  const t = (zLocal + (chunk - 3 * n) * 64) / 192;
  const h0 = laneHeight(SEED, n);
  return h0 + (laneHeight(SEED, n + 1) - h0) * t;
}

const SHIP_R = 2;

/** Hits a ship on the straight path would take from one row. Drones count at full amplitude, on either side. */
function pathHits(row: ItemRow, chunk: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < row.count; i++) {
    const o = i * ITEM_STRIDE;
    const kind = row.data[o + ItemField.KIND]!;
    const x = row.data[o + ItemField.X]!;
    const y = row.data[o + ItemField.Y]!;
    const z = row.data[o + ItemField.Z_LOCAL]!;
    const r = row.data[o + ItemField.RADIUS]!;
    const a = row.data[o + ItemField.A]!;
    const b = row.data[o + ItemField.B]!;
    const px = pathX(chunk, z);
    const py = pathY(chunk, z);
    if (kind === ItemKind.GATE) {
      if (Math.hypot(px - x, py - y) > r) out.push(`gate missed at ${chunk}`);
    } else if (kind === ItemKind.FENCE) {
      if (Math.abs(px - a) > b - SHIP_R) out.push(`fence gap missed at ${chunk}`);
    } else if (kind === ItemKind.SPIKE) {
      if (Math.hypot(px - x, py - y) <= r + SHIP_R) out.push(`spike hit at ${chunk}`);
    } else if (kind === ItemKind.DRONE) {
      const dx = Math.max(Math.abs(px - x) - a, 0);
      if (Math.hypot(dx, py - y) <= r + SHIP_R) out.push(`drone hit at ${chunk}`);
    } else if (kind === ItemKind.TRAFFIC) {
      // A car runs along its lane, so check the path anywhere along the car's whole travel.
      for (let d = 0; d <= a; d += 8) {
        const span = z + d;
        const rowChunk = chunk + Math.floor(span / 64);
        const local = span - Math.floor(span / 64) * 64;
        if (Math.hypot(pathX(rowChunk, local) - x, pathY(rowChunk, local) - y) <= r + SHIP_R) out.push(`traffic hit at ${chunk}`);
      }
    }
  }
  return out;
}

describe('lanes', () => {
  it('stays within 26, and a chunk-boundary crossing is continuous', () => {
    let prev = laneX(SEED, 0, 0, 0);
    for (let c = 0; c < 3000; c++) {
      for (let z = 0; z < 64; z += 8) {
        const x = laneX(SEED, 0, c, z);
        expect(Math.abs(x)).toBeLessThanOrEqual(26);
        expect(Math.abs(x - prev)).toBeLessThan(5);
        prev = x;
      }
    }
  });
  it('consecutive gate positions differ by at most about 26 u', () => {
    let worst = 0;
    for (let n = 0; n < 5000; n++) worst = Math.max(worst, Math.abs(laneNode(SEED, n + 1) - laneNode(SEED, n)));
    expect(worst).toBeLessThanOrEqual(26);
    expect(worst).toBeGreaterThan(5);
  });
  it('heights alternate between [8, 10) and [11, 13), so every gate climbs or dives 1 to 5 u (DI-118)', () => {
    let sum = 0, lo = Infinity, hi = -Infinity;
    const N = 5000;
    for (const base of [0, 2 ** 40 + 1, -31]) {
      for (let n = base; n < base + N; n++) {
        const h = laneHeight(SEED, n);
        const odd = ((n % 2) + 2) % 2 === 1;
        expect(h, `node ${n}`).toBeGreaterThanOrEqual(odd ? 11 : LANE_Y_MIN);
        expect(h, `node ${n}`).toBeLessThan(odd ? LANE_Y_MAX : 10);
        const d = Math.abs(laneHeight(SEED, n + 1) - h);
        expect(d).toBeGreaterThan(1);
        expect(d).toBeLessThan(5);
        if (base === 0) { sum += d; lo = Math.min(lo, h); hi = Math.max(hi, h); }
      }
    }
    expect(LANE_Y_MIN).toBe(8);
    expect(LANE_Y_MAX).toBe(13);
    // Uniform within each band: the mean step is 3 u, and the range is used end to end.
    expect(sum / N).toBeGreaterThan(2.8);
    expect(sum / N).toBeLessThan(3.2);
    expect(hi - lo).toBeGreaterThan(4.9);
  });
  it('laneHeightPair equals laneHeight by toBe', () => {
    const io = new Float64Array(9);
    for (const base of [0, 2 ** 32, 1e13, -30]) {
      for (let n = base; n < base + 30; n++) {
        io[0] = n;
        laneNodePair(SEED, io);
        laneHeightPair(SEED, io);
        expect(io[6]).toBe(laneHeight(SEED, n));
        expect(io[7]).toBe(laneHeight(SEED, n + 1));
        expect(io[1]).toBe(laneNode(SEED, n));
        expect(io[2]).toBe(laneNode(SEED, n + 1));
      }
    }
  });
  it('laneNodePair equals laneNode by toBe', () => {
    const io = new Float64Array(9);
    for (const base of [0, 2 ** 32, 1e13, -30]) {
      for (let n = base; n < base + 30; n++) {
        io[0] = n;
        laneNodePair(SEED, io);
        expect(io[1]).toBe(laneNode(SEED, n));
        expect(io[2]).toBe(laneNode(SEED, n + 1));
      }
    }
  });
});

describe('item rows', () => {
  it('hold the schema over 5000 rows per difficulty', () => {
    const row = newItemRow();
    const problems = new Set<string>();
    for (const zone of [0, 6, 12, 40]) {
      for (let c = zone * 100; c < zone * 100 + 5000; c++) {
        world.fillItems(c, row);
        for (const p of schemaProblems(row, c)) problems.add(p);
      }
    }
    for (const base of [Math.floor(1e15 / 64), CHUNK_LIMIT - 200]) {
      for (let c = base; c < base + 500; c++) {
        world.fillItems(c, row);
        for (const p of schemaProblems(row, c)) problems.add(p);
      }
    }
    expect([...problems]).toEqual([]);
  }, LONG);

  it('negative chunks are valid', () => {
    const row = newItemRow();
    for (let c = -300; c < 0; c++) {
      world.fillItems(c, row);
      expect(schemaProblems(row, c)).toEqual([]);
    }
  });

  it('the schema checker reports a hand-corrupted row', () => {
    const row = newItemRow();
    world.fillItems(1201, row);
    expect(schemaProblems(row, 1201)).toEqual([]);
    const s = row.data[ItemField.SEED]!;
    row.data[ItemField.SEED] = 1;
    expect(schemaProblems(row, 1201).join()).toContain('seed range');
    row.data[ItemField.SEED] = s;
    const z = row.data[ItemField.Z_LOCAL]!;
    row.data[ItemField.Z_LOCAL] = 64;
    expect(schemaProblems(row, 1201).join()).toContain('zLocal');
    row.data[ItemField.Z_LOCAL] = z;
    row.count = MAX_ITEMS_PER_CHUNK + 1;
    expect(schemaProblems(row, 1201).join()).toContain('count');
  });

  it('gates stand on every multiple of 3 within 26 u, except where a checkpoint takes the place', () => {
    const row = newItemRow();
    let checkpoints = 0;
    let gates = 0;
    for (let c = 0; c < 6000; c++) {
      world.fillItems(c, row);
      const found: number[] = [];
      for (let i = 0; i < row.count; i++) if (row.data[i * ITEM_STRIDE + ItemField.KIND] === ItemKind.GATE) found.push(i);
      const checkpoint = c % 100 === 0;
      if (checkpoint || c % 3 === 0) expect(found.length, `chunk ${c}`).toBe(1);
      else expect(found.length, `chunk ${c}`).toBe(0);
      if (found.length === 1) {
        const o = found[0]! * ITEM_STRIDE;
        expect(row.data[o + ItemField.Z_LOCAL]).toBe(0);
        if (checkpoint) {
          expect(row.data[o + ItemField.Y]).toBe(8);
          checkpoints++;
          expect(row.data[o + ItemField.A]).toBe(1);
          expect(row.data[o + ItemField.X]).toBe(0);
          expect(row.data[o + ItemField.RADIUS]).toBe(42);
        } else {
          gates++;
          expect(row.data[o + ItemField.A]).toBe(0);
          expect(row.data[o + ItemField.RADIUS]).toBe(8);
          expect(Math.abs(row.data[o + ItemField.X]!)).toBeLessThanOrEqual(26);
          // DI-118: at the lane's own height, which the record holds at float32.
          expect(row.data[o + ItemField.Y]).toBe(Math.fround(laneHeight(SEED, c / 3)));
          // The inner rim never below the floor.
          expect(row.data[o + ItemField.Y]! - 8).toBeGreaterThanOrEqual(-1e-6);
        }
      }
    }
    expect(checkpoints).toBe(60);
    // A zone of 100 chunks holds 33 or 34 multiples of 3, so 32 or 33 normal gates.
    expect(gates / 60).toBeGreaterThanOrEqual(32);
    expect(gates / 60).toBeLessThanOrEqual(33.4);
  }, LONG);

  it('fences keep clear of gates: never in a gate chunk, and never within 32 u before one', () => {
    const row = newItemRow();
    let fences = 0;
    for (let c = 0; c < 8000; c++) {
      world.fillItems(c, row);
      for (let i = 0; i < row.count; i++) {
        const o = i * ITEM_STRIDE;
        if (row.data[o + ItemField.KIND] !== ItemKind.FENCE) continue;
        fences++;
        expect(c % 3 === 0 || c % 100 === 0, `fence in gate chunk ${c}`).toBe(false);
        if ((c + 1) % 3 === 0 || (c + 1) % 100 === 0) expect(row.data[o + ItemField.Z_LOCAL]!).toBeLessThanOrEqual(32);
      }
    }
    expect(fences).toBeGreaterThan(100);
  }, LONG);

  it('spikes sit past z 16 in gate chunks and at least radius + 5 from the lane', () => {
    const row = newItemRow();
    for (let c = 0; c < 8000; c++) {
      world.fillItems(c, row);
      for (let i = 0; i < row.count; i++) {
        const o = i * ITEM_STRIDE;
        if (row.data[o + ItemField.KIND] !== ItemKind.SPIKE) continue;
        const z = row.data[o + ItemField.Z_LOCAL]!;
        if (c % 3 === 0 || c % 100 === 0) expect(z).toBeGreaterThanOrEqual(16);
        expect(Math.abs(row.data[o + ItemField.X]! - laneX(SEED, 0, c, z))).toBeGreaterThanOrEqual(8.5 - 1e-3);
      }
    }
  }, LONG);

  it('drones clear the lane by amplitude, radius and 3', () => {
    const row = newItemRow();
    let drones = 0;
    for (let c = 2000; c < 10000; c++) {
      world.fillItems(c, row);
      for (let i = 0; i < row.count; i++) {
        const o = i * ITEM_STRIDE;
        if (row.data[o + ItemField.KIND] !== ItemKind.DRONE) continue;
        drones++;
        const z = row.data[o + ItemField.Z_LOCAL]!;
        const a = row.data[o + ItemField.A]!;
        expect(Math.abs(row.data[o + ItemField.X]! - laneX(SEED, 0, c, z))).toBeGreaterThanOrEqual(a + 2.5 + 3 - 1e-3);
      }
    }
    expect(drones).toBeGreaterThan(1000);
  }, LONG);

  it('shards lie exactly on the world 12 u lattice, also at 2^40 + 1', () => {
    const row = newItemRow();
    const firsts = [0, 8, 4];
    for (const c of [0, 1, 2, 300, 301, 302, 2 ** 40, 2 ** 40 + 1, 2 ** 40 + 2]) {
      world.fillItems(c, row);
      let first = Infinity;
      let shards = 0;
      for (let i = 0; i < row.count; i++) {
        const o = i * ITEM_STRIDE;
        if (row.data[o + ItemField.KIND] !== ItemKind.SHARD) continue;
        shards++;
        const z = row.data[o + ItemField.Z_LOCAL]!;
        first = Math.min(first, z);
        expect((((c % 3) * 64 + z) / 12) % 1, `chunk ${c} z ${z}`).toBe(0);
        const y = row.data[o + ItemField.Y]!;
        // DI-118: the lane's height, 8 to 13, plus or minus pattern 2's 2.5 u wave.
        expect(y).toBeGreaterThanOrEqual(5.5);
        expect(y).toBeLessThanOrEqual(15.5);
      }
      expect(shards).toBeGreaterThan(0);
      if (shards >= 5) expect(first, `first shard in chunk ${c}`).toBe(firsts[c % 3]);
    }
  });

  it('mean shards per chunk is at least 3', () => {
    const row = newItemRow();
    let shards = 0;
    const N = 6000;
    for (let c = 0; c < N; c++) {
      world.fillItems(c, row);
      for (let i = 0; i < row.count; i++) if (row.data[i * ITEM_STRIDE + ItemField.KIND] === ItemKind.SHARD) shards++;
    }
    expect(shards / N).toBeGreaterThanOrEqual(3);
  });

  it('hazards rise from zone 0 to zone 12, and then stay flat within 15%', () => {
    const row = newItemRow();
    const hazardsIn = (firstZone: number): number => {
      // A block of six zones holds each biome once, so Boulevard's traffic does not swing the comparison.
      let n = 0;
      const start = Math.floor(firstZone / 6) * 6;
      for (let c = start * 100; c < (start + 6) * 100; c++) {
        world.fillItems(c, row);
        for (let i = 0; i < row.count; i++) {
          const k = row.data[i * ITEM_STRIDE + ItemField.KIND];
          if (k === ItemKind.SPIKE || k === ItemKind.FENCE || k === ItemKind.DRONE || k === ItemKind.TRAFFIC) n++;
        }
      }
      return n;
    };
    const easy = hazardsIn(0);
    const hard = hazardsIn(12);
    const later = hazardsIn(40);
    console.log(`HAZARDS per block zone0=${easy} zone12=${hard} zone40=${later}`);
    expect(hard).toBeGreaterThan(easy);
    expect(Math.abs(later - hard) / hard).toBeLessThanOrEqual(0.15);
  }, LONG);
});

describe('solvable road', () => {
  it('solvable road: a straight path between lane nodes threads every gate and touches nothing', () => {
    const row = newItemRow();
    const hits: string[] = [];
    let hazards = 0;
    for (const zone of [0, 6, 12, 40]) {
      for (let c = zone * 100; c < zone * 100 + 5000; c++) {
        world.fillItems(c, row);
        hazards += row.count;
        hits.push(...pathHits(row, c));
      }
    }
    expect(hazards).toBeGreaterThan(50_000);
    expect(hits.slice(0, 20)).toEqual([]);
  }, LONG);

  it('negative control: a hazard forced onto the lane is reported', () => {
    const row = newItemRow();
    world.fillItems(1201, row);
    expect(pathHits(row, 1201)).toEqual([]);
    const o = row.count * ITEM_STRIDE;
    row.data[o + ItemField.KIND] = ItemKind.SPIKE;
    row.data[o + ItemField.X] = pathX(1201, 30);
    row.data[o + ItemField.Y] = 8;
    row.data[o + ItemField.Z_LOCAL] = 30;
    row.data[o + ItemField.RADIUS] = 3.5;
    row.count++;
    expect(pathHits(row, 1201).join()).toContain('spike hit');
  });
});

describe('item golden', () => {
  it('a digest of 200 rows of the real items, per engine', () => {
    const row = newItemRow();
    let near = 0x811c9dc5;
    for (let i = 0; i < 200; i++) {
      world.fillItems(i * 7 + 3, row);
      near = fnv1a(itemBytes(row), near);
    }
    let far = 0x811c9dc5;
    for (let i = 0; i < 200; i++) {
      world.fillItems(Math.floor(1e15 / 64) + i * 7, row);
      far = fnv1a(itemBytes(row), far);
    }
    console.log(`GOLDEN items near=${near} far=${far}`);
    expect([near, far]).toEqual(ITEM_GOLDEN);
  });
});

/** Recorded at first green. They may change only by a Decision log entry in plans/T01-world.md saying why. Per engine (section 5.1).
 * DI-118 (2026-11-07): gates and shards at the lane's height, gate radius 8. Was [928456839, 2782424726]. */
const ITEM_GOLDEN = [3510218, 2261875425];
