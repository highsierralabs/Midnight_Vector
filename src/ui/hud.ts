// The readouts. Text through Text.data, style through setProperty, attributes through attribute slots, each on change
// only and under the slot throttle. Allocates nothing on an unchanged frame.
import { SHIELD_MAX, type FrameView } from '../contracts/index';
import type { UiDom } from './dom';
import { KM_EXPONENT_AT_U, SCORE_LONG_AT, formatKm, formatObjective, formatScore, formatSector, formatSync, kmKey, objectiveKey } from './format';
import { SCALE_LEVELS, buildScaleTable, createAttrSlot, createGate, createStyleSlot, createTextSlot } from './slots';

export interface Hud {
  /** run[0] is this run's distance in u, measured from the DEMO-to-PLAY transition. An array, so that a fractional double crosses no call boundary: that would box it, 12 B per frame (Agents.md). */
  frame(v: Readonly<FrameView>, run: Float64Array): void;
}

const NO_YES = ['0', '1'] as const;
const ARIA_MIN_TICKS = 60;
const BEAT = ['a', 'b'] as const;
/** What fits the distance box at the 11 px minimum, in half of a phone under 360 px wide. */
const NARROW_SECTOR_CHARS = 19;

function shieldLabels(): readonly string[] {
  const out: string[] = [];
  for (let i = 0; i <= SHIELD_MAX; i++) out.push(`Shields ${i} of ${SHIELD_MAX}`);
  return out;
}

function shieldCounts(): readonly string[] {
  const out: string[] = [];
  for (let i = 0; i <= SHIELD_MAX; i++) out.push(String(i));
  return out;
}

function tenPercentSteps(): readonly string[] {
  const out: string[] = [];
  for (let i = 0; i <= 10; i++) out.push(String(i * 10));
  return out;
}

export function createHud(dom: UiDom): Hud {
  const score = createTextSlot(dom.score, formatScore);
  const long = createAttrSlot(dom.scoreEl, 'data-long', NO_YES);
  const sync = createTextSlot(dom.sync, formatSync);
  const beat = createAttrSlot(dom.syncEl, 'data-beat', BEAT);
  const shieldN = createAttrSlot(dom.shields, 'data-n', shieldCounts());
  const shieldName = createAttrSlot(dom.shields, 'aria-label', shieldLabels());
  const ghost = createAttrSlot(dom.shields, 'data-ghost', NO_YES);
  const bar = createStyleSlot(dom.overdriveFill.style, 'transform', buildScaleTable());
  /** A screen reader does not need the bar's every step, and this is the slot a shard most often wakes. */
  const barValue = createAttrSlot(dom.overdrive, 'aria-valuenow', tenPercentSteps(), ARIA_MIN_TICKS);
  const sectorGate = createGate();
  const objectiveGate = createGate();
  const kmGate = createGate();
  // Part of the sector's gate key, so a resize or rotation across 360 px rewrites it at once (V1-T08). Kept by the
  // change event rather than read per frame, so a frame touches no media query.
  const narrow = window.matchMedia('(max-width: 359.98px)');
  let narrowNow = narrow.matches;
  narrow.addEventListener('change', (e) => { narrowNow = e.matches; });

  return {
    frame(v, run) {
      const tick = v.tick;
      const s = v.sim;
      if (!v.reducedMotion) beat.set(tick, Math.floor(s.beat) % 2 === 0 ? 0 : 1);

      // Hit-stop holds the readouts for section 7.4's 70 ms. Panels and popups carry on.
      if (v.feel.shipHold > 0) return;

      score.set(tick, s.score);
      long.set(tick, s.score >= SCORE_LONG_AT ? 1 : 0);
      sync.set(tick, s.sync);

      const n = s.shields > 0 ? (s.shields < SHIELD_MAX ? s.shields : SHIELD_MAX) : 0;
      shieldN.set(tick, n);
      shieldName.set(tick, n);
      ghost.set(tick, s.ghost > 0 ? 1 : 0);

      const od = s.overdrive > 0 ? (s.overdrive < 1 ? s.overdrive : 1) : 0;
      bar.set(tick, Math.round(od * SCALE_LEVELS));
      barValue.set(tick, Math.round(od * 10));

      const runU = run[0]!;
      if (kmGate.pass(tick, runU < KM_EXPONENT_AT_U ? Math.floor(runU / 100) : kmKey(runU))) dom.km.data = formatKm(runU);

      const z = v.zone;
      if (sectorGate.pass(tick, (z.index * 8 + z.paletteA) * 2 + (narrowNow ? 1 : 0))) {
        dom.sector.data = formatSector(z.index, z.paletteA, narrowNow ? NARROW_SECTOR_CHARS : Infinity);
      }
      if (objectiveGate.pass(tick, objectiveKey(z.objective, s.objectiveProgress, z.objectiveTarget))) {
        dom.objective.data = formatObjective(z.objective, s.objectiveProgress, z.objectiveTarget);
      }
    },
  };
}
