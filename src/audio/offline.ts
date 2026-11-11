// Dev only. Renders a scene with the production graph, kit, voices, sequencer and cue logic in an OfflineAudioContext,
// suspended every tickS of audio time, so the sequencer runs against ctx.currentTime as it does under a timer, with no
// wall clock. Faults live here, not in the engine: they are the negative controls of plan section 7.
import { SimMode, type Ev } from '../contracts/index';
import { anchorClock, createBeatClock } from './clock';
import { Layer, createBarPattern, type BarPattern } from './composer';
import { buildGraph, type AudioGraph } from './graph';
import { renderKit, type Kit, type KitOptions } from './kit';
import { WINDOW_S, createSequencer, type SequencerStats, type VoiceSink } from './sequencer';
import { createSfx, type SfxSink } from './sfx';
import { BAR_S, STEP_S } from './theory';
import { createVoices, type Voices } from './voices';

/** Audio time of the scene's first downbeat. */
export const SCENE_START_S = 0.25;

/** At bar offset `bar`, step `step`, plus afterS. Fired on the first driver tick at or past that time. */
export interface SceneEvent { bar: number; step: number; afterS?: number; kind: Ev; x?: number; value?: number; index?: number }

export interface SceneFaults {
  transpose?: number; gateOff?: boolean; noPump?: boolean; noDuck?: boolean; noReverb?: boolean;
  noSoftClip?: boolean; boostDb?: number; stepOffsetMs?: number; muteLayer?: number;
  /** A shallow pump: the pad falls only to this gain at a kick, not to .55. A13's negative control. */
  pumpFloor?: number;
}

export interface SceneOptions {
  bar0: number; bars: number; sync: number | ((barOffset: number) => number);
  sector: number | ((barOffset: number) => number); key: number | ((barOffset: number) => number);
  tailS?: number; sampleRate?: number; layers?: readonly number[]; volume?: [number, number];
  tickS?: number; windowS?: number; events?: readonly SceneEvent[]; faults?: SceneFaults;
  /** SimMode for the whole scene, default PLAY. Internal to T07 (Decision log). */
  mode?: SimMode;
}

export interface SceneResult { buffer: AudioBuffer; stats: SequencerStats; kit: Kit; startS: number; endS: number }

const kits = new Map<string, Promise<Kit>>();

export function kitFor(sampleRate: number, o: KitOptions = {}): Promise<Kit> {
  const k = `${sampleRate}:${o.gateOff ? 'open' : 'gated'}`;
  let p = kits.get(k);
  if (!p) {
    p = renderKit(sampleRate, o);
    kits.set(k, p);
  }
  return p;
}

function at<T extends number>(v: T | ((barOffset: number) => T), bar: number): T {
  return typeof v === 'function' ? v(bar) : v;
}

function faultSink(voices: Voices, o: SceneOptions): VoiceSink {
  const f = o.faults ?? {};
  const shift = (f.stepOffsetMs ?? 0) / 1000;
  const up = f.transpose ?? 0;
  const noPump = f.noPump ?? false;
  const scratch: BarPattern = createBarPattern();
  const allow = (layer: number): boolean => (o.layers === undefined || o.layers.includes(layer)) && f.muteLayer !== layer;
  return {
    oneShot(layer, t, vel, rate) {
      if (allow(layer)) voices.oneShot(layer, t + shift, vel, rate);
    },
    bass(t, midi, lenS, vel) {
      if (allow(Layer.BASS)) voices.bass(t + shift, midi + up, lenS, vel);
    },
    padChord(t, p, durS) {
      if (!allow(Layer.PAD)) return;
      scratch.bar = p.bar;
      scratch.chord = p.chord;
      scratch.kickMask = noPump ? 0 : p.kickMask;
      scratch.count = p.count;
      for (let i = 0; i < p.count; i++) {
        scratch.layer[i] = p.layer[i]!;
        scratch.step[i] = p.step[i]!;
        scratch.midi[i] = p.midi[i]! + up;
        scratch.len[i] = p.len[i]!;
        scratch.vel[i] = p.vel[i]!;
      }
      voices.padChord(t + shift, scratch, durS);
    },
    arp(t, midi, lenS, vel) {
      if (allow(Layer.ARP)) voices.arp(t + shift, midi + up, lenS, vel);
    },
    lead(t, midi, lenS, vel) {
      if (allow(Layer.LEAD)) voices.lead(t + shift, midi + up, lenS, vel);
    },
  };
}

function applyGraphFaults(g: AudioGraph, f: SceneFaults): void {
  if (f.noReverb) g.reverbReturn.gain.value = 0;
  if (f.noSoftClip) {
    g.softClip.curve = null;
    g.safetyClip.curve = null;
  }
  if (f.boostDb !== undefined) g.master.gain.value = Math.pow(10, f.boostDb / 20);
}

export async function renderSceneFull(o: SceneOptions): Promise<SceneResult> {
  const sampleRate = o.sampleRate ?? 48000;
  const f = o.faults ?? {};
  const kit = await kitFor(sampleRate, f.gateOff ? { gateOff: true } : {});
  const endS = SCENE_START_S + o.bars * BAR_S;
  const total = endS + (o.tailS ?? 0.5);
  const ctx = new OfflineAudioContext(2, Math.ceil(total * sampleRate), sampleRate);

  const graph = buildGraph(ctx);
  const volume = o.volume ?? [1, 1];
  graph.initVolume(volume[0], volume[1]);
  applyGraphFaults(graph, f);
  const mode = o.mode ?? SimMode.PLAY;
  if (!f.noDuck && mode !== SimMode.PLAY) graph.setMode(mode, 0);

  // Offline, onended does not measure polyphony: it reported every node live [O: prototype]. So no cap here.
  const voices = createVoices(graph, f.pumpFloor !== undefined ? { cap: Infinity, pumpFloor: f.pumpFloor } : { cap: Infinity });
  voices.setKit(kit);
  const clock = createBeatClock();
  anchorClock(clock, o.bar0 * 4, SCENE_START_S);
  const windowS = o.windowS ?? WINDOW_S;
  const seq = createSequencer(clock, faultSink(voices, o), { windowS, firstStep: o.bar0 * 16, formOrigin: 0 });
  seq.sync = at(o.sync, 0);
  seq.zoneIndex = at(o.sector, 0);
  seq.zoneKey = at(o.key, 0);
  seq.restart(0);

  const sfxSink: SfxSink = f.noDuck
    ? {
      blip: voices.blip, stab: voices.stab, miss: voices.miss, graze: voices.graze, lost: voices.lost,
      hit: voices.hitSound,
    }
    : voices;
  const sfx = createSfx(clock, seq, sfxSink);

  const events = (o.events ?? [])
    .map((e) => ({ e, t: SCENE_START_S + e.bar * BAR_S + e.step * STEP_S + (e.afterS ?? 0) }))
    .sort((a, b) => a.t - b.t);
  let nextEvent = 0;

  const tickS = o.tickS ?? 0.025;
  const driverTick = (now: number): void => {
    while (nextEvent < events.length && events[nextEvent]!.t <= now) {
      const { e } = events[nextEvent]!;
      sfx.handleOne(e.kind, e.x ?? 0, e.value ?? 100, e.index ?? 0, now);
      nextEvent += 1;
    }
    const b = Math.max(0, Math.floor((now + windowS - SCENE_START_S) / BAR_S));
    seq.sync = at(o.sync, b);
    seq.zoneIndex = at(o.sector, b);
    seq.zoneKey = at(o.key, b);
    // A scene is exactly `bars` long: the tail holds only what those bars left ringing.
    if (now + windowS < endS) seq.tick(now);
  };

  driverTick(0);
  // Registered up front: 207 suspends cost 9 ms on the prototype. Scheduling the whole render up front would cost
  // far more, because every not-yet-started node is still pulled.
  for (let k = 1; k * tickS < total - tickS; k++) {
    void ctx.suspend(k * tickS).then(() => {
      driverTick(ctx.currentTime);
      return ctx.resume();
    });
  }
  const buffer = await ctx.startRendering();
  return { buffer, stats: { ...seq.stats }, kit, startS: SCENE_START_S, endS };
}

export async function renderScene(o: SceneOptions): Promise<AudioBuffer> {
  return (await renderSceneFull(o)).buffer;
}
