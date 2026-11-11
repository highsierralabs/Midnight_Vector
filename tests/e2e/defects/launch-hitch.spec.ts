// D-009: the launch-click hitch, as a gate (DI-79, restated by DI-83, with the click frame defined by DI-86(1) and read
// in the rAF entry clock by DI-87). On the app the launching gesture is a mouse release on T08's title: pointerup
// launches, and the click that follows in the same dispatch is a no-op. The gesture's synchronous span runs from a
// window capture listener on that pointerup to a window bubble listener on the click, both installed before any page
// script, so every project listener on the path runs inside it. The budget, as literals:
//   (1) the span less the AudioContext constructor and resume(), that is the project's own synchronous work: at most 8 ms;
//   (2) every frame in the 2 s after the click other than the click frame: at most 33 ms, by entry and by rAF timestamp;
//   (3) the click frame, from the gesture event's own timestamp to the entry of the first rAF callback after it: at most
//       the constructor's own time plus 8 ms.
// The first launch runs in a fresh browser, whose first AudioContext costs 33 to 49 ms here [O: T07], and the second in
// the same browser. Controls, injected by the recorder from outside the app because T07's ?legacy=1 lives only on
// dev/audio.html: 20 ms inside the gesture fails (1) and (3); a 45 ms stall 1 s later fails (2) and not (1); 20 ms in
// the click frame after the span fails (3) and not (1). A print-only row checks the round-1 reading of a 90 to 104 ms
// frame before the click against the CPU profiler's own start (DI-83).
import { chromium, type Browser, type Page } from 'playwright/test';
import { expect, test } from '../../support/pw';
import { nodeWait, openApp } from '../lib/app';

const HITCH = { ownSyncMs: 8, frameMs: 33, clickOverCtorMs: 8, windowMs: 2000 } as const;
const CLICK = { x: 960, y: 700 } as const;

/** Faults for the controls. inside: busy-wait in the capture listener, inside the span. after: busy-wait in the bubble listener after the span is read. stall: busy-wait in the recorder's rAF callback on the first frame stallAt ms or more after the gesture. */
interface Faults { insideMs?: number; afterMs?: number; stallAtMs?: number; stallMs?: number }

interface Reading {
  spanMs: number; ctorMs: number; resumeMs: number; ownMs: number;
  clickFrameMs: number; clickFound: boolean; lagMs: number; framesInSpan: number;
  otherMs: number; long: string[];
  soundMs: number; contexts: number; state: string; mode: string | null;
  errors: string[];
}

async function installRecorder(page: Page, f: Faults): Promise<void> {
  await page.addInitScript((faults: Faults) => {
    const h = {
      t0: -1, ts: NaN, t1: -1, frames: [] as number[], ctor: [] as number[], ctorAt: [] as number[],
      resume: [] as number[], resumeAt: [] as number[], starts: [] as number[], contexts: [] as AudioContext[],
    };
    (window as unknown as { __hitch: typeof h }).__hitch = h;
    const busy = (ms: number): void => { const end = performance.now() + ms; while (performance.now() < end) { /* the fault */ } };
    window.addEventListener('pointerup', (ev) => {
      if (h.t0 >= 0 || ev.button !== 0) return;
      h.t0 = performance.now();
      h.ts = ev.timeStamp;
      if (faults.insideMs !== undefined) busy(faults.insideMs);
    }, true);
    window.addEventListener('click', () => {
      if (h.t0 < 0 || h.t1 >= 0) return;
      h.t1 = performance.now();
      if (faults.afterMs !== undefined) busy(faults.afterMs);
    }, false);
    let stalled = false;
    const rec = (t: number): void => {
      const now = performance.now();
      h.frames.push(now, t);
      if (faults.stallMs !== undefined && !stalled && h.t0 >= 0 && now - h.t0 >= (faults.stallAtMs ?? 0)) { stalled = true; busy(faults.stallMs); }
      requestAnimationFrame(rec);
    };
    requestAnimationFrame(rec);
    const Real = window.AudioContext;
    window.AudioContext = class extends Real {
      constructor(o?: AudioContextOptions) {
        const a = performance.now();
        super(o);
        h.ctor.push(performance.now() - a);
        h.ctorAt.push(a);
        h.contexts.push(this);
      }

      override resume(): Promise<void> {
        const a = performance.now();
        const p = super.resume();
        h.resume.push(performance.now() - a);
        h.resumeAt.push(a);
        return p;
      }
    };
    const note = (c: BaseAudioContext): void => { if (!(c instanceof OfflineAudioContext)) h.starts.push(performance.now()); };
    const start = AudioScheduledSourceNode.prototype.start;
    AudioScheduledSourceNode.prototype.start = function patched(this: AudioScheduledSourceNode, when?: number) { note(this.context); return start.call(this, when); };
    if (Object.prototype.hasOwnProperty.call(AudioBufferSourceNode.prototype, 'start')) {
      const bufferStart = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function patchedBuffer(this: AudioBufferSourceNode, ...args: [number?, number?, number?]) { note(this.context); return bufferStart.apply(this, args); };
    }
  }, f);
}

async function readHitch(page: Page): Promise<Omit<Reading, 'errors'>> {
  return page.evaluate((windowMs) => {
    const h = (window as unknown as { __hitch: { t0: number; ts: number; t1: number; frames: number[]; ctor: number[]; ctorAt: number[]; resume: number[]; resumeAt: number[]; starts: number[]; contexts: AudioContext[] } }).__hitch;
    const k0 = h.t0, k1 = h.t1;
    const inside = (t: number): boolean => t >= k0 && t <= k1;
    let ctorMs = 0;
    for (let i = 0; i < h.ctor.length; i++) if (inside(h.ctorAt[i]!)) ctorMs += h.ctor[i]!;
    let resumeMs = 0;
    for (let i = 0; i < h.resume.length; i++) if (inside(h.resumeAt[i]!)) resumeMs += h.resume[i]!;
    // Entry intervals [e0, e1] and timestamp intervals [s0, s1], each ending in the window. The click frame by entry is
    // the one interval that holds the gesture, and its end the first entry after it (DI-87). By timestamp it is the
    // interval with the most overlap with the span; both are exempt from (2), every other interval is held to it.
    const overlap = (a: number, b: number): number => Math.max(0, Math.min(b, k1) - Math.max(a, k0));
    let framesInSpan = 0;
    let ie = -1, is = -1, beo = 0, bso = 0;
    const rows: { at: number; de: number; ds: number; e1: number }[] = [];
    for (let i = 2; i < h.frames.length; i += 2) {
      const e0 = h.frames[i - 2]!, e1 = h.frames[i]!, s0 = h.frames[i - 1]!, s1 = h.frames[i + 1]!;
      if (e1 > k0 && e1 < k1) framesInSpan += 1;
      if (e1 < k0 || e1 > k0 + windowMs) continue;
      const row = { at: e1 - k0, de: e1 - e0, ds: s1 - s0, e1 };
      if (e0 <= k0 && e1 >= k0 && ie < 0) ie = rows.length;
      const eo = overlap(e0, e1), so = overlap(s0, s1);
      if (eo > beo) beo = eo;
      if (so > 0 && so > bso) { bso = so; is = rows.length; }
      rows.push(row);
    }
    const from = Number.isFinite(h.ts) ? Math.min(h.ts, k0) : NaN;
    const clickFrameMs = ie >= 0 ? rows[ie]!.e1 - from : NaN;
    let otherMs = 0;
    const long: string[] = [];
    rows.forEach((r, i) => {
      if (i !== ie) otherMs = Math.max(otherMs, r.de);
      if (i !== is) otherMs = Math.max(otherMs, r.ds);
      if (i === ie || i === is || Math.max(r.de, r.ds) > 25) long.push(`+${r.at.toFixed(0)}: entry ${r.de.toFixed(1)} ts ${r.ds.toFixed(1)}${i === ie ? ' click(entry)' : ''}${i === is ? ' click(ts)' : ''}`);
    });
    const sound = h.starts.find((t) => t >= k0);
    const ctx = h.contexts[0];
    return {
      spanMs: k1 - k0, ctorMs, resumeMs, ownMs: k1 - k0 - ctorMs - resumeMs,
      clickFrameMs, clickFound: ie >= 0, lagMs: k0 - h.ts, framesInSpan, otherMs, long,
      soundMs: sound === undefined ? Infinity : sound - k0, contexts: h.contexts.length, state: ctx ? ctx.state : 'none',
      mode: document.documentElement.getAttribute('data-mv-mode'),
    };
  }, HITCH.windowMs);
}

const V_OWN = 'the gesture less the constructor and resume()';
const V_OTHER = 'a frame other than the click frame';
const V_CLICK = 'the click frame';

function violations(r: Reading): string[] {
  const out: string[] = [];
  if (!(r.ownMs <= HITCH.ownSyncMs)) out.push(`${V_OWN} ran ${r.ownMs.toFixed(1)} ms (limit ${HITCH.ownSyncMs})`);
  if (!(r.otherMs <= HITCH.frameMs)) out.push(`${V_OTHER} ran ${r.otherMs.toFixed(1)} ms within ${HITCH.windowMs} ms of the click (limit ${HITCH.frameMs})`);
  if (!r.clickFound) out.push('no frame interval holds the gesture');
  else if (!(r.clickFrameMs <= r.ctorMs + HITCH.clickOverCtorMs)) out.push(`${V_CLICK}, from the gesture's timestamp to the next entry, ran ${r.clickFrameMs.toFixed(1)} ms (limit the constructor's ${r.ctorMs.toFixed(1)} + ${HITCH.clickOverCtorMs})`);
  if (r.framesInSpan !== 0) out.push(`${r.framesInSpan} rAF entries inside the gesture's span, so it is not one task`);
  if (r.state !== 'running') out.push(`state ${r.state}`);
  if (r.contexts !== 1) out.push(`${r.contexts} AudioContexts`);
  if (r.mode !== 'play') out.push(`mode ${r.mode}`);
  if (r.errors.length > 0) out.push(`console errors: ${r.errors.join(' | ')}`);
  return out;
}

const fmt = (r: Reading): string =>
  `span ${r.spanMs.toFixed(2)} ms (constructor ${r.ctorMs.toFixed(2)}, resume ${r.resumeMs.toFixed(2)}, own ${r.ownMs.toFixed(2)}), ` +
  `click frame from the gesture ${r.clickFrameMs.toFixed(1)} ms (over the constructor ${(r.clickFrameMs - r.ctorMs).toFixed(1)}; timestamp ${r.lagMs.toFixed(2)} ms before dispatch), ` +
  `other frames at most ${r.otherMs.toFixed(1)} ms [${r.long.join(', ')}], first sound +${r.soundMs.toFixed(0)} ms, ${r.state}, mode ${r.mode}`;

async function launchOnce(browser: Browser, baseURL: string, f: Faults): Promise<Reading> {
  const context = await browser.newContext({ baseURL, viewport: { width: 1920, height: 1080 } });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => { errors.push(e.message); });
    await installRecorder(page, f);
    // openApp waits on the console only, so nothing grants activation before the real gesture.
    await openApp(page);
    await nodeWait(1500);
    await page.mouse.click(CLICK.x, CLICK.y);
    await nodeWait(HITCH.windowMs + 200);
    return { ...(await readHitch(page)), errors };
  } finally {
    await context.close();
  }
}

const pairs = new Map<string, Promise<[Reading, Reading]>>();
function pairFor(info: { project: { use: { launchOptions?: Parameters<typeof chromium.launch>[0] } } }, baseURL: string, tag: string, f: Faults = {}): Promise<[Reading, Reading]> {
  const key = JSON.stringify(f);
  let p = pairs.get(key);
  if (!p) {
    p = (async (): Promise<[Reading, Reading]> => {
      const browser = await chromium.launch({ ...(info.project.use.launchOptions ?? {}), headless: true });
      try {
        const cold = await launchOnce(browser, baseURL, f);
        const warm = await launchOnce(browser, baseURL, f);
        console.log(`HITCH ${tag}, first launch in a fresh browser: ${fmt(cold)}`);
        console.log(`HITCH ${tag}, second launch in that browser: ${fmt(warm)}`);
        return [cold, warm];
      } finally {
        await browser.close();
      }
    })();
    pairs.set(key, p);
  }
  return p;
}

test.beforeEach(({}, info) => { test.skip(info.project.name !== 'gpu', 'gpu only: tier-0 software frames exceed 33 ms by design (D-007)'); });

test('launch hitch: DI-83, first launch in a fresh browser: own work at most 8 ms, other frames at most 33 ms, click frame at most the constructor plus 8 ms', async ({ baseURL }, info) => {
  test.setTimeout(120_000);
  const [cold] = await pairFor(info, baseURL!, 'D1');
  const v = violations(cold);
  console.log(`HITCH DI-83, first launch: ${v.join('; ') || 'no violation'}`);
  expect(v).toEqual([]);
});

test('launch hitch: DI-83, second launch in one browser: own work at most 8 ms, other frames at most 33 ms, click frame at most the constructor plus 8 ms', async ({ baseURL }, info) => {
  test.setTimeout(120_000);
  const [, warm] = await pairFor(info, baseURL!, 'D1');
  const v = violations(warm);
  console.log(`HITCH DI-83, second launch: ${v.join('; ') || 'no violation'}`);
  expect(v).toEqual([]);
});

test('launch hitch control: 20 ms inside the gesture fails the own-work limit and the click-frame limit', async ({ baseURL }, info) => {
  test.setTimeout(120_000);
  for (const r of await pairFor(info, baseURL!, 'control, 20 ms inside the gesture', { insideMs: 20 })) {
    const v = violations(r);
    console.log(`HITCH control, 20 ms inside: ${v.join('; ')}`);
    expect(v.some((s) => s.startsWith(V_OWN))).toBe(true);
    expect(v.some((s) => s.startsWith(V_CLICK))).toBe(true);
    expect(r.state).toBe('running');
  }
});

test('launch hitch control: a 45 ms stall 1 s after the click fails the other-frames limit, and not the own-work limit', async ({ baseURL }, info) => {
  test.setTimeout(120_000);
  for (const r of await pairFor(info, baseURL!, 'control, 45 ms stall at +1 s', { stallAtMs: 1000, stallMs: 45 })) {
    const v = violations(r);
    console.log(`HITCH control, stall: ${v.join('; ')}`);
    expect(v.some((s) => s.startsWith(V_OTHER))).toBe(true);
    expect(v.some((s) => s.startsWith(V_OWN))).toBe(false);
  }
});

test('launch hitch control: 20 ms in the click frame after the span fails the click-frame limit, and not the own-work limit', async ({ baseURL }, info) => {
  test.setTimeout(120_000);
  for (const r of await pairFor(info, baseURL!, 'control, 20 ms after the span', { afterMs: 20 })) {
    const v = violations(r);
    console.log(`HITCH control, after the span: ${v.join('; ')}`);
    expect(v.some((s) => s.startsWith(V_CLICK))).toBe(true);
    expect(v.some((s) => s.startsWith(V_OWN))).toBe(false);
  }
});

interface PNode { id: number; callFrame: { functionName: string; url: string; lineNumber: number } }
interface Prof { nodes: PNode[]; samples: number[]; timeDeltas: number[] }

/**
 * DI-83 asks T10 to confirm that round 1's first long entry, 90 to 104 ms and stamped before the click, is the CPU
 * profiler's own start. Two pages in one browser, the same steps: one starts the profiler before the click, as round 1's
 * spec did, and one does not. The long frame must overlap the Profiler.start call and appear only on that page.
 */
test('launch hitch, print: the long frame before the click is Profiler.start, not the app (DI-83)', async ({ browser }) => {
  test.setTimeout(120_000);
  const run = async (profile: boolean): Promise<{ long: { e0: number; e1: number; d: number }[]; p0: number; p1: number; click: number; top: string[] }> => {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();
    await openApp(page);
    await nodeWait(2000);
    await page.evaluate(() => {
      const w = window as unknown as { __e: number[] };
      w.__e = [];
      (function rec() { w.__e.push(performance.now()); requestAnimationFrame(rec); })();
    });
    const cdp = await page.context().newCDPSession(page);
    let p0 = NaN, p1 = NaN;
    if (profile) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
      p0 = await page.evaluate(() => performance.now());
      await cdp.send('Profiler.start');
      p1 = await page.evaluate(() => performance.now());
    } else {
      await nodeWait(30);
    }
    const click = await page.evaluate(() => performance.now());
    await page.mouse.click(CLICK.x, CLICK.y);
    await nodeWait(2500);
    const top: string[] = [];
    if (profile) {
      const { profile: prof } = await cdp.send('Profiler.stop') as { profile: Prof };
      const byId = new Map(prof.nodes.map((n) => [n.id, n]));
      const bySrc = new Map<string, number>();
      for (let i = 0; i < prof.samples.length; i++) {
        const n = byId.get(prof.samples[i]!)!;
        const url = n.callFrame.url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '');
        const src = /\/src\/[^/]+(?:\/[^/]+)?/.exec(url)?.[0] ?? (url.includes('/deps/') ? 'deps' : url || '(native)');
        bySrc.set(src, (bySrc.get(src) ?? 0) + (prof.timeDeltas[i] ?? 0) / 1000);
      }
      for (const [k, v] of [...bySrc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) top.push(`${k} ${v.toFixed(1)} ms`);
    }
    const e = await page.evaluate(() => (window as unknown as { __e: number[] }).__e);
    const long: { e0: number; e1: number; d: number }[] = [];
    for (let i = 1; i < e.length; i++) if (e[i]! - e[i - 1]! > 25 && e[i]! > click - 500) long.push({ e0: e[i - 1]! - click, e1: e[i]! - click, d: e[i]! - e[i - 1]! });
    await context.close();
    return { long, p0: p0 - click, p1: p1 - click, click: 0, top };
  };
  const withProf = await run(true);
  const without = await run(false);
  console.log(`HITCH profiler page: Profiler.start call from ${withProf.p0.toFixed(1)} to ${withProf.p1.toFixed(1)} ms relative to the click; long entries ${JSON.stringify(withProf.long.map((l) => `${l.e0.toFixed(0)}..${l.e1.toFixed(0)}: ${l.d.toFixed(1)}`))}; by source ${withProf.top.join(', ')}`);
  console.log(`HITCH no-profiler page: long entries ${JSON.stringify(without.long.map((l) => `${l.e0.toFixed(0)}..${l.e1.toFixed(0)}: ${l.d.toFixed(1)}`))}`);
  const before = (l: { e0: number; e1: number }): boolean => l.e0 < 0;
  const pre = withProf.long.filter(before);
  expect(pre.length, 'a long entry interval starting before the click, on the profiler page').toBeGreaterThan(0);
  expect(pre.some((l) => l.e0 <= withProf.p1 && l.e1 >= withProf.p0), 'it overlaps the Profiler.start call').toBe(true);
  expect(without.long.filter((l) => before(l) && l.d > 60), 'no such frame without the profiler').toEqual([]);
});
