// A3: the whole step walk against a fake sink and clock, including an hour.
import { describe, expect, it } from 'vitest';
import { anchorClock, createBeatClock, stepAtOrAfter, timeOfStep, type BeatClock } from '../../../src/audio/clock';
import {
  Layer, SOURCES_PER_NOTE, createBarPattern, chordAt, padSources, patternFor, resumeSources, stepSources, worstResume,
  type BarPattern, type SectorMusic,
} from '../../../src/audio/composer';
import { createSequencer, type Sequencer, type VoiceSink } from '../../../src/audio/sequencer';
import { BAR_S, CHORDS, STEP_S, padTonic } from '../../../src/audio/theory';

function prng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Call { kind: string; t: number; now: number; layer?: number; midi?: number; bar?: number; pad0?: number; durS?: number }

function recorder(state: { now: number }): { sink: VoiceSink; calls: Call[] } {
  const calls: Call[] = [];
  const sink: VoiceSink = {
    oneShot(layer, t) { calls.push({ kind: 'oneShot', layer, t, now: state.now }); },
    bass(t, midi) { calls.push({ kind: 'bass', t, midi, now: state.now }); },
    padChord(t, p: Readonly<BarPattern>, durS) {
      let pad0 = -1;
      for (let i = 0; i < p.count; i++) if (p.layer[i] === Layer.PAD) { pad0 = p.midi[i]!; break; }
      calls.push({ kind: 'pad', t, now: state.now, bar: p.bar, pad0, durS });
    },
    arp(t, midi) { calls.push({ kind: 'arp', t, midi, now: state.now }); },
    lead(t, midi) { calls.push({ kind: 'lead', t, midi, now: state.now }); },
  };
  return { sink, calls };
}

function setup(o: { windowS?: number; beat?: number; sync?: number } = {}): {
  clock: BeatClock; seq: Sequencer; calls: Call[]; state: { now: number };
} {
  const clock = createBeatClock();
  anchorClock(clock, o.beat ?? 0, 0);
  const state = { now: 0 };
  const { sink, calls } = recorder(state);
  const seq = createSequencer(clock, sink, o.windowS !== undefined ? { windowS: o.windowS } : {});
  seq.sync = o.sync ?? 16;
  seq.restart(0);
  return { clock, seq, calls, state };
}

function run(seq: Sequencer, state: { now: number }, from: number, to: number, dt = 0.025): void {
  for (let t = from; t <= to; t += dt) {
    state.now = t;
    seq.tick(t);
  }
}

describe('A3 one simulated hour', () => {
  it('tick 25 ms with jitter up to 40 ms: 24000 steps each once, in order, lead in range, skipped 0', () => {
    const { seq, calls, state, clock } = setup({ sync: 16 });
    const rand = prng(7);
    let t = 0;
    let worstLead = 0;
    let minLead = Infinity;
    let prevT = -Infinity;
    let prevLayerStep = new Map<number, number>();
    let repeats = 0;
    let disorder = 0;
    while (t < 3600) {
      state.now = t;
      calls.length = 0;
      seq.tick(t);
      for (const c of calls) {
        const lead = c.t - c.now;
        if (lead > worstLead) worstLead = lead;
        if (lead < minLead) minLead = lead;
        if (c.t < prevT - 1e-9) disorder += 1;
        prevT = c.t;
        if (c.layer === undefined) continue;
        const step = stepAtOrAfter(clock, c.t - 1e-6);
        if (prevLayerStep.get(c.layer) === step) repeats += 1;
        prevLayerStep.set(c.layer, step);
      }
      if (prevLayerStep.size > 64) prevLayerStep = new Map();
      t += 0.025 + rand() * 0.04;
    }
    const s = seq.stats;
    console.log(`A3 hour: scheduled ${s.scheduled}, late ${s.late}, skipped ${s.skipped}, lead ${minLead.toFixed(4)} to ${worstLead.toFixed(4)} s`);
    expect(Math.abs(s.scheduled - 24000)).toBeLessThanOrEqual(1);
    expect(s.skipped).toBe(0);
    expect(s.late).toBe(0);
    expect(minLead).toBeGreaterThanOrEqual(0);
    expect(worstLead).toBeLessThanOrEqual(0.12 + 0.025);
    expect(repeats).toBe(0);
    expect(disorder).toBe(0);
  });

  it('negative control: window 10 ms with the same tick and jitter gives skipped above 0', () => {
    const { seq, state } = setup({ windowS: 0.01, sync: 16 });
    const rand = prng(7);
    let t = 0;
    while (t < 3600) {
      state.now = t;
      seq.tick(t);
      t += 0.025 + rand() * 0.04;
    }
    console.log(`A3 control, jitter: scheduled ${seq.stats.scheduled}, late ${seq.stats.late}, skipped ${seq.stats.skipped}`);
    expect(seq.stats.skipped).toBeGreaterThan(0);
  });

  it('with no jitter, window 10 ms stops at late: lateness stays under the 30 ms limit', () => {
    const { seq, state } = setup({ windowS: 0.01, sync: 16 });
    run(seq, state, 0, 60);
    expect(seq.stats.skipped).toBe(0);
    expect(seq.stats.late).toBeGreaterThan(0);
  });
});

describe('A3 suspend and restart', () => {
  it('10 s away with the sim running: nothing for a step in the gap, at most 3 steps and one recovered pad in the first 300 ms', () => {
    const { clock, seq, calls, state } = setup({ sync: 16 });
    run(seq, state, 0, 30);
    const scheduledBefore = seq.stats.scheduled;
    calls.length = 0;
    const back = 40;
    anchorClock(clock, back / 0.6, back);
    seq.restart(back);
    run(seq, state, back, back + 0.3);
    const steps = new Set(calls.filter((c) => c.kind !== 'pad').map((c) => Math.round(c.t * 1e4)));
    const pads = calls.filter((c) => c.kind === 'pad');
    console.log(`A3 resume: ${steps.size} steps, ${pads.length} pad chords, ${calls.length} calls in 300 ms`);
    expect(steps.size).toBeLessThanOrEqual(3);
    expect(pads.length).toBeLessThanOrEqual(1);
    expect(seq.stats.scheduled - scheduledBefore).toBeLessThanOrEqual(3);
    for (const c of calls) expect(c.t).toBeGreaterThanOrEqual(back);
  });

  it('the recovered chord runs only to the bar line, so a bar is never left with no harmony', () => {
    const { clock, seq, calls, state } = setup({ sync: 16 });
    run(seq, state, 0, 30);
    calls.length = 0;
    const back = 40.1;   // mid-bar
    anchorClock(clock, back / 0.6, back);
    seq.restart(back);
    run(seq, state, back, back + 0.2);
    const pad = calls.find((c) => c.kind === 'pad');
    expect(pad).toBeDefined();
    const bar = Math.floor(stepAtOrAfter(clock, pad!.t) / 16);
    const end = timeOfStep(clock, (bar + 1) * 16);
    expect(pad!.t + pad!.durS!).toBeCloseTo(end, 6);
    expect(pad!.durS!).toBeLessThan(BAR_S);
  });

  it('frozen sim (a hidden tab): resuming at the same beat repeats nothing', () => {
    const { clock, seq, calls, state } = setup({ sync: 16 });
    run(seq, state, 0, 10);
    const lastNonPad = Math.max(...calls.filter((c) => c.kind !== 'pad').map((c) => stepAtOrAfter(clock, c.t - 1e-6)));
    calls.length = 0;
    anchorClock(clock, 10 / 0.6, 20);
    seq.restart(20);
    run(seq, state, 20, 21);
    for (const c of calls.filter((x) => x.kind !== 'pad')) {
      expect(stepAtOrAfter(clock, c.t - 1e-6)).toBeGreaterThan(lastNonPad);
    }
  });
});

// ---- A21's bound, restated in structure by DI-59, against the real sequencer ----

/** Counts sources the way voices.ts starts them, by SOURCES_PER_NOTE. A21 checks that table on the real voices. */
function sourceCounter(): { sink: VoiceSink; n: { v: number } } {
  const n = { v: 0 };
  const sink: VoiceSink = {
    oneShot(layer) { n.v += SOURCES_PER_NOTE[layer]!; },
    bass() { n.v += SOURCES_PER_NOTE[Layer.BASS]!; },
    padChord(_t, p: Readonly<BarPattern>) {
      for (let i = 0; i < p.count; i++) if (p.layer[i] === Layer.PAD) n.v += SOURCES_PER_NOTE[Layer.PAD]!;
    },
    arp() { n.v += SOURCES_PER_NOTE[Layer.ARP]!; },
    lead() { n.v += SOURCES_PER_NOTE[Layer.LEAD]!; },
  };
  return { sink, n };
}

/**
 * A second of music, a suspend, then a resume whose first step is `step` of form bar `bar`, 20 ms after now, as the
 * engine does it: anchor, restart, one tick with the same now, then the 25 ms timer for 300 ms. Sources counted.
 */
function resumeCount(sector: number, key: number, bar: number, step: number, windowS?: number): number {
  const clock = createBeatClock();
  anchorClock(clock, 0, 0);
  const { sink, n } = sourceCounter();
  const seq = createSequencer(clock, sink, windowS !== undefined ? { windowS } : {});
  seq.sync = 16;
  seq.zoneIndex = sector;
  seq.zoneKey = key;
  seq.restart(0);
  for (let i = 0; i <= 40; i++) seq.tick(i * 0.025);
  const target = (64 + bar) * 16 + step;   // formOrigin is 0 here, so this is form bar `bar`
  const back = 100;
  anchorClock(clock, target / 4 - 0.02 / 0.6, back);
  seq.restart(back);
  n.v = 0;
  for (let i = 0; i <= 12; i++) seq.tick(back + i * 0.025);
  if (seq.formOrigin !== 0) throw new Error(`formOrigin ${seq.formOrigin}`);
  return n.v;
}

describe('A21 resume bound (DI-59)', () => {
  const a = createBarPattern();
  const b = createBarPattern();
  const sectorOf = (index: number, key: number): SectorMusic => ({ index, key, fillNext: false, entered: false });

  it('the pure count equals what the sequencer starts, at all 32 form bars x 6 sectors x 16 first steps', () => {
    let worst = { bar: -1, step: -1, sector: -1, sources: -1 };
    let mismatches = 0;
    for (let sector = 0; sector < 6; sector++) {
      for (let bar = 0; bar < 32; bar++) {
        for (let step = 0; step < 16; step++) {
          const bound = resumeSources(bar, step, sectorOf(sector, 0), 16, a, b);
          const got = resumeCount(sector, 0, bar, step);
          if (got !== bound) mismatches += 1;
          if (bound > worst.sources) worst = { bar, step, sector, sources: bound };
        }
      }
    }
    const w = worstResume(16, 0);
    console.log(`A21 bound: worst ${w.sources} sources at form bar ${w.bar}, step ${w.step}, sector ${w.sector}, key 0; mismatches ${mismatches} of 3072`);
    expect(mismatches).toBe(0);
    expect(w).toEqual({ ...worst, key: 0 });
  });

  it('key 0 reaches the worst count over all 12 keys, so the browser test resumes at key 0', () => {
    const byKey = Array.from({ length: 12 }, (_, k) => worstResume(16, k).sources);
    console.log(`A21 worst by key: ${byKey.join(',')}`);
    expect(byKey[0]).toBe(Math.max(...byKey));
  });

  it('negative control: a scheduler that looked one step further exceeds the bound wherever that step plays', () => {
    let exceeded = 0;
    let silentFourth = 0;
    for (let sector = 0; sector < 6; sector++) {
      for (let bar = 0; bar < 32; bar++) {
        for (let step = 0; step < 16; step++) {
          const bound = resumeSources(bar, step, sectorOf(sector, 0), 16, a, b);
          const got = resumeCount(sector, 0, bar, step, 0.27);
          // The fourth step and, if it is a downbeat, its chord.
          const fourth = step + 3;
          const p = patternFor(fourth >= 16 ? bar + 1 : bar, sectorOf(sector, 0), 16, a);
          const extra = stepSources(p, fourth % 16) + (fourth === 16 ? padSources(p) : 0);
          if (extra === 0) silentFourth += 1;
          else if (got > bound) exceeded += 1;
          expect(got).toBe(bound + extra);
        }
      }
    }
    const w = worstResume(16, 0);
    const atWorst = resumeCount(w.sector, 0, w.bar, w.step, 0.27);
    console.log(`A21 control, window 270 ms: exceeds the bound at ${exceeded} of ${3072 - silentFourth} positions whose fourth step plays (${silentFourth} have a silent fourth step); at the worst ${atWorst} against ${w.sources}`);
    expect(exceeded).toBe(3072 - silentFourth);
    expect(atWorst).toBeGreaterThan(w.sources);
  });
});

describe('A3 late policy', () => {
  it('up to 30 ms late starts now and counts late; later skips and counts skipped', () => {
    const { seq, calls, state } = setup({ sync: 16 });
    state.now = 0;
    seq.tick(0);   // schedules step 0 (t = 0), which is on time
    expect(seq.stats.scheduled).toBe(1);
    calls.length = 0;
    // Step 1 is at .15. Tick at .17: 20 ms late.
    state.now = 0.17;
    seq.tick(0.17);
    expect(seq.stats.late).toBe(1);
    for (const c of calls) {
      if (Math.abs(c.t - 0.17) < 1e-9) continue;
      expect(c.t).toBeGreaterThan(0.17);
    }
    calls.length = 0;
    // Next is step 2 at .30, then step 3 at .45, then step 4 at .60.
    const before = seq.stats.skipped;
    state.now = 0.5;
    seq.tick(0.5);   // step 2 is 200 ms late and step 3 is 50 ms late, so both skip. Step 4 plays on time.
    expect(seq.stats.skipped).toBe(before + 2);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.t >= 0.5)).toBe(true);
  });

  it('a pad chord missed mid-bar is started for the remainder', () => {
    const { seq, calls, state } = setup({ sync: 16 });
    run(seq, state, 0, 2.2);
    calls.length = 0;
    // Bar 1 begins at 2.4. Jump past its first steps with no re-anchor: its downbeat is skipped.
    state.now = 2.7;
    seq.tick(2.7);
    const pad = calls.find((c) => c.kind === 'pad');
    expect(pad).toBeDefined();
    expect(pad!.durS!).toBeCloseTo(4.8 - pad!.t, 6);
    expect(pad!.bar).toBe(1);
    expect(seq.stats.skipped).toBeGreaterThan(0);
  });

  it('far behind with no re-anchor, the walk jumps instead of stepping through every miss', () => {
    const { seq, calls, state } = setup({ sync: 16 });
    run(seq, state, 0, 1);
    calls.length = 0;
    state.now = 7200;
    seq.tick(7200);
    expect(calls.every((c) => c.t >= 7200)).toBe(true);
    expect(calls.filter((c) => c.kind === 'pad')).toHaveLength(1);
  });
});

describe('A3 sector changes', () => {
  // No bar in these 30 s after the first is form position 0 or 16, so any later crash is the sector's.
  const START_BAR = 4;
  const START_T = 0;

  for (let offset = 0; offset < 64; offset++) {
    it(`change at offset ${offset} steps: fill, then a switch on a phrase line, within 5 bars`, () => {
      const { seq, calls, state } = setup({ sync: 16, beat: START_BAR * 4 });
      seq.zoneIndex = 0;
      seq.zoneKey = 0;
      const changeAt = START_T + offset * STEP_S;
      let t = START_T;
      let done = false;
      for (; t <= changeAt + 20; t += 0.025) {
        if (!done && t >= changeAt) {
          seq.zoneIndex = 1;
          seq.zoneKey = 7;
          done = true;
        }
        state.now = t;
        seq.tick(t);
      }
      expect(seq.stats.sectorChanges).toBe(1);
      const risers = calls.filter((c) => c.layer === Layer.RISER);
      // Form origin is START_BAR, so relative bars are t / 2.4, and the crash at t = 0 is form position 0's own.
      const crashes = calls.filter((c) => c.layer === Layer.CRASH && c.t > 0);
      expect(crashes).toHaveLength(1);
      const switchT = crashes[0]!.t;
      const switchBar = Math.round(switchT / BAR_S);
      expect(switchBar % 4).toBe(0);                 // on a phrase line
      expect(risers.some((r) => Math.abs(r.t - (switchT - BAR_S)) < 1e-6)).toBe(true);   // the fill bar precedes it
      expect(switchT - changeAt).toBeLessThanOrEqual(5 * BAR_S + 0.12 + 1e-6);
      // Every pad chord before the switch is in the old key, every one from it on is in the new key.
      for (const c of calls.filter((x) => x.kind === 'pad')) {
        const newKey = c.t >= switchT - 1e-9;
        const key = newKey ? 7 : 0;
        const sector = newKey ? 1 : 0;
        const chord = CHORDS[chordAt(c.bar!, sector)]!;
        expect(c.pad0).toBe(padTonic(key) + chord.pad[0]);
      }
    });
  }

  it('a second change during the wait replaces the pending one', () => {
    const { seq, calls, state } = setup({ sync: 16, beat: START_BAR * 4 });
    state.now = 0;
    seq.tick(0);
    seq.zoneIndex = 1;
    seq.zoneKey = 7;
    run(seq, state, 0.025, 3);
    seq.zoneIndex = 2;
    seq.zoneKey = 2;
    run(seq, state, 3, 22);
    expect(seq.stats.sectorChanges).toBe(1);
    const pads = calls.filter((c) => c.kind === 'pad');
    const last = pads[pads.length - 1]!;
    expect(last.pad0).toBe(padTonic(2) + CHORDS[chordAt(last.bar!, 2)]!.pad[0]);
  });

  it('the first start adopts the zone at once, with no fill', () => {
    const clock = createBeatClock();
    anchorClock(clock, 16 + 2, 0);
    const state = { now: 0 };
    const { sink, calls } = recorder(state);
    const seq = createSequencer(clock, sink);
    seq.sync = 16;
    seq.zoneIndex = 3;
    seq.zoneKey = 9;
    seq.restart(0);
    run(seq, state, 0, 2);
    expect(seq.stats.sectorChanges).toBe(0);
    expect(calls.filter((c) => c.layer === Layer.RISER)).toHaveLength(0);
    const pad = calls.find((c) => c.kind === 'pad')!;
    expect(pad.pad0).toBe(padTonic(9) + CHORDS[chordAt(pad.bar!, 3)]!.pad[0]);
  });

  it('chordAtStep and keyAtStep see an armed change only past the current bar', () => {
    const { seq, state } = setup({ sync: 16, beat: START_BAR * 4 });
    state.now = 0;
    seq.tick(0);
    seq.zoneIndex = 1;
    seq.zoneKey = 7;
    run(seq, state, 0.025, BAR_S * 3 + 0.2);   // bar 3 relative is computed and is the fill bar
    const fillBarAbs = START_BAR + 3;
    expect(seq.currentBar).toBe(fillBarAbs);
    expect(seq.keyAtStep(fillBarAbs * 16)).toBe(0);
    expect(seq.keyAtStep((fillBarAbs + 1) * 16)).toBe(7);
    expect(seq.chordAtStep((fillBarAbs + 1) * 16)).toBe(chordAt(4, 1));
  });
});

describe('A3 re-anchors and form', () => {
  /** The steps a hat lands on, identified through the clock current at the call. */
  function hatSteps(calls: readonly Call[], clock: BeatClock, seen: number[]): void {
    for (const c of calls) {
      if (c.layer === Layer.HAT || c.layer === Layer.OHAT) seen.push(stepAtOrAfter(clock, c.t - 1e-6));
    }
  }

  it('a warp re-anchor never repeats a step, jumping forward or back', () => {
    for (const jumpBeats of [37.5, 0.1, -0.08, -1]) {
      const { clock, seq, calls, state } = setup({ sync: 16 });
      const seen: number[] = [];
      run(seq, state, 0, 5);
      hatSteps(calls, clock, seen);
      calls.length = 0;
      anchorClock(clock, 5 / 0.6 + jumpBeats, 5);
      run(seq, state, 5, 9);
      hatSteps(calls, clock, seen);
      for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThan(seen[i - 1]!);
    }
  });

  it('formOrigin makes a start at bar 1003 enter section A', () => {
    const { calls, seq, state } = setup({ sync: 16, beat: 1003 * 4 });
    run(seq, state, 0, 0.2);
    const pad = calls.find((c) => c.kind === 'pad')!;
    expect(pad.bar).toBe(3);   // 1003 - 1000: a multiple of 4 taken off, so phases[2] stays in step
    expect(createBarPattern().count).toBe(0);
  });

  it('formOrigin is not reset on resume', () => {
    const { clock, calls, seq, state } = setup({ sync: 16, beat: 1003 * 4 });
    run(seq, state, 0, 10);
    calls.length = 0;
    anchorClock(clock, 1003 * 4 + 40 / 0.6, 40);
    seq.restart(40);
    run(seq, state, 40, 40.3);
    const pad = calls.find((c) => c.kind === 'pad')!;
    expect(pad.bar).toBe(Math.floor((1003 * 16 + (40 / 0.6) * 4) / 16) - 1000);
  });

  it('sync is sampled once per bar, so a change lands on the next bar line', () => {
    const { seq, calls, state } = setup({ sync: 1 });
    run(seq, state, 0, 1);
    seq.sync = 16;
    run(seq, state, 1, 2);
    expect(calls.filter((c) => c.kind === 'arp')).toHaveLength(0);
    run(seq, state, 2, 3);
    expect(calls.filter((c) => c.kind === 'arp').length).toBeGreaterThan(0);
  });
});
