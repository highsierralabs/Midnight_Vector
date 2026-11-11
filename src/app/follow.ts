// Camera follow gains (section 6.1, S-40, DI-81, DI-88). Pure.
import { CAMERA_FOV, PLAY_HALF_X, SHIP_FORWARD } from '../contracts/index';
import { SHIP_HALF_LENGTH, SHIP_HALF_WIDTH } from '../render/props/ship';

/** Section 6.1's floor: the gain never goes below it, and holds it from aspect about 2.3023 up (DI-88). */
const BASE = 0.72;
/** The ship's outermost point stays inside this fraction of the half-width. */
export const FOLLOW_EDGE = 0.85;
/**
 * Camera y per ship y. DI-118: .15, from .35, when the lane gained its height (8 to 13). At .35 the camera rose with the swoop and
 * T11's far-terrain sparkle S1far read .075 at seed 1985 (limit .07; .059 before the swoop) and .104 at 155; at .15, .060 and .078,
 * the old values. The ship now climbs and dives on screen rather than the view with it.
 */
export const FOLLOW_Y = 0.15;
/**
 * The nearest depth of the ship's widest point: T05's body is SHIP_HALF_WIDTH to each side and reaches SHIP_HALF_LENGTH
 * toward the camera (wing tips at 2.15, fins at 2.2), so its outer corner is taken at (SHIP_HALF_WIDTH, SHIP_FORWARD -
 * SHIP_HALF_LENGTH), which no vertex lies outside of.
 */
const WING_DEPTH = SHIP_FORWARD - SHIP_HALF_LENGTH;
const HALF_TAN = Math.tan((CAMERA_FOV / 2) * Math.PI / 180);

/**
 * Camera x per ship x, at every aspect (DI-88): the whole ship, its outer wing corner SHIP_HALF_WIDTH out at WING_DEPTH,
 * stays inside FOLLOW_EDGE of the half-width at x = +-PLAY_HALF_X, at the base FOV, which feel only ever widens, and the
 * gain never drops below .72. Bank and pitch only bring the corner in. .793 at 16:9, .976 at 390x844, .72 from aspect
 * about 2.3023 up, so 21:9 and B7's edge-paint case keep .72. Round 1 kept only the centre in frame at the ship plane
 * (.924 at 390x844, outer wing at NDC 1.54), and round 2 held .72 from 16:9 up (outer wing at NDC 1.104 there, D-011).
 */
export function followGainX(aspect: number): number {
  return Math.max(BASE, 1 - (FOLLOW_EDGE * HALF_TAN * aspect * WING_DEPTH - SHIP_HALF_WIDTH) / PLAY_HALF_X);
}
