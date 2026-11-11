import { describe, expect, it } from 'vitest';
import { bootReady, isLaunchKey, releasesMenuButton } from '../../../src/ui/gesture';

describe('releasesMenuButton (A21)', () => {
  it('every steering key and Space hands a focused II back', () => {
    for (const c of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Space']) {
      expect(releasesMenuButton(c), c).toBe(true);
    }
  });
  it('Enter, Tab, Escape, P, M and other keys keep it', () => {
    for (const c of ['Enter', 'NumpadEnter', 'Tab', 'Escape', 'KeyP', 'KeyM', 'KeyQ', 'ShiftLeft', '']) {
      expect(releasesMenuButton(c), c).toBe(false);
    }
  });
});

describe('bootReady (A26, DI-95)', () => {
  it('is true only once T10 reports running, or where nothing reports a boot', () => {
    expect(bootReady('running')).toBe(true);
    expect(bootReady(null)).toBe(true);
    for (const s of ['loading', 'failed', 'unsupported', '', 'Running']) expect(bootReady(s), s).toBe(false);
  });
});

describe('isLaunchKey', () => {
  const never = [
    'Tab', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight',
    'Escape', 'CapsLock', 'NumLock', 'ScrollLock', 'ContextMenu', 'PrintScreen', 'Pause',
    'F1', 'F2', 'F5', 'F10', 'F11', 'F12',
    'AudioVolumeUp', 'AudioVolumeMute', 'BrowserBack', 'BrowserRefresh', 'MediaPlayPause', 'MediaTrackNext',
    'KeyM', 'KeyP',
  ];
  for (const code of never) {
    it(`${code} does not launch`, () => {
      expect(isLaunchKey(code, false, false, false)).toBe(false);
    });
  }

  const launches = ['KeyA', 'KeyW', 'KeyZ', 'Space', 'Enter', 'ArrowUp', 'ArrowLeft', 'Digit1', 'Backspace', 'Slash', 'Numpad5'];
  for (const code of launches) {
    it(`${code} launches`, () => {
      expect(isLaunchKey(code, false, false, false)).toBe(true);
    });
  }

  it('no combination with Ctrl, Alt or Meta launches', () => {
    expect(isLaunchKey('KeyR', true, false, false)).toBe(false);
    expect(isLaunchKey('KeyA', false, true, false)).toBe(false);
    expect(isLaunchKey('KeyA', false, false, true)).toBe(false);
  });
});
