// A20: update allocates next to nothing. Median heap delta over short windows, as tests/unit/sim/alloc.test.ts does.
import { expect, test } from 'vitest';
import { Ev } from '../../../src/contracts/index';
import { createFeel } from '../../../src/feel/index';
import { plainEvents, plainState, pushEv, setClock } from './fixtures/frames';

const LIMIT = 4;

function medianBytes(fn: (i: number) => void, windowSteps: number, windows: number): number {
  const out = new Float64Array(windows);
  for (let w = 0; w < windows; w++) {
    const a = process.memoryUsage().heapUsed;
    for (let i = 0; i < windowSteps; i++) fn(i);
    out[w] = (process.memoryUsage().heapUsed - a) / windowSteps;
  }
  out.sort();
  return out[windows >> 1]!;
}

test('at most 4 bytes per update, with a retained-object control over the limit', () => {
  const feel = createFeel();
  const s = plainState({ speed: 110 });
  const e = plainEvents();
  pushEv(e, Ev.GATE, 500);
  pushEv(e, Ev.SHARD, 100);
  const none = plainEvents();
  let n = 0;
  const update = (): void => {
    n++;
    setClock(s, n / 60);
    s.prevX = s.x;
    s.x = 20 * Math.sin(n / 90);
    feel.update(1 / 60, s, n % 30 === 0 ? e : none, false);
  };
  for (let i = 0; i < 300000; i++) update();
  const empty = medianBytes(() => { /* the loop alone */ }, 2000, 300);
  const measured = medianBytes(update, 2000, 300);
  const keep: { i: number }[] = new Array(2000);
  const leak = medianBytes((i) => {
    update();
    keep[i] = { i };
  }, 2000, 300);
  console.log(`FEEL_ALLOC bytes per update: empty ${empty.toFixed(3)}, update ${measured.toFixed(3)}, retained control ${leak.toFixed(3)}, limit ${LIMIT}`);
  expect(measured).toBeLessThanOrEqual(LIMIT);
  expect(leak).toBeGreaterThan(LIMIT);
}, 120000);
