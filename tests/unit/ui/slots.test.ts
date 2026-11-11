import { describe, expect, it } from 'vitest';
import { SCALE_LEVELS, SLOT_MIN_TICKS, buildScaleTable, createAttrSlot, createGate, createStyleSlot, createTextSlot, type Slot } from '../../../src/ui/slots';

interface Harness { name: string; make(): { slot: Slot; writes: () => number; last: () => string } }

const TABLE = Array.from({ length: 1000 }, (_, i) => `v${i}`);

const kinds: Harness[] = [
  {
    name: 'text',
    make() {
      let n = 0;
      let last = '';
      const target = {
        get data(): string { return last; },
        set data(v: string) { n++; last = v; },
      };
      return { slot: createTextSlot(target, (v) => `v${v}`), writes: () => n, last: () => last };
    },
  },
  {
    name: 'style',
    make() {
      let n = 0;
      let last = '';
      const slot = createStyleSlot({ setProperty(_p, v) { n++; last = v; } }, 'transform', TABLE);
      return { slot, writes: () => n, last: () => last };
    },
  },
  {
    name: 'attribute',
    make() {
      let n = 0;
      let last = '';
      const slot = createAttrSlot({ setAttribute(_a, v) { n++; last = v; } }, 'data-x', TABLE);
      return { slot, writes: () => n, last: () => last };
    },
  },
];

for (const kind of kinds) {
  describe(`${kind.name} slot`, () => {
    it('writes the first value at once, then not at all while it holds', () => {
      const { slot, writes, last } = kind.make();
      slot.set(0, 3);
      expect(writes()).toBe(1);
      expect(last()).toBe('v3');
      for (let t = 1; t < 500; t++) slot.set(t, 3);
      expect(writes()).toBe(1);
    });

    it('writes one change at once after 6 quiet ticks', () => {
      const { slot, writes, last } = kind.make();
      slot.set(0, 1);
      slot.set(6, 2);
      expect(writes()).toBe(2);
      expect(last()).toBe('v2');
      slot.set(100, 3);
      expect(writes()).toBe(3);
      expect(last()).toBe('v3');
    });

    it('writes at most once per 6 ticks under a change every tick', () => {
      const { slot, writes } = kind.make();
      for (let t = 0; t < 600; t++) slot.set(t, t % 997);
      expect(writes()).toBe(100);
      expect(writes()).toBeLessThanOrEqual(600 / SLOT_MIN_TICKS);
    });

    it('lets the final value land on a later frame', () => {
      const { slot, writes, last } = kind.make();
      slot.set(0, 1);
      slot.set(1, 2);
      slot.set(2, 3);
      expect(writes()).toBe(1);
      expect(last()).toBe('v1');
      slot.set(5, 3);
      expect(writes()).toBe(1);
      slot.set(6, 3);
      expect(writes()).toBe(2);
      expect(last()).toBe('v3');
    });

    it('is safe when the tick goes backwards', () => {
      const { slot, writes, last } = kind.make();
      slot.set(1000, 1);
      slot.set(10, 2);
      expect(writes()).toBe(2);
      expect(last()).toBe('v2');
      slot.set(11, 3);
      expect(writes()).toBe(2);
      slot.set(16, 3);
      expect(writes()).toBe(3);
    });
  });
}

describe('text slot', () => {
  it('formats only when it writes', () => {
    let formats = 0;
    const slot = createTextSlot({ data: '' }, (v) => { formats++; return String(v); });
    for (let t = 0; t < 100; t++) slot.set(t, 7);
    expect(formats).toBe(1);
  });

  it('a held NaN does not write every frame', () => {
    let formats = 0;
    const slot = createTextSlot({ data: '' }, (v) => { formats++; return String(v); });
    for (let t = 0; t < 100; t++) slot.set(t, NaN);
    expect(formats).toBe(1);
  });

  it('honours a longer minTicks', () => {
    let formats = 0;
    const slot = createTextSlot({ data: '' }, (v) => { formats++; return String(v); }, 60);
    for (let t = 0; t < 600; t++) slot.set(t, t);
    expect(formats).toBe(10);
  });
});

describe('createGate', () => {
  it('passes the first value even when it is 0, NaN or negative', () => {
    expect(createGate().pass(0, 0)).toBe(true);
    expect(createGate().pass(0, NaN)).toBe(true);
    expect(createGate().pass(-50, -1)).toBe(true);
  });
});

describe('buildScaleTable', () => {
  it('has 129 ascending strings from scaleX(0) to scaleX(1)', () => {
    const t = buildScaleTable();
    expect(t.length).toBe(SCALE_LEVELS + 1);
    expect(t.length).toBe(129);
    expect(t[0]).toBe('scaleX(0)');
    expect(t[128]).toBe('scaleX(1)');
    expect(new Set(t).size).toBe(129);
    let prev = -1;
    for (const s of t) {
      const m = /^scaleX\(([0-9.]+)\)$/.exec(s);
      expect(m, s).not.toBeNull();
      const v = Number(m![1]);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });
});
