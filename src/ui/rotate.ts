// Amendment LS: the rotate gate. A phone held upright does not play: the UI covers the stage with a prompt to turn it, and
// the game waits. Pure: the one media query that says what such a phone is, and what the gate does to a run.
import { SimMode } from '../contracts/index';

/** A screen this wide or wider is a tablet, by Android's own line between the two (sw600dp), and plays either way up. */
export const ROTATE_MAX_WIDTH = 600;

/**
 * A phone held upright: taller than wide, touch first, and narrower than a tablet. A narrow desktop window has a fine
 * pointer, so it is not one and keeps the upright layout. index.ts reads this one query and nothing else decides.
 */
export const ROTATE_QUERY = `(orientation: portrait) and (pointer: coarse) and (max-width: ${ROTATE_MAX_WIDTH - 0.02}px)`;

/** The gate parks a run it finds in PLAY, as leaving fullscreen does (FH-8). */
export function gateParks(gated: boolean, mode: SimMode): boolean {
  return gated && mode === SimMode.PLAY;
}

/**
 * While the gate shows nothing starts and nothing resumes: a launch from DEMO and a resume from CRUISE wait for the phone
 * to be turned. A pause from PLAY still goes through.
 */
export function gateHolds(gated: boolean, mode: SimMode): boolean {
  return gated && mode !== SimMode.PLAY;
}
