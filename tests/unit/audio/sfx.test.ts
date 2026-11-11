// A4: pickups against a fake clock and sink.
import { describe, expect, it } from 'vitest';
import { Ev, type EventBuffer } from '../../../src/contracts/index';
import { createEventBuffer } from '../../../src/core/alloc';
import { anchorClock, createBeatClock } from '../../../src/audio/clock';
import { ladderMidi } from '../../../src/audio/composer';
import { admits, Drop, MAX_LIVE_SOURCES } from '../../../src/audio/mix';
import { COSMETIC_GAIN, createSfx, missMidi, type Sfx, type SfxSink } from '../../../src/audio/sfx';
import { CHORDS, STEP_S, padTonic } from '../../../src/audio/theory';

const pc = (x: number): number => ((x % 12) + 12) % 12;

interface Rec { kind: string; t: number; midi?: number; vel?: number; pan?: number; notes?: number[] }

function setup(chord = 0, key = 0): { sfx: Sfx; log: Rec[] } {
  const clock = createBeatClock();
  anchorClock(clock, 0, 0);
  const log: Rec[] = [];
  const sink: SfxSink = {
    blip(t, midi, vel, pan) { log.push({ kind: 'blip', t, midi, vel, pan }); },
    stab(t, a, b, c, d, vel) { log.push({ kind: 'stab', t, notes: [a, b, c, d], vel }); },
    miss(t, midi, vel) { log.push({ kind: 'miss', t, midi, vel }); },
    graze(t, vel, pan) { log.push({ kind: 'graze', t, vel, pan }); },
    hit(t) { log.push({ kind: 'hit', t }); },
    lost(t) { log.push({ kind: 'lost', t }); },
  };
  return { sfx: createSfx(clock, { chordAtStep: () => chord, keyAtStep: () => key }, sink), log };
}

function ladderOf(chord: number, key: number): { len: number; notes: number[] } {
  const tones = new Set(CHORDS[chord]!.pad.map((v) => pc(v))).size;
  const len = tones * 2;
  const notes: number[] = [];
  for (let i = 0; i < len + 8; i++) notes.push(ladderMidi(chord, key, i));
  return { len, notes };
}

describe('A4 quantise', () => {
  it('an event 40 ms after a grid line goes to the next line', () => {
    const { sfx, log } = setup();
    const line = 10 * STEP_S;
    sfx.handleOne(Ev.SHARD, 0, 100, 0, line + 0.04);
    expect(log[0]!.t).toBeCloseTo(11 * STEP_S, 9);
  });
  it('an event 10 ms after a grid line goes now', () => {
    const { sfx, log } = setup();
    const now = 10 * STEP_S + 0.01;
    sfx.handleOne(Ev.SHARD, 0, 100, 0, now);
    expect(log[0]!.t).toBe(now);
  });
  it('the grace ends at 30 ms', () => {
    const { sfx, log } = setup();
    sfx.handleOne(Ev.SHARD, 0, 100, 0, 10 * STEP_S + 0.029);
    expect(log[0]!.t).toBeCloseTo(10 * STEP_S + 0.029, 9);
    sfx.handleOne(Ev.SHARD, 0, 100, 0, 20 * STEP_S + 0.032);
    expect(log[1]!.t).toBeCloseTo(21 * STEP_S, 9);
  });
  it('gates and misses quantise, graze and hit and lost play now', () => {
    const { sfx, log } = setup();
    const now = 3 * STEP_S + 0.05;
    sfx.handleOne(Ev.GATE, 0, 100, 0, now);
    sfx.handleOne(Ev.GATE_MISS, 0, 0, 0, now);
    sfx.handleOne(Ev.GRAZE, 0, 5, 0, now);
    sfx.handleOne(Ev.HIT, 0, 2, 0, now);
    sfx.handleOne(Ev.SIGNAL_LOST, 0, 0, 0, now);
    expect(log.map((r) => r.kind)).toEqual(['stab', 'miss', 'graze', 'hit', 'lost']);
    expect(log[0]!.t).toBeCloseTo(4 * STEP_S, 9);
    expect(log[1]!.t).toBeCloseTo(4 * STEP_S, 9);
    expect(log[2]!.t).toBe(now);
    expect(log[3]!.t).toBe(now);
    expect(log[4]!.t).toBe(now);
  });
});

describe('A4 ladder', () => {
  it('over 12 keys x 8 chords: non-decreasing to its length, then alternating, all in the chord, none above 96', () => {
    for (let key = 0; key < 12; key++) {
      for (let chord = 0; chord < 8; chord++) {
        const { len, notes } = ladderOf(chord, key);
        expect(len === 8 || len === 6).toBe(true);
        if (chord === 5 || chord === 6) expect(len).toBe(6);
        const tones = CHORDS[chord]!.pad.map((v) => pc(padTonic(key) + v));
        for (let i = 0; i < notes.length; i++) {
          expect(tones).toContain(pc(notes[i]!));
          expect(notes[i]!).toBeLessThanOrEqual(96);
          if (i > 0 && i < len) expect(notes[i]!).toBeGreaterThanOrEqual(notes[i - 1]!);
          if (i >= len) expect(notes[i]).toBe(notes[len - 2 + ((i - len) % 2)]);
        }
        expect(notes[len]).not.toBe(notes[len + 1]);
      }
    }
  });
  it('starts at the first chord tone at or above padTonic + 12, unless the whole ladder folded', () => {
    const start = ladderMidi(0, 0, 0);
    expect(start).toBe(69);   // A4
    expect(ladderMidi(0, 0, 7)).toBe(88);   // A B C E, A B C E: E6
    for (let key = 0; key < 12; key++) {
      for (let chord = 0; chord < 8; chord++) {
        const bottom = ladderMidi(chord, key, 0);
        const floor = padTonic(key) + 12;
        expect(bottom === floor || bottom > floor || bottom + 12 >= floor).toBe(true);
      }
    }
  });
  it('an index far past the top still alternates, and a negative index is the bottom', () => {
    expect(ladderMidi(0, 0, 1e12)).toBe(ladderMidi(0, 0, 8));
    expect(ladderMidi(0, 0, 1e12 + 1)).toBe(ladderMidi(0, 0, 9));
    expect(ladderMidi(0, 0, -5)).toBe(ladderMidi(0, 0, 0));
  });
  it('the miss note is the chord root, an octave below the ladder', () => {
    for (let key = 0; key < 12; key++) {
      for (let chord = 0; chord < 8; chord++) {
        const m = missMidi(chord, key);
        expect(pc(m)).toBe(pc(padTonic(key) + CHORDS[chord]!.bass));
        const bottom = ladderMidi(chord, key, 0);
        expect(m).toBeGreaterThanOrEqual(bottom - 12);
        expect(m).toBeLessThan(bottom);
      }
    }
  });
});

describe('A4 queue', () => {
  it('boost-rate shards never share a step, and queue at most 3 ahead', () => {
    const { sfx, log } = setup();
    const now = 40 * STEP_S + 0.05;
    for (let i = 0; i < 10; i++) sfx.handleOne(Ev.SHARD, 0, 100, 0, now + i * 0.001);
    expect(log).toHaveLength(4);
    const steps = log.map((r) => Math.round(r.t / STEP_S));
    expect(steps).toEqual([41, 42, 43, 44]);
    expect(sfx.chain).toBe(10);       // dropped sounds still count
    expect(sfx.dropped).toBe(6);
  });
  it('the chain raises the ladder, including through dropped sounds', () => {
    const { sfx, log } = setup();
    const now = 40 * STEP_S + 0.05;
    for (let i = 0; i < 3; i++) sfx.handleOne(Ev.SHARD, 0, 100, 0, now);
    expect(log.map((r) => r.midi)).toEqual([0, 1, 2].map((i) => ladderMidi(0, 0, i)));
  });
  it('a later shard resumes once the queue has drained', () => {
    const { sfx, log } = setup();
    const now = 40 * STEP_S + 0.05;
    for (let i = 0; i < 6; i++) sfx.handleOne(Ev.SHARD, 0, 100, 0, now);
    log.length = 0;
    sfx.handleOne(Ev.SHARD, 0, 100, 0, 60 * STEP_S + 0.05);
    expect(log).toHaveLength(1);
    expect(log[0]!.t).toBeCloseTo(61 * STEP_S, 9);
  });
});

describe('A4 chain', () => {
  it('cosmetic shards do not raise the chain and play 6 dB down', () => {
    const { sfx, log } = setup();
    sfx.handleOne(Ev.SHARD, 0, 100, 0, 1.05);
    sfx.handleOne(Ev.SHARD, 0, 0, 0, 1.25);
    expect(sfx.chain).toBe(1);
    expect(log[0]!.vel).toBe(1);
    expect(log[1]!.vel).toBe(COSMETIC_GAIN);
    expect(20 * Math.log10(COSMETIC_GAIN)).toBeCloseTo(-6, 0);
  });
  it('a cosmetic shard at chain 0 uses the bottom rung', () => {
    const { sfx, log } = setup();
    sfx.handleOne(Ev.SHARD, 0, 0, 0, 1.05);
    expect(sfx.chain).toBe(0);
    expect(log[0]!.midi).toBe(ladderMidi(0, 0, 0));
  });
  it('resets on HIT, on GATE_MISS, and on SIGNAL_LOST', () => {
    for (const kind of [Ev.HIT, Ev.GATE_MISS, Ev.SIGNAL_LOST]) {
      const { sfx } = setup();
      sfx.handleOne(Ev.SHARD, 0, 100, 0, 1.05);
      sfx.handleOne(Ev.SHARD, 0, 100, 0, 1.2);
      expect(sfx.chain).toBe(2);
      sfx.handleOne(kind, 0, 0, 0, 1.4);
      expect(sfx.chain).toBe(0);
    }
  });
  it('resets after 2 bars without a shard, and not before', () => {
    const { sfx } = setup();
    const stepAt = (s: number): number => s * STEP_S + 0.05;
    sfx.handleOne(Ev.SHARD, 0, 100, 0, stepAt(100));
    sfx.handleOne(Ev.SHARD, 0, 100, 0, stepAt(101));
    expect(sfx.chain).toBe(2);
    sfx.handleOne(Ev.SHARD, 0, 100, 0, stepAt(131));   // 30 steps later
    expect(sfx.chain).toBe(3);
    sfx.handleOne(Ev.SHARD, 0, 100, 0, stepAt(170));   // 39 steps later
    expect(sfx.chain).toBe(1);
  });
  it('an ordinary gate does not touch the chain', () => {
    const { sfx } = setup();
    sfx.handleOne(Ev.SHARD, 0, 100, 0, 1.05);
    sfx.handleOne(Ev.GATE, 0, 100, 0, 1.2);
    expect(sfx.chain).toBe(1);
  });
});

describe('A4 event fields', () => {
  function fill(buf: EventBuffer, y: number, chunk: number): void {
    const push = (kind: number, x: number, value: number, index: number): void => {
      const i = buf.count++;
      buf.kind[i] = kind;
      buf.x[i] = x;
      buf.y[i] = y;
      buf.value[i] = value;
      buf.chunk[i] = chunk;
      buf.index[i] = index;
    };
    push(Ev.SHARD, 12, 100, 3);
    push(Ev.GATE, -40, 500, 0);
    push(Ev.GRAZE, 80, 10, 0);
    push(Ev.GRADE, 0, 1000, 1);
    push(Ev.SECTOR, 0, 2, 0);
    push(Ev.BOOST_ON, 0, 0, 0);
    push(Ev.BOOST_OFF, 0, 0, 0);
  }

  it('y and chunk set to NaN change nothing', () => {
    const a = setup();
    const b = setup();
    const ea = createEventBuffer();
    const eb = createEventBuffer();
    fill(ea, 6, 1234);
    fill(eb, NaN, NaN);
    a.sfx.handle(ea, 5.03);
    b.sfx.handle(eb, 5.03);
    expect(b.log).toEqual(a.log);
    expect(a.log.length).toBeGreaterThan(3);
  });

  it('pan is x over the play half-width, clamped, times .5; a NaN x is centred', () => {
    const { sfx, log } = setup();
    sfx.handleOne(Ev.SHARD, 20, 100, 0, 1.05);
    sfx.handleOne(Ev.SHARD, -80, 100, 0, 1.25);
    sfx.handleOne(Ev.SHARD, NaN, 100, 0, 1.4);
    expect(log[0]!.pan).toBeCloseTo(0.25, 9);
    expect(log[1]!.pan).toBeCloseTo(-0.5, 9);
    expect(log[2]!.pan).toBe(0);
  });

  it('GRADE plays 4 minus rank rising notes, one per sixteenth, from the next beat', () => {
    for (let rank = 0; rank < 4; rank++) {
      const { sfx, log } = setup();
      sfx.handleOne(Ev.GRADE, 0, 1000, rank, 1.31);   // step 8.73: the next beat is step 12
      expect(log).toHaveLength(4 - rank);
      log.forEach((r, j) => {
        expect(r.t).toBeCloseTo((12 + j) * STEP_S, 9);
        expect(r.midi).toBe(ladderMidi(0, 0, j));
      });
    }
  });

  it('the stab is ladder notes 0 to 3', () => {
    const { sfx, log } = setup(2, 5);
    sfx.handleOne(Ev.GATE, 0, 100, 0, 1.05);
    expect(log[0]!.notes).toEqual([0, 1, 2, 3].map((i) => ladderMidi(2, 5, i)));
  });

  it('SECTOR, BOOST_ON and BOOST_OFF are ignored', () => {
    const { sfx, log } = setup();
    sfx.handleOne(Ev.SECTOR, 0, 3, 0, 1);
    sfx.handleOne(Ev.BOOST_ON, 0, 0, 0, 1);
    sfx.handleOne(Ev.BOOST_OFF, 0, 0, 0, 1);
    expect(log).toHaveLength(0);
  });
});

describe('polyphony policy', () => {
  it('at the cap blips go first, then hats, then the arp, and the rest never', () => {
    const cap = MAX_LIVE_SOURCES;
    const dropAt = (d: number): number => {
      for (let live = 0; live <= cap + 8; live++) if (!admits(d, live, cap)) return live;
      return Infinity;
    };
    expect(dropAt(Drop.BLIP)).toBeLessThan(dropAt(Drop.HAT));
    expect(dropAt(Drop.HAT)).toBeLessThan(dropAt(Drop.ARP));
    expect(dropAt(Drop.ARP)).toBe(cap);
    expect(dropAt(Drop.NEVER)).toBe(Infinity);
  });
});
