import { describe, expect, it } from 'vitest';
import {
  ARCHETYPE_COUNT, CAMERA_FOV, EVENT_CAPACITY, ITEM_STRIDE, MAX_ITEMS_PER_CHUNK, MAX_PROPS_PER_CHUNK, PALETTE_FLOATS, PROP_STRIDE,
} from '../../../src/contracts/index';
import {
  createBendState, createEventBuffer, createItemRow, createNeutralFeel, createPropRow, createZoneState,
} from '../../../src/core/alloc';

describe('alloc', () => {
  it('sizes the prop row from its constants', () => {
    const r = createPropRow();
    expect(r.data).toBeInstanceOf(Float32Array);
    expect(r.data.length).toBe(PROP_STRIDE * MAX_PROPS_PER_CHUNK);
    expect(r.start).toBeInstanceOf(Uint16Array);
    expect(r.start.length).toBe(ARCHETYPE_COUNT + 1);
  });

  it('sizes the item row from its constants', () => {
    const r = createItemRow();
    expect(r.data).toBeInstanceOf(Float32Array);
    expect(r.data.length).toBe(ITEM_STRIDE * MAX_ITEMS_PER_CHUNK);
    expect(r.count).toBe(0);
  });

  it('sizes the zone palette and starts every field at a legal value', () => {
    const z = createZoneState();
    expect(z.palette.length).toBe(PALETTE_FLOATS);
    expect(z.heroA).toBe(0);
    expect(z.biomeMix).toBe(0);
    expect(z.dayPhase).toBe(0);
  });

  it('keeps vMax above 0 in a fresh bend', () => {
    expect(createBendState().vMax).toBeGreaterThan(0);
  });

  it('sizes every event array at EVENT_CAPACITY', () => {
    const e = createEventBuffer();
    expect(e.count).toBe(0);
    for (const a of [e.kind, e.x, e.y, e.value, e.chunk, e.index]) expect(a.length).toBe(EVENT_CAPACITY);
    expect(e.kind).toBeInstanceOf(Uint8Array);
    expect(e.x).toBeInstanceOf(Float32Array);
    expect(e.y).toBeInstanceOf(Float32Array);
    expect(e.value).toBeInstanceOf(Float32Array);
    expect(e.chunk).toBeInstanceOf(Float64Array);
    expect(e.index).toBeInstanceOf(Uint16Array);
  });

  it('createNeutralFeel gives the section 8.1 values', () => {
    expect(createNeutralFeel()).toEqual({
      shakeX: 0, shakeY: 0, roll: 0, fovDeg: CAMERA_FOV, aberration: 0, flash: 0,
      speedLines: 0, bloomGain: 1, duck: 0, shipHold: 0, glitch: 0,
    });
  });

  it('returns a fresh object on every call', () => {
    expect(createPropRow().data).not.toBe(createPropRow().data);
    expect(createZoneState().palette).not.toBe(createZoneState().palette);
    expect(createNeutralFeel()).not.toBe(createNeutralFeel());
  });
});
