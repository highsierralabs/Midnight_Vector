// Ev to popup. The only reader of event values in the UI: popups are cosmetic, and overflow may drop events, so shields,
// score and sector are always read from SimState and the zone instead.
import { Ev } from '../contracts/index';

export const PopupKind = { NONE: 0, GAIN: 1, GRAZE: 2, MISS: 3, HIT: 4, GRADE: 5 } as const;
export type PopupKind = (typeof PopupKind)[keyof typeof PopupKind];

const GRADE_LETTERS = ['S', 'A', 'B', 'C'] as const;

/** Ev.SHARD makes none: at 12.5 per second it would own the write budget, and the score ticking says it already. A GATE or GRAZE with value 0 is cosmetic, so an idle frame never shows +0. */
export function popupKind(kind: number, value: number): PopupKind {
  if (kind === Ev.GATE) return value > 0 ? PopupKind.GAIN : PopupKind.NONE;
  if (kind === Ev.GRAZE) return value > 0 ? PopupKind.GRAZE : PopupKind.NONE;
  if (kind === Ev.GATE_MISS) return PopupKind.MISS;
  if (kind === Ev.HIT) return PopupKind.HIT;
  if (kind === Ev.GRADE) return PopupKind.GRADE;
  return PopupKind.NONE;
}

export function gradeLetter(index: number): string {
  return GRADE_LETTERS[index] ?? '?';
}

/** Called only for a kind that popupKind accepted. */
export function popupText(kind: number, value: number, index: number): string {
  if (kind === Ev.GATE) return `+${Math.round(value)}`;
  if (kind === Ev.GRAZE) return `GRAZE +${Math.round(value)}`;
  if (kind === Ev.GATE_MISS) return 'MISS';
  if (kind === Ev.HIT) return 'HIT';
  if (kind === Ev.GRADE) return `GRADE ${gradeLetter(index)}`;
  return '';
}
