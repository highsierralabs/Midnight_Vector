const W32 = 4294967296;
function absorb(h: number, w: number): number {
  let k = Math.imul(w, 0xCC9E2D51);
  k = (k << 15) | (k >>> 17);
  h ^= Math.imul(k, 0x1B873593);
  h = (h << 13) | (h >>> 19);
  return (Math.imul(h, 5) + 0xE6546B64) | 0;
}
/** Uniform in [0, 1). Exact in chunk up to 2^53: the high and low words are hashed separately. */
export function hash01(seed: number, chunk: number, a: number, b: number): number {
  let h = (seed % W32) ^ Math.imul(Math.floor(seed / W32), 0x27D4EB2F);
  h = absorb(h, chunk % W32);
  h = absorb(h, Math.floor(chunk / W32));
  h = absorb(h, a);
  h = absorb(h, b);
  h ^= h >>> 16; h = Math.imul(h, 0x85EBCA6B); h ^= h >>> 13; h = Math.imul(h, 0xC2B2AE35); h ^= h >>> 16;
  return (h >>> 0) / W32;
}
