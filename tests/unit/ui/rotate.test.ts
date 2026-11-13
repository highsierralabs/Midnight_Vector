// Amendment LS: the rotate gate's query and what the gate does to a run.
import { describe, expect, it } from 'vitest';
import { SimMode } from '../../../src/contracts/index';
import { ROTATE_MAX_WIDTH, ROTATE_QUERY, gateHolds, gateParks } from '../../../src/ui/rotate';

describe('ROTATE_QUERY', () => {
  it('names a phone held upright: portrait, touch first, and narrower than a tablet', () => {
    expect(ROTATE_QUERY).toBe('(orientation: portrait) and (pointer: coarse) and (max-width: 599.98px)');
    expect(ROTATE_MAX_WIDTH).toBe(600);
  });
});

describe('the gate and a run', () => {
  it('parks a run in PLAY, and only while it shows', () => {
    expect(gateParks(true, SimMode.PLAY)).toBe(true);
    expect(gateParks(false, SimMode.PLAY)).toBe(false);
    expect(gateParks(true, SimMode.CRUISE)).toBe(false);
    expect(gateParks(true, SimMode.DEMO)).toBe(false);
  });

  it('holds a launch from DEMO and a resume from CRUISE, and lets a pause from PLAY through', () => {
    expect(gateHolds(true, SimMode.DEMO)).toBe(true);
    expect(gateHolds(true, SimMode.CRUISE)).toBe(true);
    expect(gateHolds(true, SimMode.PLAY)).toBe(false);
  });

  it('holds nothing when it does not show', () => {
    for (const mode of [SimMode.DEMO, SimMode.PLAY, SimMode.CRUISE]) expect(gateHolds(false, mode)).toBe(false);
  });
});
