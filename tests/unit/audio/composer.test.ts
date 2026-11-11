// A1, A1n: the score, checked as music before a sound exists.
import { describe, expect, it } from 'vitest';
import {
  Layer, MAX_BAR_NOTES, arpPatternFor, bassPatternFor, chordAt, createBarPattern, ladderMidi, patternFor,
  type BarPattern, type SectorMusic,
} from '../../../src/audio/composer';
import {
  ARP_PATTERNS, BASS_PATTERNS, CHORDS, MELODIES, PROGRESSIONS, SCALE, SONGS, bassTonic, padTonic, tierOf,
  type ChordDef, type MelodyNote,
} from '../../../src/audio/theory';

const pc = (x: number): number => ((x % 12) + 12) % 12;

// ---- checkers take the tables as parameters, so a bad table can be fed to them (A1n) ----

function checkMelodies(
  melodies: readonly (readonly MelodyNote[])[],
  progressions: readonly (readonly number[])[],
  chords: readonly ChordDef[],
  scale: readonly number[],
): string[] {
  const problems: string[] = [];
  melodies.forEach((m, p) => {
    let end = 0;
    for (const [step, semi, len] of m) {
      if (step !== end) problems.push(`melody-overlap: P${p} step ${step} expected ${end}`);
      end = step + len;
      const bar = Math.floor(step / 16);
      const chord = chords[progressions[p]![bar]!]!;
      const tones = chord.pad.map(pc);
      const isTone = tones.includes(pc(semi));
      if (step % 16 % 8 === 0 && !isTone) problems.push(`melody-downbeat: P${p} step ${step} semi ${semi}`);
      if (!isTone && !scale.includes(pc(semi))) problems.push(`melody-out-of-scale: P${p} step ${step} semi ${semi}`);
    }
    if (end !== 64) problems.push(`melody-span: P${p} ends at ${end}`);
  });
  return problems;
}

function checkVoiceLeading(progressions: readonly (readonly number[])[], chords: readonly ChordDef[]): string[] {
  const problems: string[] = [];
  progressions.forEach((prog, p) => {
    for (let i = 0; i < 4; i++) {
      const a = chords[prog[i]!]!.pad;
      const b = chords[prog[(i + 1) % 4]!]!.pad;
      for (let v = 0; v < 4; v++) {
        const leap = Math.abs(a[v]! - b[v]!);
        if (leap > 5) problems.push(`pad-leap: P${p} bar ${i} voice ${v} moves ${leap}`);
      }
    }
  });
  return problems;
}

function checkBassInPad(chords: readonly ChordDef[]): string[] {
  const problems: string[] = [];
  chords.forEach((c, i) => {
    if (!c.pad.map(pc).includes(pc(c.bass))) problems.push(`bass-root: chord ${i}`);
  });
  return problems;
}

const RANGE: Record<string, readonly [number, number]> = { bass: [28, 59], pad: [48, 84], arp: [60, 96], lead: [60, 91] };

function checkRange(name: string, midis: readonly number[]): string[] {
  const [lo, hi] = RANGE[name]!;
  return midis.filter((m) => m < lo || m > hi).map((m) => `range-${name}: ${m}`);
}

// ---- helpers ----

function sectorOf(index = 0, key = 0, fillNext = false, entered = false): SectorMusic {
  return { index, key, fillNext, entered };
}

function counts(p: BarPattern): number[] {
  const c = new Array<number>(11).fill(0);
  for (let i = 0; i < p.count; i++) c[p.layer[i]!]! += 1;
  return c;
}

function notes(p: BarPattern, layer: number): { step: number; midi: number; len: number; vel: number }[] {
  const out: { step: number; midi: number; len: number; vel: number }[] = [];
  for (let i = 0; i < p.count; i++) {
    if (p.layer[i] === layer) out.push({ step: p.step[i]!, midi: p.midi[i]!, len: p.len[i]!, vel: p.vel[i]! });
  }
  return out;
}

function allNotes(p: BarPattern): { layer: number; step: number; midi: number }[] {
  const out: { layer: number; step: number; midi: number }[] = [];
  for (let i = 0; i < p.count; i++) {
    if (p.layer[i] === Layer.PAD && p.vel[i] === 0.5) continue;
    out.push({ layer: p.layer[i]!, step: p.step[i]!, midi: p.midi[i]! });
  }
  return out;
}

function signature(p: BarPattern): string {
  const parts: string[] = [`chord${p.chord}`, `kick${p.kickMask}`];
  for (let i = 0; i < p.count; i++) parts.push(`${p.layer[i]}:${p.step[i]}:${p.midi[i]}:${p.len[i]}:${p.vel[i]}`);
  return parts.join(',');
}

const SYNCS = [1, 4, 8, 12, 16] as const;

describe('A1 harmony', () => {
  it('melodies: chord tones on steps 0 and 8, chord or scale tones elsewhere, span 64, no overlap', () => {
    expect(checkMelodies(MELODIES, PROGRESSIONS, CHORDS, SCALE)).toEqual([]);
  });
  it('no pad voice moves more than 5 semitones within a progression', () => {
    expect(checkVoiceLeading(PROGRESSIONS, CHORDS)).toEqual([]);
  });
  it('the bass root is in the pad', () => {
    expect(checkBassInPad(CHORDS)).toEqual([]);
  });
  it('tables have the shapes M1 states', () => {
    expect(CHORDS).toHaveLength(8);
    expect(PROGRESSIONS).toHaveLength(6);
    expect(MELODIES).toHaveLength(6);
    expect(SONGS).toHaveLength(6);
    for (const b of BASS_PATTERNS) expect(b).toHaveLength(16);
    for (const a of ARP_PATTERNS) expect(a).toHaveLength(16);
  });
  it('key math folds to one register, and pad and bass tonics share a pitch class', () => {
    expect(padTonic(0)).toBe(57);
    expect(bassTonic(0)).toBe(33);
    for (let k = -24; k < 48; k++) {
      expect(padTonic(k)).toBeGreaterThanOrEqual(52);
      expect(padTonic(k)).toBeLessThanOrEqual(63);
      expect(bassTonic(k)).toBeGreaterThanOrEqual(31);
      expect(bassTonic(k)).toBeLessThanOrEqual(42);
      expect(pc(padTonic(k))).toBe(pc(bassTonic(k)));
    }
  });
});

describe('A1n the checkers can fail', () => {
  it('a melody with a C# on a downbeat', () => {
    const bad = MELODIES.map((m) => m.slice()) as MelodyNote[][];
    bad[0]![0] = [0, 4, 6];   // semitone 4 over A minor is C#
    const got = checkMelodies(bad, PROGRESSIONS, CHORDS, SCALE);
    expect(got.some((p) => p.startsWith('melody-downbeat'))).toBe(true);
  });
  it('a pad voice leaping 12', () => {
    const bad: ChordDef[] = CHORDS.slice();
    bad[1] = { bass: -4, pad: [8, 3, 7, 12] };
    expect(checkVoiceLeading(PROGRESSIONS, bad).some((p) => p.startsWith('pad-leap'))).toBe(true);
  });
  it('an arp note at 108', () => {
    expect(checkRange('arp', [72, 108])).toEqual(['range-arp: 108']);
  });
  it('an overlapping melody and a short span', () => {
    const bad = MELODIES.map((m) => m.slice()) as MelodyNote[][];
    bad[0]!.pop();
    expect(checkMelodies(bad, PROGRESSIONS, CHORDS, SCALE).some((p) => p.startsWith('melody-span'))).toBe(true);
    const over = MELODIES.map((m) => m.slice()) as MelodyNote[][];
    over[0]![0] = [0, 7, 7];
    expect(checkMelodies(over, PROGRESSIONS, CHORDS, SCALE).some((p) => p.startsWith('melody-overlap'))).toBe(true);
  });
  it('a bass root outside the pad', () => {
    const bad: ChordDef[] = CHORDS.slice();
    bad[0] = { bass: 1, pad: [0, 3, 7, 14] };
    expect(checkBassInPad(bad)).toEqual(['bass-root: chord 0']);
  });
});

describe('A1 ranges and note counts', () => {
  it('over 12 keys x 6 sectors x 5 tiers x 32 bars: in range, at most 96 notes, fill bars included', () => {
    const p = createBarPattern();
    const seen: Record<string, [number, number]> = {};
    let most = 0;
    const midis: Record<string, number[]> = { bass: [], pad: [], arp: [], lead: [] };
    for (let key = 0; key < 12; key++) {
      for (let sector = 0; sector < 6; sector++) {
        for (const sync of SYNCS) {
          for (let bar = 0; bar < 32; bar++) {
            for (const fill of [false, true]) {
              patternFor(bar, sectorOf(sector, key, fill), sync, p);
              if (p.count > most) most = p.count;
              for (const [name, layer] of [['bass', Layer.BASS], ['pad', Layer.PAD], ['arp', Layer.ARP], ['lead', Layer.LEAD]] as const) {
                for (const n of notes(p, layer)) {
                  midis[name]!.push(n.midi);
                  const r = seen[name] ??= [999, -999];
                  if (n.midi < r[0]) r[0] = n.midi;
                  if (n.midi > r[1]) r[1] = n.midi;
                }
              }
            }
          }
        }
      }
    }
    for (const name of Object.keys(RANGE)) expect(checkRange(name, midis[name]!)).toEqual([]);
    expect(most).toBeLessThanOrEqual(MAX_BAR_NOTES);
    console.log(`A1 ranges ${JSON.stringify(seen)}, most notes in a bar ${most}`);
  });
});

describe('A1 counts per M1 table', () => {
  // bar, sync, kick, snare, hat, open hat
  const TABLE: readonly (readonly [string, number, number, number, number, number, number])[] = [
    ['A T0', 0, 1, 3, 2, 8, 0],
    ['A T1', 0, 4, 4, 2, 8, 0],
    ['A T2', 0, 8, 4, 2, 16, 0],
    ['A T3', 0, 12, 4, 2, 12, 4],
    ['A T4', 0, 16, 4, 2, 12, 4],
    ['B T0', 16, 1, 3, 2, 8, 0],
    ['B T1', 16, 4, 4, 2, 4, 4],
    ['B T2', 16, 8, 4, 2, 12, 4],
    ['B T3', 16, 12, 4, 2, 12, 4],
    ['B T4', 16, 16, 4, 2, 12, 4],
    ['C24 T0', 24, 1, 1, 1, 4, 0],
    ['C24 T1', 24, 4, 1, 1, 4, 0],
    ['C24 T2', 24, 8, 1, 1, 4, 0],
    ['C24 T3', 24, 12, 1, 1, 0, 4],
    ['C24 T4', 24, 16, 1, 1, 0, 4],
  ];
  for (const [name, bar, sync, kick, snare, hat, ohat] of TABLE) {
    it(name, () => {
      for (let sector = 0; sector < 6; sector++) {
        const c = counts(patternFor(bar, sectorOf(sector), sync, createBarPattern()));
        expect([c[Layer.KICK], c[Layer.SNARE], c[Layer.HAT], c[Layer.OHAT]]).toEqual([kick, snare, hat, ohat]);
      }
    });
  }

  it('kick steps and kickMask', () => {
    const p = createBarPattern();
    patternFor(0, sectorOf(), 1, p);
    expect(notes(p, Layer.KICK).map((n) => n.step)).toEqual([0, 6, 8]);
    expect(p.kickMask).toBe((1 << 0) | (1 << 6) | (1 << 8));
    patternFor(0, sectorOf(), 8, p);
    expect(notes(p, Layer.KICK).map((n) => n.step)).toEqual([0, 4, 8, 12]);
    expect(notes(p, Layer.KICK).map((n) => +n.vel.toFixed(2))).toEqual([1, 0.92, 0.92, 0.92]);
    patternFor(26, sectorOf(), 8, p);
    expect(notes(p, Layer.KICK).map((n) => n.step)).toEqual([0, 8]);
    patternFor(27, sectorOf(), 1, p);
    expect(notes(p, Layer.KICK).map((n) => n.step)).toEqual([0, 4, 8, 12]);
    expect(notes(p, Layer.SNARE).map((n) => n.step)).toEqual([4, 12]);
    patternFor(25, sectorOf(), 8, p);
    expect(notes(p, Layer.SNARE).map((n) => n.step)).toEqual([12]);
  });

  it('bass hits equal the picked pattern', () => {
    const p = createBarPattern();
    for (let sector = 0; sector < 12; sector++) {
      for (const sync of SYNCS) {
        patternFor(0, sectorOf(sector), sync, p);
        const pat = BASS_PATTERNS[bassPatternFor(sector, tierOf(sync))]!;
        const want = [...pat].filter((c) => c !== '.').length;
        expect(notes(p, Layer.BASS)).toHaveLength(want);
      }
    }
  });

  it('bass in the early break plays only below step 8, on B0', () => {
    const p = createBarPattern();
    patternFor(24, sectorOf(), 16, p);
    expect(notes(p, Layer.BASS).map((n) => n.step)).toEqual([0, 2, 4, 6]);
    patternFor(26, sectorOf(), 16, p);
    expect(notes(p, Layer.BASS).map((n) => n.step)).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
  });

  it('the fill adds a riser and toms, and the crash lands on 0, 16 and entered', () => {
    const p = createBarPattern();
    patternFor(31, sectorOf(), 8, p);
    expect(counts(p)[Layer.RISER]).toBe(1);
    expect(notes(p, Layer.TOM).map((n) => n.step)).toEqual([8, 9, 10, 11, 12, 13, 14, 15]);
    patternFor(31, sectorOf(), 1, p);
    expect(notes(p, Layer.TOM).map((n) => n.step)).toEqual([8, 10, 12, 14]);
    patternFor(3, sectorOf(0, 0, true), 8, p);
    expect(counts(p)[Layer.RISER]).toBe(1);
    patternFor(3, sectorOf(), 8, p);
    expect(counts(p)[Layer.RISER]).toBe(0);
    for (const [bar, want] of [[0, 1], [16, 1], [4, 0], [17, 0]] as const) {
      patternFor(bar, sectorOf(), 8, p);
      expect(counts(p)[Layer.CRASH]).toBe(want);
    }
    patternFor(4, sectorOf(0, 0, false, true), 8, p);
    expect(counts(p)[Layer.CRASH]).toBe(1);
  });
});

describe('A1 SYNC gates', () => {
  it('no arp at SYNC 3 and arp at 4', () => {
    const p = createBarPattern();
    patternFor(0, sectorOf(), 3, p);
    expect(notes(p, Layer.ARP)).toHaveLength(0);
    patternFor(0, sectorOf(), 4, p);
    expect(notes(p, Layer.ARP).length).toBeGreaterThan(0);
  });
  it('no lead at 7 and lead at 8 in a section that allows it', () => {
    const p = createBarPattern();
    patternFor(0, sectorOf(), 7, p);
    expect(notes(p, Layer.LEAD)).toHaveLength(0);
    patternFor(0, sectorOf(), 8, p);
    expect(notes(p, Layer.LEAD).length).toBeGreaterThan(0);
    patternFor(4, sectorOf(), 8, p);      // section A with floor(bar / 4) odd
    expect(notes(p, Layer.LEAD)).toHaveLength(0);
    patternFor(28, sectorOf(), 8, p);     // section D below 30
    expect(notes(p, Layer.LEAD)).toHaveLength(0);
    patternFor(30, sectorOf(), 8, p);
    expect(notes(p, Layer.LEAD).length).toBeGreaterThan(0);
    patternFor(20, sectorOf(), 8, p);     // section B, always
    expect(notes(p, Layer.LEAD).length).toBeGreaterThan(0);
  });
  it('T4 adds a harmony note a chord tone 3 to 9 below, at velocity .55', () => {
    const p = createBarPattern();
    for (let bar = 0; bar < 4; bar++) {
      patternFor(bar, sectorOf(), 16, p);
      const lead = notes(p, Layer.LEAD);
      const tones = CHORDS[p.chord]!.pad.map((v) => pc(padTonic(0) + v));
      for (const main of lead.filter((n) => n.vel === 1)) {
        const under = lead.filter((n) => n.step === main.step && Math.abs(n.vel - 0.55) < 1e-6);
        expect(under).toHaveLength(1);
        const gap = main.midi - under[0]!.midi;
        expect(gap).toBeGreaterThanOrEqual(3);
        expect(gap).toBeLessThanOrEqual(9);
        expect(tones).toContain(pc(under[0]!.midi));
      }
    }
  });
  it('T3 adds a fifth pad voice at velocity .5', () => {
    const p = createBarPattern();
    patternFor(0, sectorOf(), 8, p);
    expect(notes(p, Layer.PAD)).toHaveLength(4);
    patternFor(0, sectorOf(), 12, p);
    const pad = notes(p, Layer.PAD);
    expect(pad).toHaveLength(5);
    expect(pad[4]!.midi).toBe(pad[3]!.midi + 12);
    expect(pad[4]!.vel).toBe(0.5);
  });
});

describe('A1 purity', () => {
  it('same arguments give identical arrays, in any call order', () => {
    const a = createBarPattern();
    const b = createBarPattern();
    patternFor(5, sectorOf(3, 7), 16, a);
    const before = signature(a);
    patternFor(31, sectorOf(1, 2, true), 1, b);
    patternFor(5, sectorOf(3, 7), 16, a);
    expect(signature(a)).toBe(before);
    patternFor(5, sectorOf(3, 7), 16, b);
    expect(signature(b)).toBe(before);
  });
  it('old contents of out never leak through', () => {
    const a = createBarPattern();
    patternFor(31, sectorOf(0, 0, true), 16, a);
    patternFor(24, sectorOf(), 1, a);
    const fresh = patternFor(24, sectorOf(), 1, createBarPattern());
    expect(signature(a)).toBe(signature(fresh));
  });
  it('bar near 2^53 and sector 2.8e12 work and stay in range', () => {
    const p = createBarPattern();
    const big = 2 ** 53 - 32;   // a multiple of 32, so it is exactly form position 0
    for (let d = 0; d < 32; d++) {
      patternFor(big + d, sectorOf(2.8e12, 11), 16, p);
      expect(p.count).toBeGreaterThan(0);
      expect(checkRange('bass', notes(p, Layer.BASS).map((n) => n.midi))).toEqual([]);
      expect(checkRange('pad', notes(p, Layer.PAD).map((n) => n.midi))).toEqual([]);
      expect(checkRange('arp', notes(p, Layer.ARP).map((n) => n.midi))).toEqual([]);
      expect(checkRange('lead', notes(p, Layer.LEAD).map((n) => n.midi))).toEqual([]);
      const small = patternFor(d, sectorOf(2.8e12, 11), 16, createBarPattern());
      expect(p.chord).toBe(small.chord);
    }
  });
  it('form sections choose harmony', () => {
    expect(chordAt(0, 0)).toBe(PROGRESSIONS[0]![0]);
    expect(chordAt(16, 0)).toBe(PROGRESSIONS[2]![0]);
    expect(chordAt(24, 0)).toBe(0);
    expect(chordAt(25, 0)).toBe(0);
    expect(chordAt(26, 0)).toBe(1);
    expect(chordAt(27, 0)).toBe(1);
    expect(chordAt(28, 0)).toBe(PROGRESSIONS[0]![0]);
    expect(chordAt(32 + 17, 7)).toBe(PROGRESSIONS[SONGS[1]![1]]![1]);
  });
});

describe('A1 variety', () => {
  it('at least 12 distinct bars in 32 at SYNC 8', () => {
    const p = createBarPattern();
    const seen = new Set<string>();
    for (let bar = 0; bar < 32; bar++) seen.add(signature(patternFor(bar, sectorOf(), 8, p)));
    console.log(`A1 distinct bars ${seen.size}`);
    expect(seen.size).toBeGreaterThanOrEqual(12);
  });
  it('6 of 6 distinct 4-bar slices across songs', () => {
    const p = createBarPattern();
    const seen = new Set<string>();
    for (let s = 0; s < 6; s++) {
      let sig = '';
      for (let bar = 0; bar < 4; bar++) sig += signature(patternFor(bar, sectorOf(s), 8, p));
      seen.add(sig);
    }
    expect(seen.size).toBe(6);
  });
  it('each bass and arp pick is taken by at least 10% of sectors 0 to 999', () => {
    const b1 = [0, 0, 0, 0];
    const b2 = [0, 0, 0, 0];
    const a = [0, 0, 0, 0, 0, 0];
    for (let s = 0; s < 1000; s++) {
      b1[bassPatternFor(s, 1)]! += 1;
      b2[bassPatternFor(s, 2)]! += 1;
      a[arpPatternFor(s)]! += 1;
    }
    console.log(`A1 picks T1 ${b1} T2 ${b2} arp ${a}`);
    expect(b1[1]).toBeGreaterThanOrEqual(100);
    expect(b1[3]).toBeGreaterThanOrEqual(100);
    expect(b2[2]).toBeGreaterThanOrEqual(100);
    expect(b2[1]).toBeGreaterThanOrEqual(100);
    for (const n of a) expect(n).toBeGreaterThanOrEqual(100);
  });
});

describe('A1 key', () => {
  it('ladderMidi and all notes shift by exactly the expected semitones modulo 12, for every key', () => {
    const a = createBarPattern();
    const b = createBarPattern();
    for (let key = 0; key < 12; key++) {
      for (let chord = 0; chord < 8; chord++) {
        for (let rung = 0; rung < 6; rung++) {
          expect(pc(ladderMidi(chord, key, rung) - ladderMidi(chord, 0, rung))).toBe(key);
        }
      }
      for (let bar = 0; bar < 32; bar += 3) {
        for (const sync of SYNCS) {
          patternFor(bar, sectorOf(0, 0), sync, a);
          patternFor(bar, sectorOf(0, key), sync, b);
          // T3's fifth pad voice is dropped above MIDI 84, so it alone may be absent in another key.
          const na = allNotes(a);
          const nb = allNotes(b);
          expect(nb.length).toBe(na.length);
          na.forEach((n, i) => {
            expect(nb[i]!.layer).toBe(n.layer);
            expect(nb[i]!.step).toBe(n.step);
            if (n.midi > 0) expect(pc(nb[i]!.midi - n.midi)).toBe(key);
          });
        }
      }
    }
  });
});
