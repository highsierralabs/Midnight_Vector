import { describe, expect, it } from 'vitest';
import { ARCHETYPE_COUNT, ARCHETYPE_SPEC, Archetype, BIOME_COUNT, Biome, CLIP_DROP, PROP_STRIDE, PropField, type PropRow } from '../../../src/contracts/index';
import { PLACE, SAG, TERRAIN } from '../../../src/world/biomes';
import { coarseSurface, flattenSag, levelAt, sag95, spacingAt } from '../../../src/world/grounding';
import { heightWith, type HeightCore, type HeightFn } from '../../../src/world/height';
import { createNoise } from '../../../src/world/noise';
import { percentile } from './support/metrics';
import { newPropRow } from './support/rows';
import { REAL_TABLE, composeWorld, coreOf, pureChunks } from './support/worlds';

const SEED = 1985;
const LONG = 180_000;

function fract(x: number): number {
  return x - Math.floor(x);
}

/** Grounded records at abs(x) > 85 whose coarse surface leaves their root in the air, by the real archetype spec. */
function floatingRecords(row: PropRow, core: HeightCore, chunk: number): number {
  let floating = 0;
  for (let a = 0; a < ARCHETYPE_COUNT; a++) {
    const spec = ARCHETYPE_SPEC[a]!;
    if (spec.floats) continue;
    const end = row.start[a + 1]!;
    for (let i = row.start[a]!; i < end; i++) {
      const o = i * PROP_STRIDE;
      const x = row.data[o + PropField.X]!;
      const ax = Math.abs(x);
      if (ax <= 85) continue;
      const s = spacingAt(ax, spec.maxDist);
      const g = coarseSurface(core, x, chunk, row.data[o + PropField.Z_LOCAL]!, s) - CLIP_DROP[levelAt(ax, spec.maxDist)]!;
      // 1e-3 allows for Float32 storage of y and scale.
      if (g < row.data[o + PropField.Y]! - spec.root * row.data[o + PropField.SCALE]! - 1e-3) floating++;
    }
  }
  return floating;
}

/** Section 5.7 rule 3's second half: the share of an object's top the coarse surface may cover. */
const BURY_SHARE = 0.7;

/**
 * Grounded records at abs(x) > 85 that the coarse surface would mostly bury: surface - drop - y > .7 * top * scale,
 * by the real archetype spec. y and scale are the stored values, so scale is after any keep-out fit.
 * Returns the scattered count. PYLON is a fixed line at y = 0 (section 4, S-04) that section 5.7's placement steps do not
 * govern, so it is not in the return value; byArchetype and seen still count it, for the report.
 */
function buriedRecords(row: PropRow, core: HeightCore, chunk: number, byArchetype?: Int32Array, seen?: Int32Array): number {
  let buried = 0;
  for (let a = 0; a < ARCHETYPE_COUNT; a++) {
    const spec = ARCHETYPE_SPEC[a]!;
    if (spec.floats) continue;
    const end = row.start[a + 1]!;
    for (let i = row.start[a]!; i < end; i++) {
      const o = i * PROP_STRIDE;
      const x = row.data[o + PropField.X]!;
      const ax = Math.abs(x);
      if (ax <= 85) continue;
      if (seen) seen[a] = seen[a]! + 1;
      const s = spacingAt(ax, spec.maxDist);
      const g = coarseSurface(core, x, chunk, row.data[o + PropField.Z_LOCAL]!, s) - CLIP_DROP[levelAt(ax, spec.maxDist)]!;
      // 1e-3 allows for Float32 storage of y and scale.
      if (g - row.data[o + PropField.Y]! > BURY_SHARE * spec.top * row.data[o + PropField.SCALE]! + 1e-3) {
        if (a !== Archetype.PYLON) buried++;
        if (byArchetype) byArchetype[a] = byArchetype[a]! + 1;
      }
    }
  }
  return buried;
}

describe('the clipmap model', () => {
  it('levelAt agrees with the extents of section 6.4', () => {
    const halfW = [128, 256, 512, 1024, 2048, 4096];
    const forward = [160, 352, 736, 1504, 3008, 6016];
    for (let L = 0; L < 6; L++) {
      expect(levelAt(halfW[L]! - 1, forward[L]! - 1), `level ${L}`).toBe(L);
      if (L < 5) {
        expect(levelAt(halfW[L]!, 1), `past half width ${L}`).toBeGreaterThan(L);
        expect(levelAt(1, forward[L]!), `past forward ${L}`).toBeGreaterThan(L);
      }
    }
    expect(levelAt(1e6, 1e6)).toBe(5);
  });

  it('spacingAt doubles past ratio .6', () => {
    // Level 3: spacing 16, half width 1024, forward 1504.
    expect(spacingAt(600, 800)).toBe(16);
    expect(spacingAt(700, 800)).toBe(32);
    expect(spacingAt(600, 1000)).toBe(32);
    // The archetype reaches of section 6.5, close to the road.
    expect(spacingAt(50, 800)).toBe(16);
    expect(spacingAt(50, 1200)).toBe(32);
    expect(spacingAt(50, 1600)).toBe(32);
    expect(spacingAt(50, 2000)).toBe(64);
    expect(spacingAt(50, 3000)).toBe(64);
    expect(spacingAt(50, 4000)).toBe(128);
  });

  it('sag95 reads the class, spacing and band of section 5.7', () => {
    const flat = flattenSag(SAG);
    expect(sag95(flat, Biome.BOULEVARD, 150, 8)).toBe(0.12);
    expect(sag95(flat, Biome.OLYMPUS, 350, 32)).toBe(5.7);
    expect(sag95(flat, Biome.NEON_CITY, 800, 16)).toBe(5.7);
    expect(sag95(flat, Biome.CRYSTAL_DESERT, 1500, 64)).toBe(22.7);
    expect(sag95(flat, Biome.CYBER_CANYON, 90, 128)).toBe(21.2);
  });
});

describe('coarseSurface', () => {
  const noise = createNoise(SEED, 0);
  const blvd: HeightFn = (x, iz, zs, zl) => heightWith(noise, TERRAIN[Biome.BOULEVARD]!, x, iz, zs, zl);
  const core = coreOf(blvd);

  it('equals height exactly at a lattice corner', () => {
    for (const s of [4, 8, 16, 32, 64, 128]) {
      for (let i = 0; i < 200; i++) {
        const x = (10 + i * 3) * s;
        const chunk = 2 * (1000 + i * 7);
        const iz = s <= 64 ? chunk * (64 / s) : chunk / 2;
        expect(coarseSurface(core, x, chunk, 0, s)).toBe(blvd(x, iz, s, 0));
      }
    }
  });

  it('is a plane on each triangle of the uniform diagonal', () => {
    const s = 32;
    const chunk = 5000;
    const x0 = 320;
    const h00 = blvd(x0, chunk * 2, s, 0);
    const h10 = blvd(x0 + s, chunk * 2, s, 0);
    const h01 = blvd(x0, chunk * 2 + 1, s, 0);
    const h11 = blvd(x0 + s, chunk * 2 + 1, s, 0);
    expect(coarseSurface(core, x0 + 8, chunk, 8, s)).toBeCloseTo(h00 + 0.25 * (h10 - h00) + 0.25 * (h01 - h00), 9);
    expect(coarseSurface(core, x0 + 24, chunk, 24, s)).toBeCloseTo(h11 + 0.25 * (h01 - h11) + 0.25 * (h10 - h11), 9);
  });

  it('sag calibration', () => {
    const BANDS: readonly (readonly [number, number])[] = [[85, 200], [200, 500], [500, 1400], [1400, 2600]];
    const SPACINGS = [8, 16, 32, 64];
    const CLASS_BIOME = [Biome.BOULEVARD, Biome.NEON_CITY, Biome.CRYSTAL_DESERT, Biome.CYBER_CANYON];
    const N = 20000;
    const samples = new Float64Array(N);
    const failures: string[] = [];
    const measured: string[] = [];
    for (let k = 0; k < 4; k++) {
      const biome = CLASS_BIOME[k]!;
      const h: HeightFn = (x, iz, zs, zl) => heightWith(noise, TERRAIN[biome]!, x, iz, zs, zl);
      const c = coreOf(h);
      for (let si = 0; si < SPACINGS.length; si++) {
        const s = SPACINGS[si]!;
        const line: string[] = [];
        for (let b = 0; b < BANDS.length; b++) {
          const [lo, hi] = BANDS[b]!;
          for (let i = 0; i < N; i++) {
            const x = (i & 1 ? -1 : 1) * (lo + fract(i * 0.754877666) * (hi - lo));
            const chunk = 1000 + i * 11;
            const zLocal = fract(i * 0.61803398875) * 64;
            samples[i] = Math.abs(h(x, chunk, 64, zLocal) - coarseSurface(c, x, chunk, zLocal, s));
          }
          samples.sort();
          const p95 = percentile(samples, 0.95);
          line.push(p95.toFixed(2));
          const table = SAG[k]![si + 1]![b]!;
          if (p95 > table * 1.15) failures.push(`class ${k} s ${s} band ${b}: measured ${p95.toFixed(3)} against ${table}`);
        }
        measured.push(`class ${k} s ${s}: ${line.join(' ')}`);
      }
    }
    if (failures.length > 0) console.log(`Paste into SAG after a terrain retune:\n${measured.join('\n')}`);
    expect(failures).toEqual([]);
  }, LONG);
});

describe('grounding in the real world', () => {
  const world = composeWorld(SEED, 0);
  const row = newPropRow();

  it('no floating object', () => {
    let grounded = 0;
    for (let b = 0; b < BIOME_COUNT; b++) {
      let floating = 0;
      for (const chunk of pureChunks(world.zones, b, 2000)) {
        world.fillProps(chunk, row);
        floating += floatingRecords(row, world.core, chunk);
        for (let a = 0; a < ARCHETYPE_COUNT; a++) {
          const spec = ARCHETYPE_SPEC[a]!;
          if (spec.floats) continue;
          const end = row.start[a + 1]!;
          for (let i = row.start[a]!; i < end; i++) {
            grounded++;
            const ax = Math.abs(row.data[i * PROP_STRIDE + PropField.X]!);
            if (ax > 500) {
              expect(spec.top, `archetype ${a} at ${ax}`).toBeGreaterThanOrEqual(40);
              expect(spec.root, `archetype ${a} at ${ax}`).toBeGreaterThanOrEqual(20);
            }
            const upperSlope = ax > 520 && ax < 1040;
            expect(upperSlope, `grounded archetype ${a} at ${ax}`).toBe(false);
          }
        }
      }
      expect(floating, `floating records in biome ${b}`).toBe(0);
    }
    expect(grounded).toBeGreaterThan(100_000);
  }, LONG);

  it('no mostly buried object', () => {
    const report: string[] = [];
    const pylons: string[] = [];
    let checked = 0;
    for (let b = 0; b < BIOME_COUNT; b++) {
      let buried = 0;
      const byArchetype = new Int32Array(ARCHETYPE_COUNT);
      const seen = new Int32Array(ARCHETYPE_COUNT);
      for (const chunk of pureChunks(world.zones, b, 2000)) {
        world.fillProps(chunk, row);
        buried += buriedRecords(row, world.core, chunk, byArchetype, seen);
      }
      for (let a = 0; a < ARCHETYPE_COUNT; a++) if (a !== Archetype.PYLON) checked += seen[a]!;
      report.push(`${b}=${buried}`);
      if (seen[Archetype.PYLON]! > 0) pylons.push(`${b}=${byArchetype[Archetype.PYLON]}/${seen[Archetype.PYLON]}`);
      expect.soft(buried, `mostly buried records in biome ${b}`).toBe(0);
    }
    console.log(`BURY scattered buried per biome ${report.join(' ')} checked=${checked} | pylon, fixed line, reported only: ${pylons.join(' ')}`);
    expect(checked).toBeGreaterThan(50_000);
  }, LONG);

  it('negative control: with the bury rule unable to fire, the check finds buried records', () => {
    // Every grounded record in a pure Canyon row is exempt from the keep-out, so a huge top in the table changes only the
    // two rules that read it: the bury rule can no longer fire, and the sink is no longer capped at .3 of the top. The
    // checker keeps the real top. Drill D13 removes the bury rule alone, in grounding.ts.
    const open = composeWorld(SEED, 0, { ...REAL_TABLE, place: PLACE.map((p) => ({ ...p, top: p.top * 1e6 })) });
    let buried = 0;
    for (const chunk of pureChunks(open.zones, Biome.CYBER_CANYON, 1000)) {
      open.fillProps(chunk, row);
      buried += buriedRecords(row, open.core, chunk);
    }
    console.log(`BURY control buried=${buried}`);
    expect(buried).toBeGreaterThan(100);
  }, LONG);

  it('negative control: a tiny root raises rejections', () => {
    const count = (t = REAL_TABLE): number => {
      const w = composeWorld(SEED, 0, t);
      let n = 0;
      for (const chunk of pureChunks(world.zones, Biome.CYBER_CANYON, 600)) {
        w.fillProps(chunk, row);
        n += row.start[ARCHETYPE_COUNT]!;
      }
      return n;
    };
    const tiny = { ...REAL_TABLE, place: PLACE.map((p) => ({ ...p, root: 0.01 })) };
    const real = count();
    const fewer = count(tiny);
    expect(fewer).toBeLessThan(real);
  }, LONG);

  it('negative control: with no sink and the gate off the check finds floating records', () => {
    const noSink = SAG.map((cls) => cls.map((sp) => sp.map(() => 0)));
    // A huge root means the float test can never fire, so the gate is off. The checker keeps the real root.
    const open = composeWorld(SEED, 0, { ...REAL_TABLE, sag: noSink, place: PLACE.map((p) => ({ ...p, root: p.root > 0 ? 1e6 : 0 })) });
    let floating = 0;
    for (const b of [Biome.BOULEVARD, Biome.CYBER_CANYON]) {
      for (const chunk of pureChunks(open.zones, b, 1000)) {
        open.fillProps(chunk, row);
        floating += floatingRecords(row, open.core, chunk);
      }
    }
    expect(floating).toBeGreaterThan(100);
  }, LONG);
});
