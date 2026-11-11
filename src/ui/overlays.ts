// The sector banner and the one polite live region. SIGNAL LOST, the autopilot tag and the context-lost layer are static
// markup that CSS shows from data-view, so here they only announce themselves. The autopilot tag also leaves the road
// AUTO_TAG_TICKS after it appears (the operator's HC12 ruling, DI-119): its data-show goes to 0, and CSS fades it out.
import { BIOME_COUNT, BIOME_NAMES, PALETTE_COUNT, PALETTE_NAMES, SimMode, type FrameView } from '../contracts/index';
import * as copy from './copy';
import type { UiDom } from './dom';
import { gradeLetter } from './events';
import { formatObjective, sectorCode } from './format';
import { createAttrSlot, createGate } from './slots';
import { Panel } from './view';

/** 3 s at 120 ticks per second. */
const BANNER_TICKS = 360;
/** A grade with no sector change this soon after it shows the banner by itself. */
const GRADE_GRACE_TICKS = 30;
/** .5 s. Only a broken sim changes sector this fast, and this keeps the banner out of the adversarial write budget. */
const RARE_MIN_TICKS = 60;
/** 4 s. Longer than the dev page's BANNER_EXPIRED_TICKS (370), so its 'autopilot' state still shows the tag. */
export const AUTO_TAG_TICKS = 480;
const NO_YES = ['0', '1'] as const;

export interface Overlays {
  frame(v: Readonly<FrameView>): void;
  /** One Ev.GRADE from this frame. */
  grade(tick: number, rank: number, bonus: number): void;
  /** The data-view mask was written with a new value. */
  panelsChanged(previous: number, next: number): void;
}

function floorMod(a: number, m: number): number {
  return ((a % m) + m) % m;
}

function sectorLine(v: Readonly<FrameView>): string {
  const z = v.zone;
  const palette = PALETTE_NAMES[floorMod(z.paletteA, PALETTE_COUNT)] ?? PALETTE_NAMES[0];
  const biome = BIOME_NAMES[floorMod(z.biomeA, BIOME_COUNT)] ?? BIOME_NAMES[0];
  return `SECTOR ${sectorCode(z.index).slice(1)} - ${palette.toUpperCase()} - ${biome.toUpperCase()}`;
}

export function createOverlays(dom: UiDom): Overlays {
  const show = createAttrSlot(dom.banner, 'data-show', NO_YES);
  // No throttle: the tag is drawn the frame its panel rises, so a stale 0 must not wait a tick.
  const autoShow = createAttrSlot(dom.autoTag, 'data-show', NO_YES, 0);
  let autoRose = false;
  let autoFrom = -1;
  const bannerGate = createGate(RARE_MIN_TICKS);
  const gradeGate = createGate(RARE_MIN_TICKS);
  const liveGate = createGate(RARE_MIN_TICKS);

  let seenIndex = false;
  let lastIndex = 0;
  let until = -1;
  let shownAt = -1;
  let gradeAt = -1;
  let gradeSerial = 0;
  let liveText: string | null = null;
  let liveSerial = 0;

  function announce(text: string): void {
    liveText = text;
    liveSerial++;
  }

  function trigger(v: Readonly<FrameView>): void {
    const line = sectorLine(v);
    dom.bannerTitle.data = line;
    // Progress restarts with the sector, and sim.objectiveProgress can be a frame stale here, so the banner shows 0.
    dom.bannerObjective.data = formatObjective(v.zone.objective, 0, v.zone.objectiveTarget);
    until = v.tick + BANNER_TICKS;
    shownAt = v.tick;
    gradeAt = -1;
    announce(line);
  }

  return {
    grade(tick, rank, bonus) {
      if (!gradeGate.pass(tick, gradeSerial++)) return;
      // Written straight away and not cleared by the banner, because GRADE can come a frame before zone.index moves (S-13).
      dom.bannerGrade.data = `GRADE ${gradeLetter(rank)} +${Math.round(bonus)}`;
      gradeAt = until >= 0 ? -1 : tick;
    },

    panelsChanged(previous, next) {
      const rose = next & ~previous;
      const fell = previous & ~next;
      if ((rose & Panel.LOST) !== 0) announce(`${copy.SIGNAL_LOST} - ${copy.SIGNAL_LOST_SUB}`);
      if ((rose & Panel.AUTO) !== 0) {
        announce(copy.AUTOPILOT_TAG);
        autoRose = true;
      }
      if ((rose & Panel.CTX) !== 0) announce(copy.CONTEXT_LOST);
      if ((fell & Panel.CTX) !== 0) announce(copy.CONTEXT_RESTORED);
    },

    frame(v) {
      const tick = v.tick;
      const index = v.zone.index;

      if (index !== lastIndex || !seenIndex) {
        const playing = v.sim.mode === SimMode.PLAY || v.sim.mode === SimMode.SIGNAL_LOST;
        if (!playing || !seenIndex) {
          lastIndex = index;
          seenIndex = true;
        } else if (bannerGate.pass(tick, index)) {
          lastIndex = index;
          trigger(v);
        }
      }
      if (gradeAt >= 0 && tick - gradeAt >= GRADE_GRACE_TICKS) trigger(v);

      const showing = until >= 0 && tick < until && tick >= shownAt;
      if (until >= 0 && !showing) {
        until = -1;
        dom.bannerGrade.data = '';
      }
      show.set(tick, showing ? 1 : 0);

      // Restarted each time the panel rises, and by a clock that went back, as the dev page's can.
      if (autoRose || (autoFrom >= 0 && tick < autoFrom)) {
        autoRose = false;
        autoFrom = tick;
      }
      autoShow.set(tick, autoFrom >= 0 && tick - autoFrom < AUTO_TAG_TICKS ? 1 : 0);

      if (liveText !== null && liveGate.pass(tick, liveSerial)) {
        dom.live.data = liveText;
        liveText = null;
      }
    },
  };
}
