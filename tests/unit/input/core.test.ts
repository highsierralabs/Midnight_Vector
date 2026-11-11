import { beforeEach, describe, expect, it } from 'vitest';
import type { ControlFrame } from '../../../src/contracts/index';
import { createInputCore, type InputCore, type PointerKind } from '../../../src/input/core';

const W = 1000;
const H = 500;
const MIN = 500;

let core: InputCore;

function frame(): ControlFrame {
  const out: ControlFrame = { moveX: NaN, moveY: NaN, absolute: true, boost: true, human: true };
  core.sample(out);
  return out;
}

beforeEach(() => {
  core = createInputCore();
  core.resize(W, H);
});

describe('no device used yet', () => {
  it('reads as rate zero with nothing human', () => {
    expect(frame()).toEqual({ moveX: 0, moveY: 0, absolute: false, boost: false, human: false });
  });
});

describe('keyboard', () => {
  const cases: [string, number, number][] = [
    ['KeyW', 0, 1], ['ArrowUp', 0, 1],
    ['KeyS', 0, -1], ['ArrowDown', 0, -1],
    ['KeyA', -1, 0], ['ArrowLeft', -1, 0],
    ['KeyD', 1, 0], ['ArrowRight', 1, 0],
  ];
  for (const [code, x, y] of cases) {
    it(`${code} steers with the right sign, up positive`, () => {
      expect(core.key(code, true)).toBe(true);
      const f = frame();
      expect(f.absolute).toBe(false);
      expect(f.moveX).toBe(x);
      expect(f.moveY).toBe(y);
      expect(f.human).toBe(true);
    });
  }

  it('opposite keys cancel', () => {
    core.key('KeyA', true);
    core.key('ArrowRight', true);
    core.key('KeyW', true);
    core.key('KeyS', true);
    const f = frame();
    expect(f.moveX).toBe(0);
    expect(f.moveY).toBe(0);
    expect(f.absolute).toBe(false);
  });

  it('a diagonal is not normalised', () => {
    core.key('KeyD', true);
    core.key('KeyW', true);
    const f = frame();
    expect(f.moveX).toBe(1);
    expect(f.moveY).toBe(1);
  });

  it('two keys for one direction survive releasing either', () => {
    core.key('KeyW', true);
    core.key('ArrowUp', true);
    core.key('KeyW', false);
    expect(frame().moveY).toBe(1);
    core.key('ArrowUp', false);
    expect(frame().moveY).toBe(0);
  });

  it('Space boosts and does not steer', () => {
    core.key('Space', true);
    const f = frame();
    expect(f.boost).toBe(true);
    expect(f.moveX).toBe(0);
    expect(f.human).toBe(true);
    core.key('Space', false);
    expect(frame().boost).toBe(false);
  });

  it('a key release clears the rate, and the release itself counts once as human', () => {
    core.key('KeyD', true);
    frame();
    core.key('KeyD', false);
    const f = frame();
    expect(f.moveX).toBe(0);
    expect(f.absolute).toBe(false);
    expect(f.human).toBe(true);
    expect(frame().human).toBe(false);
  });

  it('human stays true while a key is held', () => {
    core.key('KeyD', true);
    expect(frame().human).toBe(true);
    expect(frame().human).toBe(true);
  });

  it('an unhandled code reports false and is not human', () => {
    expect(core.key('KeyM', true)).toBe(false);
    expect(frame().human).toBe(false);
  });

  it('a release for a key this core never saw pressed is not human', () => {
    expect(core.key('ArrowLeft', false)).toBe(true);
    expect(frame().human).toBe(false);
  });
});

describe('mouse', () => {
  it('centre is 0, 0 and absolute', () => {
    core.pointerMove(1, 'mouse', W / 2, H / 2);
    const f = frame();
    expect(f.absolute).toBe(true);
    expect(f.moveX).toBeCloseTo(0, 12);
    expect(f.moveY).toBeCloseTo(0, 12);
  });

  it('10% and 90% of the width reach full deflection, beyond them it clamps', () => {
    core.pointerMove(1, 'mouse', 0.1 * W, H / 2);
    expect(frame().moveX).toBeCloseTo(-1, 12);
    core.pointerMove(1, 'mouse', 0.9 * W, H / 2);
    expect(frame().moveX).toBeCloseTo(1, 12);
    core.pointerMove(1, 'mouse', 0, H / 2);
    expect(frame().moveX).toBe(-1);
    core.pointerMove(1, 'mouse', W, H / 2);
    expect(frame().moveX).toBe(1);
  });

  it('the top of the element is moveY 1, the bottom -1', () => {
    core.pointerMove(1, 'mouse', W / 2, 0);
    expect(frame().moveY).toBe(1);
    core.pointerMove(1, 'mouse', W / 2, H);
    expect(frame().moveY).toBe(-1);
  });

  it('a resting mouse is human on the move and not after', () => {
    core.pointerMove(1, 'mouse', W / 2, H / 2);
    expect(frame().human).toBe(true);
    const rest = frame();
    expect(rest.human).toBe(false);
    expect(rest.absolute).toBe(true);
  });

  it('a steer key overrides the pointer, release gives rate zero, a pointer move returns to absolute', () => {
    core.pointerMove(1, 'mouse', 0.9 * W, H / 2);
    frame();
    core.key('KeyA', true);
    let f = frame();
    expect(f.absolute).toBe(false);
    expect(f.moveX).toBe(-1);

    core.pointerMove(1, 'mouse', 0.1 * W, H / 2);
    f = frame();
    expect(f.absolute).toBe(false);
    expect(f.moveX).toBe(-1);

    core.key('KeyA', false);
    f = frame();
    expect(f.absolute).toBe(false);
    expect(f.moveX).toBe(0);
    expect(f.moveY).toBe(0);

    core.pointerMove(1, 'mouse', 0.9 * W, H / 2);
    f = frame();
    expect(f.absolute).toBe(true);
    expect(f.moveX).toBeCloseTo(1, 12);
  });

  it('button 0 boosts and button 2 does not, though both are human', () => {
    core.pointerDown(1, 'mouse', 2, 10, 10);
    let f = frame();
    expect(f.boost).toBe(false);
    expect(f.human).toBe(true);
    core.pointerUp(1);
    frame();

    core.pointerDown(1, 'mouse', 0, 10, 10);
    f = frame();
    expect(f.boost).toBe(true);
    expect(frame().human).toBe(true);
    core.pointerUp(1);
    f = frame();
    expect(f.boost).toBe(false);
    expect(frame().human).toBe(false);
  });

  it('a press alone does not jump to absolute after keyboard use', () => {
    core.key('KeyA', true);
    frame();
    core.key('KeyA', false);
    frame();
    core.pointerDown(1, 'mouse', 0, 5, 5);
    const f = frame();
    expect(f.absolute).toBe(false);
    expect(f.moveX).toBe(0);
  });

  it('a chord reported through mouseLeft boosts and releases', () => {
    core.pointerDown(1, 'mouse', 2, 10, 10);
    core.mouseLeft(true);
    expect(frame().boost).toBe(true);
    core.mouseLeft(false);
    expect(frame().boost).toBe(false);
  });
});

describe('touch', () => {
  const FINGER: PointerKind = 'touch';

  it('finger down moves nothing', () => {
    core.pointerDown(7, FINGER, 0, 300, 300);
    const f = frame();
    expect(f.moveX).toBe(0);
    expect(f.moveY).toBe(0);
    expect(f.absolute).toBe(false);
    expect(f.human).toBe(true);
    expect(f.boost).toBe(false);
  });

  it('a drag of 0.3 * minDim right adds exactly 1, then clamps', () => {
    core.pointerDown(7, FINGER, 0, 100, 100);
    core.pointerMove(7, FINGER, 100 + 0.3 * MIN, 100);
    let f = frame();
    expect(f.absolute).toBe(true);
    expect(f.moveX).toBeCloseTo(1, 12);
    expect(f.moveY).toBeCloseTo(0, 12);
    core.pointerMove(7, FINGER, 100 + 0.9 * MIN, 100);
    f = frame();
    expect(f.moveX).toBe(1);
  });

  it('a drag up raises y, and a drag down lowers it', () => {
    core.pointerDown(7, FINGER, 0, 100, 300);
    core.pointerMove(7, FINGER, 100, 300 - 0.15 * MIN);
    expect(frame().moveY).toBeCloseTo(0.5, 12);
    core.pointerMove(7, FINGER, 100, 300 + 0.15 * MIN);
    expect(frame().moveY).toBeCloseTo(-0.5, 12);
  });

  it('a finger lift holds the target, with human false after the lift has been seen', () => {
    core.pointerDown(7, FINGER, 0, 100, 100);
    core.pointerMove(7, FINGER, 100 + 0.15 * MIN, 100);
    frame();
    core.pointerUp(7);
    expect(frame().human).toBe(true);
    const f = frame();
    expect(f.absolute).toBe(true);
    expect(f.moveX).toBeCloseTo(0.5, 12);
    expect(f.human).toBe(false);
  });

  it('a new finger continues from the old target with no jump', () => {
    core.pointerDown(7, FINGER, 0, 100, 100);
    core.pointerMove(7, FINGER, 100 + 0.15 * MIN, 100);
    core.pointerUp(7);
    frame();
    core.pointerDown(8, FINGER, 0, 900, 400);
    expect(frame().moveX).toBeCloseTo(0.5, 12);
    core.pointerMove(8, FINGER, 900 + 0.03 * MIN, 400);
    expect(frame().moveX).toBeCloseTo(0.6, 12);
  });

  it('a second finger boosts and does not steer', () => {
    core.pointerDown(7, FINGER, 0, 100, 100);
    core.pointerDown(8, FINGER, 0, 800, 400);
    let f = frame();
    expect(f.boost).toBe(true);
    core.pointerMove(8, FINGER, 900, 200);
    f = frame();
    expect(f.moveX).toBe(0);
    expect(f.moveY).toBe(0);
  });

  it('the first lift hands steering to the second with no jump and no boost', () => {
    core.pointerDown(7, FINGER, 0, 100, 100);
    core.pointerMove(7, FINGER, 100 + 0.15 * MIN, 100);
    core.pointerDown(8, FINGER, 0, 800, 400);
    core.pointerMove(8, FINGER, 820, 390);
    frame();
    core.pointerUp(7);
    let f = frame();
    expect(f.boost).toBe(false);
    expect(f.moveX).toBeCloseTo(0.5, 12);
    expect(f.moveY).toBeCloseTo(0, 12);
    core.pointerMove(8, FINGER, 820 + 0.03 * MIN, 390);
    f = frame();
    expect(f.moveX).toBeCloseTo(0.6, 12);
  });

  it('a third finger changes nothing', () => {
    core.pointerDown(7, FINGER, 0, 100, 100);
    core.pointerDown(8, FINGER, 0, 800, 400);
    const before = frame();
    core.pointerDown(9, FINGER, 0, 500, 200);
    core.pointerMove(9, FINGER, 700, 100);
    const after = frame();
    expect(after).toEqual(before);
  });

  it('a sixth finger is ignored and its lift is harmless', () => {
    for (let i = 0; i < 6; i++) core.pointerDown(i, FINGER, 0, i, i);
    core.pointerUp(5);
    for (let i = 0; i < 5; i++) core.pointerUp(i);
    frame();
    expect(frame().human).toBe(false);
  });

  it('a pen drags like a finger, and a hovering pen does nothing', () => {
    core.pointerMove(3, 'pen', 500, 200);
    let f = frame();
    expect(f.absolute).toBe(false);
    expect(f.human).toBe(false);
    core.pointerDown(3, 'pen', 0, 100, 100);
    core.pointerMove(3, 'pen', 100 + 0.15 * MIN, 100);
    f = frame();
    expect(f.absolute).toBe(true);
    expect(f.moveX).toBeCloseTo(0.5, 12);
  });
});

describe('boost button', () => {
  it('boosts independently and is not a steer finger', () => {
    core.boostButton(11, true);
    let f = frame();
    expect(f.boost).toBe(true);
    expect(f.human).toBe(true);
    expect(f.absolute).toBe(false);
    core.pointerDown(12, 'touch', 0, 100, 100);
    core.pointerMove(12, 'touch', 100 + 0.15 * MIN, 100);
    f = frame();
    expect(f.moveX).toBeCloseTo(0.5, 12);
    core.boostButton(11, false);
    f = frame();
    expect(f.boost).toBe(false);
    expect(f.moveX).toBeCloseTo(0.5, 12);
  });

  it('two fingers on the button must both lift', () => {
    core.boostButton(11, true);
    core.boostButton(12, true);
    core.boostButton(11, false);
    expect(frame().boost).toBe(true);
    core.boostButton(12, false);
    expect(frame().boost).toBe(false);
  });

  it('a pointer that never pressed the button does nothing', () => {
    core.boostButton(99, false);
    expect(frame().human).toBe(false);
  });
});

describe('clear', () => {
  it('drops every held key, button and finger, and the pending flag', () => {
    core.key('KeyD', true);
    core.key('Space', true);
    core.pointerDown(1, 'mouse', 0, 1, 1);
    core.pointerDown(7, 'touch', 0, 1, 1);
    core.pointerDown(8, 'touch', 0, 2, 2);
    core.boostButton(11, true);
    core.clear();
    expect(frame()).toEqual({ moveX: 0, moveY: 0, absolute: false, boost: false, human: false });
  });

  it('a finger lift after clear is harmless', () => {
    core.pointerDown(7, 'touch', 0, 1, 1);
    core.clear();
    core.pointerUp(7);
    expect(frame().human).toBe(false);
  });
});

describe('sizes', () => {
  it('resize(0, 0) gives finite output for mouse and touch', () => {
    core.resize(0, 0);
    core.pointerMove(1, 'mouse', 10, 10);
    let f = frame();
    expect(Number.isFinite(f.moveX)).toBe(true);
    expect(Number.isFinite(f.moveY)).toBe(true);
    core.pointerDown(7, 'touch', 0, 10, 10);
    core.pointerMove(7, 'touch', 20, 20);
    f = frame();
    expect(Number.isFinite(f.moveX)).toBe(true);
    expect(Number.isFinite(f.moveY)).toBe(true);
  });

  it('minDim follows the shorter side', () => {
    core.resize(200, 800);
    core.pointerDown(7, 'touch', 0, 0, 0);
    core.pointerMove(7, 'touch', 0.3 * 200, 0);
    expect(frame().moveX).toBeCloseTo(1, 12);
  });
});

describe('fuzz', () => {
  it('1e5 seeded events keep moveX and moveY finite in [-1, 1], and never throw', () => {
    // A small LCG, so a failure reproduces.
    let s = 12345;
    const next = (): number => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const specials = [NaN, Infinity, -Infinity, 0, -0, 1e308, -1e308];
    const coord = (): number => (next() < 0.02 ? specials[Math.floor(next() * specials.length)]! : (next() - 0.25) * 3000);
    const codes = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyM', 'Tab'];
    const kinds: PointerKind[] = ['mouse', 'touch', 'pen'];
    const out: ControlFrame = { moveX: 0, moveY: 0, absolute: false, boost: false, human: false };
    for (let i = 0; i < 100_000; i++) {
      const r = next();
      const id = Math.floor(next() * 8);
      const kind = kinds[Math.floor(next() * kinds.length)]!;
      if (r < 0.2) core.key(codes[Math.floor(next() * codes.length)]!, next() < 0.5);
      else if (r < 0.35) core.pointerDown(id, kind, Math.floor(next() * 3), coord(), coord());
      else if (r < 0.75) core.pointerMove(id, kind, coord(), coord());
      else if (r < 0.9) core.pointerUp(id);
      else if (r < 0.94) core.boostButton(id, next() < 0.5);
      else if (r < 0.97) core.resize(next() < 0.1 ? 0 : next() * 4000, next() < 0.1 ? 0 : next() * 2000);
      else if (r < 0.98) core.clear();
      else core.mouseLeft(next() < 0.5);
      core.sample(out);
      expect(Number.isFinite(out.moveX)).toBe(true);
      expect(Number.isFinite(out.moveY)).toBe(true);
      expect(Math.abs(out.moveX)).toBeLessThanOrEqual(1);
      expect(Math.abs(out.moveY)).toBeLessThanOrEqual(1);
    }
  });
});
