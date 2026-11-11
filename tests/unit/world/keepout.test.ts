import { describe, expect, it } from 'vitest';
import { ARCHETYPE_COUNT, ARCHETYPE_SPEC, Archetype, BIOME_COUNT, Biome, FOG_END, PROP_STRIDE, PropField } from '../../../src/contracts/index';
import { KEEPOUT_C, KEEPOUT_K, PLACE } from '../../../src/world/biomes';
import { fitKeepOut } from '../../../src/world/keepout';
import { discOcclusion } from './support/impostor';
import { newPropRow } from './support/rows';
import { REAL_TABLE, composeWorld, pureChunks, zonesOfBiome } from './support/worlds';

const SEED = 1985;
const LIMIT = KEEPOUT_C * FOG_END;
const LONG = 120_000;
/** Section 5.6's room at abs(x), before the object's own y: abs(x) * K / C. Read from biomes.ts, so a T11 retune of KEEPOUT_K moves it. */
const roomAt = (absX: number): number => absX * KEEPOUT_K / KEEPOUT_C;

function exempt(a: number): boolean {
  return ARCHETYPE_SPEC[a]!.floats || a === Archetype.RING || a === Archetype.SEARCHLIGHT;
}

describe('fitKeepOut', () => {
  it('leaves a small object alone, and fits a tall one to the limit', () => {
    expect(fitKeepOut(300, 0, 10, 1, KEEPOUT_K)).toBe(1);
    const fitted = fitKeepOut(480, 0, 50, 3, KEEPOUT_K);
    // 100 / 50 at the shipped K of .05.
    expect(fitted).toBeCloseTo(roomAt(480) / 50, 9);
  });
  it('rejects by returning 0 when the fit would fall below .5', () => {
    // 10 u of room for a 40 u top is a scale of .25.
    expect(fitKeepOut(100, roomAt(100) - 10, 40, 1, KEEPOUT_K)).toBe(0);
  });
  it('stops applying at C * FOG_END', () => {
    expect(fitKeepOut(LIMIT, 500, 50, 3, KEEPOUT_K)).toBe(3);
    expect(fitKeepOut(LIMIT - 1, 500, 50, 3, KEEPOUT_K)).toBe(0);
  });
});

describe('the world obeys the keep-out', () => {
  const world = composeWorld(SEED, 0);
  const row = newPropRow();

  it('keep-out holds', () => {
    let over = 0;
    let checked = 0;
    let canyonOver = 0;
    for (let b = 0; b < BIOME_COUNT; b++) {
      for (const chunk of pureChunks(world.zones, b, 2000)) {
        world.fillProps(chunk, row);
        for (let a = 0; a < ARCHETYPE_COUNT; a++) {
          if (exempt(a)) continue;
          const top = PLACE[a]!.top;
          const end = row.start[a + 1]!;
          for (let i = row.start[a]!; i < end; i++) {
            const o = i * PROP_STRIDE;
            const x = Math.abs(row.data[o + PropField.X]!);
            const scale = row.data[o + PropField.SCALE]!;
            expect(scale).toBeGreaterThanOrEqual(0.5);
            if (x >= LIMIT) continue;
            const reach = row.data[o + PropField.Y]! + top * scale;
            // x / 4.8 at the shipped K. 1e-3 allows for Float32 storage of y and scale.
            const fits = reach <= roomAt(x) + 1e-3;
            if (b === Biome.CYBER_CANYON) {
              if (!fits) canyonOver++;
            } else {
              checked++;
              if (!fits) over++;
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(50_000);
    expect(over).toBe(0);
    // The exemption is real, not dead code.
    expect(canyonOver).toBeGreaterThan(0);
  }, LONG);

  it('disc occlusion', () => {
    const report: string[] = [];
    for (let b = 0; b < BIOME_COUNT; b++) {
      const zones = zonesOfBiome(world.zones, b, 5);
      let worst = 0;
      let sum = 0;
      for (const z of zones) {
        const occlusion = discOcclusion(world, { chunk: z * 100 + 20, local: 0 });
        worst = Math.max(worst, occlusion);
        sum += occlusion;
      }
      report.push(`biome=${b} mean=${(sum / zones.length * 100).toFixed(1)}% worst=${(worst * 100).toFixed(1)}%`);
      if (b !== Biome.CYBER_CANYON) expect(worst, `biome ${b}`).toBeLessThanOrEqual(0.10);
    }
    console.log(`OCCLUSION ${report.join(' | ')}`);
  }, LONG);

  it('negative control: disc occlusion rises at least to 15% on Neon City with the keep-out effectively off', () => {
    const open = composeWorld(SEED, 0, { ...REAL_TABLE, keepoutK: 5 });
    let worst = 0;
    for (const z of zonesOfBiome(open.zones, Biome.NEON_CITY, 5)) {
      worst = Math.max(worst, discOcclusion(open, { chunk: z * 100 + 20, local: 0 }));
    }
    console.log(`OCCLUSION no keep-out Neon City worst=${(worst * 100).toFixed(1)}%`);
    expect(worst).toBeGreaterThanOrEqual(0.15);
  }, LONG);
});
