// Small helpers shared by the sim tests, and the fuzz driver.
import {
  CHUNK_LIMIT, SimMode,
  type ControlFrame, type Sim, type SimCommand, type WorldSource,
} from '../../../../src/contracts/index';
import { createSimInternal, type SimProbe } from '../../../../src/sim/sim';
import { TUNING, type Tuning } from '../../../../src/sim/tuning';
import { checkStep, copySnap, createSnap } from './invariants';

export const HOLD: Readonly<ControlFrame> = { moveX: 0, moveY: 0, absolute: false, boost: false, human: true };
export const NOBODY: Readonly<ControlFrame> = { moveX: 0, moveY: 0, absolute: false, boost: false, human: false };
export const BOOST: Readonly<ControlFrame> = { moveX: 0, moveY: 0, absolute: false, boost: true, human: true };

export function tuned(o?: Partial<Tuning>): Tuning {
  return o ? { ...TUNING, ...o } : TUNING;
}

export function make(world: WorldSource, o?: Partial<Tuning>, probe?: SimProbe): Sim {
  return createSimInternal(world, tuned(o), probe);
}

export interface EvRecord { kind: number; x: number; y: number; value: number; chunk: number; index: number; tick: number }

/** Copies out and clears the buffer, as section 3.3 step 14 does. */
export function take(sim: Sim, into: EvRecord[] = []): EvRecord[] {
  const e = sim.events;
  for (let i = 0; i < e.count; i++) {
    into.push({ kind: e.kind[i]!, x: e.x[i]!, y: e.y[i]!, value: e.value[i]!, chunk: e.chunk[i]!, index: e.index[i]!, tick: sim.state.tick });
  }
  e.count = 0;
  return into;
}

export function steps(sim: Sim, n: number, c: Readonly<ControlFrame> = HOLD, into?: EvRecord[]): EvRecord[] {
  const out = into ?? [];
  for (let i = 0; i < n; i++) {
    sim.step(c);
    take(sim, out);
  }
  return out;
}

/** Steps until the predicate holds, and returns how many steps that took. Throws rather than loop forever. */
export function stepUntil(sim: Sim, pred: () => boolean, c: Readonly<ControlFrame> = HOLD, into?: EvRecord[], max = 200000): number {
  for (let i = 1; i <= max; i++) {
    sim.step(c);
    if (into) take(sim, into); else sim.events.count = 0;
    if (pred()) return i;
  }
  throw new Error(`stepUntil: no result in ${max} steps`);
}

/** The plane's position in u, relative to chunk 0: exact enough for a chunk count this size. */
export function planeU(sim: Sim): number {
  const t = sim.state.travel;
  return t.chunk * 64 + t.local + 14;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const POISON = [NaN, Infinity, -Infinity, 1e308, -1e308] as const;

/** 70% plausible, 20% extreme, 10% poison, each axis on its own, with random absolute, boost and human. */
export function fuzzFrame(rand: () => number, out: ControlFrame): void {
  for (let axis = 0; axis < 2; axis++) {
    const r = rand();
    const v = r < 0.7 ? 2 * rand() - 1 : r < 0.9 ? (rand() < 0.5 ? -1 : 1) * (1 + 4 * rand()) : POISON[Math.floor(rand() * POISON.length)]!;
    if (axis === 0) out.moveX = v;
    else out.moveY = v;
  }
  out.absolute = rand() < 0.5;
  out.boost = rand() < 0.4;
  out.human = rand() < 0.5;
}

export type FuzzTarget = 'DEMO' | 'PLAY' | 'CRUISE' | 'SIGNAL_LOST' | 'CHAOS';

export interface FuzzOptions {
  world: WorldSource;
  /** The chunk warped to before the first step. */
  base: number;
  target: FuzzTarget;
  /** Runs until this many steps ended in the target mode; for CHAOS, steps of any mode. */
  stepsInMode: number;
  seed: number;
  tuning?: Partial<Tuning>;
  reducedMotion?: boolean;
}

export interface FuzzResult {
  steps: number; inMode: number; warps: number; hits: number;
  /** What the run really visited, so a test can show it was not vacuous. Steps ended in each SimMode. */
  modeSteps: [number, number, number, number];
  idleSteps: number; reducedSteps: number;
}

const TARGET_MODE = { DEMO: SimMode.DEMO, PLAY: SimMode.PLAY, CRUISE: SimMode.CRUISE, SIGNAL_LOST: SimMode.SIGNAL_LOST } as const;
const INVALID_WARPS: readonly (readonly [number, number])[] = [
  [CHUNK_LIMIT, 0], [2 ** 48, 0], [1.5, 0], [5, 64], [5, -1], [NaN, 0], [Infinity, 0], [-1, 0], [5, NaN],
];

export function runFuzz(o: FuzzOptions): FuzzResult {
  const sim = make(o.world, o.tuning);
  const s = sim.state;
  const rand = mulberry32(o.seed);
  const prev = createSnap();
  const cur = createSnap();
  const ctx = { reducedMotion: o.reducedMotion === true };
  const control: ControlFrame = { moveX: 0, moveY: 0, absolute: false, boost: false, human: false };
  sim.setReducedMotion(ctx.reducedMotion);
  if (!sim.warpTo(o.base, 0)) throw new Error(`runFuzz: warp to ${o.base} refused`);

  const chaos = o.target === 'CHAOS';
  const targetMode = chaos ? -1 : TARGET_MODE[o.target as keyof typeof TARGET_MODE];
  if (o.target === 'PLAY' || o.target === 'SIGNAL_LOST' || o.target === 'CRUISE') sim.command('launch');
  if (o.target === 'CRUISE') sim.command('pause');

  let total = 0;
  let inMode = 0;
  let warps = 0;
  let hits = 0;
  let humanOffUntil = 0;
  let idleSteps = 0;
  let reducedSteps = 0;
  const modeSteps: [number, number, number, number] = [0, 0, 0, 0];
  const limit = o.stepsInMode * 40;
  const goal = o.stepsInMode;

  function fail(msg: string): never {
    throw new Error(`${msg} [seed ${o.seed} target ${o.target} base ${o.base} tick ${s.tick} mode ${s.mode}]`);
  }

  while ((chaos ? total : inMode) < goal) {
    if (total > limit) fail(`stuck: ${inMode} steps in mode after ${total}`);
    fuzzFrame(rand, control);
    if (o.target === 'PLAY' || o.target === 'SIGNAL_LOST') control.human = true;

    const cmd = rand();
    if (o.target === 'DEMO') {
      if (cmd < 0.02) sim.command(rand() < 0.5 ? 'pause' : 'resume');
    } else if (o.target === 'PLAY' || o.target === 'SIGNAL_LOST') {
      if (cmd < 0.02) sim.command('launch');
    } else if (o.target === 'CRUISE') {
      if (cmd < 0.02) sim.command(rand() < 0.5 ? 'pause' : 'launch');
    } else {
      if (cmd < 0.02) sim.command((['launch', 'pause', 'resume'] as const)[Math.floor(rand() * 3)] as SimCommand);
      else if (cmd < 0.025) sim.forceSignalLost();
      else if (cmd < 0.03) {
        ctx.reducedMotion = !ctx.reducedMotion;
        sim.setReducedMotion(ctx.reducedMotion);
      } else if (cmd < 0.04) {
        const pick = rand();
        const chunk = pick < 0.25 ? 0 : pick < 0.5 ? 2 ** 40 : pick < 0.75 ? CHUNK_LIMIT - 1 : Math.floor(rand() * 2 ** 47);
        const serial = s.warpSerial;
        const tick = s.tick;
        if (!sim.warpTo(chunk, rand() * 63.99)) fail(`valid warp to ${chunk} refused`);
        if (s.warpSerial !== serial + 1 || s.tick !== tick) fail('warp changed tick or did not raise warpSerial');
        warps++;
      } else if (cmd < 0.05) {
        const bad = INVALID_WARPS[Math.floor(rand() * INVALID_WARPS.length)]!;
        copySnap(s, sim.events, prev);
        if (sim.warpTo(bad[0], bad[1])) fail(`invalid warp to ${bad[0]},${bad[1]} accepted`);
        copySnap(s, sim.events, cur);
        for (const key of Object.keys(prev) as (keyof typeof prev)[]) {
          if (!Object.is(prev[key], cur[key])) fail(`invalid warp changed ${key}`);
        }
      } else if (cmd < 0.052) {
        humanOffUntil = total + 1400;   // Long enough to go idle.
      }
      if (total < humanOffUntil) control.human = false;
    }

    const stepsInFrame = Math.floor(rand() * 31);
    for (let i = 0; i < stepsInFrame; i++) {
      copySnap(s, sim.events, prev);
      sim.step(control);
      copySnap(s, sim.events, cur);
      const msg = checkStep(prev, cur, ctx);
      if (msg !== null) fail(msg);
      if (cur.shields < prev.shields) hits++;
      total++;
      if (s.mode === targetMode) inMode++;
      modeSteps[s.mode]++;
      if (s.mode === SimMode.PLAY && s.autopilot) idleSteps++;
      if (ctx.reducedMotion) reducedSteps++;
    }
    sim.events.count = 0;
  }
  return { steps: total, inMode, warps, hits, modeSteps, idleSteps, reducedSteps };
}

export interface IdleFuzzOptions {
  world: WorldSource;
  /** The chunk warped to before launch. */
  base: number;
  steps: number;
  seed: number;
  /** Chance per frame of a harness forceSignalLost, which acts only in PLAY. */
  forceRate?: number;
  tuning?: Partial<Tuning>;
}

export interface IdleFuzzResult {
  steps: number;
  /** The tick of the first step that ended in idle PLAY, or -1 if none did. */
  firstIdleTick: number;
  scoreAtIdle: number;
  finalScore: number;
  /** Forced losses that took effect from idle PLAY. */
  forcedFromIdle: number;
  /** After the first idle: steps that ended in idle PLAY, in SIGNAL_LOST, and with rules live; shield losses; sector changes in SIGNAL_LOST. */
  idleSteps: number; lostSteps: number; liveAfterIdle: number; hitsAfterIdle: number; sectorsInLost: number;
}

/**
 * DI-94: nobody at the controls. Launches, then sends only frames with human false (random moves and boost, as runFuzz
 * does), with harness forceSignalLost calls at random. Every step passes checkStep, and after the first step that ends in
 * idle PLAY the score must never rise again, through any number of forced losses.
 */
export function runIdleFuzz(o: IdleFuzzOptions): IdleFuzzResult {
  const sim = make(o.world, o.tuning);
  const s = sim.state;
  const rand = mulberry32(o.seed);
  const prev = createSnap();
  const cur = createSnap();
  const ctx = { reducedMotion: false };
  const control: ControlFrame = { moveX: 0, moveY: 0, absolute: false, boost: false, human: false };
  const forceRate = o.forceRate ?? 0.02;
  if (!sim.warpTo(o.base, 0)) throw new Error(`runIdleFuzz: warp to ${o.base} refused`);
  sim.command('launch');

  const r: IdleFuzzResult = {
    steps: 0, firstIdleTick: -1, scoreAtIdle: 0, finalScore: 0, forcedFromIdle: 0,
    idleSteps: 0, lostSteps: 0, liveAfterIdle: 0, hitsAfterIdle: 0, sectorsInLost: 0,
  };

  function fail(msg: string): never {
    throw new Error(`${msg} [seed ${o.seed} base ${o.base} tick ${s.tick} mode ${s.mode} autopilot ${s.autopilot}]`);
  }

  while (r.steps < o.steps) {
    fuzzFrame(rand, control);
    control.human = false;
    if (rand() < forceRate) {
      const fromIdle = s.mode === SimMode.PLAY && s.autopilot;
      const count = sim.events.count;
      sim.forceSignalLost();
      // A loss that took effect always emits SIGNAL_LOST, and the buffer is empty between frames.
      if (fromIdle && sim.events.count > count) r.forcedFromIdle++;
    }
    const stepsInFrame = Math.floor(rand() * 31);
    for (let i = 0; i < stepsInFrame; i++) {
      copySnap(s, sim.events, prev);
      sim.step(control);
      copySnap(s, sim.events, cur);
      const msg = checkStep(prev, cur, ctx);
      if (msg !== null) fail(msg);
      r.steps++;
      if (r.firstIdleTick >= 0) {
        if (cur.score > prev.score) {
          fail(`score rose with nobody at the controls: ${prev.score} -> ${cur.score}, ${cur.tick - r.firstIdleTick} ticks after the first idle`);
        }
        if (cur.mode === SimMode.PLAY && !cur.autopilot) r.liveAfterIdle++;
        if (cur.mode === SimMode.PLAY && cur.autopilot) r.idleSteps++;
        if (cur.mode === SimMode.SIGNAL_LOST) {
          r.lostSteps++;
          if (cur.sectorIndex !== prev.sectorIndex) r.sectorsInLost++;
        }
        if (cur.shields < prev.shields) r.hitsAfterIdle++;
      } else if (cur.mode === SimMode.PLAY && cur.autopilot) {
        r.firstIdleTick = cur.tick;
        r.scoreAtIdle = cur.score;
        r.idleSteps++;
      }
    }
    sim.events.count = 0;
  }
  r.finalScore = s.score;
  return r;
}
