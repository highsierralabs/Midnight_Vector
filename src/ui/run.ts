// This run's distance, counted only while score counts (section 7.2, DI-61). CRUISE, idle autopilot and SIGNAL_LOST
// hold it, so a parked player can farm best distance no more than best score. The HUD, the menu and the furthest best
// all read this one number, so a readout never shows a run the best would not record. Pure, and allocates nothing.
import { SimMode, type Travel } from '../contracts/index';
import { between } from '../core/coords';

/** Rules are live, and so score accrues, only in PLAY with nobody's autopilot on. SIGNAL_LOST runs on autopilot. */
export function scoring(mode: SimMode, autopilot: boolean): boolean {
  return mode === SimMode.PLAY && !autopilot;
}

export interface RunMeter {
  /** Writes this run's scored distance in u to out[0]. DEMO resets it to 0. */
  frame(mode: SimMode, autopilot: boolean, travel: Readonly<Travel>, out: Float64Array): void;
}

export function createRunMeter(): RunMeter {
  // Where the current scoring spell began. Each spell is one exact between(), not a sum of per-frame steps.
  const from: Travel = { chunk: 0, local: 0 };
  // [0] distance banked by earlier spells, [1] the total. An array, so no fractional double crosses a call (Agents.md).
  const d = new Float64Array(2);
  let live = false;

  return {
    frame(mode, autopilot, travel, out) {
      if (mode === SimMode.DEMO) {
        d[0] = 0;
        d[1] = 0;
        live = false;
      } else if (scoring(mode, autopilot)) {
        if (!live) {
          live = true;
          from.chunk = travel.chunk;
          from.local = travel.local;
          d[0] = d[1]!;
        }
        d[1] = d[0]! + between(travel, from);
      } else {
        live = false;
      }
      out[0] = d[1]!;
    },
  };
}
