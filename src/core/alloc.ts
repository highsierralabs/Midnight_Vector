import {
  ARCHETYPE_COUNT, CAMERA_FOV, EVENT_CAPACITY, ITEM_STRIDE, MAX_ITEMS_PER_CHUNK, MAX_PROPS_PER_CHUNK, PALETTE_FLOATS, PROP_STRIDE,
  Objective,
  type BendState, type EventBuffer, type FeelState, type ItemRow, type PropRow, type ZoneState,
} from '../contracts/index';

/** Caller-owned records, each sized from its constant. */
export function createPropRow(): PropRow {
  return { chunk: 0, data: new Float32Array(PROP_STRIDE * MAX_PROPS_PER_CHUNK), start: new Uint16Array(ARCHETYPE_COUNT + 1) };
}

export function createItemRow(): ItemRow {
  return { chunk: 0, data: new Float32Array(ITEM_STRIDE * MAX_ITEMS_PER_CHUNK), count: 0 };
}

export function createZoneState(): ZoneState {
  return {
    index: 0,
    biomeA: 0, biomeB: 0, biomeMix: 0,
    paletteA: 0, paletteB: 0, paletteMix: 0,
    palette: new Float32Array(PALETTE_FLOATS),
    heroA: 0, heroB: 0, heroMix: 0,
    objective: Objective.GATES, objectiveTarget: 0, musicKey: 0,
    dayPhase: 0,
  };
}

/** vMax > 0 always (BendState), so an unfilled state still divides nothing by zero. */
export function createBendState(): BendState {
  return { a: 0, c: 0, vMax: 1500 };
}

/** EVENT_CAPACITY per array. */
export function createEventBuffer(): EventBuffer {
  return {
    kind: new Uint8Array(EVENT_CAPACITY),
    x: new Float32Array(EVENT_CAPACITY),
    y: new Float32Array(EVENT_CAPACITY),
    value: new Float32Array(EVENT_CAPACITY),
    chunk: new Float64Array(EVENT_CAPACITY),
    index: new Uint16Array(EVENT_CAPACITY),
    count: 0,
  };
}

/** Shake and roll 0, fovDeg CAMERA_FOV, aberration, flash, speedLines 0, bloomGain 1, duck, shipHold, glitch 0. */
export function createNeutralFeel(): FeelState {
  return {
    shakeX: 0, shakeY: 0, roll: 0, fovDeg: CAMERA_FOV, aberration: 0, flash: 0,
    speedLines: 0, bloomGain: 1, duck: 0, shipHold: 0, glitch: 0,
  };
}
