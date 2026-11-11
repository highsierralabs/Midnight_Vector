import { describe, expect, it } from 'vitest';
import { BESTS_KEY, SETTINGS_KEY, createBestsTracker, defaultSettings, loadBests, loadSettings, saveSettings, shouldRecord, type StoreLike } from '../../../src/ui/storage';

function memory(): StoreLike & { data: Map<string, string>; sets: number } {
  const data = new Map<string, string>();
  return {
    data,
    sets: 0,
    getItem(k) { return data.get(k) ?? null; },
    setItem(k, v) { this.sets++; data.set(k, v); },
  };
}

const throwing: StoreLike = {
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('QuotaExceededError'); },
};

describe('settings', () => {
  it('defaults when nothing is stored', () => {
    expect(loadSettings(memory())).toEqual({ music: 0.8, sfx: 0.8, muted: false, quality: 'auto', reduced: null, hideHud: false });
  });

  it('round trips', () => {
    const s = memory();
    const v = { music: 0.25, sfx: 0.5, muted: true, quality: 2 as const, reduced: false, hideHud: true };
    saveSettings(s, v);
    expect(loadSettings(s)).toEqual(v);
    expect(JSON.parse(s.data.get(SETTINGS_KEY)!)).toEqual(v);
  });

  // Amendment FH, A28: hideHud is additive, so a store written before FH loads with the HUD shown (FH-15).
  it('U1: the exact pre-FH string loads with hideHud false', () => {
    const s = memory();
    s.data.set(SETTINGS_KEY, '{"music":0.8,"sfx":0.8,"muted":false,"quality":"auto","reduced":null}');
    expect(loadSettings(s)).toEqual({ music: 0.8, sfx: 0.8, muted: false, quality: 'auto', reduced: null, hideHud: false });
  });

  it('U2: a non-boolean hideHud loads false, and the saved object has exactly six keys', () => {
    for (const bad of ['"yes"', '1', 'null']) {
      const s = memory();
      s.data.set(SETTINGS_KEY, `{"hideHud":${bad}}`);
      expect(loadSettings(s).hideHud, bad).toBe(false);
    }
    const s = memory();
    saveSettings(s, { ...defaultSettings(), hideHud: true });
    const saved = JSON.parse(s.data.get(SETTINGS_KEY)!) as Record<string, unknown>;
    expect(Object.keys(saved).sort()).toEqual(['hideHud', 'music', 'muted', 'quality', 'reduced', 'sfx']);
    expect(saved['hideHud']).toBe(true);
  });

  it('corrupt JSON gives defaults', () => {
    const s = memory();
    s.data.set(SETTINGS_KEY, '{not json');
    expect(loadSettings(s)).toEqual(defaultSettings());
  });

  it('JSON of the wrong shape gives defaults', () => {
    for (const bad of ['null', '7', '"x"', '[]', '{"music":"loud","sfx":null,"muted":1,"quality":"ultra","reduced":"yes"}']) {
      const s = memory();
      s.data.set(SETTINGS_KEY, bad);
      expect(loadSettings(s), bad).toEqual(defaultSettings());
    }
  });

  it('a throwing store gives defaults and does not throw', () => {
    expect(loadSettings(throwing)).toEqual(defaultSettings());
    expect(() => { saveSettings(throwing, defaultSettings()); }).not.toThrow();
  });

  it('clamps volume', () => {
    const s = memory();
    s.data.set(SETTINGS_KEY, '{"music":5,"sfx":-2}');
    const v = loadSettings(s);
    expect(v.music).toBe(1);
    expect(v.sfx).toBe(0);
  });

  it('unknown quality is auto, and each tier survives', () => {
    for (const q of [5, -1, 1.5, 'high', null]) {
      const s = memory();
      s.data.set(SETTINGS_KEY, JSON.stringify({ quality: q }));
      expect(loadSettings(s).quality, String(q)).toBe('auto');
    }
    for (const q of [0, 1, 2, 3, 4]) {
      const s = memory();
      s.data.set(SETTINGS_KEY, JSON.stringify({ quality: q }));
      expect(loadSettings(s).quality).toBe(q);
    }
  });
});

describe('bests', () => {
  it('default to zero, and bad values read as zero', () => {
    expect(loadBests(memory())).toEqual({ score: 0, km: 0 });
    expect(loadBests(throwing)).toEqual({ score: 0, km: 0 });
    const s = memory();
    s.data.set(BESTS_KEY, '{"score":-5,"km":"far"}');
    expect(loadBests(s)).toEqual({ score: 0, km: 0 });
  });

  it('never fall', () => {
    const s = memory();
    s.data.set(BESTS_KEY, '{"score":1000,"km":5}');
    const t = createBestsTracker(s);
    t.update(0, 10, [1000], 0);
    t.flush();
    expect(t.current).toEqual({ score: 1000, km: 5 });
    expect(loadBests(s)).toEqual({ score: 1000, km: 5 });
    expect(s.sets).toBe(0);
  });

  it('rise independently and round trip', () => {
    const s = memory();
    const t = createBestsTracker(s);
    t.update(0, 500, [1000], 0);
    t.update(1000, 400, [2000], 0);
    expect(loadBests(s)).toEqual({ score: 500, km: 2 });
  });

  it('write at most once per 600 ticks while rising, and flush the rest', () => {
    const s = memory();
    const t = createBestsTracker(s);
    for (let tick = 0; tick < 1200; tick++) t.update(tick, tick + 1, [0], 0);
    expect(s.sets).toBe(2);
    expect(loadBests(s).score).toBe(601);
    t.flush();
    expect(s.sets).toBe(3);
    expect(loadBests(s).score).toBe(1200);
    t.flush();
    expect(s.sets).toBe(3);
  });

  it('shouldRecord is false once warpSerial is non-zero', () => {
    expect(shouldRecord(0)).toBe(true);
    expect(shouldRecord(1)).toBe(false);
    expect(shouldRecord(99)).toBe(false);
  });

  it('a warp bars every write from then on, even when warpSerial looks clean again', () => {
    const s = memory();
    const t = createBestsTracker(s);
    t.update(0, 100, [1000], 0);
    expect(s.sets).toBe(1);
    t.update(1000, 200, [2000], 0);
    expect(s.sets).toBe(2);
    t.update(1001, 300, [3000], 0);
    t.update(1002, 9999, [9000], 1);
    t.flush();
    t.update(5000, 9999, [9000], 0);
    t.flush();
    expect(s.sets).toBe(2);
    expect(loadBests(s)).toEqual({ score: 200, km: 2 });
  });

  it('a throwing store does not stop the tracker', () => {
    const t = createBestsTracker(throwing);
    expect(() => { t.update(0, 10, [1000], 0); t.flush(); }).not.toThrow();
    expect(t.current.score).toBe(10);
  });

  it('survives a tick that goes backwards', () => {
    const s = memory();
    const t = createBestsTracker(s);
    t.update(5000, 1, [0], 0);
    t.update(10, 2, [0], 0);
    expect(s.sets).toBe(2);
  });
});
