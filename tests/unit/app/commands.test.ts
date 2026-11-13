// A9: UiCommands routing per T02's and T08's seams.
import { describe, expect, it } from 'vitest';
import { CamMode, SimMode, type AudioEngine, type Governor, type Tier } from '../../../src/contracts/index';
import { createCommands } from '../../../src/app/commands';
import { createFakeSim } from './fixtures/fakes';

function rig() {
  const log: string[] = [];
  const sim = createFakeSim({ on: false, log: [] });
  const origCommand = sim.command.bind(sim);
  sim.command = (c) => { log.push(`command:${c}`); origCommand(c); };
  let unlockResolved = false;
  const audio: AudioEngine = {
    unlock() {
      log.push('unlock');
      return new Promise<void>((res) => { setTimeout(() => { unlockResolved = true; res(); }, 5); });
    },
    frame() { /* not used */ },
    setVolume(m, s) { log.push(`setVolume:${m},${s}`); },
    suspend() { /* not used */ },
    resume() { /* not used */ },
    dispose() { /* not used */ },
  };
  const forced: (Tier | 'auto')[] = [];
  const gov = { profile: null, sample: () => null, force: (t: Tier | 'auto') => { forced.push(t); } } as unknown as Governor;
  let governor: Governor | null = null;
  const view = { reducedMotion: false };
  const cam: { want: CamMode } = { want: CamMode.CHASE };
  const cmd = createCommands({ sim, audio, view, cam, governor: () => governor });
  return { log, sim, cmd, view, cam, forced, gov, setGovernor: (g: Governor | null) => { governor = g; }, unlocked: () => unlockResolved };
}

describe('createCommands', () => {
  it('launch from DEMO: unlock, then command(launch), in one synchronous stack, unlock not awaited', () => {
    const r = rig();
    r.cmd.launch();
    expect(r.log).toEqual(['unlock', 'command:launch']);
    expect(r.unlocked()).toBe(false);
    expect(r.sim.state.mode).toBe(SimMode.PLAY);
  });

  it('a second launch, and launch outside DEMO, do nothing', () => {
    const r = rig();
    r.cmd.launch();
    r.cmd.launch();
    expect(r.log).toEqual(['unlock', 'command:launch']);
    for (const m of [SimMode.CRUISE, SimMode.SIGNAL_LOST]) {
      r.sim.state.mode = m;
      r.cmd.launch();
    }
    expect(r.log).toEqual(['unlock', 'command:launch']);
  });

  it('togglePause: PLAY pauses, CRUISE resumes, DEMO and SIGNAL_LOST do nothing', () => {
    const r = rig();
    r.sim.state.mode = SimMode.PLAY;
    r.cmd.togglePause();
    expect(r.sim.state.mode).toBe(SimMode.CRUISE);
    r.cmd.togglePause();
    expect(r.sim.state.mode).toBe(SimMode.PLAY);
    for (const m of [SimMode.DEMO, SimMode.SIGNAL_LOST]) {
      r.sim.state.mode = m;
      r.cmd.togglePause();
      expect(r.sim.state.mode).toBe(m);
    }
    expect(r.log).toEqual(['command:pause', 'command:resume']);
  });

  it('setReducedMotion writes the sim and the view together', () => {
    const r = rig();
    r.cmd.setReducedMotion(true);
    expect(r.sim.reduced).toEqual([true]);
    expect(r.view.reducedMotion).toBe(true);
    r.cmd.setReducedMotion(false);
    expect(r.sim.reduced).toEqual([true, false]);
    expect(r.view.reducedMotion).toBe(false);
  });

  it('setVolume reaches audio at once', () => {
    const r = rig();
    r.cmd.setVolume(0.5, 0.25);
    expect(r.log).toEqual(['setVolume:0.5,0.25']);
  });

  it('setQuality before the final governor buffers, the last value wins; after, it calls force, auto included', () => {
    const r = rig();
    expect(r.cmd.buffered).toBeNull();
    r.cmd.setQuality(2);
    r.cmd.setQuality(1);
    expect(r.cmd.buffered).toBe(1);
    r.cmd.setQuality('auto');
    expect(r.cmd.buffered).toBe('auto');
    expect(r.forced).toEqual([]);
    r.setGovernor(r.gov);
    r.cmd.setQuality(4);
    r.cmd.setQuality('auto');
    expect(r.forced).toEqual([4, 'auto']);
    expect(r.cmd.buffered).toBe('auto');
  });

  it('T13: setCamMode writes the camera state the loop reads, and nothing else', () => {
    const r = rig();
    r.cmd.setCamMode(CamMode.NOSE);
    expect(r.cam.want).toBe(CamMode.NOSE);
    r.cmd.setCamMode(CamMode.CHASE);
    expect(r.cam.want).toBe(CamMode.CHASE);
    expect(r.log).toEqual([]);
  });
});
