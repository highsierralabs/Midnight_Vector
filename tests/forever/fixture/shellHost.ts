// The shell target: T00's dev shell and proof layer, T09's small composer stack, adapted to HarnessHost. Real GPU pixels,
// real bloom and real three allocation, with no T10. It has no terrain, props or UI, so what it proves is the machinery
// and its controls, not the game. Query: ?period=<n> (default 1024, 0 is aperiodic), ?seed=<int>, ?tier=0..4, ?follow=1.
//
// Two things make it behave as the app does where a spec could otherwise pass here and fail there (V1-T09). Until
// manual(true), its own rAF loop steps the sim, as section 3.3 step 4 does, so travel rises through a context loss. And
// with ?follow=1, renderState takes camX from the sim, as section 8.1's renderState takes it from prevX: the fake sim's x
// never moves, so the shell weaves it as a pure function of the sim's tick, standing in for DEMO autopilot.
import {
  CHUNK_LEN, SIM_HZ,
  type ControlFrame, type FeelState, type HarnessHost, type HeroMode, type RenderLayer, type Tier,
} from '../../../src/contracts/index';
import { createFakeHost } from '../../../src/testing/fakeHost';
import { createFakeWorld, FAKE_SEED } from '../../../src/testing/fakeWorld';
import { startDevShell, type DevShell } from '../../../src/testing/devShell';
import type { ScriptedFrameOptions } from '../../../src/testing/scriptedFrame';
import { createTrivialLayer } from '../../support/devshell/trivialLayer';
import { createLabPost } from './labPost';

const CONTROL: Readonly<ControlFrame> = { moveX: 0, moveY: 0, absolute: false, boost: false, human: false };
const BOOT_TIMEOUT_MS = 30_000;
/** Section 3.3: dt is clamped to .25 s, and at most 30 steps run in one frame. */
const MAX_DT = 0.25;
const MAX_STEPS = 30;
/** The weave under ?follow=1: scriptedFrame's own, 12 u over 16 s, with its .72 follow gain. */
const WEAVE_X = 12;
const WEAVE_TICKS = 16 * SIM_HZ;
const FOLLOW_GAIN = 0.72;
const TAU = 2 * Math.PI;

function queryNumber(q: URLSearchParams, name: string, fallback: number): number {
  const raw = q.get(name);
  if (raw === null) return fallback;
  const v = Number(raw);
  return Number.isInteger(v) && v >= 0 ? v : fallback;
}

function waitReady(shell: DevShell): Promise<void> {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    const poll = (): void => {
      if (shell.ready) resolve();
      else if (shell.shaderErrors.length > 0) reject(new Error(`shell target: shader error: ${shell.shaderErrors.join('\n')}`));
      else if (performance.now() - start > BOOT_TIMEOUT_MS) reject(new Error('shell target: boot timed out'));
      else setTimeout(poll, 10);
    };
    poll();
  });
}

export async function createShellHost(): Promise<HarnessHost> {
  const q = new URLSearchParams(location.search);
  const world = createFakeWorld({ periodChunks: queryNumber(q, 'period', 1024), seed: queryNumber(q, 'seed', FAKE_SEED) });
  const post = createLabPost();
  const layers: readonly RenderLayer[] = [createTrivialLayer()];
  const shell = startDevShell([...layers], post, { world, tier: 3 });
  await waitReady(shell);
  // The dev shell's own loop plays scripted frames and steps no sim. This host runs its own loop instead, below.
  shell.setManual(true);
  const follow = q.get('follow') === '1';

  // Only the fake's sim and governor are used. Its renderer is a second WebGL context, which this page has no use for
  // (Agents.md: one context per page), so it is freed at once.
  const fake = createFakeHost();
  const { sim, governor } = fake;
  const spare = fake.ctx.renderer;
  spare.dispose();
  spare.forceContextLoss();
  spare.domElement.remove();

  let zone: { palette: number; biome: number; hero: HeroMode } | null = null;
  let bend: { a: number; c: number } | null = null;
  let fov: number | null = null;
  let feel: Partial<FeelState> | null = null;
  let contextOk = true;
  let pendingTier: Tier | null = null;

  const canvas = shell.ctx.renderer.domElement;
  canvas.addEventListener('webglcontextlost', () => { contextOk = false; });
  canvas.addEventListener('webglcontextrestored', () => {
    contextOk = true;
    shell.rebuild();
    post.rebuild();
    post.precompile().catch((e: unknown) => { console.error(`shell target: precompile after restore failed: ${String(e)}`); });
  });

  function draw(chunk: number, local: number, tick: number): void {
    if (!contextOk) return;
    const o: ScriptedFrameOptions = { at: { chunk, local }, tick };
    if (zone) {
      o.palette = zone.palette;
      o.biome = zone.biome;
      o.hero = zone.hero;
    }
    if (bend) o.bend = bend;
    if (feel || fov !== null) o.feel = fov === null ? { ...feel } : { ...feel, fovDeg: fov };
    // prevX is the weave one tick back. Only sim.step moves the tick, so only a step can move the camera, as on the app.
    if (follow) o.camX = FOLLOW_GAIN * WEAVE_X * Math.sin((TAU * (sim.state.tick - 1)) / WEAVE_TICKS);
    shell.frameAt(0, o);
  }

  /** Section 3.3: the force is taken in step 2 and applied in step 15, so it shows from the next frame. */
  function takeTier(): void {
    const t = governor.sample(0);
    if (t !== null) pendingTier = t;
  }

  function applyTier(): void {
    if (pendingTier === null || !contextOk) return;
    shell.setTier(pendingTier);
    pendingTier = null;
  }

  function renderState(chunk: number, local: number, tick: number): void {
    takeTier();
    draw(chunk, local, tick);
    applyTier();
  }

  // The loop until manual(true): steps the sim on an accumulator, then draws at the sim's travel. Drawing is skipped
  // while the context is lost, and stepping is not (R1).
  let manual = false;
  let rafId = 0;
  let lastMs = -1;
  let acc = 0;
  function onFrame(nowMs: number): void {
    if (manual) return;
    rafId = requestAnimationFrame(onFrame);
    acc += lastMs < 0 ? 0 : Math.min((nowMs - lastMs) / 1000, MAX_DT);
    lastMs = nowMs;
    for (let i = 0; i < MAX_STEPS && acc >= 1 / SIM_HZ; i++) {
      sim.step(CONTROL);
      acc -= 1 / SIM_HZ;
    }
    const t = sim.state.travel;
    renderState(t.chunk, t.local, sim.state.tick);
  }
  rafId = requestAnimationFrame(onFrame);

  return {
    sim,
    ctx: shell.ctx,
    layers,
    post,
    governor,
    setManual(on: boolean): void {
      if (manual === on) return;
      manual = on;
      if (on) {
        cancelAnimationFrame(rafId);
        return;
      }
      // Re-armed with no carried time, so the first delta is not the whole manual stretch (T10 seam).
      lastMs = -1;
      acc = 0;
      rafId = requestAnimationFrame(onFrame);
    },
    runFrame(dt: number): void {
      const steps = Math.floor(dt * SIM_HZ);
      for (let i = 0; i < steps; i++) sim.step(CONTROL);
      const t = sim.state.travel;
      if (t.local >= CHUNK_LEN) throw new Error('shell target: travel out of range');
      renderState(t.chunk, t.local, sim.state.tick);
    },
    renderState,
    overrideZone(o): void { zone = o; },
    overrideBend(o): void { bend = o; },
    overrideFov(deg): void { fov = deg; },
    overrideFeel(o): void { feel = o; },
  };
}
