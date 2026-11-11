// A FrameView from a time and a few overrides. Returns one module-level object mutated in place, like the real
// one, so a caller who needs two must copy values, and a layer that retains it is exposed. Imports no three.
import {
  CAMERA_Y, PHASE_COUNT, SIM_HZ, SPEED_CRUISE, SimMode,
  type Ev, type FeelState, type FrameView, type HeroMode, type QualityProfile, type SimState, type Tier, type Travel, type WorldSource, type ZoneState,
} from '../contracts/index';
import { createBendState, createEventBuffer, createNeutralFeel, createZoneState } from '../core/alloc';
import { advance } from '../core/coords';
import { writePhases } from '../core/motion';
import { createFakeWorld, writeFakePalette } from './fakeWorld';

const TAU = 2 * Math.PI;

export interface ScriptedEvent { kind: Ev; x: number; y: number; value: number; chunk: number; index: number }
export interface ScriptedFrameOptions {
  at?: Travel; tick?: number; palette?: number; biome?: number; hero?: HeroMode;
  bend?: { a: number; c: number }; feel?: Partial<FeelState>; sim?: Partial<SimState>;
  tier?: Tier; reducedMotion?: boolean; events?: readonly ScriptedEvent[]; world?: WorldSource;
  camX?: number; camY?: number;   // render-space; default as section 6.1 from sim.x and sim.y, with gain 0.72
  /** Applied last, after palette, biome and hero. For testing crossfades and day phase. */
  zone?: Partial<Pick<ZoneState, 'index' | 'biomeA' | 'biomeB' | 'biomeMix' | 'heroA' | 'heroB' | 'heroMix' | 'dayPhase'>>;
}

/** Section 6.10, with exact pixel counts. Equal field by field to T06's table; T11 may edit this under the pin rule (section 12). */
const PROFILES: Readonly<Record<Tier, Readonly<QualityProfile>>> = {
  4: { tier: 4, dprCap: 2, maxPixels: 3686400, msaa: 4, mirror: true, post: 'full', bloomLevels: 7, nebulaWidth: 384, propDensity: 1, terrainStride: 1, speedLines: 96 },
  3: { tier: 3, dprCap: 1.5, maxPixels: 2073600, msaa: 2, mirror: true, post: 'full', bloomLevels: 6, nebulaWidth: 384, propDensity: 1, terrainStride: 1, speedLines: 64 },
  2: { tier: 2, dprCap: 1, maxPixels: 1440000, msaa: 0, mirror: false, post: 'noCa', bloomLevels: 5, nebulaWidth: 192, propDensity: 0.7, terrainStride: 1, speedLines: 32 },
  1: { tier: 1, dprCap: 0.75, maxPixels: 921600, msaa: 0, mirror: false, post: 'min', bloomLevels: 3, nebulaWidth: 0, propDensity: 0.4, terrainStride: 2, speedLines: 0 },
  0: { tier: 0, dprCap: 1, maxPixels: 230400, msaa: 0, mirror: false, post: 'bare', bloomLevels: 0, nebulaWidth: 0, propDensity: 0.08, terrainStride: 2, speedLines: 0 },
};

/** Equal field by field to T06's table. Returns a shared object, so calling it per frame allocates nothing. */
export function fakeProfile(t: Tier): QualityProfile {
  return PROFILES[t];
}

const defaultWorld = createFakeWorld();
const NEUTRAL = createNeutralFeel();

const sim: SimState = {
  tick: 0, travel: { chunk: 1, local: 0 }, stepDist: SPEED_CRUISE / SIM_HZ, speed: SPEED_CRUISE,
  x: 0, y: 6, prevX: 0, prevY: 6, mode: SimMode.DEMO,
  score: 0, sync: 1, shields: 3, overdrive: 0, ghost: 0, beat: 0, sectorIndex: 0, objectiveProgress: 0,
  autopilot: true, warpSerial: 0,
};
const travelRef = sim.travel;
const cam: Travel = { chunk: 1, local: 0 };
const feel: FeelState = createNeutralFeel();
const zone: ZoneState = createZoneState();
const bend = createBendState();
const events = createEventBuffer();
const view: FrameView = {
  dt: 0, tick: 0, alpha: 0, cam, camX: 0, camY: CAMERA_Y,
  phases: new Float32Array(PHASE_COUNT), sim, feel, zone, bend, events, quality: PROFILES[3], reducedMotion: false,
};

function fract(x: number): number {
  return x - Math.floor(x);
}

/** t is seconds. Same t and options give the same values, and nothing here reads a clock. */
export function scriptedFrame(t: number, o: ScriptedFrameOptions = {}): FrameView {
  const world = o.world ?? defaultWorld;
  const stepDist = SPEED_CRUISE / SIM_HZ;
  const direct = o.at !== undefined || o.tick !== undefined;
  const tick = o.tick ?? Math.floor(t * SIM_HZ);
  const alpha = direct ? 0 : t * SIM_HZ - tick;

  if (o.at) {
    // Exactly this state: alpha 0, cam equal to at.
    cam.chunk = o.at.chunk;
    cam.local = o.at.local;
    travelRef.chunk = o.at.chunk;
    travelRef.local = o.at.local;
  } else {
    travelRef.chunk = 1;
    travelRef.local = 0;
    advance(travelRef, tick * stepDist);
    cam.chunk = travelRef.chunk;
    cam.local = travelRef.local;
    // Section 3.3 step 5: the camera interpolates between ticks T-1 and T.
    if (!direct) advance(cam, -(1 - alpha) * stepDist);
  }

  view.dt = o.at ? 0 : 1 / 60;
  view.tick = tick;
  view.alpha = alpha;
  writePhases(tick, alpha, view.phases);

  world.zoneAt(cam, zone);
  world.bendAt(cam, bend);
  if (o.palette !== undefined) {
    zone.paletteA = zone.paletteB = o.palette;
    zone.paletteMix = 0;
    writeFakePalette(o.palette, zone.palette);
  }
  if (o.biome !== undefined) {
    zone.biomeA = zone.biomeB = o.biome;
    zone.biomeMix = 0;
  }
  if (o.hero !== undefined) {
    zone.heroA = zone.heroB = o.hero;
    zone.heroMix = 0;
  }
  if (o.zone) Object.assign(zone, o.zone);
  if (o.bend) {
    bend.a = o.bend.a;
    bend.c = o.bend.c;
  }

  Object.assign(feel, NEUTRAL);
  if (o.feel) Object.assign(feel, o.feel);

  sim.tick = tick;
  sim.travel = travelRef;
  sim.stepDist = stepDist;
  sim.speed = SPEED_CRUISE;
  sim.x = 12 * Math.sin((TAU * t) / 16);
  sim.y = 6;
  sim.prevX = sim.x;
  sim.prevY = sim.y;
  sim.mode = SimMode.DEMO;
  sim.score = Math.floor(t * 100);
  sim.sync = 1 + (Math.floor(t / 4) % 16);
  sim.shields = 3;
  sim.overdrive = fract(t / 10);
  sim.ghost = 0;
  sim.beat = tick / 72;
  sim.sectorIndex = zone.index;
  sim.objectiveProgress = 0;
  sim.autopilot = true;
  sim.warpSerial = 0;
  if (o.sim) {
    Object.assign(sim, o.sim);
    // state.travel is a stable object, mutated in place.
    if (o.sim.travel) {
      travelRef.chunk = o.sim.travel.chunk;
      travelRef.local = o.sim.travel.local;
      sim.travel = travelRef;
    }
  }

  view.camX = o.camX ?? 0.72 * sim.x;
  view.camY = o.camY ?? CAMERA_Y + 0.35 * (sim.y - 6);

  events.count = 0;
  if (o.events) {
    for (const e of o.events) {
      if (events.count >= events.kind.length) break;
      const i = events.count++;
      events.kind[i] = e.kind;
      events.x[i] = e.x;
      events.y[i] = e.y;
      events.value[i] = e.value;
      events.chunk[i] = e.chunk;
      events.index[i] = e.index;
    }
  }

  view.quality = PROFILES[o.tier ?? 3];
  view.reducedMotion = o.reducedMotion ?? false;
  return view;
}
