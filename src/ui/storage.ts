// Bests and settings over an injected store. Every access is in try/catch, since private modes and blocked storage throw
// on read as well as on write (Agents.md). Bad data gives defaults and never an exception.
import type { Tier } from '../contracts/index';

export interface StoreLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const BESTS_KEY = 'mv.bests.v1';
export const SETTINGS_KEY = 'mv.settings.v1';

/** At 120 ticks per second, one bests write per 5 s while they rise, plus pagehide (DI-52). */
export const BESTS_MIN_TICKS = 600;

export interface Settings {
  music: number; sfx: number; muted: boolean;
  quality: Tier | 'auto';
  /** null follows the OS. */
  reduced: boolean | null;
  /** HIDE HUD (amendment FH). Absent or not a boolean in a stored object loads false, so a store from before FH loads as it was. */
  hideHud: boolean;
}
export interface Bests { score: number; km: number }

export function defaultSettings(): Settings {
  return { music: 0.8, sfx: 0.8, muted: false, quality: 'auto', reduced: null, hideHud: false };
}

function read(store: StoreLike, key: string): unknown {
  try {
    const raw = store.getItem(key);
    return raw === null ? null : JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function write(store: StoreLike, key: string, value: unknown): void {
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // Full or blocked storage: the game runs on, and the value just does not persist.
  }
}

function field(o: unknown, name: string): unknown {
  return typeof o === 'object' && o !== null ? (o as Record<string, unknown>)[name] : undefined;
}

function volume(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function quality(v: unknown): Tier | 'auto' {
  return v === 0 || v === 1 || v === 2 || v === 3 || v === 4 ? v : 'auto';
}

export function loadSettings(store: StoreLike): Settings {
  const d = defaultSettings();
  const o = read(store, SETTINGS_KEY);
  const muted = field(o, 'muted');
  const reduced = field(o, 'reduced');
  const hideHud = field(o, 'hideHud');
  return {
    music: volume(field(o, 'music'), d.music),
    sfx: volume(field(o, 'sfx'), d.sfx),
    muted: typeof muted === 'boolean' ? muted : d.muted,
    quality: quality(field(o, 'quality')),
    reduced: typeof reduced === 'boolean' ? reduced : null,
    hideHud: typeof hideHud === 'boolean' ? hideHud : d.hideHud,
  };
}

export function saveSettings(store: StoreLike, s: Readonly<Settings>): void {
  write(store, SETTINGS_KEY, { music: s.music, sfx: s.sfx, muted: s.muted, quality: s.quality, reduced: s.reduced, hideHud: s.hideHud });
}

function best(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

export function loadBests(store: StoreLike): Bests {
  const o = read(store, BESTS_KEY);
  return { score: best(field(o, 'score')), km: best(field(o, 'km')) };
}

/** A harness warp disqualifies the run, so a test cannot poison a real best. */
export function shouldRecord(warpSerial: number): boolean {
  return warpSerial === 0;
}

export interface BestsTracker {
  readonly current: Readonly<Bests>;
  /** Raises the bests from run[0], distance in u, and writes at most once per BESTS_MIN_TICKS while they rise. Allocates only when it writes. */
  update(tick: number, score: number, run: ArrayLike<number>, warpSerial: number): void;
  /** For pagehide and the fatal page. A no-op unless something is unsaved. */
  flush(): void;
}

export function createBestsTracker(store: StoreLike, minTicks: number = BESTS_MIN_TICKS): BestsTracker {
  const current = loadBests(store);
  let dirty = false;
  let barred = false;
  let lastWrite = -Infinity;

  function flush(): void {
    if (!dirty || barred) return;
    dirty = false;
    write(store, BESTS_KEY, { score: current.score, km: current.km });
  }

  return {
    current,
    update(tick, score, run, warpSerial) {
      if (!shouldRecord(warpSerial)) {
        barred = true;
        return;
      }
      if (barred) return;
      if (score > current.score) { current.score = score; dirty = true; }
      const km = run[0]! / 1000;
      if (km > current.km) { current.km = km; dirty = true; }
      if (!dirty) return;
      if (tick < lastWrite) lastWrite = -Infinity;
      if (tick - lastWrite < minTicks) return;
      lastWrite = tick;
      flush();
    },
    flush,
  };
}
