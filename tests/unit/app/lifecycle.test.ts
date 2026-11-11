// Section 10.2's safety net in lifecycle.ts: a context loss arms the RESTORE_TIMEOUT fatal timer before it calls into
// T08, so a throw from ui.showContextLost(true) cannot leave a frozen picture with no fatal page (VI-r1). Node has no
// DOM, so the canvas and document are recording stand-ins and the timer is Vitest's fake clock.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioEngine, FatalReason, InputSource, Ui } from '../../../src/contracts/index';
import { createLifecycle, RESTORE_TIMEOUT_MS, type LifecycleApp } from '../../../src/app/lifecycle';
import { createCounters, createFlags } from '../../../src/app/loop';

type Listener = () => void;

function rig(o: { throwOnLost: boolean }) {
  const log: string[] = [];
  const listeners = new Map<string, Listener>();
  const canvas = {
    addEventListener(type: string, fn: Listener) { listeners.set(type, fn); },
    remove() { log.push('canvas.remove'); },
  } as unknown as HTMLCanvasElement;
  const root = { dataset: {} as Record<string, string> } as unknown as HTMLElement;
  const ui: Ui = {
    mount() { /* not used */ },
    frame() { /* not used */ },
    showContextLost(lost) {
      log.push(`showContextLost:${lost}`);
      if (lost && o.throwOnLost) throw new Error('showContextLost fault');
    },
    showFatal(r: FatalReason) { log.push(`showFatal:${r}`); },
  };
  const audio: AudioEngine = {
    unlock: () => Promise.resolve(), frame() { /* not used */ }, setVolume() { /* not used */ },
    suspend() { /* not used */ }, resume() { /* not used */ }, dispose() { log.push('audio.dispose'); },
  };
  const input: InputSource = { attach() { /* not used */ }, sample() { /* not used */ }, detach() { log.push('input.detach'); } };
  const app: LifecycleApp = { canvas, root, ui, audio, input, flags: createFlags(), counters: createCounters(), post: null, loop: null };
  const life = createLifecycle(app);
  life.wire();
  const fire = (type: string): void => {
    const fn = listeners.get(type);
    if (!fn) throw new Error(`no ${type} listener`);
    fn();
  };
  return { log, app, life, fire };
}

describe('lifecycle: the restore timeout (section 10.2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('document', { addEventListener() { /* visibilitychange: not used here */ }, visibilityState: 'visible' });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('a throwing showContextLost(true) still arms the fatal timer: the fatal page at RESTORE_TIMEOUT_MS (VI-r1)', () => {
    const r = rig({ throwOnLost: true });
    expect(() => { r.fire('webglcontextlost'); }).toThrow('showContextLost fault');
    expect(r.app.flags.contextOk).toBe(false);
    vi.advanceTimersByTime(RESTORE_TIMEOUT_MS - 1);
    expect(r.log).not.toContain('showFatal:context-lost-permanent');
    expect(r.life.dead).toBe(false);
    vi.advanceTimersByTime(1);
    expect(r.life.dead).toBe(true);
    expect(r.log.slice(1)).toEqual(['input.detach', 'audio.dispose', 'showFatal:context-lost-permanent', 'canvas.remove']);
  });

  it('control: a loss with a working UI reaches the fatal page at the same time', () => {
    const r = rig({ throwOnLost: false });
    r.fire('webglcontextlost');
    expect(r.log).toEqual(['showContextLost:true']);
    vi.advanceTimersByTime(RESTORE_TIMEOUT_MS);
    expect(r.log).toEqual(['showContextLost:true', 'input.detach', 'audio.dispose', 'showFatal:context-lost-permanent', 'canvas.remove']);
  });

  it('control: a restore before the timeout clears the timer, so no fatal page', async () => {
    const r = rig({ throwOnLost: false });
    r.fire('webglcontextlost');
    vi.advanceTimersByTime(RESTORE_TIMEOUT_MS - 1000);
    r.fire('webglcontextrestored');
    await Promise.resolve();
    expect(r.app.flags.contextOk).toBe(true);
    vi.advanceTimersByTime(RESTORE_TIMEOUT_MS * 2);
    expect(r.life.dead).toBe(false);
    expect(r.log).toEqual(['showContextLost:true', 'showContextLost:false']);
  });
});
