// The allocation and leak probes, alone in this file so the sampling profiler attributes them to one URL. Nothing here
// runs unless a control is switched on. A JSArray of n holes costs 4n + 24 bytes in Chrome, with pointer compression:
// windows moved by exactly 240 for 54 slots and 1008 for 246 [O: T09, plan section 10]. Node's sizes differ.

let sink: unknown = null;
const retained: unknown[] = [];
/** Never written outside the dead branch below. See probeFrame. */
let filler = 0;

/** How many slots to ask for, so an array costs this many bytes. */
export function slotsFor(bytes: number): number {
  return Math.max(0, Math.ceil((bytes - 24) / 4));
}

/** Allocates one short-lived array. It stays reachable only until the next call, so the JIT cannot remove it. */
export function allocTick(slots: number): void {
  sink = new Array(slots);
}

/**
 * One frame of the probes. Negative slots means that probe is off.
 *
 * The sampling profiler charges an allocation to the physical stack frame, so a function the JIT inlines is charged to
 * its caller [O: this probe, when small, read 0 here and 270 in its caller for a true 256]. The dead branch keeps this
 * function over V8's inlining limit of 460 bytes of bytecode, so its allocations stay at this URL.
 */
export function probeFrame(allocSlots: number, leakSlots: number): void {
  if (allocSlots >= 0) sink = new Array(allocSlots);
  if (leakSlots >= 0) retained.push(new Array(leakSlots));
  if (filler !== 0) {
    filler = (filler * 31 + 1) % 65521; filler = (filler * 31 + 2) % 65521; filler = (filler * 31 + 3) % 65521; filler = (filler * 31 + 4) % 65521;
    filler = (filler * 31 + 5) % 65521; filler = (filler * 31 + 6) % 65521; filler = (filler * 31 + 7) % 65521; filler = (filler * 31 + 8) % 65521;
    filler = (filler * 37 + 1) % 65521; filler = (filler * 37 + 2) % 65521; filler = (filler * 37 + 3) % 65521; filler = (filler * 37 + 4) % 65521;
    filler = (filler * 37 + 5) % 65521; filler = (filler * 37 + 6) % 65521; filler = (filler * 37 + 7) % 65521; filler = (filler * 37 + 8) % 65521;
    filler = (filler * 41 + 1) % 65521; filler = (filler * 41 + 2) % 65521; filler = (filler * 41 + 3) % 65521; filler = (filler * 41 + 4) % 65521;
    filler = (filler * 41 + 5) % 65521; filler = (filler * 41 + 6) % 65521; filler = (filler * 41 + 7) % 65521; filler = (filler * 41 + 8) % 65521;
    filler = (filler * 43 + 1) % 65521; filler = (filler * 43 + 2) % 65521; filler = (filler * 43 + 3) % 65521; filler = (filler * 43 + 4) % 65521;
    filler = (filler * 43 + 5) % 65521; filler = (filler * 43 + 6) % 65521; filler = (filler * 43 + 7) % 65521; filler = (filler * 43 + 8) % 65521;
    filler = (filler * 47 + 1) % 65521; filler = (filler * 47 + 2) % 65521; filler = (filler * 47 + 3) % 65521; filler = (filler * 47 + 4) % 65521;
    filler = (filler * 47 + 5) % 65521; filler = (filler * 47 + 6) % 65521; filler = (filler * 47 + 7) % 65521; filler = (filler * 47 + 8) % 65521;
    filler = (filler * 53 + 1) % 65521; filler = (filler * 53 + 2) % 65521; filler = (filler * 53 + 3) % 65521; filler = (filler * 53 + 4) % 65521;
    filler = (filler * 53 + 5) % 65521; filler = (filler * 53 + 6) % 65521; filler = (filler * 53 + 7) % 65521; filler = (filler * 53 + 8) % 65521;
  }
}

export function leakClear(): void {
  retained.length = 0;
}

export function probeState(): { sink: boolean; retained: number } {
  return { sink: sink !== null, retained: retained.length };
}
