// The pure schedule of sky events. No three, no DOM, no state, no allocation in writeSkyEvents.
// Everything derives from tick mod SKY_CYCLE and zone fields, so setting the tick reproduces the frame exactly.
// It deliberately ignores zone.index and v.cam: a hashed zone index would pop a meteor at a zone boundary, and reading
// the camera would break periodChunks identity (plans/T04-sky.md, decision log).
import { Biome, type ZoneState } from '../../contracts/index';
import { hash01 } from '../../core/hash';
import {
  AURORA_GAIN_DAY, BOLT_FLASH, BOLT_PATH_SALT, BOLT_POINTS, BOLT_RATE, BOLT_SALT, BOLT_SLOT_TICKS, BOLT_START_MIN, BOLT_START_SPAN,
  BOLT_WALK, BOLT_X_MAX, BOLT_X_MIN, BOLT_X_SPAN, METEOR_CHANNEL_OFFSET, METEOR_CHANNELS, METEOR_DX_MIN, METEOR_DX_SPAN, METEOR_DY_MIN,
  METEOR_DY_SPAN, METEOR_FADE_IN, METEOR_FADE_OUT, METEOR_GAIN_DAY, METEOR_GATE_WIDTH, METEOR_LIFE_MIN, METEOR_LIFE_SPAN, METEOR_RATE,
  METEOR_RATE_ORBITAL, METEOR_SALT, METEOR_SLOT_TICKS, METEOR_START_MIN, METEOR_START_SPAN, METEOR_TAIL_LAG, METEOR_X_MIN,
  METEOR_X_SPAN, METEOR_Y_MIN, METEOR_Y_SPAN, STROBE_1_END, STROBE_1_TAU, STROBE_2_END, STROBE_2_GAIN, STROBE_2_START, STROBE_2_TAU,
} from './skyParams';

export const SKY_CYCLE = 30720;        // phase 7, 256 s. Divisible by every slot length here

export interface SkyEvents {
  readonly met: Float32Array;          // 8: head x, y, tail x, y for each channel
  readonly metK: Float32Array;         // 2
  readonly boltX: Float32Array;        // 9
  boltK: number;
  flash: number;
  aurora: number;
}
export type SkyZone = Readonly<Pick<ZoneState, 'biomeA' | 'biomeB' | 'biomeMix' | 'dayPhase'>>;

const TAU = 2 * Math.PI;

export function createSkyEvents(): SkyEvents {
  return { met: new Float32Array(8), metK: new Float32Array(2), boltX: new Float32Array(BOLT_POINTS), boltK: 0, flash: 0, aurora: 0 };
}

/** Weight of biome b in the crossfade. Continuous across a zone boundary, and it ignores biomeB at mix 0. */
export function biomeWeight(z: SkyZone, b: number): number {
  return (z.biomeA === b ? 1 - z.biomeMix : 0) + (z.biomeB === b ? z.biomeMix : 0);
}

/** 1 at dayPhase 0, deepest night. The sawtooth wrap cannot pop, since only the cosine is used. */
export function nightFactor(dayPhase: number): number {
  return 0.5 + 0.5 * Math.cos(TAU * dayPhase);
}

function writeMeteor(seed: number, c: number, tc: number, alpha: number, rate: number, nightGain: number, out: SkyEvents): void {
  const at = c * 4;
  // Channel 1's last slot spans the cycle wrap, so its slot and local tick run through the wrap with no jump.
  const lc = (tc + SKY_CYCLE - c * METEOR_CHANNEL_OFFSET) % SKY_CYCLE;
  const slot = Math.floor(lc / METEOR_SLOT_TICKS);
  const salt = METEOR_SALT + c;
  const h0 = hash01(seed, slot, salt, 0);
  if (h0 < rate) {
    const t0 = METEOR_START_MIN + METEOR_START_SPAN * hash01(seed, slot, salt, 1);
    const life = METEOR_LIFE_MIN + METEOR_LIFE_SPAN * hash01(seed, slot, salt, 2);
    const s = ((lc - slot * METEOR_SLOT_TICKS + alpha) / METEOR_SLOT_TICKS - t0) / life;
    if (s > 0 && s < 1) {
      const ax = METEOR_X_MIN + METEOR_X_SPAN * hash01(seed, slot, salt, 3);
      const ay = METEOR_Y_MIN + METEOR_Y_SPAN * hash01(seed, slot, salt, 4);
      const dx = (ax > 0 ? -1 : 1) * (METEOR_DX_MIN + METEOR_DX_SPAN * hash01(seed, slot, salt, 5));
      const dy = -(METEOR_DY_MIN + METEOR_DY_SPAN * hash01(seed, slot, salt, 6));
      const tail = Math.max(s - METEOR_TAIL_LAG, 0);
      out.met[at] = ax + dx * s;
      out.met[at + 1] = ay + dy * s;
      out.met[at + 2] = ax + dx * tail;
      out.met[at + 3] = ay + dy * tail;
      const gate = Math.min((rate - h0) / METEOR_GATE_WIDTH, 1);
      out.metK[c] = gate * Math.min(s / METEOR_FADE_IN, (1 - s) / METEOR_FADE_OUT, 1) * nightGain;
      return;
    }
  }
  out.met[at] = out.met[at + 1] = out.met[at + 2] = out.met[at + 3] = 0;
  out.metK[c] = 0;
}

function strobeAt(age: number): number {
  if (age >= 0 && age < STROBE_1_END) return Math.exp(-age / STROBE_1_TAU);
  if (age >= STROBE_2_START && age < STROBE_2_END) return STROBE_2_GAIN * Math.exp(-(age - STROBE_2_START) / STROBE_2_TAU);
  return 0;
}

function writeBolt(seed: number, tc: number, alpha: number, w: number, out: SkyEvents): void {
  out.boltK = 0;
  out.flash = 0;
  if (w > 0) {
    const slot = Math.floor(tc / BOLT_SLOT_TICKS);
    if (hash01(seed, slot, BOLT_SALT, 0) < BOLT_RATE) {
      const fire = BOLT_START_MIN + Math.floor(hash01(seed, slot, BOLT_SALT, 1) * BOLT_START_SPAN);
      const strobe = strobeAt(tc - slot * BOLT_SLOT_TICKS + alpha - fire);
      if (strobe > 0) {
        const side = hash01(seed, slot, BOLT_SALT, 3) < 0.5 ? -1 : 1;
        let x = side * (BOLT_X_MIN + BOLT_X_SPAN * hash01(seed, slot, BOLT_SALT, 2));
        let outer = side * x;
        out.boltX[0] = x;
        for (let i = 1; i < BOLT_POINTS; i++) {
          x += (hash01(seed, slot, BOLT_PATH_SALT, i) - 0.5) * BOLT_WALK;
          out.boltX[i] = x;
          outer = Math.max(outer, side * x);
        }
        // A walk past the screen edge moves the whole path inward, keeping its shape, so no strike flashes with no bolt.
        const shift = side * Math.max(outer - BOLT_X_MAX, 0);
        for (let i = 0; i < BOLT_POINTS; i++) out.boltX[i] = out.boltX[i]! - shift;
        out.boltK = w * strobe;
        out.flash = BOLT_FLASH * w * strobe;
        return;
      }
    }
  }
  out.boltX.fill(0);
}

/** Pure: same inputs give the same output, in any call order. tick is any integer below 2^53, alpha in [0, 1). */
export function writeSkyEvents(seed: number, tick: number, alpha: number, z: SkyZone, reduced: boolean, out: SkyEvents): void {
  const tc = tick % SKY_CYCLE;
  const night = nightFactor(z.dayPhase);
  const orbital = biomeWeight(z, Biome.ORBITAL_NIGHT);
  out.aurora = orbital * (AURORA_GAIN_DAY + (1 - AURORA_GAIN_DAY) * night);
  const rate = reduced ? -1 : METEOR_RATE + METEOR_RATE_ORBITAL * orbital;
  const nightGain = METEOR_GAIN_DAY + (1 - METEOR_GAIN_DAY) * night;
  for (let c = 0; c < METEOR_CHANNELS; c++) writeMeteor(seed, c, tc, alpha, rate, nightGain, out);
  writeBolt(seed, tc, alpha, reduced ? 0 : biomeWeight(z, Biome.CYBER_CANYON), out);
}
