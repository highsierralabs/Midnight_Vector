// Amendment FH, A28: the fullscreen module over duck-typed documents, so every branch runs in Node (U3 to U10).
import { describe, expect, it } from 'vitest';
import { SimMode } from '../../../src/contracts/index';
import {
  FsApi, createOwnExit, detectFullscreen, escIsBrowsers, exitFullscreen, fullscreenElementOf, isFullscreen,
  leaveOpensCruise, requestFullscreen, takeOwnExit,
} from '../../../src/ui/fullscreen';

const HTML = { tag: 'html' };
const MODES = [SimMode.DEMO, SimMode.PLAY, SimMode.CRUISE, SimMode.SIGNAL_LOST] as const;

/** A stub that records what was called. Members left out are absent, as on a browser without that form. */
function stub(parts: {
  enabled?: unknown; webkitEnabled?: unknown; element?: unknown; webkitElement?: unknown;
  standard?: boolean; webkit?: boolean; request?: () => unknown; exit?: () => unknown;
}) {
  const calls: string[] = [];
  const doc: Record<string, unknown> = {};
  const target: Record<string, unknown> = {};
  if ('enabled' in parts) doc['fullscreenEnabled'] = parts.enabled;
  if ('webkitEnabled' in parts) doc['webkitFullscreenEnabled'] = parts.webkitEnabled;
  if ('element' in parts) doc['fullscreenElement'] = parts.element;
  if ('webkitElement' in parts) doc['webkitFullscreenElement'] = parts.webkitElement;
  if (parts.standard === true) {
    target['requestFullscreen'] = () => { calls.push('requestFullscreen'); return parts.request ? parts.request() : Promise.resolve(); };
    doc['exitFullscreen'] = () => { calls.push('exitFullscreen'); return parts.exit ? parts.exit() : Promise.resolve(); };
  }
  if (parts.webkit === true) {
    target['webkitRequestFullscreen'] = () => { calls.push('webkitRequestFullscreen'); return undefined; };
    doc['webkitExitFullscreen'] = () => { calls.push('webkitExitFullscreen'); return undefined; };
  }
  return { doc, target, calls };
}

/** A promise that settles on a later turn, so a test can tell "resolved at once" from "resolved after it settled". */
function later<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

async function settled(p: Promise<unknown>): Promise<boolean> {
  let done = false;
  void p.then(() => { done = true; });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  return done;
}

describe('detectFullscreen', () => {
  it('U3: the standard API when fullscreenEnabled is true and requestFullscreen is a function', () => {
    expect(detectFullscreen(...pair(stub({ enabled: true, standard: true })))).toBe(FsApi.STANDARD);
    // Chromium has both forms; the standard one wins.
    expect(detectFullscreen(...pair(stub({ enabled: true, webkitEnabled: true, standard: true, webkit: true })))).toBe(FsApi.STANDARD);
  });

  it('U4: the prefixed API when only its pair is there', () => {
    expect(detectFullscreen(...pair(stub({ webkitEnabled: true, webkit: true })))).toBe(FsApi.WEBKIT);
    // The standard flag false, as in an iframe that allows only the prefixed form, still finds the prefixed pair.
    expect(detectFullscreen(...pair(stub({ enabled: false, webkitEnabled: true, standard: true, webkit: true })))).toBe(FsApi.WEBKIT);
  });

  it('U5: none when enabled is false, when the request is missing, or when neither form exists', () => {
    // FH-R2 (2): both flags false with all four request and exit functions present, as in an iframe without allow.
    expect(detectFullscreen(...pair(stub({ enabled: false, webkitEnabled: false, standard: true, webkit: true })))).toBe(FsApi.NONE);
    expect(detectFullscreen(...pair(stub({ enabled: true, webkitEnabled: true })))).toBe(FsApi.NONE);
    expect(detectFullscreen(...pair(stub({})))).toBe(FsApi.NONE);
    // Truthy is not enough: the test is === true.
    expect(detectFullscreen(...pair(stub({ enabled: 1, webkitEnabled: 'yes', standard: true, webkit: true })))).toBe(FsApi.NONE);
  });
});

function pair(s: { doc: Record<string, unknown>; target: Record<string, unknown> }): [Record<string, unknown>, Record<string, unknown>] {
  return [s.doc, s.target];
}

describe('fullscreen state', () => {
  it('U6: the element is read from either property, and null when neither holds one', () => {
    expect(fullscreenElementOf({ fullscreenElement: HTML })).toBe(HTML);
    expect(fullscreenElementOf({ webkitFullscreenElement: HTML })).toBe(HTML);
    expect(fullscreenElementOf({ fullscreenElement: null, webkitFullscreenElement: HTML })).toBe(HTML);
    expect(fullscreenElementOf({ fullscreenElement: null, webkitFullscreenElement: null })).toBeNull();
    expect(fullscreenElementOf({})).toBeNull();
    expect(isFullscreen({ webkitFullscreenElement: HTML })).toBe(true);
    expect(isFullscreen({ fullscreenElement: null })).toBe(false);
  });
});

describe('requestFullscreen', () => {
  it('U7: goes through the detected API; the standard promise is waited for, the prefixed form resolves at once', async () => {
    const pending = later<void>();
    const std = stub({ enabled: true, webkitEnabled: true, standard: true, webkit: true, request: () => pending.promise });
    const p = requestFullscreen(FsApi.STANDARD, std.target);
    expect(std.calls).toEqual(['requestFullscreen']);
    expect(await settled(p)).toBe(false);
    pending.resolve();
    expect(await settled(p)).toBe(true);

    const wk = stub({ webkitEnabled: true, standard: true, webkit: true });
    const q = requestFullscreen(FsApi.WEBKIT, wk.target);
    expect(wk.calls).toEqual(['webkitRequestFullscreen']);
    expect(await settled(q)).toBe(true);

    const none = stub({ standard: true, webkit: true });
    expect(await settled(requestFullscreen(FsApi.NONE, none.target))).toBe(true);
    expect(none.calls).toEqual([]);
  });

  it('U7: a request whose promise rejects, or that throws, still gives a resolved promise', async () => {
    const pending = later<void>();
    const std = stub({ enabled: true, standard: true, request: () => pending.promise });
    const p = requestFullscreen(FsApi.STANDARD, std.target);
    pending.reject(new TypeError('Permissions check failed'));
    await expect(p).resolves.toBeUndefined();
    const thrower = stub({ enabled: true, standard: true, request: () => { throw new TypeError('no'); } });
    await expect(requestFullscreen(FsApi.STANDARD, thrower.target)).resolves.toBeUndefined();
  });
});

describe('exitFullscreen', () => {
  it('U8: goes through the detected API while either property holds an element, and sets the own-exit mark', async () => {
    const std = stub({ enabled: true, element: HTML, standard: true, webkit: true });
    const mark = createOwnExit();
    await exitFullscreen(FsApi.STANDARD, std.doc, mark);
    expect(std.calls).toEqual(['exitFullscreen']);
    expect(mark.pending).toBe(true);

    const wk = stub({ webkitEnabled: true, webkitElement: HTML, standard: true, webkit: true });
    const mark2 = createOwnExit();
    await exitFullscreen(FsApi.WEBKIT, wk.doc, mark2);
    expect(wk.calls).toEqual(['webkitExitFullscreen']);
    expect(mark2.pending).toBe(true);
  });

  it('U8: with no element nothing is called, the mark stays clear, and the promise resolves', async () => {
    const std = stub({ enabled: true, element: null, webkitElement: null, standard: true, webkit: true });
    const mark = createOwnExit();
    await expect(exitFullscreen(FsApi.STANDARD, std.doc, mark)).resolves.toBeUndefined();
    await expect(exitFullscreen(FsApi.WEBKIT, std.doc, mark)).resolves.toBeUndefined();
    expect(std.calls).toEqual([]);
    expect(mark.pending).toBe(false);
  });

  it('U8: an exit whose promise rejects still gives a resolved promise', async () => {
    const std = stub({ enabled: true, element: HTML, standard: true, exit: () => Promise.reject(new TypeError('Document not active')) });
    await expect(exitFullscreen(FsApi.STANDARD, std.doc, createOwnExit())).resolves.toBeUndefined();
    const thrower = stub({ enabled: true, element: HTML, standard: true, exit: () => { throw new TypeError('no'); } });
    await expect(exitFullscreen(FsApi.STANDARD, thrower.doc, createOwnExit())).resolves.toBeUndefined();
  });

  it('U8: the mark is cleared when its exit rejects, so a later change from in to out in PLAY still opens CRUISE', async () => {
    const std = stub({ enabled: true, element: HTML, standard: true, exit: () => Promise.reject(new TypeError('Document not active')) });
    const mark = createOwnExit();
    const p = exitFullscreen(FsApi.STANDARD, std.doc, mark);
    expect(mark.pending).toBe(true);
    await p;
    expect(mark.pending).toBe(false);
    const own = takeOwnExit(mark, false);
    expect(own).toBe(false);
    expect(leaveOpensCruise(true, false, own, SimMode.PLAY)).toBe(true);

    // The mark of an exit that did not reject is consumed by the next change that finds no element, and only once.
    const ok = stub({ enabled: true, element: HTML, standard: true });
    const mark2 = createOwnExit();
    await exitFullscreen(FsApi.STANDARD, ok.doc, mark2);
    expect(takeOwnExit(mark2, true)).toBe(false);
    expect(mark2.pending).toBe(true);
    expect(takeOwnExit(mark2, false)).toBe(true);
    expect(takeOwnExit(mark2, false)).toBe(false);
  });
});

describe('rules', () => {
  it('U9: leaving opens CRUISE only from in to out, not by the box, and in PLAY', () => {
    for (const mode of MODES) {
      for (const own of [false, true]) {
        for (const [wasIn, isIn] of [[false, false], [false, true], [true, false], [true, true]] as const) {
          const expected = wasIn && !isIn && !own && mode === SimMode.PLAY;
          expect(leaveOpensCruise(wasIn, isIn, own, mode), `mode ${mode} own ${own} ${wasIn} to ${isIn}`).toBe(expected);
        }
      }
    }
  });

  it('U10: Esc belongs to the browser exactly when either property holds an element', () => {
    expect(escIsBrowsers({ fullscreenElement: HTML })).toBe(true);
    expect(escIsBrowsers({ webkitFullscreenElement: HTML })).toBe(true);
    expect(escIsBrowsers({ fullscreenElement: null, webkitFullscreenElement: HTML })).toBe(true);
    expect(escIsBrowsers({ fullscreenElement: null, webkitFullscreenElement: null })).toBe(false);
    expect(escIsBrowsers({})).toBe(false);
  });
});
