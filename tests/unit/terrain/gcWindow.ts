// The GC observer for T03's allocation tests (A2, A16). Not a test file: vitest includes only *.test.ts.
import { PerformanceObserver, performance, type PerformanceEntry } from 'node:perf_hooks';

export interface GcWindow {
  /** Entries whose start lies inside the body's own [t0, t1] window. This is the count the gates assert on. */
  inBody: number;
  /** Entries that started before t0 or after t1, reported for the record and never asserted on. */
  outside: number;
  /** Each entry as `k<kind>@<offset>`: inside as +ms from t0, outside as -ms before t0 or >ms after t1. */
  detail: string;
}

function kindOf(e: PerformanceEntry): number {
  return (e as unknown as { detail?: { kind?: number } }).detail?.kind ?? -1;
}

/**
 * Counts V8 GC entries that start while the synchronous `body` runs. The body holds the thread, so an entry can start inside it only
 * from work the body itself triggers. Entries that start after it, in the trailing wait, are excluded: V1-T03 found a kind 8 plus
 * kind 4 pair (incremental mark, then mark-compact) 0 to 112 ms after an allocation-free body, with the same pair after a spin loop
 * that runs no T03 code, and counting them made A25 red (plan section 10). Node records a gc entry's startTime at the GC prologue,
 * on the performance.now() timebase, so the window test is exact.
 */
export async function gcDuring(body: () => void): Promise<GcWindow> {
  const entries: PerformanceEntry[] = [];
  const observer = new PerformanceObserver((list) => { for (const e of list.getEntries()) entries.push(e); });
  observer.observe({ entryTypes: ['gc'] });
  // Lets anything already in flight report before the window opens. Late deliveries still carry their own start time.
  await new Promise((resolve) => setTimeout(resolve, 200));
  const t0 = performance.now();
  body();
  const t1 = performance.now();
  // Lets the body's own entries be delivered.
  await new Promise((resolve) => setTimeout(resolve, 200));
  for (const e of observer.takeRecords()) entries.push(e);
  observer.disconnect();
  let inBody = 0;
  let outside = 0;
  const parts: string[] = [];
  for (const e of entries) {
    const k = kindOf(e);
    if (e.startTime >= t0 && e.startTime <= t1) {
      inBody++;
      if (parts.length < 12) parts.push(`k${k}@+${(e.startTime - t0).toFixed(0)}`);
    } else {
      outside++;
      const at = e.startTime < t0 ? `-${(t0 - e.startTime).toFixed(0)}` : `>${(e.startTime - t1).toFixed(0)}`;
      if (parts.length < 12) parts.push(`k${k}@${at}`);
    }
  }
  return { inBody, outside, detail: parts.join(' ') };
}
