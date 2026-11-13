// The cockpit's layout (T13, plans/T13-views.md), shared by the props layer, which draws the dashboard, and the UI, which
// places the readouts on it. Sibling modules may not import each other (section 3.2), so the one copy lives here. Pure.
//
// Everything is in cockpit units: one unit is cockpitUnit(w, h) pixels of the stage, x is measured from the stage's centre,
// to the right, and y from its bottom edge, up. The cockpit is 1.6 units wide by design, so it fits any stage: on a stage
// wider than 1.6:1 the unit is the height and the dashboard runs on past the design width; on a narrower one the unit is
// width / 1.6 and the cockpit takes only the bottom of the stage.

/** The widest shape the cockpit is designed inside. */
export const COCKPIT_REF_ASPECT = 1.6;
/** Half of the design width, in units. */
export const COCKPIT_HALF_WIDTH = COCKPIT_REF_ASPECT / 2;

/** One cockpit unit in the pixels w and h are given in. Not for a per-frame path: it returns a double (Agents.md). */
export function cockpitUnit(w: number, h: number): number {
  const byWidth = w / COCKPIT_REF_ASPECT;
  return h < byWidth ? h : byWidth;
}

export interface CockpitRect { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }

/** The dashboard's top edge. Nothing of the cockpit but the canopy struts is drawn above it. */
export const COCKPIT_DASH_TOP = 0.3;

/** The two instrument panels, one to each side of the wheel. A bezel is drawn around each. */
export const COCKPIT_PANELS = {
  left: { x0: -0.78, y0: 0.105, x1: -0.27, y1: 0.275 },
  right: { x0: 0.27, y0: 0.105, x1: 0.78, y1: 0.275 },
} as const satisfies Record<string, CockpitRect>;

/**
 * Where each group of readouts sits. score: score and SYNC. status: shields and overdrive. nav: distance, sector and
 * objective. Each lies inside a panel, with the panel's bezel around it.
 */
export const COCKPIT_SLOTS = {
  score: { x0: -0.765, y0: 0.195, x1: -0.285, y1: 0.265 },
  status: { x0: -0.765, y0: 0.115, x1: -0.285, y1: 0.185 },
  nav: { x0: 0.285, y0: 0.115, x1: 0.765, y1: 0.265 },
} as const satisfies Record<string, CockpitRect>;

/** The wheel's hub, and the radius its grips and the pilot's hands stay inside at any turn and any pull. */
export const COCKPIT_HUB = { x: 0, y: 0.115 } as const;
export const COCKPIT_WHEEL_REACH = 0.23;
/** The wheel turns this far each way, in radians, and moves this far toward the pilot (+) or away (-), as a scale about the eye line. */
export const COCKPIT_WHEEL_TURN = 0.7;
export const COCKPIT_WHEEL_PULL = 0.1;
/** The eye line: the height, in units, that a pull or push scales the wheel about. */
export const COCKPIT_EYE_Y = 0.5;
