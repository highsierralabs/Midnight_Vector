// Pure composer: one bar of notes written into caller-owned arrays, no allocation. Bars are integer-valued doubles
// up to 2^53, so everything here is % and Math.floor, never a bit operation on a bar or a sector.
import { hash01 } from '../core/hash';
import {
  ARP_PATTERNS, BASS_PATTERNS, CHORDS, MELODIES, PICK_SEED, PROGRESSIONS, PUMP, SONGS,
  bassTonic, padTonic, tierOf,
} from './theory';

export const Layer = { KICK: 0, SNARE: 1, HAT: 2, OHAT: 3, TOM: 4, CRASH: 5, RISER: 6, BASS: 7, PAD: 8, ARP: 9, LEAD: 10 } as const;
export const LAYER_COUNT = 11;
export const MAX_BAR_NOTES = 96;

export interface BarPattern {
  bar: number; chord: number; kickMask: number; count: number;
  readonly layer: Uint8Array; readonly step: Uint8Array; readonly midi: Uint8Array;
  readonly len: Float32Array; readonly vel: Float32Array;   // len in steps
}

/** fillNext: this bar is the fill before a sector change. entered: this bar is the first of a new sector. */
export interface SectorMusic { index: number; key: number; fillNext: boolean; entered: boolean }

export function createBarPattern(): BarPattern {
  return {
    bar: 0, chord: 0, kickMask: 0, count: 0,
    layer: new Uint8Array(MAX_BAR_NOTES), step: new Uint8Array(MAX_BAR_NOTES), midi: new Uint8Array(MAX_BAR_NOTES),
    len: new Float32Array(MAX_BAR_NOTES), vel: new Float32Array(MAX_BAR_NOTES),
  };
}

function formStep(bar: number): number {
  return ((bar % 32) + 32) % 32;
}

function songIndex(sectorIndex: number): number {
  return ((sectorIndex % 6) + 6) % 6;
}

/** The progression in use at form position s: the song's B in section B, its A everywhere else. */
function progressionAt(s: number, song: number): number {
  const pair = SONGS[song]!;
  return s >= 16 && s < 24 ? pair[1] : pair[0];
}

function chordIn(s: number, song: number): number {
  if (s >= 24 && s < 28) return s < 26 ? 0 : 1;   // the break: i for 24 and 25, VI for 26 and 27
  return PROGRESSIONS[progressionAt(s, song)]![s % 4]!;
}

export function chordAt(bar: number, sectorIndex: number): number {
  return chordIn(formStep(bar), songIndex(sectorIndex));
}

/**
 * The chord's pitch classes stacked upward from the first chord tone at or above padTonic + 12, for two octaves.
 * index is clamped to the top, and alternates between the top two after that. If the top would pass MIDI 96, the
 * whole ladder moves down an octave, never note by note, so it stays monotonic and in the chord (DI-48).
 */
export function ladderMidi(chord: number, key: number, index: number): number {
  const pad = CHORDS[chord]!.pad;
  const tonic = padTonic(key);
  let mask = 0;   // twelve bits of pitch class
  let tones = 0;
  for (let i = 0; i < 4; i++) {
    const bit = 1 << ((((tonic + pad[i]!) % 12) + 12) % 12);
    if ((mask & bit) === 0) { mask |= bit; tones++; }
  }
  const len = tones * 2;
  const clamped = index < 0 ? 0 : Math.floor(index);
  const at = clamped < len ? clamped : len - 2 + (clamped - len) % 2;
  let found = 0;
  let top = 0;
  let n = 0;
  for (let m = tonic + 12; n < len; m++) {
    if ((mask & (1 << (m % 12))) === 0) continue;
    if (n === at) found = m;
    top = m;
    n++;
  }
  return top > 96 ? found - 12 : found;
}

// Picks are stable per sector, so one memo saves three hash01 calls per bar. It cannot change a result, and it is
// a typed array because a double returned through a call can box (Agents.md).
const picks = new Float64Array(4);
picks[0] = NaN;

function loadPicks(sector: number): void {
  picks[0] = sector;
  picks[1] = hash01(PICK_SEED, sector, 1, 0) < 0.5 ? 1 : 3;
  picks[2] = hash01(PICK_SEED, sector, 2, 0) < 0.5 ? 2 : 1;
  picks[3] = Math.floor(hash01(PICK_SEED, sector, 3, 0) * 6);
}

/** The bass pattern and arp pattern a sector picks, for tests and for nothing else in production. */
export function bassPatternFor(sectorIndex: number, tier: number): number {
  if (picks[0] !== sectorIndex) loadPicks(sectorIndex);
  return tier === 0 ? 0 : tier === 1 ? picks[1]! : picks[2]!;
}

export function arpPatternFor(sectorIndex: number): number {
  if (picks[0] !== sectorIndex) loadPicks(sectorIndex);
  return picks[3]!;
}

/**
 * Claims the next note. The caller writes len and vel straight into the arrays, because a double passed through a
 * call that does not inline gets boxed: 15 scavenges over 3e6 bars with them as arguments [O: alloc.test.ts]. Past
 * the limit the index is out of range and the typed-array writes do nothing, which is safer here than a throw.
 */
function claim(out: BarPattern, layer: number, step: number, midi: number): number {
  const i = out.count;
  if (i >= MAX_BAR_NOTES) return MAX_BAR_NOTES;
  out.layer[i] = layer;
  out.step[i] = step;
  out.midi[i] = midi;
  out.len[i] = 0;
  out.vel[i] = 1;
  out.count = i + 1;
  return i;
}

/** Writes one bar. No allocation. Same arguments give identical arrays, in any call order. */
export function patternFor(bar: number, sector: Readonly<SectorMusic>, sync: number, out: BarPattern): BarPattern {
  const s = ((bar % 32) + 32) % 32;
  const T = tierOf(sync);
  const inA = s < 16;
  const inB = s >= 16 && s < 24;
  const inC = s >= 24 && s < 28;
  const inD = s >= 28;
  const index = sector.index;
  const song = ((index % 6) + 6) % 6;
  const chordId = chordIn(s, song);
  const chord = CHORDS[chordId]!;
  const padT = padTonic(sector.key);
  const bassT = bassTonic(sector.key);
  if (picks[0] !== index) loadPicks(index);

  out.bar = bar;
  out.chord = chordId;
  out.kickMask = 0;
  out.count = 0;

  // Kick
  for (let i = 0; i < 16; i++) {
    let on: boolean;
    if (inC) on = s === 27 ? i % 4 === 0 : s === 26 ? i % 8 === 0 : i === 0;
    else if (T === 0) on = i === 0 || i === 6 || i === 8;
    else on = i % 4 === 0;
    if (on) {
      out.kickMask |= 1 << i;
      const n = claim(out, Layer.KICK, i, 0);
      out.vel[n] = i === 0 ? 1 : 0.92;
    }
  }

  // Snare
  if (!(inC && s < 27)) claim(out, Layer.SNARE, 4, 0);
  claim(out, Layer.SNARE, 12, 0);

  // Hats
  const sixteenths = T >= 2;
  const openAllowed = T >= 3 || (inB && T >= 1);
  for (let i = 0; i < 16; i += sixteenths ? 1 : 2) {
    const off = i % 4 === 2;
    if (inC && s < 26 && !off) continue;
    const n = claim(out, openAllowed && off ? Layer.OHAT : Layer.HAT, i, 0);
    out.vel[n] = sixteenths ? (i % 4 === 0 ? 0.8 : i % 2 === 0 ? 0.6 : 0.35) : off ? 0.85 : 0.55;
  }

  // Bass
  const bassId = inC ? 0 : T === 0 ? 0 : T === 1 ? picks[1]! : picks[2]!;
  const bassPat = BASS_PATTERNS[bassId]!;
  let root = bassT + chord.bass;
  if (root < 28) root += 12;
  for (let i = 0; i < 16; i++) {
    if (inC && s < 26 && i >= 8) break;
    const c = bassPat.charCodeAt(i);
    if (c === 46) continue;   // .
    const next = bassPat.charCodeAt((i + 1) % 16);
    const n = claim(out, Layer.BASS, i, c === 79 ? root + 12 : root);   // O
    out.len[n] = bassId === 0 || next === 46 ? 1.6 : 0.8;
    out.vel[n] = (c === 114 ? 0.7 : 1) * PUMP[i % 4]!;   // r
  }

  // Pad
  for (let v = 0; v < 4; v++) {
    const n = claim(out, Layer.PAD, 0, padT + chord.pad[v]!);
    out.len[n] = 16;
  }
  if (T >= 3 && padT + chord.pad[3] + 12 <= 84) {
    const n = claim(out, Layer.PAD, 0, padT + chord.pad[3] + 12);
    out.len[n] = 16;
    out.vel[n] = 0.5;
  }

  // Arp
  if (T >= 1 && !(inC && s < 26)) {
    const arp = ARP_PATTERNS[picks[3]!]!;
    for (let i = 0; i < 16; i++) {
      const ix = arp[i]!;
      if (ix < 0) continue;
      let m = padT + 12 + chord.pad[ix]!;
      if (T >= 3 && i >= 8) m += 12;
      while (m > 96) m -= 12;
      const n = claim(out, Layer.ARP, i, m);
      out.len[n] = 1.2;
      out.vel[n] = (i % 4 === 0 ? 0.9 : 0.65) * PUMP[i % 4]!;
    }
  }

  // Lead
  const leadOn = T >= 2 && (inB || (inA && Math.floor(bar / 4) % 2 === 0) || (inD && s >= 30));
  if (leadOn) {
    const melody = MELODIES[progressionAt(s, song)]!;
    const from = (s % 4) * 16;
    for (let i = 0; i < melody.length; i++) {
      const note = melody[i]!;
      const st = note[0];
      if (st < from || st >= from + 16) continue;
      const semi = note[1];
      const raw = padT + 12 + semi;
      const fold = raw > 91 ? 12 : 0;
      const n = claim(out, Layer.LEAD, st - from, raw - fold);
      out.len[n] = note[2];
      if (T >= 4) {
        const h = claim(out, Layer.LEAD, st - from, raw - fold - harmonyBelow(chord, semi));
        out.len[h] = note[2];
        out.vel[h] = 0.55;
      }
    }
  }

  // Fill
  if (sector.fillNext || s === 31) {
    claim(out, Layer.RISER, 0, 0);
    const stride = T >= 1 ? 1 : 2;
    const count = T >= 1 ? 8 : 4;
    for (let j = 0; j < count; j++) {
      const n = claim(out, Layer.TOM, 8 + j * stride, 0);
      out.vel[n] = 0.75 + (0.25 * j) / count;
    }
  }

  // Crash
  if (s === 0 || s === 16 || sector.entered) claim(out, Layer.CRASH, 0, 0);

  return out;
}

// ---- A21's bound (DI-59), counted from the score. Dev and test use only; nothing in production calls these. ----

/**
 * Sources each note starts, by Layer, as voices.ts plays it: a one-shot is one buffer source, a bass note two saws
 * and a sine, a pad voice four saws, an arp note a saw and a square, a lead note two saws and a vibrato sine. A21
 * checks this table against the real voices by counting AudioScheduledSourceNode.start.
 */
export const SOURCES_PER_NOTE: readonly number[] = [1, 1, 1, 1, 1, 1, 1, 3, 4, 2, 3];

/** Steps the scheduler can start in the 300 ms after resume(): a 120 ms window over 300 ms reaches 3 steps of 150. */
export const RESUME_STEPS = 3;

/** Sources the sequencer starts at one step of a bar, the pad chord excluded. */
export function stepSources(p: Readonly<BarPattern>, inBar: number): number {
  let n = 0;
  for (let i = 0; i < p.count; i++) {
    const layer = p.layer[i]!;
    if (p.step[i] === inBar && layer !== Layer.PAD) n += SOURCES_PER_NOTE[layer]!;
  }
  return n;
}

/** Sources one pad chord starts. */
export function padSources(p: Readonly<BarPattern>): number {
  let n = 0;
  for (let i = 0; i < p.count; i++) if (p.layer[i] === Layer.PAD) n += SOURCES_PER_NOTE[Layer.PAD]!;
  return n;
}

/**
 * The most the sequencer can start in the 300 ms after resume() when the first step it schedules is `step` (0 to 15)
 * of form bar `bar`: 3 steps from there, plus the recovered pad chord of that bar, since restart clears the pad bar.
 * A step 0 among the later steps brings its own bar's chord, as any downbeat does. A first step of 0 recovers the
 * chord it would have played anyway, so that chord counts once. Hats and arp notes the cap drops only lower the real
 * count. `a` and `b` are scratch patterns.
 */
export function resumeSources(
  bar: number, step: number, sector: Readonly<SectorMusic>, sync: number, a: BarPattern, b: BarPattern,
): number {
  let p = patternFor(bar, sector, sync, a);
  let n = padSources(p);
  let inBar = step;
  for (let j = 0; j < RESUME_STEPS; j++) {
    if (inBar === 16) {
      inBar = 0;
      p = patternFor(bar + 1, sector, sync, b);
      n += padSources(p);
    }
    n += stepSources(p, inBar);
    inBar += 1;
  }
  return n;
}

export interface ResumeWorst { bar: number; step: number; sector: number; key: number; sources: number }

/**
 * The worst resume position over all 32 form bars, the 6 songs' sectors 0 to 5 and every first step, at one SYNC
 * and key, by resumeSources. Ties go to the first found, bar then sector then step.
 */
export function worstResume(sync: number, key: number): ResumeWorst {
  const a = createBarPattern();
  const b = createBarPattern();
  const out: ResumeWorst = { bar: 0, step: 0, sector: 0, key, sources: -1 };
  const sector: SectorMusic = { index: 0, key, fillNext: false, entered: false };
  for (let bar = 0; bar < 32; bar++) {
    for (let index = 0; index < 6; index++) {
      sector.index = index;
      for (let step = 0; step < 16; step++) {
        const n = resumeSources(bar, step, sector, sync, a, b);
        if (n > out.sources) {
          out.bar = bar;
          out.step = step;
          out.sector = index;
          out.sources = n;
        }
      }
    }
  }
  return out;
}

/** Semitones down to the nearest chord tone 3 to 9 below semi. */
function harmonyBelow(chord: { readonly pad: readonly number[] }, semi: number): number {
  for (let d = 3; d <= 9; d++) {
    const pc = (((semi - d) % 12) + 12) % 12;
    for (let v = 0; v < 4; v++) {
      if ((((chord.pad[v]! % 12) + 12) % 12) === pc) return d;
    }
  }
  return 3;
}
