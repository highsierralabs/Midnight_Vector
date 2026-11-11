import { describe, expect, it } from 'vitest';
import {
  ARCHETYPE_COUNT, ARCHETYPE_SPEC, Archetype, BIOME_COUNT, CHUNK_LIMIT, MAX_PROPS_PER_CHUNK, PROP_STRIDE, PropField, type PropRow,
} from '../../../src/contracts/index';
import { hash01 } from '../../../src/core/hash';
import { PLACE, QUOTA, YawMode } from '../../../src/world/biomes';
import { FROZEN_TABLE } from './support/frozenTable';
import { fnv1a, newPropRow, propBytes } from './support/rows';
import { composeWorld, pureChunks } from './support/worlds';

const SEED = 1985;
const LONG = 180_000;
const world = composeWorld(SEED, 0);

/** Every schema rule of section 4 that one row can break, by name. */
function schemaProblems(row: PropRow, chunk: number): string[] {
  const out: string[] = [];
  const { data, start } = row;
  if (row.chunk !== chunk) out.push('out.chunk');
  for (let a = 0; a < ARCHETYPE_COUNT; a++) {
    if (start[a]! > start[a + 1]!) out.push(`start order at ${a}`);
    const n = start[a + 1]! - start[a]!;
    if (n > ARCHETYPE_SPEC[a]!.perChunk) out.push(`perChunk of ${a}`);
  }
  const total = start[ARCHETYPE_COUNT]!;
  if (total > MAX_PROPS_PER_CHUNK) out.push('row total');
  for (let i = total * PROP_STRIDE; i < data.length; i++) {
    if (data[i] !== 0) { out.push('tail not zero'); break; }
  }
  for (let a = 0; a < ARCHETYPE_COUNT; a++) {
    let prevZ = -Infinity;
    for (let i = start[a]!; i < start[a + 1]! && i < MAX_PROPS_PER_CHUNK; i++) {
      const o = i * PROP_STRIDE;
      for (let f = 0; f < PROP_STRIDE; f++) if (!Number.isFinite(data[o + f]!)) out.push(`non-finite field ${f}`);
      const z = data[o + PropField.Z_LOCAL]!;
      if (z < 0 || z >= 64) out.push('zLocal range');
      if (z < prevZ) out.push(`zLocal order in ${a}`);
      prevZ = z;
      for (const f of [PropField.KEEP, PropField.TINT_SEED, PropField.VARIANT]) {
        const v = data[o + f]!;
        if (v < 0 || v >= 1) out.push(`field ${f} outside [0, 1)`);
      }
      if (!(data[o + PropField.SCALE]! > 0)) out.push('scale');
      if (a !== Archetype.RING && Math.abs(data[o + PropField.X]!) < 44) out.push(`archetype ${a} inside the play window`);
    }
  }
  return out;
}

function archetypeProblems(row: PropRow, chunk: number, nextRow: PropRow): string[] {
  const out: string[] = [];
  const { data, start } = row;
  const nRing = start[Archetype.RING + 1]! - start[Archetype.RING]!;
  if (nRing !== (chunk % 48 === 0 ? 1 : 0)) out.push('ring only on multiples of 48');
  if (nRing === 1) {
    const o = start[Archetype.RING]! * PROP_STRIDE;
    if (data[o + PropField.X] !== 0 || data[o + PropField.Y] !== Math.fround(65.14) || data[o + PropField.Z_LOCAL] !== 32
      || data[o + PropField.KEEP] !== 0 || data[o + PropField.SCALE] !== 1 || data[o + PropField.YAW] !== 0) out.push('ring fields');
  }
  const nPylon = start[Archetype.PYLON + 1]! - start[Archetype.PYLON]!;
  if (nPylon !== 0 && nPylon !== 2) out.push('pylon count');
  if (nPylon === 2) {
    const l = start[Archetype.PYLON]! * PROP_STRIDE;
    const r = l + PROP_STRIDE;
    const nextPair = nextRow.start[Archetype.PYLON + 1]! - nextRow.start[Archetype.PYLON]! === 2;
    const wire = nextPair ? 0.75 : 0.25;
    if (data[l + PropField.X] !== -100 || data[r + PropField.X] !== 100) out.push('pylon x');
    if (data[l + PropField.Y] !== 0 || data[r + PropField.Y] !== 0) out.push('pylon y');
    if (data[l + PropField.Z_LOCAL] !== 0 || data[r + PropField.Z_LOCAL] !== 0) out.push('pylon z');
    if (data[l + PropField.YAW] !== 0 || data[r + PropField.YAW] !== 0 || data[l + PropField.SCALE] !== 1) out.push('pylon yaw or scale');
    if (data[l + PropField.KEEP] !== Math.fround(0.1) || data[r + PropField.KEEP] !== Math.fround(0.6)) out.push('pylon keep');
    if (data[l + PropField.VARIANT] !== wire || data[r + PropField.VARIANT] !== wire) out.push('pylon variant');
  }
  const refStart = start[Archetype.REFLECTOR]!;
  const nRef = start[Archetype.REFLECTOR + 1]! - refStart;
  if (nRef % 2 !== 0) out.push('reflector count');
  for (let i = 0; i < nRef; i++) {
    const o = (refStart + i) * PROP_STRIDE;
    if (Math.abs(data[o + PropField.X]!) !== 44.5 || data[o + PropField.Y] !== 0 || data[o + PropField.YAW] !== 0) out.push('reflector fields');
    const expectedZ = Math.fround((Math.floor(i / 2) + 0.5) * 64 / (nRef / 2));
    if (data[o + PropField.Z_LOCAL] !== expectedZ) out.push('reflector z');
  }
  const nSearch = start[Archetype.SEARCHLIGHT + 1]! - start[Archetype.SEARCHLIGHT]!;
  if (nSearch > 0 && chunk % 6 !== 0) out.push('searchlight off its multiple');
  for (let a = 0; a < ARCHETYPE_COUNT; a++) {
    if (PLACE[a]!.yaw !== YawMode.FACING) continue;
    for (let i = start[a]!; i < start[a + 1]!; i++) {
      const o = i * PROP_STRIDE;
      if (Math.sign(data[o + PropField.YAW]!) === Math.sign(data[o + PropField.X]!)) out.push('facing yaw sign');
    }
  }
  for (let i = start[Archetype.CHEVRON]!; i < start[Archetype.CHEVRON + 1]!; i++) {
    if (data[i * PROP_STRIDE + PropField.Y] !== 0) out.push('chevron y');
  }
  return out;
}

describe('scatter schema', () => {
  it('holds over 5000 rows: all biomes, fade rows, every distance', () => {
    const row = newPropRow();
    const next = newPropRow();
    const bases = [0, Math.floor(1e9 / 64), Math.floor(1e15 / 64), CHUNK_LIMIT - 1];
    const problems = new Set<string>();
    let rows = 0;
    for (const base of bases) {
      const start = Math.floor(base / 100) * 100;
      const span = base === CHUNK_LIMIT - 1 ? 1 : 1700;
      for (let i = 0; i < span; i++) {
        const chunk = base === CHUNK_LIMIT - 1 ? base : start + i;
        world.fillProps(chunk, row);
        world.fillProps(chunk + 1, next);
        for (const p of schemaProblems(row, chunk)) problems.add(p);
        for (const p of archetypeProblems(row, chunk, next)) problems.add(p);
        rows++;
      }
    }
    // Rows just past the end of the world, the ones a camera at CHUNK_LIMIT - 1 reads.
    for (let i = 1; i <= 94; i++) {
      world.fillProps(CHUNK_LIMIT - 1 + i, row);
      world.fillProps(CHUNK_LIMIT + i, next);
      for (const p of schemaProblems(row, CHUNK_LIMIT - 1 + i)) problems.add(p);
      for (const p of archetypeProblems(row, CHUNK_LIMIT - 1 + i, next)) problems.add(p);
      rows++;
    }
    expect([...problems]).toEqual([]);
    expect(rows).toBeGreaterThanOrEqual(5000);
  }, LONG);

  it('negative rows are valid, and out.chunk stays as passed', () => {
    const row = newPropRow();
    const next = newPropRow();
    const problems = new Set<string>();
    for (let chunk = -300; chunk < 0; chunk++) {
      world.fillProps(chunk, row);
      world.fillProps(chunk + 1, next);
      for (const p of schemaProblems(row, chunk)) problems.add(p);
      for (const p of archetypeProblems(row, chunk, next)) problems.add(p);
    }
    expect([...problems]).toEqual([]);
  }, LONG);

  it('the schema checker reports a hand-corrupted row', () => {
    const row = newPropRow();
    world.fillProps(4800, row);
    expect(schemaProblems(row, 4800)).toEqual([]);
    const a = Archetype.REFLECTOR;
    const o = row.start[a]! * PROP_STRIDE;
    const keptStart = row.start[a]!;
    row.start[a] = row.start[a + 1]! + 1;
    expect(schemaProblems(row, 4800).join()).toContain('start order');
    row.start[a] = keptStart;
    const keptKeep = row.data[o + PropField.KEEP]!;
    row.data[o + PropField.KEEP] = 1;
    expect(schemaProblems(row, 4800).join()).toContain(`field ${PropField.KEEP}`);
    row.data[o + PropField.KEEP] = keptKeep;
    const keptZ = row.data[o + PropField.Z_LOCAL]!;
    row.data[o + PropField.Z_LOCAL] = 64;
    expect(schemaProblems(row, 4800).join()).toContain('zLocal range');
    row.data[o + PropField.Z_LOCAL] = keptZ;
    const keptX = row.data[o + PropField.X]!;
    row.data[o + PropField.X] = 10;
    expect(schemaProblems(row, 4800).join()).toContain('inside the play window');
    row.data[o + PropField.X] = keptX;
    expect(schemaProblems(row, 4800)).toEqual([]);
    row.data[row.data.length - 1] = 1;
    expect(schemaProblems(row, 4800).join()).toContain('tail');
  });
});

describe('scatter behaviour', () => {
  it('left and right per archetype stay within 5% over 2000 rows', () => {
    const row = newPropRow();
    for (const [b, from] of Array.from({ length: BIOME_COUNT * 2 }, (_, i) => [i % BIOME_COUNT, i < BIOME_COUNT ? 0 : Math.floor(1e15 / 64 / 100)] as const)) {
      const left = new Int32Array(ARCHETYPE_COUNT);
      const right = new Int32Array(ARCHETYPE_COUNT);
      // SEARCHLIGHT stands on every 6th chunk with one candidate, so its 2000 records take 12000 rows.
      const chunks = pureChunks(world.zones, b, 12000, from);
      for (let r = 0; r < chunks.length; r++) {
        const chunk = chunks[r]!;
        if (r >= 2000 && chunk % 6 !== 0) continue;
        world.fillProps(chunk, row);
        for (let a = 0; a < ARCHETYPE_COUNT; a++) {
          if (r >= 2000 && a !== Archetype.SEARCHLIGHT) continue;
          for (let i = row.start[a]!; i < row.start[a + 1]!; i++) {
            if (row.data[i * PROP_STRIDE + PropField.X]! < 0) left[a] = left[a]! + 1;
            else right[a] = right[a]! + 1;
          }
        }
      }
      for (let a = 0; a < ARCHETYPE_COUNT; a++) {
        const total = left[a]! + right[a]!;
        if (total === 0 || a === Archetype.RING) continue;
        expect(Math.abs(left[a]! - right[a]!) / total, `biome ${b} from zone ${from} archetype ${a}: ${left[a]} left, ${right[a]} right`).toBeLessThanOrEqual(0.05);
      }
    }
  }, LONG);

  it('sides alternate candidate by candidate inside every row', () => {
    // Section 4: candidate i of a row sits in z slot i of n, and sides alternate with i. From the stored row, a record's
    // slot is floor(zLocal * n / 64), with n recomputed from section 5.5's dither on a pure row, where expected is the
    // quota. Then side times (-1)^slot is one constant per archetype per row, and left and right differ by at most
    // 1 plus the candidates rejected. Fixed lines (RING, PYLON, REFLECTOR) are checked by the schema test.
    const row = newPropRow();
    const problems: string[] = [];
    let rowsWithPairs = 0;
    for (let b = 0; b < BIOME_COUNT; b++) {
      for (const from of [0, Math.floor(1e15 / 64 / 100)]) {
        for (const chunk of pureChunks(world.zones, b, 1000, from)) {
          world.fillProps(chunk, row);
          for (let a = 0; a < ARCHETYPE_COUNT; a++) {
            if (a === Archetype.RING || a === Archetype.PYLON || a === Archetype.REFLECTOR) continue;
            const q = QUOTA[b]![a]!;
            if (q <= 0) continue;
            const dither = hash01(SEED, chunk, a, 0);
            let n = a === Archetype.SEARCHLIGHT ? (chunk % 6 === 0 && dither < q * 6 ? 1 : 0) : Math.floor(q + dither);
            n = Math.min(n, ARCHETYPE_SPEC[a]!.perChunk);
            const placed = row.start[a + 1]! - row.start[a]!;
            const where = `biome ${b} chunk ${chunk} archetype ${a}`;
            if (placed > n) { problems.push(`${where}: ${placed} placed of ${n} candidates`); continue; }
            let left = 0;
            let right = 0;
            let parity = 0;
            let prevSlot = -1;
            for (let i = row.start[a]!; i < row.start[a + 1]!; i++) {
              const o = i * PROP_STRIDE;
              const x = row.data[o + PropField.X]!;
              const slot = Math.floor(row.data[o + PropField.Z_LOCAL]! * n / 64);
              if (slot <= prevSlot) problems.push(`${where}: slot ${slot} after ${prevSlot}`);
              prevSlot = slot;
              if (x < 0) left++;
              else right++;
              const p = Math.sign(x) * (slot % 2 === 0 ? 1 : -1);
              if (parity === 0) parity = p;
              else if (p !== parity) problems.push(`${where}: slot ${slot} on the same side as its neighbour`);
            }
            if (Math.abs(left - right) > 1 + n - placed) problems.push(`${where}: ${left} left, ${right} right, ${n - placed} rejected`);
            if (placed >= 2) rowsWithPairs++;
          }
        }
      }
    }
    expect(problems.slice(0, 10), `${problems.length} problems`).toEqual([]);
    expect(rowsWithPairs).toBeGreaterThan(20_000);
  }, LONG);

  it('y is the mesh origin: grounded at or below true height, floating above it', () => {
    const row = newPropRow();
    for (let b = 0; b < BIOME_COUNT; b++) {
      for (const chunk of pureChunks(world.zones, b, 300)) {
        world.fillProps(chunk, row);
        for (let a = 0; a < ARCHETYPE_COUNT; a++) {
          if (a === Archetype.RING || a === Archetype.PYLON) continue;
          const spec = ARCHETYPE_SPEC[a]!;
          for (let i = row.start[a]!; i < row.start[a + 1]!; i++) {
            const o = i * PROP_STRIDE;
            const x = row.data[o + PropField.X]!;
            const y = row.data[o + PropField.Y]!;
            const h = world.height(x, chunk, 64, row.data[o + PropField.Z_LOCAL]!);
            if (spec.floats) expect(y).toBeGreaterThan(h);
            else if (Math.abs(x) <= 85) expect(y).toBe(0);
            else expect(y).toBeLessThanOrEqual(h + 1e-3);
          }
        }
      }
    }
  }, LONG);

  it('a pylon line starts and ends once in a fade, and its last pair has no wire', () => {
    const row = newPropRow();
    let endings = 0;
    for (let z = 0; z < 200; z++) {
      let prev = -1;
      for (let c = z * 100; c < z * 100 + 100; c++) {
        world.fillProps(c, row);
        const has = row.start[Archetype.PYLON + 1]! - row.start[Archetype.PYLON]! === 2 ? 1 : 0;
        if (prev === 1 && has === 0) {
          endings++;
          world.fillProps(c - 1, row);
          expect(row.data[row.start[Archetype.PYLON]! * PROP_STRIDE + PropField.VARIANT]).toBe(0.25);
        }
        prev = has;
      }
    }
    expect(endings).toBeGreaterThan(10);
  }, LONG);

  it('position was grounded as stored: re-reading height at the stored floats keeps hover inside its band', () => {
    const row = newPropRow();
    for (const a of [Archetype.ORB, Archetype.CRYSTAL, Archetype.SAUCER]) {
      const [lo, hi] = PLACE[a]!.hover;
      for (let b = 0; b < BIOME_COUNT; b++) {
        if (QUOTA[b]![a] === 0) continue;
        for (const chunk of pureChunks(world.zones, b, 400)) {
          world.fillProps(chunk, row);
          for (let i = row.start[a]!; i < row.start[a + 1]!; i++) {
            const o = i * PROP_STRIDE;
            const h = world.height(row.data[o + PropField.X]!, chunk, 64, row.data[o + PropField.Z_LOCAL]!);
            const hover = row.data[o + PropField.Y]! - h;
            expect(hover).toBeGreaterThanOrEqual(lo - 1e-2);
            expect(hover).toBeLessThanOrEqual(hi + 1e-2);
          }
        }
      }
    }
  }, LONG);

  it('bands and scale ranges of section 4 hold', () => {
    const row = newPropRow();
    for (let b = 0; b < BIOME_COUNT; b++) {
      for (const chunk of pureChunks(world.zones, b, 1000)) {
        world.fillProps(chunk, row);
        for (let a = 0; a < ARCHETYPE_COUNT; a++) {
          if (a === Archetype.RING) continue;
          const p = PLACE[a]!;
          for (let i = row.start[a]!; i < row.start[a + 1]!; i++) {
            const o = i * PROP_STRIDE;
            const ax = Math.abs(row.data[o + PropField.X]!);
            let inBand = false;
            for (const [lo, hi] of p.bands) if (ax >= lo - 1e-3 && ax <= hi + 1e-3) inBand = true;
            expect(inBand, `archetype ${a} at ${ax}`).toBe(true);
            expect(row.data[o + PropField.SCALE]!).toBeLessThanOrEqual(p.scale[1] + 1e-5);
          }
        }
      }
    }
  }, LONG);
});

describe('scatter golden', () => {
  it('a digest of 200 rows on the frozen table, per engine', () => {
    const frozen = composeWorld(SEED, 0, FROZEN_TABLE);
    const row = newPropRow();
    let h = 0x811c9dc5;
    for (let i = 0; i < 200; i++) {
      frozen.fillProps(i * 7 + 3, row);
      h = fnv1a(propBytes(row), h);
    }
    let far = 0x811c9dc5;
    for (let i = 0; i < 200; i++) {
      frozen.fillProps(Math.floor(1e15 / 64) + i * 7, row);
      far = fnv1a(propBytes(row), far);
    }
    console.log(`GOLDEN scatter near=${h} far=${far}`);
    expect([h, far]).toEqual(SCATTER_GOLDEN);
  }, LONG);
});

/** Recorded at first green. They may change only by a Decision log entry in plans/T01-world.md saying why. Per engine (section 5.1). */
const SCATTER_GOLDEN = [519618140, 911465691];
