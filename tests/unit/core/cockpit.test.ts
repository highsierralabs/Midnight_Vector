// T13: the cockpit's layout, which the props layer draws and the UI places readouts on.
import { describe, expect, it } from 'vitest';
import {
  COCKPIT_DASH_TOP, COCKPIT_EYE_Y, COCKPIT_HALF_WIDTH, COCKPIT_HUB, COCKPIT_PANELS, COCKPIT_REF_ASPECT, COCKPIT_SLOTS,
  COCKPIT_WHEEL_PULL, COCKPIT_WHEEL_REACH, cockpitUnit, type CockpitRect,
} from '../../../src/core/cockpit';

const inside = (a: CockpitRect, b: CockpitRect): boolean => a.x0 >= b.x0 && a.x1 <= b.x1 && a.y0 >= b.y0 && a.y1 <= b.y1;
const overlap = (a: CockpitRect, b: CockpitRect): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

describe('cockpitUnit', () => {
  it('is the height on a stage wider than the design, and width / 1.6 on a narrower one', () => {
    expect(cockpitUnit(1920, 1080)).toBe(1080);
    expect(cockpitUnit(2560, 1080)).toBe(1080);
    expect(cockpitUnit(1600, 1000)).toBe(1000);
    expect(cockpitUnit(1024, 768)).toBe(640);
    expect(cockpitUnit(390, 844)).toBeCloseTo(243.75, 12);
    expect(cockpitUnit(844, 390)).toBe(390);
  });

  it('the design width always fits the stage', () => {
    for (const [w, h] of [[1920, 1080], [2560, 1080], [1024, 768], [390, 844], [844, 390], [320, 568]] as const) {
      expect(cockpitUnit(w, h) * COCKPIT_REF_ASPECT).toBeLessThanOrEqual(w + 1e-9);
      expect(cockpitUnit(w, h)).toBeLessThanOrEqual(h);
    }
  });
});

describe('the layout', () => {
  const panels = Object.values(COCKPIT_PANELS);
  const slots = Object.values(COCKPIT_SLOTS);

  it('panels are inside the design width, under the dashboard top, and mirror each other', () => {
    for (const p of panels) {
      expect(p.x0).toBeLessThan(p.x1);
      expect(p.y0).toBeLessThan(p.y1);
      expect(Math.abs(p.x0)).toBeLessThanOrEqual(COCKPIT_HALF_WIDTH);
      expect(Math.abs(p.x1)).toBeLessThanOrEqual(COCKPIT_HALF_WIDTH);
      expect(p.y1).toBeLessThan(COCKPIT_DASH_TOP);
      expect(p.y0).toBeGreaterThan(0);
    }
    expect(COCKPIT_PANELS.left.x0).toBe(-COCKPIT_PANELS.right.x1);
    expect(COCKPIT_PANELS.left.x1).toBe(-COCKPIT_PANELS.right.x0);
  });

  it('every slot is inside one panel, and no two slots overlap', () => {
    for (const s of slots) expect(panels.filter((p) => inside(s, p)).length).toBe(1);
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) expect(overlap(slots[i]!, slots[j]!)).toBe(false);
    }
  });

  it('the wheel, at any turn and the fullest pull, stays clear of both panels', () => {
    // A pull scales the wheel about the eye line, so its far reach from the hub grows by the same factor.
    const reach = COCKPIT_WHEEL_REACH * (1 + COCKPIT_WHEEL_PULL);
    const hubY = COCKPIT_EYE_Y + (COCKPIT_HUB.y - COCKPIT_EYE_Y) * (1 + COCKPIT_WHEEL_PULL);
    for (const p of panels) {
      const nx = Math.max(p.x0, Math.min(COCKPIT_HUB.x, p.x1));
      const ny = Math.max(p.y0, Math.min(hubY, p.y1));
      expect(Math.hypot(nx - COCKPIT_HUB.x, ny - hubY)).toBeGreaterThan(reach);
    }
  });
});
