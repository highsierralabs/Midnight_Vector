// Events to cues: T07's own chain, quantisation to the sixteenth grid, the one-blip-per-step queue. Pure; the
// Web Audio side is an SfxSink. Reads kind, x, value and index only. y and chunk are never read.
import { Ev, PLAY_HALF_X, type EventBuffer } from '../contracts/index';
import { stepAtOrAfter, timeOfStep, type BeatClock } from './clock';
import { ladderMidi } from './composer';
import { CHORDS, padTonic } from './theory';

/** A pickup at most this long after a grid line plays now: at cruise they arrive just after one (plan M2). */
export const GRACE_S = 0.03;
export const QUEUE_LIMIT_STEPS = 3;
export const CHAIN_TIMEOUT_STEPS = 32;
/** -6 dB, for a cosmetic pickup (value 0). */
export const COSMETIC_GAIN = 0.501;

export interface SfxSink {
  blip(t: number, midi: number, vel: number, pan: number): void;
  stab(t: number, m0: number, m1: number, m2: number, m3: number, vel: number): void;
  miss(t: number, midi: number, vel: number): void;
  graze(t: number, vel: number, pan: number): void;
  hit(t: number): void;
  lost(t: number): void;
}

export interface Harmony {
  chordAtStep(step: number): number;
  keyAtStep(step: number): number;
}

export interface Sfx {
  /** Scored shards in a row. Independent of T02's CHAIN objective and of sim.sync (plan seam). */
  chain: number;
  dropped: number;
  handle(events: Readonly<EventBuffer>, now: number): void;
  handleOne(kind: number, x: number, value: number, index: number, now: number): void;
}

/** Chord root, an octave below the ladder. */
export function missMidi(chord: number, key: number): number {
  const base = ladderMidi(chord, key, 0) - 12;
  const pc = (((padTonic(key) + CHORDS[chord]!.bass) % 12) + 12) % 12;
  let m = base;
  while (m % 12 !== pc) m += 1;
  return m;
}

function panOf(x: number): number {
  if (x !== x) return 0;
  const p = x / PLAY_HALF_X;
  return (p < -1 ? -1 : p > 1 ? 1 : p) * 0.5;
}

export function createSfx(clock: BeatClock, harmony: Harmony, sink: SfxSink): Sfx {
  const q = { step: 0, inGrace: false, lastBlip: -Infinity, lastShard: -Infinity };

  function quantise(now: number): void {
    const next = stepAtOrAfter(clock, now);
    q.inGrace = now - timeOfStep(clock, next - 1) <= GRACE_S;
    q.step = q.inGrace ? next - 1 : next;
  }

  function timeAt(step: number, target: number, now: number): number {
    return step === target && q.inGrace ? now : timeOfStep(clock, step);
  }

  const sfx: Sfx = {
    chain: 0,
    dropped: 0,

    handle(events: Readonly<EventBuffer>, now: number): void {
      const n = events.count;
      for (let i = 0; i < n; i++) {
        sfx.handleOne(events.kind[i]!, events.x[i]!, events.value[i]!, events.index[i]!, now);
      }
    },

    handleOne(kind: number, x: number, value: number, index: number, now: number): void {
      switch (kind) {
        case Ev.SHARD: {
          quantise(now);
          const target = q.step;
          if (target - q.lastShard > CHAIN_TIMEOUT_STEPS) sfx.chain = 0;
          if (value !== 0) {
            sfx.chain += 1;
            q.lastShard = target;
          }
          const step = target > q.lastBlip + 1 ? target : q.lastBlip + 1;
          if (step - target > QUEUE_LIMIT_STEPS) {
            sfx.dropped += 1;   // the sound goes; the chain has already counted
            return;
          }
          q.lastBlip = step;
          const rung = sfx.chain > 0 ? sfx.chain - 1 : 0;
          sink.blip(
            timeAt(step, target, now),
            ladderMidi(harmony.chordAtStep(step), harmony.keyAtStep(step), rung),
            value !== 0 ? 1 : COSMETIC_GAIN,
            panOf(x),
          );
          return;
        }
        case Ev.GATE: {
          quantise(now);
          const c = harmony.chordAtStep(q.step);
          const k = harmony.keyAtStep(q.step);
          sink.stab(
            timeAt(q.step, q.step, now),
            ladderMidi(c, k, 0), ladderMidi(c, k, 1), ladderMidi(c, k, 2), ladderMidi(c, k, 3),
            value !== 0 ? 1 : COSMETIC_GAIN,
          );
          return;
        }
        case Ev.GATE_MISS: {
          sfx.chain = 0;
          quantise(now);
          sink.miss(timeAt(q.step, q.step, now), missMidi(harmony.chordAtStep(q.step), harmony.keyAtStep(q.step)), 1);
          return;
        }
        case Ev.GRAZE:
          sink.graze(now, value !== 0 ? 1 : COSMETIC_GAIN, panOf(x));
          return;
        case Ev.HIT:
          sfx.chain = 0;
          sink.hit(now);
          return;
        case Ev.SIGNAL_LOST:
          sfx.chain = 0;
          sink.lost(now);
          return;
        case Ev.GRADE: {
          const rank = index > 3 ? 3 : index;
          const notes = 4 - rank;
          const beatStep = Math.ceil(stepAtOrAfter(clock, now) / 4) * 4;
          for (let j = 0; j < notes; j++) {
            const step = beatStep + j;
            sink.blip(timeOfStep(clock, step), ladderMidi(harmony.chordAtStep(step), harmony.keyAtStep(step), j), 1, 0);
          }
          if (beatStep + notes - 1 > q.lastBlip) q.lastBlip = beatStep + notes - 1;
          return;
        }
        default:
          // SECTOR, BOOST_ON, BOOST_OFF: sector comes from zone.index, and wind from sim.speed, so a dropped event cannot strand a sound.
          return;
      }
    },
  };
  return sfx;
}
