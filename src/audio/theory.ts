// The score as data: every table of plan M1, verbatim. Pure. Tuning a chord or a melody means editing this file.
import { BPM } from '../contracts/index';

export const STEPS_PER_BAR = 16;
export const BEAT_S = 60 / BPM;            // .6
export const STEP_S = BEAT_S / 4;          // .15
export const BAR_S = STEP_S * STEPS_PER_BAR;   // 2.4

export const CHORD = { I: 0, VI: 1, III: 2, VII: 3, IV_MINOR: 4, V: 5, IV: 6, BII: 7 } as const;

/** bass and pad are semitones from the tonic. Names in the comments are for A minor. */
export interface ChordDef { readonly bass: number; readonly pad: readonly [number, number, number, number] }
export const CHORDS: readonly ChordDef[] = [
  { bass: 0, pad: [0, 3, 7, 14] },     // i     Am(add9)  A C E B
  { bass: -4, pad: [-4, 3, 7, 12] },   // VI    Fmaj7     F C E A
  { bass: 3, pad: [-2, 3, 7, 14] },    // III   Cmaj7/G   G C E B
  { bass: -2, pad: [-2, 2, 5, 12] },   // VII   G(add9)   G B D A
  { bass: 5, pad: [-4, 0, 5, 15] },    // iv    Dm7/F     F A D C
  { bass: -5, pad: [-1, 2, 7, 11] },   // V     E/G#      G# B E G#, harmonic minor
  { bass: 5, pad: [-3, 0, 5, 9] },     // IV    D/F#      F# A D F#, Dorian colour
  { bass: 1, pad: [1, 5, 8, 12] },     // bII   Bbmaj7    Bb D F A, Phrygian colour
];

/** One chord per bar, indexed by bar % 4. */
export const PROGRESSIONS: readonly (readonly [number, number, number, number])[] = [
  [0, 1, 2, 3],   // P0 Night Drive    i VI III VII
  [0, 3, 1, 3],   // P1 Neon Vamp      i VII VI VII
  [1, 3, 0, 0],   // P2 Skyline        VI VII i i
  [0, 4, 1, 5],   // P3 Turbo Cadence  i iv VI V
  [0, 2, 3, 6],   // P4 Dorian Dawn    i III VII IV
  [0, 7, 0, 3],   // P5 Black Chrome   i bII i VII
];

/** (A progression, B progression), by sector % 6. */
export const SONGS: readonly (readonly [number, number])[] = [[0, 2], [1, 3], [3, 0], [4, 2], [5, 1], [2, 4]];

/** One per progression: [step, semitones above the tonic, length in steps], over 64 steps. MIDI is padTonic + 12 + semitones. */
export type MelodyNote = readonly [number, number, number];
export const MELODIES: readonly (readonly MelodyNote[])[] = [
  [[0, 7, 6], [6, 5, 2], [8, 3, 8], [16, 0, 8], [24, 3, 4], [28, 7, 4], [32, 10, 12], [44, 7, 4], [48, 5, 8], [56, 2, 4], [60, 5, 4]],
  [[0, 12, 4], [4, 14, 4], [8, 12, 8], [16, 10, 8], [24, 5, 8], [32, 7, 8], [40, 3, 4], [44, 0, 4], [48, 2, 8], [56, 5, 4], [60, 10, 4]],
  [[0, 12, 8], [8, 7, 8], [16, 10, 12], [28, 5, 4], [32, 7, 8], [40, 12, 6], [46, 14, 2], [48, 15, 8], [56, 12, 8]],
  [[0, 3, 6], [6, 7, 2], [8, 12, 8], [16, 8, 8], [24, 5, 4], [28, 3, 4], [32, 7, 8], [40, 8, 4], [44, 12, 4], [48, 11, 12], [60, 7, 4]],
  [[0, 7, 8], [8, 12, 8], [16, 10, 4], [20, 7, 4], [24, 3, 8], [32, 5, 8], [40, 2, 8], [48, 9, 8], [56, 5, 4], [60, 0, 4]],
  [[0, 12, 12], [12, 10, 4], [16, 8, 8], [24, 5, 8], [32, 7, 8], [40, 3, 8], [48, 5, 8], [56, 2, 8]],
];

/** R root, r ghost root at velocity .7, O root + 12, . rest. */
export const BASS_PATTERNS: readonly string[] = [
  'R.R.R.R.R.R.R.R.',   // B0 eighths
  'RrRrRrRrRrRrRrRr',   // B1 rolling
  'R.RR.ROrR.RR.RO.',   // B2 octave pump
  'R.rrR.rrR.rrR.rr',   // B3 gallop
];

/** Indexes into the pad voicing, -1 rest. */
export const ARP_PATTERNS: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3],           // A0 up
  [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1, 2, 3],           // A1 up-down
  [0, 2, 1, 3, 0, 2, 1, 3, 0, 2, 1, 3, 0, 2, 1, 3],           // A2 skip
  [0, 0, 2, 0, 3, 0, 2, 1, 0, 0, 2, 0, 3, 0, 2, 3],           // A3 stutter
  [0, -1, -1, 2, -1, -1, 3, -1, 1, -1, -1, 2, -1, -1, 3, -1], // A4 tresillo
  [0, -1, -1, 1, -1, -1, 2, -1, -1, 3, -1, -1, 2, -1, -1, 1], // A5 threes
];

/** Velocity shape by i % 4: the short notes' side of the pump. */
export const PUMP: readonly number[] = [0.62, 0.82, 0.95, 1];

/** Playback rate of a fill's tom, by step - 8. */
export const TOM_RATES: readonly number[] = [1.5, 1.5, 1.25, 1.25, 1, 1, 0.8, 0.8];

/** Natural minor, as pitch classes above the tonic. */
export const SCALE: readonly number[] = [0, 2, 3, 5, 7, 8, 10];

/** Seed of the bass and arp picks. Private on purpose: the music does not follow ?seed (T00 seam). */
export const PICK_SEED = 1985;

/** T0 is SYNC 1 to 3, T1 is 4 to 7, T2 is 8 to 11, T3 is 12 to 15, T4 is 16. */
export function tierOf(sync: number): number {
  return sync >= 16 ? 4 : sync >= 12 ? 3 : sync >= 8 ? 2 : sync >= 4 ? 1 : 0;
}

/** Any integer key folds to [0, 12). */
export function normKey(musicKey: number): number {
  return ((musicKey % 12) + 12) % 12;
}

/** A3 at key 0, always inside E3 to D#4. */
export function padTonic(musicKey: number): number {
  return 52 + (normKey(musicKey) + 5) % 12;
}

/** A1 at key 0, always inside G1 to F#2. */
export function bassTonic(musicKey: number): number {
  return 31 + (normKey(musicKey) + 2) % 12;
}

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
