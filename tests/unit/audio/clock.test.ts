// A2: the drift filter, the slew and both re-anchors, over a simulated hour.
import { describe, expect, it } from 'vitest';
import {
  anchorClock, createBeatClock, observe, setOutputLatency, stepAtOrAfter, timeOfStep, type BeatClock,
} from '../../../src/audio/clock';
import { BEAT_S } from '../../../src/audio/theory';

function prng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Run { clock: BeatClock; audio: (t: number) => number; beat: (t: number) => number; last: number }

/** A frame at wall time t: the sim's beat with jitter, the audio clock quantised and skewed. */
function makeRun(quantum: number, ppm: number, jitterS: number, seed = 1): Run & { rand: () => number; offset: { s: number } } {
  const rand = prng(seed);
  const offset = { s: 0 };
  const clock = createBeatClock();
  const audio = (t: number): number => Math.floor((t * (1 + ppm / 1e6)) / quantum) * quantum;
  const beat = (t: number): number => (t + offset.s + (rand() * 2 - 1) * jitterS) / BEAT_S;
  anchorClock(clock, beat(0), audio(0));
  return { clock, audio, beat, last: audio(0), rand, offset };
}

function frame(r: Run, t: number): void {
  const now = r.audio(t);
  observe(r.clock, r.beat(t), now, now - r.last);
  r.last = now;
}

describe('A2 an hour of ordinary frames', () => {
  it('60 Hz, 10.67 ms quantum, +-5 ms jitter, 100 ppm skew: no re-anchor after the first, filtered drift under 5 ms', () => {
    const r = makeRun(0.01067, 100, 0.005);
    const frames = 3600 * 60;
    let overRaw = 0;
    let worst = 0;
    for (let i = 1; i <= frames; i++) {
      frame(r, i / 60);
      if (Math.abs(r.clock.raw) > 0.005) overRaw += 1;
      if (i > 60 && Math.abs(r.clock.ema) > worst) worst = Math.abs(r.clock.ema);
    }
    console.log(`A2 hour: anchors ${r.clock.anchors}, final ema ${(r.clock.ema * 1e3).toFixed(3)} ms, worst ema ${(worst * 1e3).toFixed(3)} ms, raw over 5 ms on ${((100 * overRaw) / frames).toFixed(1)}% of frames`);
    expect(r.clock.anchors).toBe(1);
    expect(Math.abs(r.clock.ema)).toBeLessThan(0.005);
    expect(worst).toBeLessThan(0.03);
  });
});

describe('A2 steps in the clock', () => {
  function settled(): Run & { rand: () => number; offset: { s: number }; t: number } {
    const r = makeRun(0.01067, 0, 0.002);
    for (let i = 1; i <= 120; i++) frame(r, i / 60);
    return Object.assign(r, { t: 120 / 60 });
  }

  it('a +50 ms step re-anchors within 1 s, then filtered drift is small', () => {
    const r = settled();
    const before = r.clock.anchors;
    r.offset.s = 0.05;
    let at = -1;
    for (let i = 1; i <= 300; i++) {
      frame(r, r.t + i / 60);
      if (at < 0 && r.clock.anchors > before) at = i / 60;
    }
    console.log(`A2 +50 ms: re-anchored after ${at.toFixed(3)} s`);
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(1);
    expect(r.clock.anchors).toBe(before + 1);
    expect(Math.abs(r.clock.ema)).toBeLessThan(0.005);
  });

  it('a +20 ms step never re-anchors and slews out in under 15 s', () => {
    const r = settled();
    const before = r.clock.anchors;
    r.offset.s = 0.02;
    let clearAt = -1;
    for (let i = 1; i <= 60 * 30; i++) {
      frame(r, r.t + i / 60);
      if (clearAt < 0 && i > 30 && Math.abs(r.clock.ema) < 0.002) clearAt = i / 60;
    }
    console.log(`A2 +20 ms: inside 2 ms after ${clearAt.toFixed(2)} s`);
    expect(r.clock.anchors).toBe(before);
    expect(clearAt).toBeGreaterThan(0);
    expect(clearAt).toBeLessThan(15);
  });

  it('a +250 ms clamp re-anchors within 2 observes', () => {
    const r = settled();
    const before = r.clock.anchors;
    r.offset.s = 0.25;
    frame(r, r.t + 1 / 60);
    expect(r.clock.anchors).toBe(before);
    frame(r, r.t + 2 / 60);
    expect(r.clock.anchors).toBe(before + 1);
  });

  it('one raw spike above 150 ms alone does not re-anchor', () => {
    const r = settled();
    const before = r.clock.anchors;
    r.offset.s = 0.25;
    frame(r, r.t + 1 / 60);
    r.offset.s = 0;
    frame(r, r.t + 2 / 60);
    expect(r.clock.anchors).toBe(before);
  });

  it('a backward tick re-anchors and does not throw', () => {
    const r = settled();
    const before = r.clock.anchors;
    r.offset.s = -5;
    expect(() => {
      frame(r, r.t + 1 / 60);
      frame(r, r.t + 2 / 60);
    }).not.toThrow();
    expect(r.clock.anchors).toBe(before + 1);
  });
});

describe('A2 negative control: the filter earns its place', () => {
  const MINUTES = 10;

  it('an unfiltered 30 ms threshold, same jitter plus a 50 ms audio quantum, re-anchors repeatedly', () => {
    const r = makeRun(0.05, 100, 0.005);
    let anchorTime = r.audio(0);
    let anchorBeat = r.beat(0);
    let reanchors = 0;
    for (let i = 1; i <= MINUTES * 60 * 60; i++) {
      const t = i / 60;
      const now = r.audio(t);
      const b = r.beat(t);
      const raw = anchorTime + (b - anchorBeat) * BEAT_S - now;
      if (Math.abs(raw) > 0.03) {
        anchorTime = now;
        anchorBeat = b;
        reanchors += 1;
      }
    }
    console.log(`A2 control: unfiltered threshold re-anchored ${reanchors} times in ${MINUTES} min`);
    expect(reanchors).toBeGreaterThan(100);
  });

  it('the real rules on the same input do not', () => {
    const r = makeRun(0.05, 100, 0.005);
    for (let i = 1; i <= MINUTES * 60 * 60; i++) frame(r, i / 60);
    console.log(`A2 control: the real filter anchored ${r.clock.anchors} times`);
    expect(r.clock.anchors).toBe(1);
  });
});

describe('clock arithmetic', () => {
  it('timeOfStep follows the formula, and a step is .15 s', () => {
    const c = createBeatClock();
    anchorClock(c, 100, 5);
    expect(timeOfStep(c, 400)).toBeCloseTo(5, 12);
    expect(timeOfStep(c, 401) - timeOfStep(c, 400)).toBeCloseTo(0.15, 12);
    expect(timeOfStep(c, 416)).toBeCloseTo(5 + 2.4, 12);
  });

  it('stepAtOrAfter is the smallest step at or after a time, even on a grid line', () => {
    const c = createBeatClock();
    anchorClock(c, 7.25, 123.456);
    for (let s = 20; s < 60; s++) {
      const t = timeOfStep(c, s);
      expect(stepAtOrAfter(c, t)).toBe(s);
      expect(stepAtOrAfter(c, t + 1e-6)).toBe(s + 1);
      expect(stepAtOrAfter(c, t - 1e-6)).toBe(s);
    }
  });

  it('works at large beats', () => {
    const c = createBeatClock();
    const beat = 2 ** 40;
    anchorClock(c, beat, 10);
    expect(stepAtOrAfter(c, 10)).toBe(beat * 4);
    expect(timeOfStep(c, beat * 4 + 16)).toBeCloseTo(12.4, 6);
  });

  it('latency comp: clamp(L - .02, 0, .3), a 10 ms deadband, and it moves the sound without moving drift', () => {
    const c = createBeatClock();
    anchorClock(c, 0, 0);
    setOutputLatency(c, 0.01);
    expect(c.comp).toBe(0);
    setOutputLatency(c, 0.025);          // moved 5 ms: below the deadband
    expect(c.comp).toBe(0);
    setOutputLatency(c, 0.08);
    expect(c.comp).toBeCloseTo(0.06, 12);
    expect(timeOfStep(c, 16)).toBeCloseTo(2.4 - 0.06, 12);
    setOutputLatency(c, 5);
    expect(c.comp).toBeCloseTo(0.3, 12);
    const anchors = c.anchors;
    observe(c, 10, 6, 0.016);            // beat 10 is 6 s: zero drift whatever comp says
    expect(c.raw).toBeCloseTo(0, 9);
    expect(c.anchors).toBe(anchors);
    expect(stepAtOrAfter(c, timeOfStep(c, 40))).toBe(40);
  });
});
