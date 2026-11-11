// Six spans, reused. Each start sets the text and flips between two identical keyframe rules, which restarts a
// compositor-only animation with no reflow. Under reduced motion a popup just appears and expires on v.tick (DI-49).
import type { FrameView } from '../contracts/index';
import type { UiDom } from './dom';
import { PopupKind, popupKind, popupText } from './events';

/** Starts are spaced by 100 ms, so 2 writes each stays within what section 7's adversarial budget leaves for popups. */
const START_MIN_TICKS = 12;
/** .9 s at 120 ticks per second, as long as the animation. */
const REDUCED_TICKS = 108;

const NAMES = ['', 'gain', 'graze', 'miss', 'hit', 'grade'] as const;
/** When two arrive inside one spacing, the one that matters most is the one kept. */
const PRIORITY: readonly number[] = [0, 2, 1, 3, 5, 4];

export interface Popups {
  event(kind: number, value: number, index: number): void;
  frame(v: Readonly<FrameView>): void;
}

export function createPopups(dom: UiDom): Popups {
  const spans = dom.popups;
  const texts = dom.popupText;
  const count = spans.length;
  const classA: string[] = NAMES.map((n) => `${n}-a`);
  const classB: string[] = NAMES.map((n) => `${n}-b`);
  const classR: string[] = NAMES.map((n) => `${n}-r`);
  const flip: boolean[] = [];
  const expiry: number[] = [];
  for (let i = 0; i < count; i++) {
    flip.push(false);
    expiry.push(-1);
  }

  let next = 0;
  let lastStart = -Infinity;
  let pendingKind: number = PopupKind.NONE;
  let pendingEv = 0;
  let pendingValue = 0;
  let pendingIndex = 0;

  return {
    event(kind, value, index) {
      const p = popupKind(kind, value);
      if (p === PopupKind.NONE || PRIORITY[p]! < PRIORITY[pendingKind]!) return;
      pendingKind = p;
      pendingEv = kind;
      pendingValue = value;
      pendingIndex = index;
    },
    frame(v) {
      const tick = v.tick;
      if (tick < lastStart) lastStart = -Infinity;
      if (pendingKind !== PopupKind.NONE && tick - lastStart >= START_MIN_TICKS) {
        const i = next;
        next = (next + 1) % count;
        lastStart = tick;
        texts[i]!.data = popupText(pendingEv, pendingValue, pendingIndex);
        if (v.reducedMotion) {
          spans[i]!.setAttribute('data-k', classR[pendingKind]!);
          expiry[i] = tick + REDUCED_TICKS;
        } else {
          flip[i] = !flip[i];
          spans[i]!.setAttribute('data-k', flip[i] ? classA[pendingKind]! : classB[pendingKind]!);
          expiry[i] = -1;
        }
        pendingKind = PopupKind.NONE;
      }
      for (let i = 0; i < count; i++) {
        const e = expiry[i]!;
        if (e >= 0 && (tick >= e || tick < e - REDUCED_TICKS)) {
          expiry[i] = -1;
          spans[i]!.setAttribute('data-k', '');
        }
      }
    },
  };
}
