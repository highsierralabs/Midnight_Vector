// Context loss and restore (section 10.2), hidden tabs (section 10.4), and the one fatal route. Wired after the renderer
// exists, because three's own context listeners must run before these, and listeners run in registration order.
import type { AudioEngine, FatalReason, InputSource, PostStack, Ui } from '../contracts/index';
import type { Loop, LoopCounters, LoopFlags } from './loop';

export const RESTORE_TIMEOUT_MS = 15_000;

/** Read at event time: boot fills in post and loop after the listeners are wired. */
export interface LifecycleApp {
  readonly canvas: HTMLCanvasElement;
  readonly root: HTMLElement;
  readonly ui: Ui;
  readonly audio: AudioEngine;
  readonly input: InputSource;
  readonly flags: LoopFlags;
  readonly counters: LoopCounters;
  post: PostStack | null;
  loop: Loop | null;
}

export interface Lifecycle {
  /** Once only. Stops the loop, shows T08's fatal page, removes the canvas. */
  onFatal(r: FatalReason, e: unknown): void;
  readonly dead: boolean;
  /** Adds the context and visibility listeners. Call after the renderer exists, so three's own run first. */
  wire(): void;
}

export function createLifecycle(app: LifecycleApp): Lifecycle {
  let dead = false;
  let restoreGen = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function onFatal(r: FatalReason, e: unknown): void {
    if (dead) return;
    dead = true;
    app.loop?.stop();
    clearTimer();
    if (r !== 'context-lost-permanent') console.error('FATAL', r, e);
    app.root.dataset['mvBoot'] = 'running';
    try { app.input.detach(); } catch (x) { console.warn('MV: input.detach threw on the fatal route', x); }
    try { app.audio.dispose(); } catch (x) { console.warn('MV: audio.dispose threw on the fatal route', x); }
    app.ui.showFatal(r);
    app.canvas.remove();
  }

  function onLost(): void {
    if (dead) return;
    app.flags.contextOk = false;
    restoreGen += 1;
    // The safety net first, then T08: a throw from showContextLost must not leave a frozen picture with no fatal timer
    // (VI-r1). The throw itself is not caught here, so it still reaches the page's error reporting.
    clearTimer();
    timer = setTimeout(() => { onFatal('context-lost-permanent', null); }, RESTORE_TIMEOUT_MS);
    app.ui.showContextLost(true);
  }

  async function onRestored(): Promise<void> {
    if (dead) return;
    clearTimer();
    app.counters.restores += 1;
    const gen = restoreGen;
    const post = app.post;
    const loop = app.loop;
    if (post !== null && loop !== null) {
      if (app.flags.tierHeld) {
        app.flags.tierHeld = false;
        loop.applyQuality();
      }
      loop.rebuildAll();
      await post.precompile();
      // Lost again while compiling: the newer restore owns recovery.
      if (gen !== restoreGen || dead) return;
    }
    // One synchronous step, so the overlay and contextOk flip together (T09's B12 seam).
    app.flags.contextOk = true;
    app.flags.restorePending = true;
    app.ui.showContextLost(false);
  }

  function wire(): void {
    app.canvas.addEventListener('webglcontextlost', onLost);
    app.canvas.addEventListener('webglcontextrestored', () => {
      onRestored().catch((e: unknown) => { onFatal('runtime-error', e); });
    });
    document.addEventListener('visibilitychange', () => {
      if (dead) return;
      if (document.visibilityState === 'hidden') {
        app.audio.suspend();
      } else {
        app.loop?.resetClock();
        app.audio.resume();
      }
    });
  }

  return {
    onFatal,
    get dead() { return dead; },
    wire,
  };
}
