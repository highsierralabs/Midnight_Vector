// UiCommands routed to live objects (T02's and T08's seams). Pure: no DOM, no clock.
import { SimMode, type AudioEngine, type CamMode, type Governor, type Sim, type Tier, type UiCommands } from '../contracts/index';

export interface CommandDeps {
  readonly sim: Sim;
  readonly audio: AudioEngine;
  readonly view: { reducedMotion: boolean };
  /** T13: the camera state; the loop moves the camera toward `want`. */
  readonly cam: { want: CamMode };
  /** The final governor, or null while boot is still running. */
  governor(): Governor | null;
}

export interface AppCommands extends UiCommands {
  /** The last setQuality made before the final governor existed, or null. Read once by boot. */
  readonly buffered: Tier | 'auto' | null;
}

export function createCommands(d: CommandDeps): AppCommands {
  let buffered: Tier | 'auto' | null = null;
  return {
    get buffered() { return buffered; },
    launch() {
      if (d.sim.state.mode !== SimMode.DEMO) return;
      // Same synchronous stack as the gesture, never awaited: unlock never rejects (section 8.1).
      void d.audio.unlock();
      d.sim.command('launch');
    },
    togglePause() {
      const m = d.sim.state.mode;
      if (m === SimMode.PLAY) d.sim.command('pause');
      else if (m === SimMode.CRUISE) d.sim.command('resume');
    },
    setQuality(t) {
      const g = d.governor();
      if (g) g.force(t);
      else buffered = t;
    },
    setVolume(music, sfx) {
      d.audio.setVolume(music, sfx);
    },
    setReducedMotion(on) {
      d.sim.setReducedMotion(on);
      d.view.reducedMotion = on;
    },
    setCamMode(m) {
      d.cam.want = m;
    },
  };
}
