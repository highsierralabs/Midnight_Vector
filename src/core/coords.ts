// src/core/coords.ts -- complete; T00 ships exactly this
import { CHUNK_LEN, CHUNK_LIMIT, ROW_MOD, type Travel } from '../contracts/index';

/** Moves t by d (either sign), keeping local in [0, CHUNK_LEN). */
export function advance(t: Travel, d: number): void {
  t.local += d;
  if (t.local >= CHUNK_LEN || t.local < 0) {
    const n = Math.floor(t.local / CHUNK_LEN);
    t.chunk += n;
    t.local -= n * CHUNK_LEN;
    // A tiny negative local rounds up to exactly CHUNK_LEN just above.
    if (t.local >= CHUNK_LEN) { t.local = 0; t.chunk += 1; }
  }
}
/** a - b in u. The only legal way to subtract positions. Exact while the chunks are close. */
export function between(a: Readonly<Travel>, b: Readonly<Travel>): number {
  return (a.chunk - b.chunk) * CHUNK_LEN + (a.local - b.local);
}
/** Chunk mod 65536 in [0, 65536), for the uCamRow uniform and aRow attributes. */
export function rowMod(chunk: number): number {
  return ((chunk % ROW_MOD) + ROW_MOD) % ROW_MOD;
}
/** Distance mod period, exact. period must be a positive integer multiple of CHUNK_LEN. */
export function travelMod(t: Readonly<Travel>, period: number): number {
  const chunks = period / CHUNK_LEN;
  return (((t.chunk % chunks) + chunks) % chunks) * CHUNK_LEN + t.local;
}
export function canWarp(chunk: number, local: number): boolean {
  return Number.isInteger(chunk) && chunk >= 0 && chunk < CHUNK_LIMIT && local >= 0 && local < CHUNK_LEN;
}
/** HUD only. Loses precision at extreme distances, which no player will see. */
export function totalDistance(t: Readonly<Travel>): number {
  return t.chunk * CHUNK_LEN + t.local;
}
