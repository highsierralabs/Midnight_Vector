import { describe, expect, it } from 'vitest';
import { hash01 } from '../../../src/core/hash';
import { drawInto } from '../../../src/world/draws';

describe('drawInto', () => {
  it('equals hash01 by toBe, for every key class the world uses', () => {
    const keys = new Float64Array(1);
    const out = new Float64Array(16);
    const seeds = [1985, 7, 0, -3, 2 ** 40 + 5, -(2 ** 33)];
    const chunks = [0, 1, -1, -48, 1000, 2 ** 31, 2 ** 32, 2 ** 32 + 1, 15625000000000, 2 ** 47, 2 ** 48 - 1025, 2 ** 53 - 1, -(2 ** 40)];
    const salts = [0, 7, 19, 0x4E01, 0x5A01, 0x6000, 0x6005, 0x6100];
    const bases = [0, 1, 8, 32, 64, 3000];
    let compared = 0;
    for (const seed of seeds) {
      for (const chunk of chunks) {
        keys[0] = chunk;
        for (const a of salts) {
          for (const base of bases) {
            drawInto(seed, keys, 0, a, base, out, 3, 8);
            for (let i = 0; i < 8; i++) {
              compared++;
              expect(out[3 + i]).toBe(hash01(seed, chunk, a, base + i));
            }
          }
        }
      }
    }
    expect(compared).toBe(seeds.length * chunks.length * salts.length * bases.length * 8);
    expect(out[0]).toBe(0);
  });
});
