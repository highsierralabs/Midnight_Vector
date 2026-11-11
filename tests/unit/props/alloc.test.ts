// A3: feeder.cross and hideItem allocate nothing. GC events are counted, not heap deltas: a heap delta read 3.3 B against
// only 55 B per call in the spike, too close to separate. Scope is the pure path, not three's render(), and only once the JIT has
// optimised it: below TurboFan the same loop allocates by boxing (plan section 10), which a warm-up hides.
//
// Only GC entries that start inside the measured body count. Once a body outlasts about 8 s, which a loaded machine makes it, V8's memory
// reducer runs an incremental mark and a major GC in the tail just after the body returns, which allocation in the body did not cause:
// the whole unit run read 2 such events, both after the body (plan section 10). Those are printed, not counted.
import { PerformanceObserver, performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { ARCHETYPE_COUNT, ITEM_STRIDE, type ItemRow, type PropRow, type WorldSource } from '../../../src/contracts/index';
import { createItemRow, createPropRow } from '../../../src/core/alloc';
import { worstCaseRows } from '../../../src/render/props/dev/worstCaseWorld';
import { createFeeder } from '../../../src/render/props/feeder';
import { RING_PLAN } from '../../../src/render/props/plan';
import { RingStore } from '../../../src/render/props/ring';

const CALLS = 200_000;

/** Copies prebuilt rows, so all allocation in the loop would be the feeder's own. */
function allocationFreeWorld(): Pick<WorldSource, 'fillProps' | 'fillItems'> {
  const base = worstCaseRows();
  const props: PropRow = createPropRow();
  const items: ItemRow = createItemRow();
  base.fillProps(4800, props);
  base.fillItems(4800, items);
  return {
    fillProps(c: number, out: PropRow) {
      out.chunk = c;
      const from = props.data;
      const to = out.data;
      for (let i = 0; i < from.length; i++) to[i] = from[i]!;
      for (let a = 0; a <= ARCHETYPE_COUNT; a++) out.start[a] = props.start[a]!;
    },
    fillItems(c: number, out: ItemRow) {
      out.chunk = c;
      const from = items.data;
      const to = out.data;
      const n = items.count * ITEM_STRIDE;
      for (let i = 0; i < n; i++) to[i] = from[i]!;
      out.count = items.count;
    },
  };
}

const retained: { row: number }[] = [];
class LeakyRing extends RingStore {
  override writeRow(chunk: number, src: Float32Array, start: number, end: number): void {
    retained[chunk & 255] = { row: chunk };
    super.writeRow(chunk, src, start, end);
  }
}

function nextTask(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface GcCount {
  /** Entries whose start lies inside the body: the gated number. */
  inBody: number;
  before: number;
  after: number;
  bodyMs: number;
  /** kind@ms relative to the body's start, for every entry seen. Kind 1 is a scavenge, 4 a major GC, 8 an incremental mark. */
  log: string;
}

async function gcEventsDuring(body: () => void): Promise<GcCount> {
  const seen: { start: number; kind: number }[] = [];
  const take = (entries: readonly { startTime: number; detail?: unknown }[]): void => {
    for (const e of entries) seen.push({ start: e.startTime, kind: (e.detail as { kind?: number } | undefined)?.kind ?? -1 });
  };
  const obs = new PerformanceObserver((list) => take(list.getEntries()));
  obs.observe({ entryTypes: ['gc'] });
  // Settle: wait for a 50 ms window with no GC entry, so a mark started before the body finishes before it, at most about 1 s.
  for (let i = 0; i < 20; i++) {
    const n = seen.length;
    await nextTask(50);
    take(obs.takeRecords());
    if (seen.length === n) break;
  }
  const t0 = performance.now();
  body();
  const t1 = performance.now();
  await nextTask();
  take(obs.takeRecords());
  obs.disconnect();
  let inBody = 0;
  let before = 0;
  let after = 0;
  for (const e of seen) {
    if (e.start < t0) before++;
    else if (e.start <= t1) inBody++;
    else after++;
  }
  const log = seen.map((e) => `${e.kind}@${(e.start - t0).toFixed(0)}`).join(' ');
  return { inBody, before, after, bodyMs: t1 - t0, log };
}

describe('zero allocation in the pure path', () => {
  it('runs feeder.cross and hideItem with 0 GC events, and a one-object-per-call wrapper with more than 10', { timeout: 300_000 }, async () => {
    const f = createFeeder(allocationFreeWorld(), RING_PLAN);
    f.rebuild(1000);
    let c = 1000;
    function loop(n: number, each?: (i: number) => void): void {
      for (let i = 0; i < n; i++) {
        c++;
        f.cross(c);
        f.hideItem(c + 2, i % 12);
        if (each) each(i);
      }
    }
    // Warm up, so nothing lazy is left, and yield a task.
    loop(20_000);
    await nextTask();

    const clean = await gcEventsDuring(() => loop(CALLS));
    console.log(`A3 clean: ${clean.inBody} GC events inside the ${clean.bodyMs.toFixed(0)} ms body over ${CALLS} calls; outside it ${clean.before} before, ${clean.after} after [${clean.log}]`);
    expect(clean.inBody).toBe(0);

    // The negative control wraps the ring write, 26 calls per crossing: one object per call, retained briefly, as a
    // per-ring slip in this path would be. One object per crossing is 5 MB over the run, too little to fill a semi-space often.
    const leaky = createFeeder(allocationFreeWorld(), RING_PLAN, (p) => new LeakyRing(p));
    leaky.rebuild(1000);
    let d = 1000;
    for (let i = 0; i < 2000; i++) leaky.cross(++d);
    await nextTask();
    const dirty = await gcEventsDuring(() => {
      for (let i = 0; i < CALLS; i++) leaky.cross(++d);
    });
    console.log(`A3 negative control: ${dirty.inBody} GC events inside the ${dirty.bodyMs.toFixed(0)} ms body, ${dirty.after} after; ${retained.length} objects held at the end`);
    expect(dirty.inBody).toBeGreaterThan(10);
  });
});
