import { describe, expect, it } from 'vitest';
import { SimMode } from '../../../src/contracts/index';
import { MODE_NAMES, Panel, buildViewTable, deriveView, hudHidden, hudInert, menuHidden } from '../../../src/ui/view';

const { DEMO, PLAY, CRUISE, SIGNAL_LOST } = SimMode;
const { TITLE, HUD, MENU, LOST, AUTO, CTX } = Panel;

describe('deriveView', () => {
  const cases: [SimMode, boolean, boolean, number][] = [
    [DEMO, false, false, TITLE],
    [DEMO, true, false, TITLE],
    [DEMO, false, true, TITLE | CTX],
    [DEMO, true, true, TITLE | CTX],
    [PLAY, false, false, HUD],
    [PLAY, true, false, HUD | AUTO],
    [PLAY, false, true, HUD | CTX],
    [PLAY, true, true, HUD | AUTO | CTX],
    [CRUISE, false, false, HUD | MENU],
    [CRUISE, true, false, HUD | MENU],
    [CRUISE, false, true, HUD | MENU | CTX],
    [CRUISE, true, true, HUD | MENU | CTX],
    [SIGNAL_LOST, false, false, HUD | LOST],
    [SIGNAL_LOST, true, false, HUD | LOST],
    [SIGNAL_LOST, false, true, HUD | LOST | CTX],
    [SIGNAL_LOST, true, true, HUD | LOST | CTX],
  ];
  for (const [mode, auto, lost, expected] of cases) {
    it(`mode ${mode}, autopilot ${auto}, lost ${lost}`, () => {
      expect(deriveView(mode, auto, lost)).toBe(expected);
    });
  }
});

describe('reach of the warm panels (D-012)', () => {
  // [mode, hud aria-hidden, hud inert, menu inert and aria-hidden], for every autopilot and lost combination.
  const cases: [SimMode, boolean, boolean, boolean][] = [
    [DEMO, true, true, true],
    [PLAY, false, false, true],
    [CRUISE, false, true, false],
    [SIGNAL_LOST, false, false, true],
  ];
  for (const [mode, hidden, inert, menu] of cases) {
    for (const auto of [false, true]) {
      for (const lost of [false, true]) {
        it(`mode ${mode}, autopilot ${auto}, lost ${lost}`, () => {
          const mask = deriveView(mode, auto, lost);
          expect(hudHidden(mask)).toBe(hidden);
          expect(hudInert(mask)).toBe(inert);
          expect(menuHidden(mask)).toBe(menu);
        });
      }
    }
  }

  it('a hidden HUD is always inert, and the menu is reachable only when open', () => {
    for (let mask = 0; mask < 64; mask++) {
      if (hudHidden(mask)) expect(hudInert(mask)).toBe(true);
      expect(menuHidden(mask)).toBe((mask & MENU) === 0);
    }
  });
});

describe('tables', () => {
  it('has one data-view string per mask, naming each set bit', () => {
    const t = buildViewTable();
    expect(t.length).toBe(64);
    expect(t[0]).toBe('');
    expect(t[TITLE]).toBe('title');
    expect(t[HUD | MENU]).toBe('hud menu');
    expect(t[HUD | AUTO | CTX]).toBe('hud auto ctx');
    expect(t[HUD | LOST]).toBe('hud lost');
    expect(new Set(t).size).toBe(64);
  });

  it('names modes in SimMode order', () => {
    expect(MODE_NAMES[DEMO]).toBe('demo');
    expect(MODE_NAMES[PLAY]).toBe('play');
    expect(MODE_NAMES[CRUISE]).toBe('cruise');
    expect(MODE_NAMES[SIGNAL_LOST]).toBe('lost');
  });
});
