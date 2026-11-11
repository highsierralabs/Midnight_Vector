// Element fullscreen for the CRUISE card's FULLSCREEN box (amendment FH). The standard API, or the webkit-prefixed one
// that iPadOS Safari before 16.4 needs [M], which TypeScript's lib.dom does not type, so both are read by duck typing
// and this file runs in Node. No rejection leaves it (FH-26): request and exit return promises that always resolve.
import { SimMode } from '../contracts/index';

/** The document's fullscreen members, both forms. Every field is optional, since a browser may have either or neither. */
export interface FsDoc {
  readonly fullscreenEnabled?: unknown;
  readonly webkitFullscreenEnabled?: unknown;
  readonly fullscreenElement?: unknown;
  readonly webkitFullscreenElement?: unknown;
  readonly exitFullscreen?: unknown;
  readonly webkitExitFullscreen?: unknown;
}
/** The element put in fullscreen, here document.documentElement. */
export interface FsTarget {
  readonly requestFullscreen?: unknown;
  readonly webkitRequestFullscreen?: unknown;
}

export const FsApi = { NONE: 0, STANDARD: 1, WEBKIT: 2 } as const;
export type FsApi = (typeof FsApi)[keyof typeof FsApi];

/** FH-5: the standard pair when enabled and its request is a function, else the prefixed pair on the same test, else none. */
export function detectFullscreen(doc: FsDoc, target: FsTarget): FsApi {
  if (doc.fullscreenEnabled === true && typeof target.requestFullscreen === 'function') return FsApi.STANDARD;
  if (doc.webkitFullscreenEnabled === true && typeof target.webkitRequestFullscreen === 'function') return FsApi.WEBKIT;
  return FsApi.NONE;
}

/** The element in fullscreen, from either property, or null. */
export function fullscreenElementOf(doc: FsDoc): unknown {
  const standard = doc.fullscreenElement;
  if (standard !== null && standard !== undefined) return standard;
  const prefixed = doc.webkitFullscreenElement;
  return prefixed !== null && prefixed !== undefined ? prefixed : null;
}

export function isFullscreen(doc: FsDoc): boolean {
  return fullscreenElementOf(doc) !== null;
}

/**
 * FH-7: in fullscreen, Esc belongs to the browser, which leaves fullscreen with it. The game's Esc toggle then does
 * nothing, so one key never both drops fullscreen and resumes or parks the run; FH-8 opens CRUISE from PLAY instead.
 */
export function escIsBrowsers(doc: FsDoc): boolean {
  return isFullscreen(doc);
}

/** FH-9 and FH-26: an exit the box asked for, set when that exit is called, cleared if it rejects. */
export interface OwnExit { pending: boolean }

export function createOwnExit(): OwnExit {
  return { pending: false };
}

/** The next change that finds no element consumes the mark: true when that exit was the box's own. */
export function takeOwnExit(mark: OwnExit, isIn: boolean): boolean {
  if (isIn) return false;
  const own = mark.pending;
  mark.pending = false;
  return own;
}

/** FH-8: leaving fullscreen by anything but the box, while the frame's mode is PLAY, opens CRUISE. */
export function leaveOpensCruise(wasIn: boolean, isIn: boolean, ownExit: boolean, mode: SimMode): boolean {
  return wasIn && !isIn && !ownExit && mode === SimMode.PLAY;
}

function noop(): void { /* settled either way */ }

function call(fn: unknown, self: unknown): unknown {
  return typeof fn === 'function' ? (fn as (this: unknown) => unknown).call(self) : undefined;
}

function isThenable(p: unknown): p is PromiseLike<unknown> {
  return typeof p === 'object' && p !== null && typeof (p as { then?: unknown }).then === 'function';
}

/** Resolves once the browser's request settles, either way; at once for the prefixed form, which returns nothing. */
export function requestFullscreen(api: FsApi, target: FsTarget): Promise<void> {
  try {
    if (api === FsApi.STANDARD) {
      const p = call(target.requestFullscreen, target);
      if (isThenable(p)) return Promise.resolve(p).then(noop, noop);
    } else if (api === FsApi.WEBKIT) {
      call(target.webkitRequestFullscreen, target);
    }
  } catch {
    // A request refused by a throw rather than a rejection: the box is re-read all the same.
  }
  return Promise.resolve();
}

/**
 * Exits through the detected API, only while either property holds an element (FH-26): with none, nothing is asked of
 * the browser, whose exit would reject. The mark is set when the exit is called and cleared if that exit rejects, so a
 * failed exit never hides the next real one from FH-8.
 */
export function exitFullscreen(api: FsApi, doc: FsDoc, mark: OwnExit): Promise<void> {
  if (!isFullscreen(doc)) return Promise.resolve();
  const exit = api === FsApi.STANDARD ? doc.exitFullscreen : api === FsApi.WEBKIT ? doc.webkitExitFullscreen : undefined;
  if (typeof exit !== 'function') return Promise.resolve();
  mark.pending = true;
  const failed = (): void => { mark.pending = false; };
  try {
    const p = call(exit, doc);
    if (isThenable(p)) return Promise.resolve(p).then(noop, failed);
  } catch {
    failed();
  }
  return Promise.resolve();
}
