// Every string a player reads, including the fatal text. T10's poster is written from this file, and a test compares the
// key phrases, so keep WebGL2 and floating-point in the no-webgl2 body.
import type { FatalReason, Tier } from '../contracts/index';

export const TAGLINE = 'THE ROAD NEVER STOPS';

/** Amendment LH: the two start buttons. Any key, or a tap off them, still launches with the remembered HUD choice. */
export const LAUNCH_HUD = 'LAUNCH';
export const LAUNCH_NO_HUD = 'LAUNCH - NO HUD';
/** Shown in place of LAUNCH until the game is running (DI-95). */
export const PROMPT_LOADING = 'LOADING';

/** [control, action] pairs. The touch list replaces the keyboard list on a coarse pointer. */
export const LEGEND_KEYS: readonly (readonly [string, string])[] = [
  ['WASD / ARROWS', 'STEER'], ['MOUSE', 'AIM'], ['SPACE / CLICK', 'BOOST'], ['DOUBLE-TAP', 'LOCK'], ['ESC / P', 'CRUISE'],
  ['M', 'MUTE'],
];
export const LEGEND_TOUCH: readonly (readonly [string, string])[] = [
  ['DRAG', 'STEER'], ['2ND FINGER / BUTTON', 'BOOST'], ['DOUBLE-TAP', 'LOCK'], ['II', 'CRUISE'],
];

export const LABEL_BEST = 'BEST';
export const LABEL_SCORE = 'SCORE';
export const LABEL_SYNC = 'SYNC';
export const LABEL_KM = 'KM';
export const LABEL_SHIELD = 'SHIELD';
export const LABEL_OVERDRIVE = 'OVERDRIVE';
export const LABEL_BOOST = 'BOOST';
export const LABEL_MUTED = 'MUTED';
export const MENU_BUTTON = 'II';
export const MENU_BUTTON_NAME = 'Open cruise menu';

export const AUTOPILOT_TAG = 'AUTOPILOT - ANY INPUT RETAKES';
export const SIGNAL_LOST = 'SIGNAL LOST';
export const SIGNAL_LOST_SUB = 'REACQUIRING - SCORE KEPT';
export const CONTEXT_LOST = 'VIDEO SIGNAL INTERRUPTED - THE ROAD IS STILL MOVING';
export const CONTEXT_RESTORED = 'VIDEO SIGNAL RESTORED';

export const CRUISE_HEADING = 'CRUISE';
export const RESUME = 'RESUME';
export const LABEL_MUSIC = 'MUSIC';
export const LABEL_SFX = 'SFX';
export const LABEL_MUTE = 'MUTE';
export const LABEL_QUALITY = 'QUALITY';
export const LABEL_REDUCED = 'REDUCED MOTION';
export const LABEL_FULLSCREEN = 'FULLSCREEN';
export const LABEL_HIDE_HUD = 'HIDE HUD';
export const LABEL_RUN = 'THIS RUN';
export const CRUISE_NOTE = 'There is no true pause. Rules are frozen and hazards ghosted, and the world keeps moving behind this menu.';

/** Section 6.10. */
export const TIER_NAMES: Readonly<Record<Tier, string>> = { 4: 'HIGH', 3: 'STANDARD', 2: 'LOW', 1: 'MINIMUM', 0: 'SOFTWARE' };
/** Menu order. */
export const TIER_ORDER: readonly Tier[] = [4, 3, 2, 1, 0];
export const LABEL_AUTO = 'AUTO';

export function autoLabel(tier: Tier): string {
  return `${LABEL_AUTO} (${TIER_NAMES[tier]})`;
}

export const RELOAD = 'RELOAD';

export const FATAL_COPY: Readonly<Record<FatalReason, { readonly heading: string; readonly body: string }>> = {
  'no-webgl2': {
    heading: 'NO SIGNAL',
    body: 'This browser or device could not start WebGL2 with floating-point render targets, which the road is drawn with. A current browser with hardware acceleration turned on should run it.',
  },
  'context-lost-permanent': {
    heading: 'SIGNAL LOST FOR GOOD',
    body: 'The graphics context dropped and did not return within 15 seconds. The GPU may have reset or run out of memory. Reloading usually brings it back, and your bests are kept.',
  },
  'shader-error': {
    heading: 'BAD TAPE',
    body: 'A shader failed to compile on this GPU. That is a fault in the game, not in anything you did. A newer graphics driver or another browser may get past it.',
  },
  'runtime-error': {
    heading: 'THE ROAD BROKE',
    body: 'Something failed while running, and the game stopped rather than show you a frozen road. Reloading starts a fresh run, and your bests are kept.',
  },
};
