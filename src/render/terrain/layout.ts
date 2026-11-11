// Pure, no three. The level table and every row number, computed in exact doubles from {chunk, local}.
// No shift or |0 anywhere near a row: rows reach 2^53 at the world limit (section 4.2).
import { CHUNK_LEN, CLIP_BASE_SPACING, CLIP_COLS, CLIP_REAR_ROWS, CLIP_RING_ROWS, CLIP_ROWS, type Travel } from '../../contracts/index';

/** Half-open cell ranges of the coarse hole at stride 1 (section 6.4). */
export const HOLE = { c0: 34, c1: 94, r0: 0, r1: 45 } as const;
/** Stride 2: rows stop on an even bound, so whole 2x2 cells stay aligned. */
export const HOLE_S2 = { c0: 34, c1: 94, r0: 0, r1: 44 } as const;

export function spacing(k: number): number {
  return CLIP_BASE_SPACING * 2 ** k;
}

/** Forward reach of level k from its rear rows: 160, 352, 736, 1504, 3008, 6016. */
export function forwardOf(k: number): number {
  return (CLIP_ROWS - CLIP_REAR_ROWS[k]!) * spacing(k);
}

export function halfWidthOf(k: number): number {
  return (CLIP_COLS / 2) * spacing(k);
}

/** Lattice row of grid row 0, always even: floor(camRow / 2) * 2 - rear[k], camRow = chunk * (64 / s) + floor(local / s). */
export function baseRow(k: number, cam: Readonly<Travel>): number {
  const s = spacing(k);
  const camRow = cam.chunk * (CHUNK_LEN / s) + Math.floor(cam.local / s);
  return Math.floor(camRow / 2) * 2 - CLIP_REAR_ROWS[k]!;
}

/** Forward distance of grid row 0 from the camera: small and exact at any distance, because the chunk cancels as an integer first. */
export function rowOffset(k: number, cam: Readonly<Travel>): number {
  const s = spacing(k);
  return (baseRow(k, cam) - cam.chunk * (CHUNK_LEN / s)) * s - cam.local;
}

/** Slot of grid row 0 in the level's ring, in [0, 128). */
export function baseMod(k: number, cam: Readonly<Travel>): number {
  return ((baseRow(k, cam) % CLIP_RING_ROWS) + CLIP_RING_ROWS) % CLIP_RING_ROWS;
}
