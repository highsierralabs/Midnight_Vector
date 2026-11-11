// Allocation probe, calibrated in the plan's M7. Garbage counts: no GC runs at the end of a window.
// Sub-windows catch what a plain before-and-after would lose: a scavenge inside a window makes that sub-window read
// negative, so only rising sub-windows are summed. That can under-read by one sub-window per scavenge, never over-read.
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

let gcFn: (() => void) | null = null;

function gc(): void {
  if (!gcFn) {
    setFlagsFromString('--expose-gc');
    gcFn = runInNewContext('gc') as () => void;
  }
  gcFn();
}

const SUB_WINDOW = 5000;

/**
 * Bytes per call of fn, in the median of 4 runs of `calls` calls each, after `warm` warm-up calls.
 * subWindow is in calls. Keep subWindow times the bytes a leaking call would allocate small next to the young
 * generation: a sub-window spanning several scavenges reads only what came after the last. A 129-sample height row
 * called 5000 times per sub-window read 0.86 B/sample with one leaked object per sample (plan section 10).
 */
export function bytesPerCall(fn: (i: number) => void, warm = 3000, calls = 20000, subWindow = SUB_WINDOW): number {
  for (let i = 0; i < warm; i++) fn(i);
  const runs: number[] = [];
  for (let run = 0; run < 4; run++) {
    gc();
    let sum = 0;
    let done = 0;
    while (done < calls) {
      const before = process.memoryUsage().heapUsed;
      for (let i = 0; i < subWindow; i++) fn(done + i);
      const delta = process.memoryUsage().heapUsed - before;
      if (delta > 0) sum += delta;
      done += subWindow;
    }
    runs.push(sum / done);
  }
  runs.sort((a, b) => a - b);
  return (runs[1]! + runs[2]!) / 2;
}
