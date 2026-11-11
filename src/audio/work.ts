// Construction work in a FIFO (D-009, DI-79). An OfflineAudioContext scene drains it at once. The live engine runs it
// in time-boxed slices, one per frame, so nothing but the AudioContext itself is built inside the launch gesture and no
// slice holds a frame for long. Each item does a bounded amount per run. Builders append; render callbacks append too.
import type { FillJob } from './impulse';

export interface Work {
  /** Does a bounded piece of work. True when this item is finished. */
  run(): boolean;
  /**
   * Too large or too unknown to share a slice, such as setting a convolver's buffer, a wiring step, or a fill's
   * first run before the JIT has compiled it: it runs only first in a slice, and ends it. Read before each run.
   */
  readonly alone: boolean;
  /** What the next run is expected to take, in ms; ONCE_MS if absent. */
  estimate?(): number;
  /** Told how long its last run took in a slice, so a fill can size the next one. */
  adapt?(ms: number): void;
}

export interface WorkQueue {
  readonly items: (Work | null)[];
  head: number;
  /** Fill kinds that have run once in this queue, so their code has been through the JIT at least once. */
  readonly seen: Set<string>;
}

/**
 * A fill's first run writes FILL_START samples. In a slice each later run doubles while a run takes under
 * FILL_FAST_MS and halves over FILL_SLOW_MS, within [FILL_MIN, FILL_MAX]: the same loop ran many times slower before
 * the JIT had compiled it [O: D-009, a 16384-sample run read up to about 5 ms on a first launch, and a first run of
 * 1024 up to 2.1 ms].
 */
export const FILL_START = 1024;
export const FILL_MIN = 256;
/**
 * An impulse's passes differ in cost per sample by about ten: a chunk grown on the cheap noise pass took 2.2 ms on the
 * lowpass and exp pass at 65536 samples [O: D-009 slice replay]. At 8192 that pass is about .3 ms.
 */
export const FILL_MAX = 8192;
export const FILL_FAST_MS = 0.25;
export const FILL_SLOW_MS = 0.6;
/** The expected cost of an item that does not say, such as making one buffer or starting one render [A]. */
export const ONCE_MS = 0.5;
/**
 * The expected cost of a wiring step: creating and connecting a few dozen nodes took .9 to 2.4 ms in code the JIT had
 * not compiled yet [O: D-009 item timing]. So one starts a slice, and small items may follow it.
 */
export const WIRE_MS = 2;

export function createQueue(): WorkQueue {
  return { items: [], head: 0, seen: new Set() };
}

/** fn runs once. costMs is what it is expected to take; alone makes it start and end a slice of its own. */
export function once(q: WorkQueue, fn: () => void, alone = false, costMs = ONCE_MS): void {
  q.items.push({ run: () => { fn(); return true; }, alone, estimate: () => costMs });
}

/**
 * A resumable fill, made by `make` when it first runs, so its buffer can come from an earlier item. The first run of
 * the first fill of each `kind` in a queue is alone, since its code has not run yet and its cost is unknown; every
 * other run is expected to stay inside the band it is sized for.
 */
export function fill(q: WorkQueue, make: () => FillJob, kind = 'fill'): void {
  const st = { job: null as FillJob | null, chunk: FILL_START };
  q.items.push({
    run: () => {
      if (st.job === null) {
        st.job = make();
        q.seen.add(kind);
      }
      return st.job.step(st.chunk);
    },
    get alone() { return st.job === null && !q.seen.has(kind); },
    estimate: () => FILL_SLOW_MS,
    adapt: (ms) => {
      if (ms > FILL_SLOW_MS) st.chunk = Math.max(FILL_MIN, Math.floor(st.chunk / 2));
      else if (ms < FILL_FAST_MS) st.chunk = Math.min(FILL_MAX, st.chunk * 2);
    },
  });
}

export function hasWork(q: WorkQueue): boolean {
  return q.head < q.items.length;
}

function advance(q: WorkQueue): void {
  q.items[q.head] = null;
  q.head += 1;
}

/** Runs everything queued, including what the items append while they run. */
export function drain(q: WorkQueue): void {
  while (q.head < q.items.length) {
    const w = q.items[q.head]!;
    while (!w.run()) { /* a fill: keep going */ }
    advance(q);
  }
}

/**
 * Runs items while their expected cost fits in `budgetMs`, measured by `now`. The first item always runs. After it,
 * an item runs only if it is not alone and the time so far plus its estimate stays within the budget, so a slice
 * passes the budget only by what an estimate missed. An alone item ends its slice.
 */
export function runSlice(q: WorkQueue, budgetMs: number, now: () => number): void {
  const t0 = now();
  let before = t0;
  let first = true;
  while (q.head < q.items.length) {
    const w = q.items[q.head]!;
    const alone = w.alone;
    if (!first && (alone || before - t0 + (w.estimate ? w.estimate() : ONCE_MS) > budgetMs)) return;
    const done = w.run();
    const after = now();
    if (w.adapt) w.adapt(after - before);
    before = after;
    if (done) advance(q);
    if (alone) return;
    first = false;
  }
}
