// A19: feel cannot write what it reads, and instances share nothing.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { Ev, type EventBuffer, type SimState } from '../../../src/contracts/index';
import { createFeel } from '../../../src/feel/index';
import { plainEvents, plainState, pushEv } from './fixtures/frames';

function frozenState(): SimState {
  const s = plainState({ speed: 120, x: 3, prevX: 2 });
  Object.freeze(s.travel);
  return Object.freeze(s);
}

function loaded(): EventBuffer {
  const e = plainEvents();
  pushEv(e, Ev.HIT, 2);
  pushEv(e, Ev.GATE, 500);
  pushEv(e, Ev.SHARD, 100);
  pushEv(e, Ev.SIGNAL_LOST);
  return e;
}

test('update on a frozen state copy does not throw', () => {
  const feel = createFeel();
  expect(() => {
    for (let i = 0; i < 100; i++) feel.update(1 / 60, frozenState(), loaded(), false);
  }).not.toThrow();
});

test('negative control: a deliberately writing function on the frozen state does throw, so the test mode is strict', () => {
  const s = frozenState();
  const write = (x: SimState): void => {
    x.score = 5;
  };
  expect(() => write(s)).toThrow(TypeError);
  expect(() => {
    s.travel.local = 1;
  }).toThrow(TypeError);
});

test('event arrays and count are byte-identical afterwards', () => {
  const feel = createFeel();
  const e = loaded();
  const copy = {
    kind: e.kind.slice(), x: e.x.slice(), y: e.y.slice(), value: e.value.slice(), chunk: e.chunk.slice(), index: e.index.slice(), count: e.count,
  };
  feel.update(1 / 60, plainState(), e, false);
  expect(e.count).toBe(copy.count);
  expect(Buffer.from(e.kind.buffer).equals(Buffer.from(copy.kind.buffer))).toBe(true);
  expect(Buffer.from(e.x.buffer).equals(Buffer.from(copy.x.buffer))).toBe(true);
  expect(Buffer.from(e.y.buffer).equals(Buffer.from(copy.y.buffer))).toBe(true);
  expect(Buffer.from(e.value.buffer).equals(Buffer.from(copy.value.buffer))).toBe(true);
  expect(Buffer.from(e.chunk.buffer).equals(Buffer.from(copy.chunk.buffer))).toBe(true);
  expect(Buffer.from(e.index.buffer).equals(Buffer.from(copy.index.buffer))).toBe(true);
});

test('two instances fed different streams do not influence each other', () => {
  const a = createFeel();
  const b = createFeel();
  const alone = createFeel();
  const quiet = plainEvents();
  const s = plainState();
  for (let i = 0; i < 200; i++) {
    a.update(1 / 60, s, i % 20 === 0 ? loaded() : quiet, false);
    b.update(1 / 60, s, quiet, false);
    alone.update(1 / 60, s, quiet, false);
    expect({ ...b.out }).toEqual({ ...alone.out });
  }
  expect(a.out.flash).toBeGreaterThan(b.out.flash);
});

test('the same input gives the same output by Object.is', () => {
  const run = (): number[] => {
    const f = createFeel();
    const s = plainState({ speed: 110 });
    const trace: number[] = [];
    for (let i = 0; i < 400; i++) {
      s.tick = i * 2;
      s.beat = s.tick / 72;
      s.prevX = s.x;
      s.x = 20 * Math.sin(i / 11);
      f.update(1 / 60, s, i % 50 === 0 ? loaded() : plainEvents(), false);
      trace.push(...Object.values(f.out));
    }
    return trace;
  };
  const a = run();
  const b = run();
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) expect(Object.is(a[i], b[i])).toBe(true);
});

test('createFeel takes nothing and has one stable out', () => {
  expect(createFeel.length).toBe(0);
  const feel = createFeel();
  const out = feel.out;
  feel.update(1 / 60, plainState(), loaded(), false);
  expect(feel.out).toBe(out);
});

test('src/feel holds no module-level mutable state, reads no clock and imports no sim', () => {
  for (const name of ['feel.ts', 'tuning.ts', 'index.ts']) {
    const text = readFileSync(fileURLToPath(new URL(`../../../src/feel/${name}`, import.meta.url)), 'utf8');
    expect(text).not.toMatch(/^let\s/m);
    expect(text).not.toMatch(/^var\s/m);
    expect(text).not.toMatch(/\/sim\//);
    expect(text).not.toMatch(/Math\.random|Date\.now|performance\./);
  }
});
