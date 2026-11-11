// The speed lines' data, away from any GL.
import { SPEED_FLOOR, SPEED_MAX } from '../../contracts/index';
import { hash01 } from '../../core/hash';

export const LINE_CAPACITY = 96;
/** Forward wrap of a line, in u. Divides WORLD_PERIOD, so uTravel.y's wrap at 4096 cannot jump (section 4.3). */
export const LINE_PERIOD = 256;
export const LINE_FLOATS = 4;

const SEED = 1985;
const LENGTH_MIN = 8;
const LENGTH_SPAN = 32;

/** Fills 4 floats per line, angle, radius, forward and rank, each in [0, 1). */
export function writeLineSeeds(out: Float32Array): void {
  for (let i = 0; i < LINE_CAPACITY; i++) {
    for (let k = 0; k < LINE_FLOATS; k++) {
      // A value just below 1 would round to 1.0 in float32, so it is clamped to keep [0, 1) true.
      out[i * LINE_FLOATS + k] = Math.min(hash01(SEED, 0, i, k), 0.99999994);
    }
  }
}

/** World length of a line in u: 8 at the speed floor, 40 at the top speed. */
export function lineLength(speed: number): number {
  const t = (speed - SPEED_FLOOR) / (SPEED_MAX - SPEED_FLOOR);
  return LENGTH_MIN + LENGTH_SPAN * (t < 0 ? 0 : t > 1 ? 1 : t);
}
