// Pure, no three. One vertex array shared by every level, and the index builders.
import { CLIP_COLS, CLIP_ROWS } from '../../contracts/index';
import { HOLE, HOLE_S2 } from './layout';

const W = CLIP_COLS + 1;

/** position = (c, r, 0) for r in 0..96 and c in 0..128: 12513 vertices. The vertex shader reads them as grid coordinates. */
export function buildVertices(): Float32Array {
  const out = new Float32Array(W * (CLIP_ROWS + 1) * 3);
  let n = 0;
  for (let r = 0; r <= CLIP_ROWS; r++) {
    for (let c = 0; c <= CLIP_COLS; c++) {
      out[n++] = c;
      out[n++] = r;
      out[n++] = 0;
    }
  }
  return out;
}

/**
 * Two triangles per drawn cell, with the shared edge running (c + stride, r) to (c, r + stride), the uniform diagonal
 * the morph rule assumes (section 6.4). Winding is CCW seen from above. Grow enlarges the hole on three sides, and only
 * the crack control passes a non-zero value. holeRows overrides the hole's row bound: the layer passes HOLE_S2.r1 at stride 1 while a
 * ramp runs, so the swap to stride 2 does not also change which of the parent's rows are drawn.
 */
export function buildIndex(stride: 1 | 2, hole: boolean, grow: number, holeRows?: number): Uint16Array {
  const h = stride === 1 ? HOLE : HOLE_S2;
  const c0 = h.c0 - grow;
  const c1 = h.c1 + grow;
  const r1 = (holeRows ?? h.r1) + grow;
  const cellsAcross = CLIP_COLS / stride;
  const cellsDown = CLIP_ROWS / stride;
  const out = new Uint16Array(cellsAcross * cellsDown * 6);
  let n = 0;
  for (let r = 0; r < CLIP_ROWS; r += stride) {
    for (let c = 0; c < CLIP_COLS; c += stride) {
      if (hole && r < r1 && c >= c0 && c < c1) continue;
      const a = r * W + c;
      const b = a + stride;
      const d = a + W * stride;
      const e = d + stride;
      out[n++] = a;
      out[n++] = b;
      out[n++] = d;
      out[n++] = b;
      out[n++] = e;
      out[n++] = d;
    }
  }
  return out.slice(0, n);
}
