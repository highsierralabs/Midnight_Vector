// DI-61: a run's distance, and so furthest, accrues only while score does. PLAY with autopilot off is the only scoring
// state; CRUISE, idle autopilot and SIGNAL_LOST hold the distance, and scoring again resumes from it with no jump.
import { describe, expect, it } from 'vitest';
import { CHUNK_LEN, SimMode, type Travel } from '../../../src/contracts/index';
import { createRunMeter, scoring } from '../../../src/ui/run';

function at(chunk: number, local = 0): Travel {
  return { chunk, local };
}

function meter() {
  const m = createRunMeter();
  const out = new Float64Array(1);
  return (mode: SimMode, autopilot: boolean, t: Travel): number => {
    m.frame(mode, autopilot, t, out);
    return out[0]!;
  };
}

describe('scoring', () => {
  it('is PLAY with autopilot off, and nothing else', () => {
    const rows: [SimMode, boolean, boolean][] = [
      [SimMode.DEMO, true, false], [SimMode.DEMO, false, false],
      [SimMode.PLAY, false, true], [SimMode.PLAY, true, false],
      [SimMode.CRUISE, true, false], [SimMode.CRUISE, false, false],
      [SimMode.SIGNAL_LOST, true, false], [SimMode.SIGNAL_LOST, false, false],
    ];
    for (const [mode, autopilot, want] of rows) expect(scoring(mode, autopilot), `${mode} ${autopilot}`).toBe(want);
  });
});

describe('run meter', () => {
  it('is 0 in DEMO however far the world has gone', () => {
    const f = meter();
    expect(f(SimMode.DEMO, true, at(1))).toBe(0);
    expect(f(SimMode.DEMO, true, at(9_000_000))).toBe(0);
  });

  it('counts from the launch, not from chunk 0', () => {
    const f = meter();
    f(SimMode.DEMO, true, at(5000));
    expect(f(SimMode.PLAY, false, at(5000))).toBe(0);
    expect(f(SimMode.PLAY, false, at(5100, 8))).toBe(100 * CHUNK_LEN + 8);
  });

  it('holds in CRUISE while the world moves, and resumes from the held value', () => {
    const f = meter();
    f(SimMode.DEMO, true, at(5000));
    f(SimMode.PLAY, false, at(5000));
    f(SimMode.PLAY, false, at(5100));
    expect(f(SimMode.CRUISE, true, at(5100))).toBe(100 * CHUNK_LEN);
    expect(f(SimMode.CRUISE, true, at(9000))).toBe(100 * CHUNK_LEN);
    expect(f(SimMode.PLAY, false, at(9000))).toBe(100 * CHUNK_LEN);
    expect(f(SimMode.PLAY, false, at(9010))).toBe(110 * CHUNK_LEN);
  });

  it('holds during idle autopilot in PLAY', () => {
    const f = meter();
    f(SimMode.DEMO, true, at(1));
    f(SimMode.PLAY, false, at(1));
    f(SimMode.PLAY, false, at(51));
    expect(f(SimMode.PLAY, true, at(51))).toBe(50 * CHUNK_LEN);
    expect(f(SimMode.PLAY, true, at(4051))).toBe(50 * CHUNK_LEN);
    expect(f(SimMode.PLAY, false, at(4051))).toBe(50 * CHUNK_LEN);
    expect(f(SimMode.PLAY, false, at(4052))).toBe(51 * CHUNK_LEN);
  });

  it('holds during SIGNAL_LOST', () => {
    const f = meter();
    f(SimMode.DEMO, true, at(1));
    f(SimMode.PLAY, false, at(1));
    f(SimMode.PLAY, false, at(11));
    expect(f(SimMode.SIGNAL_LOST, true, at(11))).toBe(10 * CHUNK_LEN);
    expect(f(SimMode.SIGNAL_LOST, true, at(31))).toBe(10 * CHUNK_LEN);
  });

  it('a state entered straight from DEMO without scoring shows 0', () => {
    const f = meter();
    f(SimMode.DEMO, true, at(1));
    expect(f(SimMode.CRUISE, true, at(1))).toBe(0);
    expect(f(SimMode.CRUISE, true, at(777))).toBe(0);
  });

  it('a return to DEMO resets it, and the next run starts from its own launch', () => {
    const f = meter();
    f(SimMode.DEMO, true, at(1));
    f(SimMode.PLAY, false, at(1));
    f(SimMode.PLAY, false, at(101));
    expect(f(SimMode.DEMO, true, at(200))).toBe(0);
    f(SimMode.PLAY, false, at(300));
    expect(f(SimMode.PLAY, false, at(302))).toBe(2 * CHUNK_LEN);
  });

  it('stays exact far out, because each spell is one between() and not a sum of steps', () => {
    const f = meter();
    const far = 2 ** 44;
    f(SimMode.DEMO, true, at(far));
    f(SimMode.PLAY, false, at(far, 0.25));
    f(SimMode.PLAY, false, at(far + 3, 0.5));
    f(SimMode.CRUISE, true, at(far + 1000));
    f(SimMode.PLAY, false, at(far + 1000, 0.125));
    expect(f(SimMode.PLAY, false, at(far + 1001, 0.125))).toBe(3 * CHUNK_LEN + 0.25 + CHUNK_LEN);
  });
});
