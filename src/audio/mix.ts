// Every level and send, in one tunable table. Pure. A retune from an ear review edits this file and theory.ts only.
// Nobody has heard these values. They come from the prototype's measured levels, or [A] where noted.

export const MIX = {
  // Drums and one-shots
  kick: 0.55, snare: 0.34, hat: 0.2, ohat: 0.13, tom: 0.3, crash: 0.12, riser: 0.1,
  // Pitched layers
  bass: 0.15, pad: 0.062, arp: 0.24, lead: 0.075,
  // SFX. blip from the prototype; the rest never rendered there [A].
  blip: 0.2, stab: 0.12, miss: 0.18, graze: 0.1, hit: 0.5, hitNoise: 0.25, lost: 0.2, lostNoise: 0.08, launch: 0.1,
  // Wind at full boost
  wind: 0.06,
  // Sends
  padToReverb: 0.35, arpToDelay: 0.35, leadToDelay: 0.3, leadToReverb: 0.25,
  // Delay: L .45 s then R .45 s, a dotted eighth, ping-pong
  delayFeedback: 0.34, delayToMusic: 0.8, delayToReverb: 0.3, delayLowpass: 2800, delayS: 0.45,
  // Reverb
  reverbReturn: 0.5, reverbHighpass: 220, reverbS: 2.2, reverbTau: 0.55, reverbDarken: 0.9, reverbSeed: 99,
  // Chorus on the pad
  chorusWet: 0.7, chorusDry: 0.7, chorusA: 0.0125, chorusB: 0.0165, chorusDepth: 0.0028, chorusHz: 0.62, padHighpass: 130,
  // Master
  musicTrim: 0.85, masterPre: 0.5, musicHighpass: 24,
  compThreshold: -12, compKnee: 10, compRatio: 2.5, compAttack: 0.01, compRelease: 0.18,
  // Default linear volumes, though T08 always calls setVolume at mount
  defaultMusic: 0.8, defaultSfx: 0.8,
} as const;

/** The duck table of plan M4. index is SimMode. */
export const MODE_FILTER: readonly number[] = [20000, 20000, 2400, 350];   // DEMO, PLAY, CRUISE, SIGNAL_LOST
export const MODE_GAIN: readonly number[] = [1, 1, 0.708, 0.5];
export const MODE_TAU_S = 0.08;
export const HIT_FILTER = 500;
export const HIT_GAIN = 0.3548;      // -9 dB
export const HIT_S = 0.4;
export const HIT_ATTACK_TAU_S = 0.005;
export const HIT_GAIN_RELEASE_TAU_S = 0.04;
export const HIT_FILTER_RELEASE_TAU_S = 0.05;
export const VOLUME_TAU_S = 0.015;
export const RESUME_RAMP_S = 0.3;
export const WIND_TAU_S = 0.15;
export const WIND_INTERVAL_S = 0.1;
export const WIND_DEADBAND = 0.02;   // of the [0, 1] boost fraction

/** Live-source cap [A]. Peak at T4 was 68 [O: prototype]. */
export const MAX_LIVE_SOURCES = 96;
export const Drop = { NEVER: 0, ARP: 1, HAT: 2, BLIP: 3, STAB: 4 } as const;

/**
 * At the cap, blips and gate stabs go first, then hats, then the arp. Kick, snare, bass, pad and lead always sound,
 * and so do the one-per-event cues (miss, graze, hit, lost) and the launch sweep, which the event buffer bounds.
 */
export function admits(drop: number, live: number, cap: number): boolean {
  if (drop === Drop.NEVER) return true;
  const margin = drop === Drop.BLIP || drop === Drop.STAB ? 8 : drop === Drop.HAT ? 4 : 0;
  return live < cap - margin;
}
