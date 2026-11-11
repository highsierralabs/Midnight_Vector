import { describe, expect, it } from 'vitest';
import { BOOST_MASK, DOWN_MASK, LEFT_MASK, RIGHT_MASK, STEER_MASK, UP_MASK, keepsKey, keyBit } from '../../../src/input/keys';

const STEER = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'];
const WASD = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
const ARROWS = ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'];

describe('keepsKey (A21, VI-game)', () => {
  it('a button, a checkbox and a button-like input keep Space and Enter, and nothing that steers', () => {
    for (const [tag, type] of [['BUTTON', ''], ['INPUT', 'checkbox'], ['INPUT', 'button'], ['INPUT', 'submit'], ['INPUT', 'reset']] as const) {
      for (const c of ['Space', 'Enter', 'NumpadEnter']) expect(keepsKey(tag, type, false, c), `${tag} ${type} ${c}`).toBe(true);
      for (const c of STEER) expect(keepsKey(tag, type, false, c), `${tag} ${type} ${c}`).toBe(false);
    }
  });

  it('a radio keeps Space, Enter and its arrows, and WASD steers', () => {
    for (const c of ['Space', 'Enter', ...ARROWS]) expect(keepsKey('INPUT', 'radio', false, c), c).toBe(true);
    for (const c of WASD) expect(keepsKey('INPUT', 'radio', false, c), c).toBe(false);
  });

  it('a slider, a text field, a select, a textarea and editable text keep every key', () => {
    for (const [tag, type, editable] of [['INPUT', 'range', false], ['INPUT', 'text', false], ['SELECT', '', false], ['TEXTAREA', '', false], ['DIV', '', true], ['BUTTON', '', true]] as const) {
      for (const c of [...STEER, 'Space']) expect(keepsKey(tag, type, editable, c), `${tag} ${type} ${c}`).toBe(true);
    }
  });

  it('the page itself and any other element keep nothing', () => {
    for (const tag of ['BODY', 'HTML', 'DIV', 'CANVAS', 'SECTION']) {
      for (const c of [...STEER, 'Space']) expect(keepsKey(tag, '', false, c), `${tag} ${c}`).toBe(false);
    }
  });
});

describe('keyBit', () => {
  it('maps each steering code to its direction', () => {
    for (const c of ['KeyW', 'ArrowUp']) expect(keyBit(c) & UP_MASK, c).not.toBe(0);
    for (const c of ['KeyS', 'ArrowDown']) expect(keyBit(c) & DOWN_MASK, c).not.toBe(0);
    for (const c of ['KeyA', 'ArrowLeft']) expect(keyBit(c) & LEFT_MASK, c).not.toBe(0);
    for (const c of ['KeyD', 'ArrowRight']) expect(keyBit(c) & RIGHT_MASK, c).not.toBe(0);
  });

  it('maps Space to boost and not to steering', () => {
    expect(keyBit('Space') & BOOST_MASK).not.toBe(0);
    expect(keyBit('Space') & STEER_MASK).toBe(0);
  });

  it('gives every key its own bit', () => {
    const codes = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Space'];
    const bits = new Set(codes.map(keyBit));
    expect(bits.size).toBe(codes.length);
    for (const b of bits) expect(b).toBeGreaterThan(0);
  });

  it('does not handle what src/ui handles, or anything else', () => {
    for (const c of ['Escape', 'KeyP', 'KeyM', 'Tab', 'Enter', 'KeyQ', 'toString', 'constructor', '']) {
      expect(keyBit(c), c).toBe(0);
    }
  });
});
