// window.__mvE2e: T10's own read-only test object, for T10's and T11's specs only. Not a contract. Imported
// dynamically, and only under ?harness, so a normal visit never loads it.
import type { HarnessHost, SimState } from '../contracts/index';

export interface AppTestHook {
  readonly sim: Readonly<SimState>;
  readonly host: HarnessHost;
  readonly boot: { software: boolean; rendererString: string; measuredP95Ms: number; firstFrameMs: number; depthBits: number };
  readonly counters: { frames: number; rendered: number; rebuilds: number; restores: number; resizes: number };
  contextOk(): boolean;
  camera(): { fov: number; aspect: number; gainX: number };
  forceSignalLost(): void;
  /** rawDt of the last rAF frame in s; 0 on the first frame after a clock reset. */
  lastRawDt(): number;
}

declare global {
  interface Window { __mvE2e?: AppTestHook }
}

export function installTestHook(hook: AppTestHook): void {
  window.__mvE2e = hook;
}
