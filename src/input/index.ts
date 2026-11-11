// Binds real browser events to the pure core. The only export of this module (section 3.2).
import type { CreateInput } from '../contracts/index';
import { createInputCore, type PointerKind } from './core';
import { keepsKey } from './keys';

function pointerKind(t: string): PointerKind {
  return t === 'mouse' ? 'mouse' : t === 'pen' ? 'pen' : 'touch';
}

/**
 * Arrows must move a slider and Space must press a button, so the focused control keeps those keys (keys.ts). Read
 * from the element focused now rather than the event's target, so a control blurred earlier in the same dispatch no
 * longer holds the key: src/ui hands a focused II back to the ship in PLAY, in the capture phase, and Space then boosts
 * on its first press.
 */
function keptByFocus(code: string): boolean {
  const t = document.activeElement;
  if (!(t instanceof HTMLElement)) return false;
  return keepsKey(t.tagName, t instanceof HTMLInputElement ? t.type : '', t.isContentEditable, code);
}

function onBoostButton(t: EventTarget | null): boolean {
  return t instanceof Element && t.closest('[data-mv-boost]') !== null;
}

export const createInput: CreateInput = () => {
  const core = createInputCore();
  let bound: HTMLElement | null = null;
  let ac: AbortController | null = null;
  let observer: ResizeObserver | null = null;
  let priorTouchAction = '';
  let rectLeft = 0;
  let rectTop = 0;

  function measure(el: HTMLElement): void {
    // Read here only: an event handler never touches layout.
    const r = el.getBoundingClientRect();
    rectLeft = r.left;
    rectTop = r.top;
    core.resize(r.width, r.height);
  }

  function detach(): void {
    if (!bound) return;
    ac?.abort();
    ac = null;
    observer?.disconnect();
    observer = null;
    bound.style.touchAction = priorTouchAction;
    bound = null;
    core.clear();
  }

  function attach(el: HTMLElement): void {
    if (bound === el) return;
    detach();
    bound = el;
    priorTouchAction = el.style.touchAction;
    el.style.touchAction = 'none';
    measure(el);

    const controller = new AbortController();
    ac = controller;
    const opts = { signal: controller.signal };
    const capture = { signal: controller.signal, capture: true };

    el.addEventListener('pointerdown', (e) => {
      const type = pointerKind(e.pointerType);
      core.pointerDown(e.pointerId, type, e.button, e.clientX - rectLeft, e.clientY - rectTop);
      // A mouse button released outside the element must still reach pointerup. Touch has implicit capture.
      if (type === 'mouse') {
        try { el.setPointerCapture(e.pointerId); } catch { /* the pointer has already gone */ }
      }
    }, opts);
    el.addEventListener('pointermove', (e) => {
      const type = pointerKind(e.pointerType);
      core.pointerMove(e.pointerId, type, e.clientX - rectLeft, e.clientY - rectTop);
      // A second button pressed or released during a press reports here, not through pointerdown or pointerup.
      if (type === 'mouse' && e.button !== -1) core.mouseLeft((e.buttons & 1) !== 0);
    }, opts);
    const up = (e: PointerEvent): void => { core.pointerUp(e.pointerId); };
    el.addEventListener('pointerup', up, opts);
    el.addEventListener('pointercancel', up, opts);
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); }, opts);

    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (keptByFocus(e.code)) return;
      if (core.key(e.code, true)) e.preventDefault();
    }, opts);
    // Never filtered: a key pressed on the page and released on a slider must still let go.
    window.addEventListener('keyup', (e) => { core.key(e.code, false); }, opts);
    window.addEventListener('blur', () => { core.clear(); }, opts);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') core.clear();
    }, opts);

    document.addEventListener('pointerdown', (e) => {
      if (onBoostButton(e.target)) core.boostButton(e.pointerId, true);
    }, capture);
    const boostUp = (e: PointerEvent): void => { core.boostButton(e.pointerId, false); };
    document.addEventListener('pointerup', boostUp, capture);
    document.addEventListener('pointercancel', boostUp, capture);
    document.addEventListener('contextmenu', (e) => {
      if (onBoostButton(e.target)) e.preventDefault();
    }, capture);

    observer = new ResizeObserver(() => { measure(el); });
    observer.observe(el);
  }

  return {
    attach,
    detach,
    sample(out) { core.sample(out); },
  };
};
