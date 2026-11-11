import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BIOME_COUNT, BIOME_NAMES, Biome, PALETTE_COUNT, PALETTE_NAMES, PaletteId } from '../../../src/contracts/index';
import { createWorld } from '../../../src/world/index';
import { SALT_BIOME, createZones, findZoneChunk } from '../../../src/world/zones';
import { renderImpostor, type ImpostorImage } from './support/impostor';
import { encodePng, pngSignatureOk } from './support/png';
import { REAL_TABLE, composeWorld, fadeZone } from './support/worlds';

const SEED = 1985;
const PREVIEW = process.env['TERRAIN_PREVIEW'] === '1';
const LONG = 600_000;
const OUT = resolve('test-results/T01/preview');

function save(name: string, image: ImpostorImage): void {
  mkdirSync(OUT, { recursive: true });
  const path = join(OUT, `${name}.png`);
  writeFileSync(path, encodePng(image.rgb, image.width, image.height));
  console.log(`SCREENSHOT ${path}`);
}

function slug(name: string): string {
  return name.toLowerCase().replaceAll(' ', '-');
}

describe('impostor preview', () => {
  it('renders a small frame, a valid PNG with more than 16 colours', () => {
    const world = createWorld({ seed: SEED, periodChunks: 0 });
    const image = renderImpostor(world, { chunk: 20, local: 10 }, 64, 36);
    const png = encodePng(image.rgb, image.width, image.height);
    expect(pngSignatureOk(png)).toBe(true);
    const colours = new Set<number>();
    for (let i = 0; i < image.rgb.length; i += 3) colours.add((image.rgb[i]! << 16) | (image.rgb[i + 1]! << 8) | image.rgb[i + 2]!);
    expect(colours.size).toBeGreaterThan(16);
  }, LONG);

  it.runIf(PREVIEW)('writes every preview image', () => {
    const W = 960;
    const H = 540;
    const world = createWorld({ seed: SEED, periodChunks: 0 });
    const zones = createZones(SEED, 0);
    for (let b = 0; b < BIOME_COUNT; b++) {
      const chunk = findZoneChunk(SEED, PaletteId.SUNSET_DRIVE, b);
      expect(chunk).toBeGreaterThanOrEqual(0);
      save(`biome-${slug(BIOME_NAMES[b]!)}`, renderImpostor(world, { chunk: chunk + 20, local: 0 }, W, H));
    }
    const fades: readonly (readonly [number, number])[] = [
      [Biome.BOULEVARD, Biome.CYBER_CANYON],
      [Biome.NEON_CITY, Biome.ORBITAL_NIGHT],
      [Biome.CRYSTAL_DESERT, Biome.OLYMPUS],
    ];
    for (const [a, b] of fades) {
      const z = fadeZone(zones, a, b);
      save(`fade-${slug(BIOME_NAMES[a]!)}-${slug(BIOME_NAMES[b]!)}`, renderImpostor(world, { chunk: z * 100 + 87, local: 0 }, W, H));
    }
    let farZone = Math.floor(1e15 / 64 / 100);
    while (zones.entry(farZone, SALT_BIOME, 6) !== Biome.BOULEVARD) farZone++;
    save('far-1e15', renderImpostor(world, { chunk: farZone * 100 + 20, local: 0 }, W, H));
    const open = composeWorld(SEED, 0, { ...REAL_TABLE, keepoutK: 5 });
    save('no-keepout-neon', renderImpostor(open, { chunk: findZoneChunk(SEED, PaletteId.SUNSET_DRIVE, Biome.NEON_CITY) + 20, local: 0 }, W, H));

    const CW = 320;
    const CH = 180;
    const sheet = new Uint8Array(CW * PALETTE_COUNT * CH * BIOME_COUNT * 3);
    for (let p = 0; p < PALETTE_COUNT; p++) {
      for (let b = 0; b < BIOME_COUNT; b++) {
        const chunk = findZoneChunk(SEED, p, b);
        expect(chunk, `${PALETTE_NAMES[p]} with ${BIOME_NAMES[b]}`).toBeGreaterThanOrEqual(0);
        const cell = renderImpostor(world, { chunk: chunk + 20, local: 0 }, CW, CH);
        for (let y = 0; y < CH; y++) {
          sheet.set(cell.rgb.subarray(y * CW * 3, (y + 1) * CW * 3), ((b * CH + y) * CW * PALETTE_COUNT + p * CW) * 3);
        }
      }
    }
    save('sheet', { rgb: sheet, width: CW * PALETTE_COUNT, height: CH * BIOME_COUNT });
  }, LONG);
});
