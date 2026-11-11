// Every feel constant. All [A], unplaytested. T11 may change values here, never names.
const VALUES = {
  // Trauma: added per event, decays linearly, and the shake amplitude is its square.
  TRAUMA_HIT: 0.7,
  TRAUMA_SIGNAL_LOST: 1,
  TRAUMA_DECAY_PER_S: 1.6,

  // Shake, radians, rotation only. Harmonics are integers on the 1 s tick phase, so no randomness and no wrap pop.
  SHAKE_YAW_MAX: 0.006,
  SHAKE_PITCH_MAX: 0.012,
  SHAKE_ROLL_MAX: 0.02,
  SHAKE_YAW_A: 23,
  SHAKE_YAW_B: 37,
  SHAKE_PITCH_A: 29,
  SHAKE_PITCH_B: 41,
  SHAKE_ROLL_A: 19,
  SHAKE_ROLL_B: 31,

  // Bank into a turn.
  BANK_ROLL_MAX: 0.05,
  BANK_REF_RATE: 60,
  BANK_TAU: 0.25,

  // Field of view, degrees and seconds.
  FOV_BOOST_DEG: 8,
  FOV_GATE_PULSE_DEG: 2,
  FOV_PULSE_TAU: 0.18,
  FOV_TAU: 0.35,

  // Flash.
  FLASH_HIT: 0.6,
  FLASH_GATE: 0.12,
  FLASH_SHARD: 0.03,
  FLASH_TAU: 0.12,
  FLASH_CAP: 0.6,

  // Chromatic aberration, as a 0 to 1 position across section 6.6's range.
  ABERR_BOOST: 0.5,
  ABERR_HIT: 1,
  ABERR_GATE: 0.3,
  ABERR_TAU: 0.2,
  ABERR_CAP: 1,

  // Bloom gain.
  BLOOM_GATE: 0.15,
  BLOOM_BEAT: 0.03,
  BLOOM_BEAT_K: 6,
  BLOOM_TAU: 0.3,
  BLOOM_GAIN_CAP: 1.25,

  // Speed lines start above this speed.
  SPEED_LINES_MIN: 70,
  SPEED_LINES_TAU: 0.25,

  // Holds, seconds; glitch's is a level.
  HITSTOP_S: 0.07,
  GLITCH_S: 0.2,
  GLITCH_SIGNAL_LOST_HOLD: 0.35,
  DUCK_S: 0.4,
};

export type FeelTuning = { readonly [K in keyof typeof VALUES]: number };

export const FEEL_TUNING: FeelTuning = Object.freeze(VALUES);
