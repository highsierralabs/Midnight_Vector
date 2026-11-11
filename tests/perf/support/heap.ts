// The sampling heap profile by URL class, and the top functions. Attribution needs /src/... URLs, so this runs on the dev
// server. With both collected flags on it sees short-lived allocation; with both off, only what is still live, which is how
// a leak is told from churn.
import type { CDPSession, Page } from 'playwright/test';
import { probeShift, type ProbeShift } from '../../../src/harness/metrics';

export type HeapClass = 'probe' | 'harness' | 'world' | 'other' | 'libs' | 'engine';

/** First match wins. An empty URL is native code. */
const CLASSES: readonly (readonly [HeapClass, RegExp])[] = [
  ['probe', /\/src\/harness\/hotProbe\.ts/],
  ['harness', /\/src\/(?:harness|testing)\/|\/tests\//],
  ['world', /\/src\/world\//],
  ['other', /\/src\//],
  ['libs', /\/\.vite\/(?:[^/]+\/)?deps\/|\/node_modules\//],
];

export function classify(url: string): HeapClass {
  if (url === '') return 'engine';
  for (const [name, re] of CLASSES) if (re.test(url)) return name;
  return 'engine';
}

/** Section 9.2's per-class lines in bytes per frame, as B19 gates them (DI-16, DI-78). */
export interface ClassLimits { other: number; world: number; libs: number }

const LIMITED = ['other', 'world', 'libs'] as const;

/**
 * B19's class lines as one pure function, so the gate and its control run the same check and the unit suite can hold it
 * to its job. One message per line over its limit, empty when all hold. NaN fails, so a profile that measured nothing
 * cannot pass. probe, harness and engine are not limited here.
 */
export function classLimitProblems(classes: Readonly<Record<HeapClass, number>>, limits: Readonly<ClassLimits>): string[] {
  const out: string[] = [];
  for (const k of LIMITED) {
    if (!(classes[k] <= limits[k])) out.push(`${k} ${classes[k].toFixed(1)} B/frame over ${limits[k]}`);
  }
  return out;
}

/** Where B19 runs: T09's shell page or the integrated app, as `target()` in tests/forever/support/open.ts names them. */
export type WindowsTarget = 'shell' | 'app';
/** B19's windows control: how the probe is laid over the windows, what it allocates per frame, and the line around it. */
export interface WindowsControl { readonly form: 'sequential' | 'interleaved'; readonly bytes: number; readonly tol: number }

/**
 * B19's windows control by target (DI-84, DI-86(2)). The shell's scene is constant, so clean and probe runs 3000 frames
 * apart agree to the byte, and it keeps that form with allocProbe(256) at 256 +/- 16. On the app the clean medians move
 * with the route, and that form read +88.8 to +564.4 for a true 256 [O: T09, repair D], so there probe-on and probe-off
 * windows alternate over one stretch (DI-84). With 256 B there, no-probe readings ran from -58.4 to +127.8 and one real
 * reading was +323.2 [O: T09, repair E], so a 256 +/- 64 band could not separate the probe from the noise. DI-86(2): the
 * app's probe is 1024 B, accepted at 1024 +/- 256, so a probe of 0 still fails by over 600 B. MIN_WINDOW_RUNS and the soft
 * lines are accepted on both (DI-84).
 */
export const WINDOWS_CONTROL: Readonly<Record<WindowsTarget, WindowsControl>> = {
  shell: { form: 'sequential', bytes: 256, tol: 16 },
  app: { form: 'interleaved', bytes: 1024, tol: 256 },
};

/** The windows control's line for one target, through probeShift: with and without are window medians in B/frame. */
export function windowsControlCheck(on: WindowsTarget, withProbe: number, without: number): ProbeShift {
  const c = WINDOWS_CONTROL[on];
  return probeShift(withProbe, without, c.bytes, c.tol);
}

export interface HeapFunction { name: string; url: string; bytes: number; heapClass: HeapClass }
export interface HeapProfile {
  frames: number;
  /** Bytes per frame, per class. */
  classes: Record<HeapClass, number>;
  /** Bytes per frame across all classes. */
  total: number;
  /** Bytes per frame by function, largest first. */
  top: HeapFunction[];
}

interface ProfileNode {
  callFrame: { functionName: string; url: string; lineNumber: number };
  selfSize: number;
  children: ProfileNode[];
}

export interface SampleOptions { collected: boolean; interval?: number }

const TOP = 12;

export function summarise(head: ProfileNode, frames: number): HeapProfile {
  const classes: Record<HeapClass, number> = { probe: 0, harness: 0, world: 0, other: 0, libs: 0, engine: 0 };
  const byFunction = new Map<string, HeapFunction>();
  const walk = (n: ProfileNode): void => {
    if (n.selfSize > 0) {
      const { url, functionName, lineNumber } = n.callFrame;
      const heapClass = classify(url);
      classes[heapClass] += n.selfSize;
      const key = `${functionName}|${url}|${lineNumber}`;
      const f = byFunction.get(key);
      if (f) f.bytes += n.selfSize;
      else byFunction.set(key, { name: functionName || '(anonymous)', url, bytes: n.selfSize, heapClass });
    }
    for (const c of n.children) walk(c);
  };
  walk(head);
  let total = 0;
  for (const k of Object.keys(classes) as HeapClass[]) {
    total += classes[k];
    classes[k] /= frames;
  }
  const top = [...byFunction.values()].sort((a, b) => b.bytes - a.bytes).slice(0, TOP);
  for (const f of top) f.bytes /= frames;
  return { frames, classes, total: total / frames, top };
}

/** Starts sampling, awaits run, which reports how many frames it drove, and summarises per frame. */
export async function sampleHeap(cdp: CDPSession, run: () => Promise<number>, o: SampleOptions): Promise<HeapProfile> {
  await cdp.send('HeapProfiler.startSampling', {
    samplingInterval: o.interval ?? 1024,
    includeObjectsCollectedByMajorGC: o.collected,
    includeObjectsCollectedByMinorGC: o.collected,
  });
  const frames = await run();
  const { profile } = await cdp.send('HeapProfiler.stopSampling');
  return summarise(profile.head as unknown as ProfileNode, frames);
}

export async function openProfiler(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  return cdp;
}

export function printProfile(label: string, p: HeapProfile): void {
  const c = p.classes;
  console.log(`HEAP ${label}: total ${p.total.toFixed(1)} B/frame, probe ${c.probe.toFixed(1)}, harness ${c.harness.toFixed(1)}, world ${c.world.toFixed(1)}, other ${c.other.toFixed(1)}, libs ${c.libs.toFixed(1)}, engine ${c.engine.toFixed(1)}, over ${p.frames} frames`);
  for (const f of p.top) console.log(`HEAP   ${f.bytes.toFixed(1).padStart(9)} ${f.heapClass.padEnd(7)} ${f.name} ${f.url.replace(/^https?:\/\/[^/]+/, '')}`);
}
