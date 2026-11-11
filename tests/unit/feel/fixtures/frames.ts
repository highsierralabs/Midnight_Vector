// A plain SimState and EventBuffer, because lint stops tests/unit/feel importing src/sim.
import { SimMode, SIM_HZ, SPEED_CRUISE, EVENT_CAPACITY, type Ev, type EventBuffer, type SimState } from '../../../../src/contracts/index';
import { createEventBuffer } from '../../../../src/core/alloc';

export function plainState(o: Partial<SimState> = {}): SimState {
  return {
    tick: 0, travel: { chunk: 3, local: 34 }, stepDist: SPEED_CRUISE / SIM_HZ, speed: SPEED_CRUISE,
    x: 0, y: 6, prevX: 0, prevY: 6, mode: SimMode.PLAY, score: 0, sync: 1, shields: 3, overdrive: 0.25, ghost: 0, beat: 0,
    sectorIndex: 0, objectiveProgress: 0, autopilot: false, warpSerial: 0, ...o,
  };
}

export function plainEvents(): EventBuffer {
  return createEventBuffer();
}

export function pushEv(e: EventBuffer, kind: Ev, value = 0): void {
  if (e.count >= EVENT_CAPACITY) return;
  e.kind[e.count] = kind;
  e.value[e.count] = value;
  e.count += 1;
}

/** Sets tick and beat from a time in seconds, as the sim's clock would read at that moment. */
export function setClock(s: SimState, t: number): void {
  s.tick = Math.round(t * SIM_HZ);
  s.beat = s.tick / 72;
}
