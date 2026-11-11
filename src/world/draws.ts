// src/world/draws.ts -- hash01's exact arithmetic, inlined, for several draws from one key.
// A double through a non-inlined call is boxed (Agents.md, hot paths), and V8's inlining budget runs out inside a scatter
// or item row: hash01 calls there returned a boxed double each, at 16 B a time. This function has no nested call and takes
// its key from an array, so it boxes nothing, whether or not it is inlined. draws.test.ts holds it equal to hash01 by toBe.
const W32 = 4294967296;

/**
 * Writes out[at + i] = hash01(seed, keys[keyAt], a, base + i) for i in 0 .. count - 1.
 * The shared prefix of the hash (seed, chunk, a) runs once.
 */
export function drawInto(seed: number, keys: Float64Array, keyAt: number, a: number, base: number, out: Float64Array, at: number, count: number): void {
  const chunk = keys[keyAt]!;
  // x - hi * W32 is congruent to x % W32 modulo 2^32, so ToInt32 gives the same word, without fmod.
  const seedHi = Math.floor(seed / W32);
  const chunkHi = Math.floor(chunk / W32);
  let h0 = (seed - seedHi * W32) ^ Math.imul(seedHi, 0x27D4EB2F);
  let k = Math.imul(chunk - chunkHi * W32, 0xCC9E2D51);
  k = (k << 15) | (k >>> 17);
  h0 ^= Math.imul(k, 0x1B873593);
  h0 = (h0 << 13) | (h0 >>> 19);
  h0 = (Math.imul(h0, 5) + 0xE6546B64) | 0;
  k = Math.imul(chunkHi, 0xCC9E2D51);
  k = (k << 15) | (k >>> 17);
  h0 ^= Math.imul(k, 0x1B873593);
  h0 = (h0 << 13) | (h0 >>> 19);
  h0 = (Math.imul(h0, 5) + 0xE6546B64) | 0;
  k = Math.imul(a, 0xCC9E2D51);
  k = (k << 15) | (k >>> 17);
  h0 ^= Math.imul(k, 0x1B873593);
  h0 = (h0 << 13) | (h0 >>> 19);
  h0 = (Math.imul(h0, 5) + 0xE6546B64) | 0;
  for (let i = 0; i < count; i++) {
    k = Math.imul(base + i, 0xCC9E2D51);
    k = (k << 15) | (k >>> 17);
    let h = h0 ^ Math.imul(k, 0x1B873593);
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xE6546B64) | 0;
    h ^= h >>> 16;
    h = Math.imul(h, 0x85EBCA6B);
    h ^= h >>> 13;
    h = Math.imul(h, 0xC2B2AE35);
    h ^= h >>> 16;
    out[at + i] = (h >>> 0) / W32;
  }
}
