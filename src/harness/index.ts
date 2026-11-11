// The harness entry point (section 11.3). app/ imports this dynamically, only under ?harness, and calls createHarness
// once, after boot and one real frame. So a normal visit never fetches this chunk, and the isolation test finds it by
// the marker below.
import type { HarnessApi, HarnessHost } from '../contracts/index';
import { createApi, createCore } from './api';
import { createClearSaver } from './controls';
import { createLab, type HarnessLab } from './lab';

declare global {
  interface Window {
    __mv?: HarnessApi;
    __mvLab?: HarnessLab;
    __mvHarnessChunk?: string;
    /** gl.linkProgram calls, from the spy a spec installs with addInitScript. */
    __mvLinks?: number;
  }
}

interface HarnessGlobals { __mv?: HarnessApi; __mvLab?: HarnessLab; __mvHarnessChunk?: string }

// A side effect on purpose: an unused exported constant was removed by the build [O], and the isolation test would then
// have nothing to look for.
(globalThis as HarnessGlobals).__mvHarnessChunk = 'MV-HARNESS-CHUNK';

/** Installs window.__mv and window.__mvLab through globalThis, and returns the API. ready is true from this moment. */
export function createHarness(h: HarnessHost): HarnessApi {
  const core = createCore(h);
  const clear = createClearSaver(h.ctx);
  const api = createApi(core, clear);
  const g = globalThis as HarnessGlobals;
  g.__mv = api;
  g.__mvLab = createLab(core, api, clear);
  return api;
}
