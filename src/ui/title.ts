// The title overlay. The first real gesture launches, synchronously, inside the browser's activation window.
import { SimMode } from '../contracts/index';
import * as copy from './copy';
import type { UiDom } from './dom';
import { formatKm, formatScore } from './format';
import { createAttrSlot } from './slots';
import type { Bests } from './storage';

/** 30 s at 120 ticks per second with no input, then the title behaves as a screensaver. */
const ATTRACT_TICKS = 3600;
const NO_YES = ['0', '1'] as const;

export interface Title {
  frame(tick: number, mode: SimMode): void;
  /** A pointer or key arrived, from any part of the page. */
  noteActivity(): void;
}

/**
 * Amendment LH: which start button an element is, or sits in. true is LAUNCH - NO HUD, false is LAUNCH, and null is
 * anywhere else, which launches with the remembered choice (LH-3).
 */
export function launchChoice(dom: UiDom, at: EventTarget | null): boolean | null {
  if (!(at instanceof Node)) return null;
  if (dom.launchNoHud.contains(at)) return true;
  if (dom.launch.contains(at)) return false;
  return null;
}

/** tryLaunch's argument: hide the HUD, show it, or null for the remembered setting. */
export function createTitle(dom: UiDom, bests: Readonly<Bests>, tryLaunch: (hideHud: boolean | null) => void): Title {
  dom.best.data = `${copy.LABEL_BEST} ${formatScore(bests.score)} / ${formatKm(bests.km * 1000)} KM`;

  dom.title.addEventListener('pointerup', (e) => {
    // A touch drag fires pointerup and never click, and touch pointerdown does not activate. So pointerup, and click too.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    tryLaunch(launchChoice(dom, e.target));
  });
  dom.title.addEventListener('click', (e) => { tryLaunch(launchChoice(dom, e.target)); });

  const attract = createAttrSlot(dom.title, 'data-attract', NO_YES);
  let active = true;
  let lastActive = 0;

  return {
    noteActivity() { active = true; },
    frame(tick, mode) {
      if (active || tick < lastActive) {
        active = false;
        lastActive = tick;
      }
      attract.set(tick, mode === SimMode.DEMO && tick - lastActive >= ATTRACT_TICKS ? 1 : 0);
    },
  };
}
