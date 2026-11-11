import { describe, expect, it } from 'vitest';
import { Ev } from '../../../src/contracts/index';
import { PopupKind, gradeLetter, popupKind, popupText } from '../../../src/ui/events';

describe('events table', () => {
  it('SHARD makes no popup, whatever its value', () => {
    expect(popupKind(Ev.SHARD, 100)).toBe(PopupKind.NONE);
    expect(popupKind(Ev.SHARD, 0)).toBe(PopupKind.NONE);
  });

  it('GATE and GRAZE show their points, and value 0 is cosmetic', () => {
    expect(popupKind(Ev.GATE, 500)).toBe(PopupKind.GAIN);
    expect(popupText(Ev.GATE, 500, 0)).toBe('+500');
    expect(popupKind(Ev.GATE, 0)).toBe(PopupKind.NONE);
    expect(popupKind(Ev.GRAZE, 50)).toBe(PopupKind.GRAZE);
    expect(popupText(Ev.GRAZE, 50, 0)).toBe('GRAZE +50');
    expect(popupKind(Ev.GRAZE, 0)).toBe(PopupKind.NONE);
  });

  it('GATE_MISS, HIT and GRADE have fixed text', () => {
    expect(popupKind(Ev.GATE_MISS, 0)).toBe(PopupKind.MISS);
    expect(popupText(Ev.GATE_MISS, 0, 0)).toBe('MISS');
    expect(popupKind(Ev.HIT, 2)).toBe(PopupKind.HIT);
    expect(popupText(Ev.HIT, 2, 0)).toBe('HIT');
    expect(popupKind(Ev.GRADE, 1000)).toBe(PopupKind.GRADE);
    expect(popupText(Ev.GRADE, 1000, 0)).toBe('GRADE S');
    expect(popupText(Ev.GRADE, 1000, 1)).toBe('GRADE A');
    expect(popupText(Ev.GRADE, 1000, 2)).toBe('GRADE B');
    expect(popupText(Ev.GRADE, 1000, 3)).toBe('GRADE C');
  });

  it('the rest make none', () => {
    for (const k of [Ev.SIGNAL_LOST, Ev.SECTOR, Ev.BOOST_ON, Ev.BOOST_OFF, 0, 99]) {
      expect(popupKind(k, 5), String(k)).toBe(PopupKind.NONE);
      expect(popupText(k, 5, 0), String(k)).toBe('');
    }
  });

  it('a Float32 value prints as a whole number', () => {
    expect(popupText(Ev.GATE, 1600.0000000001, 0)).toBe('+1600');
  });

  it('an unknown rank is visible rather than wrong', () => {
    expect(gradeLetter(9)).toBe('?');
  });
});
