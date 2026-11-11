// HUD strings. Pure, no locale API, and every format stays within its box at 1e15 u.
import { Objective, PALETTE_COUNT, PALETTE_NAMES } from '../contracts/index';

/** Score has this many characters or more, so the HUD uses its long size. */
export const SCORE_LONG_AT = 1e8;

export function formatScore(score: number): string {
  if (!Number.isFinite(score)) return '--------';
  const s = score < 0 ? 0 : Math.floor(score);
  if (s < 1e10) return String(s).padStart(8, '0');
  return s.toExponential(3).toUpperCase();
}

export const KM_EXPONENT_AT_U = 1e9;   // 1e6 km

/** floor(x * 10) / 10 as text, built from integers so that binary fractions cannot round it up. */
function tenths(t: number): string {
  const whole = Math.floor(t / 10);
  return `${whole}.${t - whole * 10}`;
}

/** The four significant digits of km, floored and as an integer, so binary fractions cannot round it up. */
function exponentKm(u: number): string {
  const km = u / 1000;
  let e = Math.floor(Math.log10(km));
  let q = Math.floor(km / Math.pow(10, e - 3));
  if (q >= 10000) { e += 1; q = Math.floor(km / Math.pow(10, e - 3)); }
  if (q < 1000) { e -= 1; q = Math.floor(km / Math.pow(10, e - 3)); }
  if (e > 99) return '9.999E+99';
  const whole = Math.floor(q / 1000);
  return `${whole}.${String(q - whole * 1000).padStart(3, '0')}E+${e}`;
}

/** At most 9 characters. Floors, never rounds up. u is distance in world units; the text is km. */
export function formatKm(u: number): string {
  if (!Number.isFinite(u)) return '-------';
  if (u < 0) return '0.0';
  if (u < KM_EXPONENT_AT_U) return tenths(Math.floor(u / 100));
  return exponentKm(u);
}

/** A number that changes exactly when formatKm's text does, so a slot can compare without formatting. */
export function kmKey(u: number): number {
  if (!Number.isFinite(u) || u < 0) return -1;
  if (u < KM_EXPONENT_AT_U) return Math.floor(u / 100);
  const km = u / 1000;
  const step = Math.pow(10, Math.floor(Math.log10(km)) - 3);
  return Math.floor(km / step) * step;
}

export function formatSync(n: number): string {
  return `×${n}`;
}

function floorMod(a: number, m: number): number {
  return ((a % m) + m) % m;
}

/** S07 ULTRAVIOLET. Past maxChars the palette name goes, so a huge sector on a small phone still fits its box. */
export function formatSector(index: number, palette: number, maxChars: number = Infinity): string {
  const name = PALETTE_NAMES[floorMod(palette, PALETTE_COUNT)] ?? PALETTE_NAMES[0];
  const full = `${sectorCode(index)} ${name.toUpperCase()}`;
  return full.length > maxChars ? sectorCode(index) : full;
}

export function sectorCode(index: number): string {
  return `S${String(index).padStart(2, '0')}`;
}

const OBJECTIVE_NAMES = ['GATES', 'CHAIN', 'GRAZES', 'CLEAN', 'BOOST'] as const;

function isDistanceObjective(kind: number): boolean {
  return kind === Objective.NO_HIT || kind === Objective.BOOST;
}

/** The displayed progress in display units: a whole count, or tenths of a km. Clamped to target. */
function shownProgress(kind: number, progress: number, target: number): number {
  const p = progress > 0 ? (progress < target ? progress : target) : 0;
  return Math.floor(isDistanceObjective(kind) ? p / 100 : p);
}

/** GATES 6/10, CLEAN 1.2/3.2 KM, and OK once done. */
export function formatObjective(kind: number, progress: number, target: number): string {
  const name = OBJECTIVE_NAMES[kind];
  if (name === undefined) return '';
  const shown = shownProgress(kind, progress, target);
  const done = target > 0 && progress >= target ? ' OK' : '';
  if (isDistanceObjective(kind)) return `${name} ${tenths(shown)}/${tenths(Math.floor(target / 100))} KM${done}`;
  return `${name} ${shown}/${target}${done}`;
}

/** Changes exactly when formatObjective's text does, and stays a small integer, because a large or fractional number passed between closures is a heap allocation. */
export function objectiveKey(kind: number, progress: number, target: number): number {
  const done = target > 0 && progress >= target ? 1 : 0;
  const shownTarget = isDistanceObjective(kind) ? Math.floor(target / 100) : target;
  return kind + 8 * (done + 2 * (shownProgress(kind, progress, target) + 4096 * shownTarget));
}
