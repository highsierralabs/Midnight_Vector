// Cosmetic only. createFeel gets no sim reference, reads what update is handed, and writes only its own out object.
//
// update's order is decay, then events, then output, so the frame an event arrives on shows its full height whatever
// dt is, and two frame rates agree at any time both of them sample.
import {
  CAMERA_FOV, CAMERA_FOV_MAX, Ev, EVENT_CAPACITY, SIM_HZ, SimMode, SPEED_CRUISE, SPEED_MAX,
  type EventBuffer, type Feel, type FeelState, type SimState,
} from '../contracts/index';
import { createNeutralFeel } from '../core/alloc';
import { FEEL_TUNING as F } from './tuning';

const TAU = 2 * Math.PI;
/** An exponential decay never lands on 0, so below this a pulse is over: neutral is exact, and no denormal lingers. */
const SETTLED = 1e-5;

export function createFeelInternal(): Feel {
  const out: FeelState = createNeutralFeel();
  // Hidden state keeps moving under reduced motion, so the toggle cannot pop.
  const h = {
    trauma: 0, bank: 0, fovBase: CAMERA_FOV, fovPulse: 0, flash: 0, aberr: 0, bloom: 0, lines: 0, glitch: 0, duck: 0, hold: 0,
    lineGoal: 0, fovGoal: CAMERA_FOV, bankGoal: 0,
  };
  let started = false;

  function update(dt: number, s: Readonly<SimState>, e: EventBuffer, reducedMotion: boolean): void {
    const d = dt > 0 ? dt : 0;

    // Decay what was there.
    const trauma = h.trauma - F.TRAUMA_DECAY_PER_S * d;
    h.trauma = trauma > 0 ? trauma : 0;
    const flash = h.flash * Math.exp(-d / F.FLASH_TAU);
    h.flash = flash > SETTLED ? flash : 0;
    const aberr = h.aberr * Math.exp(-d / F.ABERR_TAU);
    h.aberr = aberr > SETTLED ? aberr : 0;
    const bloom = h.bloom * Math.exp(-d / F.BLOOM_TAU);
    h.bloom = bloom > SETTLED ? bloom : 0;
    const fovPulse = h.fovPulse * Math.exp(-d / F.FOV_PULSE_TAU);
    h.fovPulse = fovPulse > SETTLED ? fovPulse : 0;
    const hold = h.hold - d;
    h.hold = hold > 0 ? hold : 0;
    const glitch = h.glitch - d / F.GLITCH_S;
    h.glitch = glitch > 0 ? glitch : 0;
    const duck = h.duck - d / F.DUCK_S;
    h.duck = duck > 0 ? duck : 0;

    // Read this frame's events, by kind only, so a cosmetic event pulses too and the title screen breathes.
    const n = e.count < EVENT_CAPACITY ? e.count : EVENT_CAPACITY;
    for (let i = 0; i < n; i++) {
      const kind = e.kind[i];
      if (kind === Ev.SHARD) {
        h.flash += F.FLASH_SHARD;
      } else if (kind === Ev.GATE) {
        h.flash += F.FLASH_GATE;
        h.aberr += F.ABERR_GATE;
        h.bloom += F.BLOOM_GATE;
        h.fovPulse = F.FOV_GATE_PULSE_DEG;
      } else if (kind === Ev.HIT) {
        h.trauma += F.TRAUMA_HIT;
        h.flash += F.FLASH_HIT;
        h.aberr += F.ABERR_HIT;
        h.hold = F.HITSTOP_S;
        h.glitch = 1;
        h.duck = 1;
      } else if (kind === Ev.SIGNAL_LOST) {
        h.trauma += F.TRAUMA_SIGNAL_LOST;
      }
    }
    if (h.trauma > 1) h.trauma = 1;
    if (h.flash > F.FLASH_CAP) h.flash = F.FLASH_CAP;
    if (h.aberr > F.ABERR_CAP) h.aberr = F.ABERR_CAP;
    const bloomRoom = F.BLOOM_GAIN_CAP - 1;
    if (h.bloom > bloomRoom) h.bloom = bloomRoom;
    if (s.mode === SimMode.SIGNAL_LOST && h.glitch < F.GLITCH_SIGNAL_LOST_HOLD) h.glitch = F.GLITCH_SIGNAL_LOST_HOLD;

    // What follows the sim's speed and steering. Each eases toward the mean of its last two goals, so a goal that moves
    // between frames does not lead by half a frame. A NaN reading becomes a goal of 0 rather than sticking.
    const over = (s.speed - SPEED_CRUISE) / (SPEED_MAX - SPEED_CRUISE);
    const boostBlend = over > 0 ? (over < 1 ? over : 1) : 0;
    const lineLevel = (s.speed - F.SPEED_LINES_MIN) / (SPEED_MAX - F.SPEED_LINES_MIN);
    const lineGoal = lineLevel > 0 ? (lineLevel < 1 ? lineLevel : 1) : 0;
    const fovGoal = CAMERA_FOV + F.FOV_BOOST_DEG * boostBlend;
    const rate = ((s.x - s.prevX) * SIM_HZ) / F.BANK_REF_RATE;
    const lean = rate > 1 ? 1 : rate < -1 ? -1 : rate === rate ? rate : 0;
    const bankGoal = -F.BANK_ROLL_MAX * lean;
    if (!started) {
      started = true;
      h.lineGoal = lineGoal;
      h.fovGoal = fovGoal;
      h.bankGoal = bankGoal;
    }
    h.lines += ((lineGoal + h.lineGoal) / 2 - h.lines) * (1 - Math.exp(-d / F.SPEED_LINES_TAU));
    h.lineGoal = lineGoal;
    h.fovBase += ((fovGoal + h.fovGoal) / 2 - h.fovBase) * (1 - Math.exp(-d / F.FOV_TAU));
    h.fovGoal = fovGoal;
    h.bank += ((bankGoal + h.bankGoal) / 2 - h.bank) * (1 - Math.exp(-d / F.BANK_TAU));
    h.bankGoal = bankGoal;

    // Output.
    const beatPart = s.beat - Math.floor(s.beat);
    const beatPulse = F.BLOOM_BEAT * Math.exp(-beatPart * F.BLOOM_BEAT_K);
    const gain = 1 + h.bloom + (beatPulse === beatPulse ? beatPulse : 0);
    const aberration = F.ABERR_BOOST * boostBlend + h.aberr;
    const fov = h.fovBase + h.fovPulse;
    out.duck = h.duck;
    out.shipHold = h.hold;
    if (reducedMotion) {
      out.shakeX = 0;
      out.shakeY = 0;
      out.roll = 0;
      out.fovDeg = CAMERA_FOV;
      out.aberration = 0;
      out.flash = 0;
      out.speedLines = 0;
      out.bloomGain = 1;
      out.glitch = 0;
      return;
    }
    const amp = h.trauma * h.trauma;
    if (amp > 0) {
      const p3 = (s.tick % SIM_HZ) / SIM_HZ;
      out.shakeX = F.SHAKE_YAW_MAX * amp * 0.5 * (Math.sin(TAU * F.SHAKE_YAW_A * p3) + Math.sin(TAU * F.SHAKE_YAW_B * p3));
      out.shakeY = F.SHAKE_PITCH_MAX * amp * 0.5 * (Math.sin(TAU * F.SHAKE_PITCH_A * p3) + Math.sin(TAU * F.SHAKE_PITCH_B * p3));
      out.roll = h.bank + F.SHAKE_ROLL_MAX * amp * 0.5 * (Math.sin(TAU * F.SHAKE_ROLL_A * p3) + Math.sin(TAU * F.SHAKE_ROLL_B * p3));
    } else {
      out.shakeX = 0;
      out.shakeY = 0;
      out.roll = h.bank;
    }
    out.fovDeg = Math.min(fov, CAMERA_FOV_MAX);
    out.aberration = Math.min(aberration, F.ABERR_CAP);
    out.flash = h.flash;
    out.speedLines = h.lines;
    out.bloomGain = Math.min(gain, F.BLOOM_GAIN_CAP);
    out.glitch = h.glitch;
  }

  return { out, update };
}
