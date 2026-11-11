// A2, A3, A3n and A4: the governor against synthetic frame series. Expected events are the plan's own table.
import v8 from 'node:v8';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import type { Governor, Tier } from '../../../src/contracts/index';
import { createNeutralFeel } from '../../../src/core/alloc';
import { scriptedFrame } from '../../../src/testing/scriptedFrame';
import { bootTier, createGovernorImpl } from '../../../src/render/fx/governor';
import { computePostParams, createPostParams } from '../../../src/render/fx/postParams';

type Ev = readonly [number, Tier];
const F60 = 1000 / 60;   // "16.667" in the plan's table is exactly this

interface Run { g: Governor; clock: number; events: [number, Tier][] }

function start(bootP95Ms: number, software = false, forced: Tier | null = null): Run {
  return { g: createGovernorImpl({ software, bootP95Ms, forced }), clock: 0, events: [] };
}

/** Runs frames of f(i) until seconds of summed frame time have passed, recording returned tiers. */
function run(r: Run, seconds: number, f: (i: number) => number): Run {
  const end = r.clock + seconds * 1000;
  let i = 0;
  while (r.clock < end) {
    const ms = f(++i);
    r.clock += ms;
    const out = r.g.sample(ms);
    if (out !== null) r.events.push([r.clock / 1000, out]);
  }
  return r;
}

const steady = (ms: number) => (): number => ms;
const every = (n: number, a: number, b: number) => (i: number): number => (i % n === 0 ? a : b);

function expectEvents(r: Run, want: readonly Ev[]): void {
  const got = r.events.map(([t, tier]) => `${t.toFixed(3)}:${tier}`).join(' ');
  expect(r.events.length, `events were ${got}`).toBe(want.length);
  want.forEach(([t, tier], i) => {
    const [gt, gtier] = r.events[i]!;
    expect(gtier, `event ${i} of ${got}`).toBe(tier);
    // Time is to 0.1 s, as the plan's table is. The small addend is only rounding of the comparison itself.
    expect(Math.abs(gt - t), `event ${i} of ${got}`).toBeLessThanOrEqual(0.1 + 1e-9);
  });
}

describe('A2 boot', () => {
  it('bootTier follows section 6.10 at each edge', () => {
    const cases: [number, Tier][] = [[1.99, 4], [2, 3], [13.99, 3], [14, 2], [27.99, 2], [28, 1], [500, 1], [0, 3], [NaN, 3], [Infinity, 3], [-1, 3]];
    for (const [p, tier] of cases) expect(bootTier(p), `p95 ${p}`).toBe(tier);
  });

  it('software starts at tier 0', () => {
    expect(start(1, true).g.profile.tier).toBe(0);
  });

  it('forced beats software, and holds through 120 s of 100 ms frames', () => {
    const r = start(1, true, 3);
    expect(r.g.profile.tier).toBe(3);
    run(r, 120, steady(100));
    expect(r.events).toEqual([]);
    expect(r.g.profile.tier).toBe(3);
  });
});

describe('A3 series', () => {
  const rows: [string, number, [number, (i: number) => number][], Ev[]][] = [
    ['60 Hz from tier 3 for an hour', 5, [[3600, steady(F60)]], [[63.0, 4]]],
    ['60 Hz from tier 2', 20, [[200, steady(F60)]], [[63.0, 3], [126.0, 4]]],
    ['60 Hz at tier 4', 1, [[300, steady(F60)]], []],
    ['between the thresholds', 5, [[300, steady(18)]], []],
    ['exactly 20 is not above 20', 5, [[120, steady(20.0)]], []],
    ['20.2 steady, boot under half, held', 5, [[120, steady(20.2)]], []],
    ['20.2 steady, boot not under half', 13, [[30, steady(20.2)]], [[5.0, 2], [10.1, 1]]],
    ['33.3 steady, held, the 30 Hz cap', 8, [[120, steady(33.3)]], []],
    ['33.3 from tier 2, then the tier 1 floor', 20, [[120, steady(33.3)]], [[5.1, 1]]],
    ['60 from tier 1 enters tier 0', 40, [[30, steady(60)]], [[5.0, 0]]],
    ['NaN boot, never held', NaN, [[30, steady(33.3)]], [[5.1, 2], [10.1, 1]]],
    ['0 boot, never held', 0, [[30, steady(33.3)]], [[5.1, 2], [10.1, 1]]],
    ['5.9% spikes', 5, [[20, every(17, 40, 16.7)]], [[5.0, 2], [10.0, 1]]],
    ['4% spikes', 5, [[600, every(25, 40, 16.7)]], [[63.3, 4]]],
    ['the reversal locks tier 3 until 372 s', 20, [[70, steady(F60)], [10, steady(33.3)], [400, steady(F60)]],
      [[63.0, 3], [72.1, 2], [77.1, 1], [140.2, 2], [373.2, 3], [436.2, 4]]],
    ['49 s after the upshift is not a reversal', 20, [[110, steady(F60)], [10, steady(33.3)], [70, steady(F60)]],
      [[63.0, 3], [112.1, 2], [117.2, 1], [180.2, 2]]],
  ];

  for (const [name, boot, segments, want] of rows) {
    it(name, () => {
      const r = start(boot);
      for (const [seconds, f] of segments) run(r, seconds, f);
      expectEvents(r, want);
    });
  }

  it('a NaN or 0 boot starts at tier 3', () => {
    expect(start(NaN).g.profile.tier).toBe(3);
    expect(start(0).g.profile.tier).toBe(3);
  });

  // The plan's row. One 5000 ms sample among about 60 cannot move a nearest-rank p95, so this row passes with the
  // stall rule deleted (V1 verifier). The three rows after it are the ones that fail without the rule.
  it('a 5000 ms stall is not load, and the tier stays 3', () => {
    const r = start(13);
    run(r, 4, steady(F60));
    run(r, 5, steady(5000));
    run(r, 6, steady(F60));
    expect(r.events).toEqual([]);
    expect(r.g.profile.tier).toBe(3);
  });

  it('a 40 s stall resets the upshift chain: no upshift straight after it', () => {
    const r = start(5);
    run(r, 30, steady(F60));
    run(r, 40, steady(40000));   // one delta, as a return from a hidden tab gives
    run(r, 40, steady(F60));
    expectEvents(r, []);
    expect(r.g.profile.tier).toBe(3);
  });

  it('a 3000 ms stall after every 2 s of 60 Hz is never load', () => {
    const r = start(5);
    // 120 frames of 1000 / 60 sum to 2000 ms, then one stall.
    run(r, 120, (i) => (i % 121 === 0 ? 3000 : F60));
    expectEvents(r, []);
    expect(r.g.profile.tier).toBe(3);
  });

  // Stalls on every 4th frame, so a window that counted them would have p50 at 60 Hz and p95 at the stall, and the
  // display-limit hold could not mask the mistake. A window of stalls alone would be held, and prove nothing.
  it('deltas of exactly STALL_MS on every 4th frame are stalls, not load', () => {
    const r = start(5);
    run(r, 10, steady(F60));
    run(r, 30, every(4, 1000, F60));
    run(r, 10, steady(F60));
    expectEvents(r, []);
    expect(r.g.profile.tier).toBe(3);
  });

  // A stall clears the window as well as the chain. 60 frames of 25 ms after the settle fill 1500 ms, short of
  // WINDOW_MS, so nothing decides before the stall. Kept, they are p95 25 in the first window after it, and boot 13
  // is not under half of that, so the governor would shed a tier. Cleared, that window is 16 ms alone.
  it('a stall clears the window: slow frames just before it do not count after it', () => {
    const r = start(13);
    run(r, 3, steady(16));       // 188 frames, all inside the 3000 ms settle
    run(r, 1.5, steady(25));     // 60 frames, an open window of 1500 ms
    run(r, 40, steady(40000));   // one delta, as a return from a hidden tab gives
    run(r, 10, steady(16));
    expectEvents(r, []);
    expect(r.g.profile.tier).toBe(3);
  });

  it('force(1): profile at once, first sample returns it, second null, none for 100 s, then auto resumes', () => {
    const r = start(5);
    r.g.force(1);
    expect(r.g.profile.tier).toBe(1);
    expect(r.g.sample(F60)).toBe(1);
    expect(r.g.sample(F60)).toBeNull();
    r.clock += 2 * F60;
    run(r, 100, steady(F60));
    expect(r.events).toEqual([]);
    r.g.force('auto');
    run(r, 70, steady(F60));
    expectEvents(r, [[163.1, 2]]);
  });

  it('force on the current tier returns nothing', () => {
    const r = start(5);
    r.g.force(3);
    expect(r.g.sample(F60)).toBeNull();
  });

  it('10,000 sample(0), then a real series, gives the real series alone', () => {
    const r = start(5);
    for (let i = 0; i < 10000; i++) expect(r.g.sample(0)).toBeNull();
    run(r, 200, steady(F60));
    expectEvents(r, [[63.0, 4]]);
  });

  it('sample(0) in mid-series changes nothing: this is the row that fails without the guard', () => {
    const r = start(13);
    run(r, 4, steady(20.2));
    for (let i = 0; i < 10000; i++) expect(r.g.sample(0)).toBeNull();
    run(r, 26, steady(20.2));
    expectEvents(r, [[5.0, 2], [10.1, 1]]);
  });

  it('force(1), then sample(0) twice: first returns 1, second null', () => {
    const r = start(5);
    r.g.force(1);
    expect(r.g.sample(0)).toBe(1);
    expect(r.g.sample(0)).toBeNull();
  });

  it('software: no events at any speed, force(2) applies, auto returns to 0', () => {
    const r = start(1, true);
    run(r, 120, steady(5));
    run(r, 60, steady(100));
    expect(r.events).toEqual([]);
    expect(r.g.profile.tier).toBe(0);
    r.g.force(2);
    expect(r.g.profile.tier).toBe(2);
    expect(r.g.sample(F60)).toBe(2);
    r.g.force('auto');
    expect(r.g.profile.tier).toBe(0);
    expect(r.g.sample(F60)).toBe(0);
    expect(r.g.sample(F60)).toBeNull();
  });
});

describe('A3n fuzz', () => {
  function series(seed: number): number[] {
    let s = seed;
    const r = (): number => (s = (s * 16807) % 2147483647) / 2147483647;
    const out: number[] = [];
    let mode = r();
    let t = 0;
    while (t < 600000) {
      if (r() < 0.001) mode = r();
      const ms = mode < 0.4 ? 10 + r() * 8 : mode < 0.7 ? 16 + r() * 30 : mode < 0.95 ? 30 + r() * 80 : 200 + r() * 1200;
      out.push(ms);
      t += ms;
    }
    return out;
  }

  it('200 seeds: changes at least 5 s apart, one step each, and repeatable', () => {
    let changes = 0;
    let minGap = Infinity;
    for (let seed = 1; seed <= 200; seed++) {
      const frames = series(seed * 7919);
      const boot = 1 + (seed * 37 % 40);
      const a = createGovernorImpl({ software: false, bootP95Ms: boot, forced: null });
      const b = createGovernorImpl({ software: false, bootP95Ms: boot, forced: null });
      let last = -Infinity;
      let clock = 0;
      let prev = a.profile.tier;
      for (const ms of frames) {
        clock += ms;
        const x = a.sample(ms);
        const y = b.sample(ms);
        expect(y).toBe(x);
        if (x !== null) {
          expect(x).toBe(a.profile.tier);
          expect(Math.abs(x - prev)).toBe(1);
          minGap = Math.min(minGap, clock - last);
          expect(clock - last, `seed ${seed}`).toBeGreaterThanOrEqual(5000);
          last = clock;
          prev = x;
          changes++;
        }
      }
    }
    console.log(`A3n changes ${changes}, min gap ${minGap.toFixed(1)} ms`);
    expect(changes).toBeGreaterThan(100);
  });
});

describe('A4 allocation', () => {
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc') as () => void;
  const heapAfterGc = (): number => {
    gc();
    gc();
    return process.memoryUsage().heapUsed;
  };

  it('2e6 sample calls do not grow the heap', () => {
    const g = createGovernorImpl({ software: false, bootP95Ms: 5, forced: null });
    for (let i = 0; i < 2e5; i++) g.sample(16.7);
    const before = heapAfterGc();
    for (let i = 0; i < 2e6; i++) g.sample(i % 7 ? 16.7 : 30);
    const after = heapAfterGc();
    console.log(`A4 governor heap delta ${after - before} bytes over 2e6 samples`);
    expect(after - before).toBeLessThan(64 * 1024);
  });

  it('2e6 computePostParams calls do not grow the heap', () => {
    const v = scriptedFrame(4, { feel: { ...createNeutralFeel(), aberration: 0.3, flash: 0.2, bloomGain: 1.1 }, palette: 2 });
    const out = createPostParams();
    for (let i = 0; i < 2e5; i++) computePostParams(v, 'full', 1, 1.5, out);
    const before = heapAfterGc();
    for (let i = 0; i < 2e6; i++) computePostParams(v, i % 3 ? 'full' : 'min', 1 + (i % 2), 1.5, out);
    const after = heapAfterGc();
    console.log(`A4 postParams heap delta ${after - before} bytes over 2e6 calls`);
    expect(after - before).toBeLessThan(64 * 1024);
  });

  it('negative control: the same measure sees 1e5 retained small objects, so it can fail', () => {
    const before = heapAfterGc();
    const kept: { a: number; b: number }[] = [];
    for (let i = 0; i < 1e5; i++) kept.push({ a: i, b: i + 1 });
    const after = heapAfterGc();
    console.log(`A4 control heap delta ${after - before} bytes`);
    expect(after - before).toBeGreaterThan(1024 * 1024);
    expect(kept.length).toBe(1e5);
  });
});
