// src/world/keepout.ts -- section 5.6. An object inside the sun's lateral cone stays below the disc's lower part.
// Y is the mesh origin in world y, so y + top * scale is a true world height, terrain included.
import { FOG_END } from '../contracts/index';
import { KEEPOUT_C } from './biomes';
import { GROUND_REGS, GroundReg } from './grounding';

const C = KEEPOUT_C;
const G_ABS_X = GroundReg.ABS_X;
const G_Y = GroundReg.Y;
const G_TOP = GroundReg.TOP;
const G_SCALE = GroundReg.SCALE;
const G_K = GroundReg.KEEPOUT_K;

/** Beyond this lateral distance the object cannot enter the cone before the fog takes it. */
export const KEEPOUT_LIMIT = C * FOG_END;

/** Register form, for scatter (see grounding.ts). Reads ABS_X, Y, TOP, SCALE, KEEPOUT_K. Writes SCALE: fitted to the keep-out, or 0 if it would fall below 0.5. */
export function fitKeepOutAt(r: Float64Array): void {
  const absX = r[G_ABS_X]!;
  if (absX >= KEEPOUT_LIMIT) return;
  const top = r[G_TOP]!;
  const room = absX * r[G_K]! / C - r[G_Y]!;
  let scale = r[G_SCALE]!;
  if (top * scale > room) scale = room / top;
  r[G_SCALE] = scale < 0.5 ? 0 : scale;
}

const scratch = new Float64Array(GROUND_REGS);

/** Scale that keeps the top under the keep-out, or 0 if it would fall below 0.5. absX >= C * FOG_END: unchanged. k is KEEPOUT_K, passed in so tests can vary it. */
export function fitKeepOut(absX: number, y: number, top: number, scale: number, k: number): number {
  scratch[GroundReg.ABS_X] = absX;
  scratch[GroundReg.Y] = y;
  scratch[GroundReg.TOP] = top;
  scratch[GroundReg.SCALE] = scale;
  scratch[GroundReg.KEEPOUT_K] = k;
  fitKeepOutAt(scratch);
  return scratch[GroundReg.SCALE]!;
}
