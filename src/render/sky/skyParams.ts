// Every CPU-side tunable of the sky, as a named constant. No three, no DOM. All values are [A]: design, not measured.
// The schedule's meaning is in plans/T04-sky.md, M6. T11 may retune these under its window.

/** Day-phase gains: value at full day. Full night is always 1. */
export const STAR_GAIN_DAY = 0.35;
export const NEBULA_GAIN_DAY = 0.5;
export const METEOR_GAIN_DAY = 0.6;
export const AURORA_GAIN_DAY = 0.6;

/** The target's size before any quality arrives, and through a boot at nebulaWidth 0, so the sampler is always valid. */
export const NEBULA_DEFAULT_WIDTH = 192;

/** Salts for hash01's a argument, so channels and events do not share random numbers. */
export const METEOR_SALT = 10;
export const BOLT_SALT = 20;
export const BOLT_PATH_SALT = 21;

// Meteors: two channels, each with one chance per slot.
export const METEOR_CHANNELS = 2;
export const METEOR_SLOT_TICKS = 960;           // 8 s
export const METEOR_CHANNEL_OFFSET = 480;
export const METEOR_RATE = 0.25;
export const METEOR_RATE_ORBITAL = 0.25;        // added at full Orbital Night weight
export const METEOR_GATE_WIDTH = 0.02;          // a changing weight fades a meteor rather than popping it
export const METEOR_START_MIN = 0.05;           // of the slot
export const METEOR_START_SPAN = 0.55;
export const METEOR_LIFE_MIN = 0.09;            // of the slot: .72 to 1.36 s
export const METEOR_LIFE_SPAN = 0.08;           // so every meteor ends by .77 of its slot
export const METEOR_X_MIN = -1.4;               // gnomonic
export const METEOR_X_SPAN = 2.8;
export const METEOR_Y_MIN = 0.3;
export const METEOR_Y_SPAN = 0.38;
export const METEOR_DX_MIN = 0.35;
export const METEOR_DX_SPAN = 0.35;
export const METEOR_DY_MIN = 0.1;
export const METEOR_DY_SPAN = 0.16;
export const METEOR_TAIL_LAG = 0.55;
export const METEOR_FADE_IN = 0.1;
export const METEOR_FADE_OUT = 0.3;

// Lightning: at most one strike per slot, two strobes per strike, at least 3.7 s between strikes by construction.
export const BOLT_SLOT_TICKS = 1920;            // 16 s
export const BOLT_RATE = 0.55;
export const BOLT_START_MIN = 192;              // ticks into the slot
export const BOLT_START_SPAN = 1440;
export const STROBE_1_END = 12;                 // ticks of age
export const STROBE_1_TAU = 4;
export const STROBE_2_START = 20;
export const STROBE_2_END = 30;
export const STROBE_2_TAU = 3;
export const STROBE_2_GAIN = 0.8;
export const BOLT_FLASH = 0.05;                 // sky-wide flash at full strobe, in accent units
export const BOLT_X_MIN = 0.45;                 // gnomonic, away from the disc
export const BOLT_X_SPAN = 0.4;                 // start at .45 to .85; .8 put about a quarter of strikes wholly off screen (V1 review)
export const BOLT_WALK = 0.14;
export const BOLT_POINTS = 9;
/** The whole path stays inside this, so every strike shows its bolt: 16:9 at FOV 58 shows |g.x| up to about .98. */
export const BOLT_X_MAX = 0.9;
