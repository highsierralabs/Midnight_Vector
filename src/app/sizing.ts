// Resize handling (section 10.5). Observers only set a flag; the size is applied in section 3.3 step 9, before drawing.
// The stage wrapper is observed, never the canvas: T06's renderer.setSize pins the canvas's inline size in px.
// The observed box is the trigger only; the ratio always comes from window.devicePixelRatio, because under emulated DPR
// devicePixelContentBoxSize reports the CSS size [O: T10 rehearsal]. A change of the ratio alone has two triggers of
// its own: a resolution media query, and a slow poll against the ratio last applied.
import type { PerspectiveCamera } from 'three';
import type { PostStack } from '../contracts/index';
import { firstPersonFovCap, followGainX } from './follow';

/**
 * How often the ratio is compared with the one last applied. Under CDP's deviceScaleFactor emulation no resize event,
 * observer callback or media query change fires for a ratio change [O: VI-r1, and T10's probe on Chromium 1234], so this
 * poll is the trigger A16d can see. It runs on a timer, never in the frame, so the frame reads no extra DOM property.
 */
export const DPR_POLL_MS = 250;

export interface Sizing {
  /** Camera x per ship x for the current aspect. Recomputed only when a resize applies. */
  readonly gainX: number;
  /** T13: the widest field of view first person may use at the current aspect, in degrees. Recomputed with gainX. */
  readonly fovCapFirst: number;
  /** Applies a pending resize: camera aspect, projection, gainX, fovCapFirst and post.resize. Returns true when it applied one. */
  applyIfDirty(camera: PerspectiveCamera, post: PostStack): boolean;
  dispose(): void;
}

export function createSizing(stage: HTMLElement): Sizing {
  /** appliedDpr: the ratio the last applied resize passed to post.resize; 0 until the first one. */
  const st = { dirty: true, appliedDpr: 0 };
  const mark = (): void => { st.dirty = true; };
  let observer: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(mark);
    try {
      observer.observe(stage, { box: 'device-pixel-content-box' });
    } catch {
      observer.observe(stage, { box: 'content-box' });
    }
  }
  window.addEventListener('resize', mark);
  const vv = window.visualViewport;
  if (vv) vv.addEventListener('resize', mark);

  // A devicePixelRatio change at a fixed CSS size, such as a window moved to a monitor of another density, fires no
  // resize event [O: VI-r1]. A query on the current ratio is the platform's notice of it [M]: it fires once when the ratio
  // leaves that value, so each change marks dirty and re-registers on the new ratio. Not observed to fire under CDP
  // emulation, so the poll below is the trigger the tests reach. Both run at event time, not per frame.
  let dprQuery: MediaQueryList | null = null;
  const onDprChange = (): void => {
    mark();
    watchDpr();
  };
  function watchDpr(): void {
    dprQuery?.removeEventListener('change', onDprChange);
    dprQuery = null;
    if (typeof window.matchMedia !== 'function') return;
    dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    dprQuery.addEventListener('change', onDprChange);
  }
  watchDpr();
  const poll = setInterval(() => {
    if (st.appliedDpr !== 0 && window.devicePixelRatio !== st.appliedDpr) mark();
  }, DPR_POLL_MS);

  // gainX is a plain data field, not a getter: a double returned through a call is boxed every frame (Agents.md).
  const sizing = {
    gainX: followGainX(aspectOf(stage)),
    fovCapFirst: firstPersonFovCap(aspectOf(stage)),
    applyIfDirty(camera: PerspectiveCamera, post: PostStack): boolean {
      if (!st.dirty) return false;
      st.dirty = false;
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      if (w < 1 || h < 1) return false;
      const aspect = w / h;
      if (camera.aspect !== aspect) {
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
      }
      sizing.gainX = followGainX(aspect);
      sizing.fovCapFirst = firstPersonFovCap(aspect);
      const dpr = window.devicePixelRatio;
      post.resize(w, h, dpr);
      st.appliedDpr = dpr;
      return true;
    },
    dispose(): void {
      observer?.disconnect();
      window.removeEventListener('resize', mark);
      if (vv) vv.removeEventListener('resize', mark);
      dprQuery?.removeEventListener('change', onDprChange);
      dprQuery = null;
      clearInterval(poll);
    },
  };
  return sizing;
}

/** The stage's aspect, or 16:9 while it has no size. */
export function aspectOf(stage: HTMLElement): number {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  return w >= 1 && h >= 1 ? w / h : 16 / 9;
}
