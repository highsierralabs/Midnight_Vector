// Dev only: wiring for dev/audio.html. Controls for a human, window.__audio for the browser gates. Never in the bundle.
// scriptedFrame arrives by injection, because T00's lint forbids src/audio from importing src/testing.
import { Ev, SimMode, type AudioEngine, type FrameView, type SimState, type Travel } from '../contracts/index';
import * as analysis from './analysis';
import { anchorClock, createBeatClock, stepAtOrAfter } from './clock';
import { Layer, chordAt, createBarPattern, ladderMidi, patternFor, type BarPattern, type SectorMusic } from './composer';
import { TICK_MS, createEngine, type EngineProbe, type ProbedEngine } from './engine';
import { buildGraph } from './graph';
import { renderKit } from './kit';
import { SCENE_START_S, kitFor, renderSceneFull, type SceneEvent, type SceneOptions, type SceneResult } from './offline';
import { createSequencer } from './sequencer';
import { createSfx } from './sfx';
import { createVoices } from './voices';
import { BAR_S, CHORDS, STEP_S, midiToHz, padTonic } from './theory';
import { encodeWav } from './wav';

interface ScriptedEventLite { kind: Ev; x: number; y: number; value: number; chunk: number; index: number }
interface ScriptedOptionsLite { at?: Travel; sim?: Partial<SimState>; events?: readonly ScriptedEventLite[]; reducedMotion?: boolean }
export type ScriptedFrameFn = (t: number, o?: ScriptedOptionsLite) => FrameView;

export interface SceneMetrics {
  peak: number; clip: number; bad: number; dc: number; rmsDb: number; crestDb: number; corr: number; monoDb: number;
  bands: [number, number, number, number]; stats: SceneResult['stats'];
}

export interface ShotOptions {
  kind: 'spec' | 'wave';
  title: string;
  /** Render this scene, or use one kit sound. */
  scene?: SceneOptions;
  kitSound?: 'kick' | 'snare' | 'tom' | 'hat' | 'ohat' | 'crash' | 'riser';
  t0?: number;
  t1?: number;
  /** Vertical marks, seconds, with a label. */
  marks?: readonly { t: number; label: string }[];
}

export interface LiveStats {
  state: string; running: boolean; disposed: boolean; retryArmed: boolean; timerRunning: boolean;
  scheduled: number; late: number; skipped: number; fills: number; sectorChanges: number;
  anchors: number; emaMs: number; rawMs: number; compMs: number;
  liveSources: number; peakSources: number; created: number; dropped: number;
  tickCount: number; tickP50: number; tickP99: number; tickMax: number;
  /** The latest 2048 samples after the last stage. */
  tapRmsDb: number;
  /** Mean power since resetTap, in dB. */
  tapMeanDb: number;
  tapPeak: number;
  chain: number;
}

/** One page frame while a trace runs: after the engine's frame, both taps read in the same task. */
export interface TraceEntry {
  wall: number;
  /** ctx.currentTime. */
  at: number;
  /** RMS dB of the master's two inputs, music after its volume plus sfx, and of the output after the last stage. */
  preDb: number;
  postDb: number;
  nextStep: number;
  scheduled: number;
  skipped: number;
  anchors: number;
}

export interface LiveApi {
  readonly engine: AudioEngine;
  probe(): EngineProbe;
  stats(): LiveStats;
  set(o: { sync?: number; sector?: number; key?: number; mode?: number; speed?: number; reducedMotion?: boolean }): void;
  emit(kind: Ev, x?: number, value?: number, index?: number): void;
  /** Jumps the scripted clock against the audio clock. */
  jump(seconds: number): void;
  /** Where the scripted clock is inside a bar, in steps, in [0, 16). */
  stepInBar(): number;
  /** The scripted clock's beat now. */
  scriptedBeat(): number;
  /** Starts a fresh trace, or stops it. */
  trace(on: boolean): void;
  traceLog(): readonly TraceEntry[];
  resetTicks(): void;
  /** Resets the peak-following tap. */
  resetTap(): void;
  /** n no-event frame() calls in one task, beat advancing. Returns mean ms. */
  frameProbe(n: number): number;
  /** Passes an arbitrary view straight to frame, for the failure guard. */
  frameRaw(v: unknown): void;
  /** n reads of ctx.currentTime in one task, with nothing else. */
  clockReadProbe(n: number): number;
  /**
   * Plays `steps` steps up to and including `endStep` at once, as a naive catch-up would, in the engine's own form:
   * A21's control. endStep defaults to the step at the audio clock now.
   */
  replayGap(steps: number, endStep?: number): void;
  /** Stops the page's own rAF frames, or starts them. */
  setFrames(on: boolean): void;
  /**
   * The longest engine.frame() call, timed from outside, among the page's frames that started in [from, to] on the
   * performance clock, and how many there were: D-009's per-frame slice bound.
   */
  frameCost(from: number, to: number): { worstMs: number; frames: number };
}

export interface AudioDevApi {
  scene(o: SceneOptions): Promise<SceneMetrics>;
  render(o: SceneOptions): Promise<SceneResult>;
  /** The mid channel of a buffer. */
  mid(b: AudioBuffer): Float32Array;
  channel(b: AudioBuffer, c: number): Float32Array;
  last: SceneResult | null;
  kit(o?: { gateOff?: boolean }): ReturnType<typeof kitFor>;
  shot(o: ShotOptions): Promise<void>;
  a: typeof analysis;
  Layer: typeof Layer;
  Ev: typeof Ev;
  SimMode: typeof SimMode;
  startS: number;
  barS: number;
  stepS: number;
  chordAt: typeof chordAt;
  ladderMidi: typeof ladderMidi;
  padTonic: typeof padTonic;
  midiToHz: typeof midiToHz;
  chordPcs(chord: number, key: number): number[];
  firstBass(bar: number, sector: number, key: number, sync: number): number;
  padPcs(bar: number, sector: number, key: number, sync: number): number[];
  live: LiveApi;
  /** A fresh pattern of one bar, for A21's per-voice source count. */
  pattern(bar: number, sector: number, key: number, sync: number): BarPattern;
  allocProbe(n: number): number;
  presets: readonly string[];
}

declare global {
  interface Window {
    __audio?: AudioDevApi;
    __eagerCtx?: AudioContext;
    __legacyCtx?: AudioContext;
  }
}

/**
 * D-009's control, `?legacy=1`: the order unlock had before repair D1, everything inside the gesture, from the same
 * builders the engine queues: context, resume, the whole graph, voices, the launch sweep, and the kit's fills, wiring
 * and render starts, with its normalising in one task when the renders return. The engine is not involved.
 */
function legacyUnlock(): void {
  if (window.__legacyCtx) return;
  const ctx = new AudioContext({ latencyHint: 'interactive' });
  window.__legacyCtx = ctx;
  void ctx.resume();
  const graph = buildGraph(ctx);
  graph.initVolume(0.8, 0.8);
  const voices = createVoices(graph);
  const clock = createBeatClock();
  const seq = createSequencer(clock, voices);
  createSfx(clock, seq, voices);
  voices.launch(ctx.currentTime);
  void renderKit(ctx.sampleRate).then((kit) => { voices.setKit(kit); });
}

const allocKeep: { keep: unknown } = { keep: null };

const MODES: readonly [string, number][] = [['DEMO', SimMode.DEMO], ['PLAY', SimMode.PLAY], ['CRUISE', SimMode.CRUISE], ['SIGNAL_LOST', SimMode.SIGNAL_LOST]];

function playEvents(bars: number): SceneEvent[] {
  // A plausible run: a shard every other step in rising runs, a gate per bar, a graze, a miss, one hit, a grade.
  const out: SceneEvent[] = [];
  for (let bar = 0; bar < bars; bar++) {
    for (let step = 0; step < 16; step += 2) out.push({ bar, step, afterS: 0.01, kind: Ev.SHARD, x: 20 * Math.sin(step + bar), value: 100 });
    out.push({ bar, step: 8, afterS: 0.01, kind: Ev.GATE, value: 500 });
  }
  out.push({ bar: 3, step: 5, afterS: 0.02, kind: Ev.GRAZE, x: 25, value: 10 });
  out.push({ bar: 6, step: 8, afterS: 0.05, kind: Ev.GATE_MISS, value: 0 });
  out.push({ bar: 9, step: 2, afterS: 0.03, kind: Ev.HIT, value: 2 });
  out.push({ bar: 12, step: 0, afterS: 0.05, kind: Ev.GRADE, value: 5000, index: 0 });
  return out;
}

/** The operator's review set (plan A27). */
const PRESETS: Readonly<Record<string, SceneOptions>> = {
  '01-sync-ramp': { bar0: 24, bars: 24, sync: (b) => Math.min(16, 1 + Math.floor((b * 16) / 22)), sector: 0, key: 0, tailS: 2 },
  '02-full-form-sync8': { bar0: 0, bars: 32, sync: 8, sector: 0, key: 0, tailS: 2 },
  '03-sector-change': { bar0: 0, bars: 16, sync: 8, sector: (b) => (b < 6 ? 0 : 1), key: (b) => (b < 6 ? 0 : 7), tailS: 2 },
  '04-play-with-events': { bar0: 0, bars: 16, sync: 8, sector: 2, key: 2, events: playEvents(16), tailS: 2 },
  '05-top-tier-sector3': { bar0: 0, bars: 24, sync: 16, sector: 3, key: 9, tailS: 2 },
  '06-drums': { bar0: 0, bars: 8, sync: 16, sector: 0, key: 0, layers: [Layer.KICK, Layer.SNARE, Layer.HAT, Layer.OHAT, Layer.TOM, Layer.CRASH, Layer.RISER], tailS: 1 },
};

export function installDevPage(scriptedFrame: ScriptedFrameFn): void {
  const params = new URLSearchParams(location.search);
  if (params.get('eager') === '1') window.__eagerCtx = new AudioContext();

  // Time the engine's timer from outside, so the engine holds no test hook.
  const ticks = { count: 0, n: 0, buf: new Float32Array(200000) };
  const realSetInterval = window.setInterval.bind(window);
  window.setInterval = ((fn: TimerHandler, ms?: number, ...rest: unknown[]) => {
    if (ms === TICK_MS && typeof fn === 'function') {
      const inner = fn as () => void;
      return realSetInterval(() => {
        const a = performance.now();
        inner();
        const d = performance.now() - a;
        ticks.count += 1;
        ticks.buf[ticks.n % ticks.buf.length] = d;
        ticks.n += 1;
      }, ms);
    }
    return realSetInterval(fn, ms, ...rest);
  }) as typeof window.setInterval;

  // ?sync, ?sector and ?key set the scripted state from the first frame, so the first start adopts them with no fill.
  const intParam = (name: string, fallback: number): number => {
    const v = params.get(name);
    return v !== null && v !== '' && Number.isInteger(Number(v)) ? Number(v) : fallback;
  };
  const initial = { sync: intParam('sync', 1), sector: intParam('sector', 0), key: intParam('key', 0) };

  const engine: ProbedEngine = createEngine();
  buildUi(engine, params.get('legacy') === '1');

  const live = {
    sync: initial.sync, sector: initial.sector, key: initial.key,
    mode: SimMode.PLAY as number, speed: 80, reducedMotion: false,
    offset: 0, framesOn: true, pending: [] as ScriptedEventLite[], t0: performance.now() / 1000,
  };
  const tap = { node: null as AnalyserNode | null, buf: new Float32Array(2048), peak: 0, rmsDb: -240, sum: 0, reads: 0 };
  const pre = { node: null as AnalyserNode | null, buf: new Float32Array(2048) };
  const trace = { on: false, log: [] as TraceEntry[] };
  // Each engine.frame() call's start and length, from outside, in a ring.
  const FRAME_RING = 8192;
  const frameRing = { at: new Float64Array(FRAME_RING), ms: new Float64Array(FRAME_RING), n: 0 };

  function viewAt(t: number): FrameView {
    const o: ScriptedOptionsLite = {
      at: { chunk: 100 * live.sector, local: 0 },
      sim: { beat: (t + live.offset) / 0.6, sync: live.sync, mode: live.mode as SimMode, speed: live.speed },
      reducedMotion: live.reducedMotion,
    };
    if (live.pending.length > 0) o.events = live.pending;
    // Spread, not a write through: FrameView's sim and zone are read-only, and this is a page, so a copy is fine.
    const v = scriptedFrame(t, o);
    return { ...v, sim: { ...v.sim }, zone: { ...v.zone, musicKey: live.key } };
  }

  function readTap(): void {
    const ctx = engine.probe().ctx;
    if (!ctx || ctx.state !== 'running') return;
    if (!tap.node || !pre.node) {
      const graph = engine.probe().graph;
      if (!graph) return;
      tap.node = ctx.createAnalyser();
      tap.node.fftSize = 2048;
      graph.safetyClip.connect(tap.node);
      // The master's input: both buses that feed it. Against the output, it shows the master's own gain over time.
      pre.node = ctx.createAnalyser();
      pre.node.fftSize = 2048;
      graph.musicVol.connect(pre.node);
      graph.sfx.connect(pre.node);
    }
    tap.node.getFloatTimeDomainData(tap.buf);
    const p = analysis.peak(tap.buf);
    if (p > tap.peak) tap.peak = p;
    tap.rmsDb = analysis.rmsDb(tap.buf);
    tap.sum += Math.pow(10, tap.rmsDb / 10);
    tap.reads += 1;
    if (trace.on) {
      pre.node.getFloatTimeDomainData(pre.buf);
      const probe = engine.probe();
      const seq = probe.sequencer;
      trace.log.push({
        wall: performance.now(), at: ctx.currentTime, preDb: analysis.rmsDb(pre.buf), postDb: tap.rmsDb,
        nextStep: seq ? seq.nextStep : NaN, scheduled: seq ? seq.stats.scheduled : 0, skipped: seq ? seq.stats.skipped : 0,
        anchors: probe.clock.anchors,
      });
    }
  }

  function loop(): void {
    if (live.framesOn) {
      const t = performance.now() / 1000 - live.t0;
      const view = viewAt(t);
      const a = performance.now();
      engine.frame(view);
      const slot = frameRing.n % FRAME_RING;
      frameRing.at[slot] = a;
      frameRing.ms[slot] = performance.now() - a;
      frameRing.n += 1;
      if (live.pending.length > 0) live.pending = [];
      readTap();
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  function liveStats(): LiveStats {
    const p = engine.probe();
    const n = Math.min(ticks.n, ticks.buf.length);
    const sorted = ticks.buf.slice(0, n).sort();
    const stats = p.sequencer?.stats;
    return {
      state: p.ctx ? p.ctx.state : 'none',
      running: p.ctx?.state === 'running',
      disposed: p.disposed,
      retryArmed: p.retryArmed,
      timerRunning: p.timerRunning,
      scheduled: stats?.scheduled ?? 0, late: stats?.late ?? 0, skipped: stats?.skipped ?? 0,
      fills: stats?.fills ?? 0, sectorChanges: stats?.sectorChanges ?? 0,
      anchors: p.clock.anchors, emaMs: p.clock.ema * 1e3, rawMs: p.clock.raw * 1e3, compMs: p.clock.comp * 1e3,
      liveSources: p.voices?.live ?? 0, peakSources: p.voices?.peak ?? 0, created: p.voices?.created ?? 0, dropped: p.voices?.dropped ?? 0,
      tickCount: ticks.count,
      tickP50: n > 0 ? sorted[Math.floor(n * 0.5)]! : 0,
      tickP99: n > 0 ? sorted[Math.floor(n * 0.99)]! : 0,
      tickMax: n > 0 ? sorted[n - 1]! : 0,
      tapRmsDb: tap.rmsDb,
      tapMeanDb: tap.reads > 0 ? 10 * Math.log10(tap.sum / tap.reads + 1e-24) : -240,
      tapPeak: tap.peak,
      chain: p.sfx?.chain ?? 0,
    };
  }

  const liveApi: LiveApi = {
    engine,
    probe: () => engine.probe(),
    stats: liveStats,
    set(o) {
      if (o.sync !== undefined) live.sync = o.sync;
      if (o.sector !== undefined) live.sector = o.sector;
      if (o.key !== undefined) live.key = o.key;
      if (o.mode !== undefined) live.mode = o.mode;
      if (o.speed !== undefined) live.speed = o.speed;
      if (o.reducedMotion !== undefined) live.reducedMotion = o.reducedMotion;
    },
    emit(kind, x = 0, value = 100, index = 0) {
      live.pending.push({ kind, x, y: 6, value, chunk: 0, index });
    },
    jump(seconds) {
      live.offset += seconds;
    },
    stepInBar() {
      const steps = ((performance.now() / 1000 - live.t0 + live.offset) / 0.6) * 4;
      return ((steps % 16) + 16) % 16;
    },
    scriptedBeat() {
      return (performance.now() / 1000 - live.t0 + live.offset) / 0.6;
    },
    trace(on) {
      if (on) trace.log = [];
      trace.on = on;
    },
    traceLog() {
      return trace.log;
    },
    resetTicks() {
      ticks.n = 0;
      ticks.count = 0;
    },
    resetTap() {
      tap.peak = 0;
      tap.sum = 0;
      tap.reads = 0;
    },
    frameProbe(n) {
      const t = performance.now() / 1000 - live.t0;
      const v = viewAt(t);
      const sim = { ...v.sim };
      const view: FrameView = { ...v, sim };
      const a = performance.now();
      for (let i = 0; i < n; i++) {
        sim.beat += 2e-6;
        engine.frame(view);
      }
      return (performance.now() - a) / n;
    },
    frameRaw(v) {
      engine.frame(v as FrameView);
    },
    clockReadProbe(n) {
      const ctx = engine.probe().ctx;
      if (!ctx) return 0;
      let acc = 0;
      const a = performance.now();
      for (let i = 0; i < n; i++) acc += ctx.currentTime;
      allocKeep.keep = acc;
      return (performance.now() - a) / n;
    },
    replayGap(steps, endStep) {
      const p = engine.probe();
      if (!p.ctx || !p.voices || !p.sequencer) return;
      const clock = createBeatClock();
      const now = p.ctx.currentTime;
      const end = endStep ?? stepAtOrAfter(p.clock, now);
      anchorClock(clock, (end - steps) / 4, now);
      // The engine's own form origin, so the replayed steps are the same form bars the engine was playing.
      const seq = createSequencer(clock, p.voices, { windowS: (steps + 1) * STEP_S, formOrigin: p.sequencer.formOrigin });
      seq.sync = live.sync;
      seq.zoneIndex = live.sector;
      seq.zoneKey = live.key;
      seq.restart(now);
      seq.tick(now);
    },
    setFrames(on) {
      live.framesOn = on;
    },
    frameCost(from, to) {
      let worstMs = 0;
      let frames = 0;
      const n = Math.min(frameRing.n, FRAME_RING);
      for (let i = 0; i < n; i++) {
        const at = frameRing.at[i]!;
        if (at < from || at > to) continue;
        frames += 1;
        if (frameRing.ms[i]! > worstMs) worstMs = frameRing.ms[i]!;
      }
      return { worstMs, frames };
    },
  };

  const api: AudioDevApi = {
    last: null,
    async render(o) {
      const r = await renderSceneFull(o);
      api.last = r;
      return r;
    },
    async scene(o) {
      const r = await api.render(o);
      return metricsOf(r);
    },
    mid: midOf,
    channel: (b, c) => b.getChannelData(c),
    kit: (o) => kitFor(48000, o?.gateOff ? { gateOff: true } : {}),
    shot: (o) => drawShot(o),
    a: analysis,
    Layer, Ev, SimMode,
    startS: SCENE_START_S,
    barS: BAR_S,
    stepS: STEP_S,
    chordAt, ladderMidi, padTonic, midiToHz,
    chordPcs: (chord, key) => CHORDS[chord]!.pad.map((v) => (padTonic(key) + v) % 12),
    firstBass(bar, sector, key, sync) {
      const p = patternOf(bar, sector, key, sync);
      for (let i = 0; i < p.count; i++) if (p.layer[i] === Layer.BASS) return p.midi[i]!;
      return 0;
    },
    padPcs(bar, sector, key, sync) {
      const p = patternOf(bar, sector, key, sync);
      const out: number[] = [];
      for (let i = 0; i < p.count; i++) if (p.layer[i] === Layer.PAD) out.push(p.midi[i]! % 12);
      return [...new Set(out)];
    },
    live: liveApi,
    pattern: (bar, sector, key, sync) => patternOf(bar, sector, key, sync),
    allocProbe(n) {
      let kept = 0;
      for (let i = 0; i < n; i++) {
        const o = { a: i, b: [i, i + 1, i + 2] };
        allocKeep.keep = o;
        kept += o.b[1]!;
      }
      return kept;
    },
    presets: Object.keys(PRESETS),
  };
  window.__audio = api;

  function buildUi(eng: ProbedEngine, legacy: boolean): void {
    document.title = 'T07 audio';
    document.body.style.cssText = 'margin:0;background:#0b0614;color:#e8e0ff;font:13px/1.4 ui-monospace,Consolas,monospace';
    const start = document.createElement('button');
    start.id = 'start';
    start.textContent = 'Start';
    start.style.cssText = 'position:fixed;left:16px;top:16px;width:240px;height:64px;font:600 18px ui-monospace,Consolas,monospace;background:#ff2fa0;color:#10021a;border:0;cursor:pointer';
    // The real game calls unlock inside a pointerup or click (T08). This page uses click alone. ?legacy=1 runs the
    // pre-D1 order instead, as D-009's control.
    start.addEventListener('click', legacy ? legacyUnlock : () => { void eng.unlock(); });
    document.body.append(start);

    const panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;left:16px;top:96px;width:320px;display:grid;gap:6px';
    document.body.append(panel);

    const row = (label: string, el: HTMLElement): void => {
      const w = document.createElement('label');
      w.style.cssText = 'display:grid;grid-template-columns:96px 1fr;align-items:center;gap:8px';
      w.append(document.createTextNode(label), el);
      panel.append(w);
    };
    const range = (id: string, min: number, max: number, value: number, step: number, on: (v: number) => void): void => {
      const el = document.createElement('input');
      el.id = id;
      el.type = 'range';
      el.min = String(min);
      el.max = String(max);
      el.step = String(step);
      el.value = String(value);
      el.addEventListener('input', () => on(Number(el.value)));
      row(id, el);
    };
    range('sync', 1, 16, initial.sync, 1, (v) => liveApi.set({ sync: v }));
    range('sector', 0, 5, initial.sector, 1, (v) => liveApi.set({ sector: v }));
    range('key', 0, 11, initial.key, 1, (v) => liveApi.set({ key: v }));
    range('speed', 45, 150, 80, 1, (v) => liveApi.set({ speed: v }));
    const volumes = { music: 0.8, sfx: 0.8 };
    range('music', 0, 1, 0.8, 0.01, (v) => { volumes.music = v; eng.setVolume(volumes.music, volumes.sfx); });
    range('sfx', 0, 1, 0.8, 0.01, (v) => { volumes.sfx = v; eng.setVolume(volumes.music, volumes.sfx); });

    const mode = document.createElement('select');
    mode.id = 'mode';
    for (const [name, value] of MODES) {
      const opt = document.createElement('option');
      opt.textContent = name;
      opt.value = String(value);
      if (value === SimMode.PLAY) opt.selected = true;
      mode.append(opt);
    }
    mode.addEventListener('change', () => liveApi.set({ mode: Number(mode.value) }));
    row('mode', mode);

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px';
    const cue = (name: string, kind: Ev, value: number, index = 0): void => {
      const b = document.createElement('button');
      b.id = `cue-${name.toLowerCase()}`;
      b.textContent = name;
      b.addEventListener('click', () => liveApi.emit(kind, 0, value, index));
      buttons.append(b);
    };
    cue('Hit', Ev.HIT, 2);
    cue('Shard', Ev.SHARD, 100);
    cue('Gate', Ev.GATE, 500);
    cue('Miss', Ev.GATE_MISS, 0);
    cue('Graze', Ev.GRAZE, 10);
    cue('Grade', Ev.GRADE, 1000);
    panel.append(buttons);

    const preset = document.createElement('select');
    preset.id = 'preset';
    for (const name of Object.keys(PRESETS)) {
      const opt = document.createElement('option');
      opt.textContent = name;
      preset.append(opt);
    }
    row('scene', preset);
    const render = document.createElement('button');
    render.id = 'render';
    render.textContent = 'Render and download WAV';
    const status = document.createElement('div');
    status.id = 'render-status';
    render.addEventListener('click', () => {
      status.textContent = 'rendering';
      void downloadScene(preset.value).then((text) => { status.textContent = text; });
    });
    panel.append(render, status);
  }

  async function downloadScene(name: string): Promise<string> {
    const o = PRESETS[name];
    if (!o) return `no preset ${name}`;
    const { buffer } = await renderSceneFull(o);
    const wav = encodeWav(buffer.getChannelData(0), buffer.getChannelData(1), buffer.sampleRate);
    const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.wav`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return `done ${name} ${(wav.byteLength / 1e6).toFixed(1)} MB`;
  }
}

function patternOf(bar: number, sector: number, key: number, sync: number): ReturnType<typeof createBarPattern> {
  const s: SectorMusic = { index: sector, key, fillNext: false, entered: false };
  return patternFor(bar, s, sync, createBarPattern());
}

function midOf(b: AudioBuffer): Float32Array {
  const l = b.getChannelData(0);
  const r = b.getChannelData(1);
  const m = new Float32Array(l.length);
  for (let i = 0; i < l.length; i++) m[i] = (l[i]! + r[i]!) / 2;
  return m;
}

function metricsOf(r: SceneResult): SceneMetrics {
  const b = r.buffer;
  const sr = b.sampleRate;
  const from = Math.floor(r.startS * sr);
  const to = Math.min(b.length, Math.floor(r.endS * sr));
  const l = b.getChannelData(0).subarray(from, to);
  const rr = b.getChannelData(1).subarray(from, to);
  const mid = midOf(b).subarray(from, to);
  const rms = 10 * Math.log10((Math.pow(10, analysis.rmsDb(l) / 10) + Math.pow(10, analysis.rmsDb(rr) / 10)) / 2 + 1e-24);
  const peak = Math.max(analysis.peak(l), analysis.peak(rr));
  return {
    peak,
    clip: analysis.clipCount(l) + analysis.clipCount(rr),
    bad: analysis.badCount(b.getChannelData(0)) + analysis.badCount(b.getChannelData(1)),
    dc: (analysis.dc(l) + analysis.dc(rr)) / 2,
    rmsDb: rms,
    crestDb: 20 * Math.log10(peak + 1e-12) - rms,
    corr: analysis.corr(l, rr),
    monoDb: analysis.monoDb(l, rr),
    bands: analysis.bandShares(mid, sr),
    stats: r.stats,
  };
}

function shotCanvas(): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  let c = document.getElementById('shot') as HTMLCanvasElement | null;
  if (!c) {
    c = document.createElement('canvas');
    c.id = 'shot';
    c.style.cssText = 'position:fixed;left:0;top:0;z-index:10;display:block';
    document.body.append(c);
  }
  c.width = window.innerWidth;
  c.height = window.innerHeight;
  return { c, g: c.getContext('2d')! };
}

function label(g: CanvasRenderingContext2D, text: string, x: number, y: number, color = '#ffffff'): void {
  g.font = '15px Consolas, monospace';
  g.fillStyle = 'rgba(0,0,0,.65)';
  const w = g.measureText(text).width;
  g.fillRect(x - 2, y - 13, w + 4, 17);
  g.fillStyle = color;
  g.fillText(text, x, y);
}

async function drawShot(o: ShotOptions): Promise<void> {
  const { c, g } = shotCanvas();
  const W = c.width;
  const H = c.height;
  let x: Float32Array;
  let sr = 48000;
  let dur: number;
  if (o.kitSound) {
    const kit = await kitFor(48000);
    const b = kit[o.kitSound];
    x = b.getChannelData(0);
    sr = b.sampleRate;
    dur = b.duration;
  } else {
    const r = await renderSceneFull(o.scene!);
    x = o.kind === 'wave' ? r.buffer.getChannelData(0) : midOf(r.buffer);
    sr = r.buffer.sampleRate;
    dur = r.buffer.duration;
  }
  const t0 = o.t0 ?? 0;
  const t1 = o.t1 ?? dur;
  const X = (t: number): number => ((t - t0) / (t1 - t0)) * W;

  if (o.kind === 'spec') {
    const img = analysis.spectrogram(x, sr, t0, t1, W, H);
    const data = new ImageData(img as Uint8ClampedArray<ArrayBuffer>, W, H);
    g.putImageData(data, 0, 0);
    for (const f of [100, 1000, 10000]) {
      const y = (H - 1) * (1 - Math.log(f / 30) / Math.log(16000 / 30));
      g.fillStyle = 'rgba(255,255,255,.25)';
      g.fillRect(0, y, W, 1);
      label(g, f >= 1000 ? `${f / 1000} kHz` : `${f} Hz`, 6, y - 3);
    }
  } else {
    g.fillStyle = '#0b0614';
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,.2)';
    g.fillRect(0, H / 2, W, 1);
    const a = Math.floor(t0 * sr);
    const b = Math.floor(t1 * sr);
    const peak = analysis.peak(x.subarray(a, b)) || 1;
    g.fillStyle = '#39e6ff';
    for (let col = 0; col < W; col++) {
      const s0 = a + Math.floor(((b - a) * col) / W);
      const s1 = a + Math.floor(((b - a) * (col + 1)) / W);
      let lo = 0;
      let hi = 0;
      for (let i = s0; i < s1 && i < x.length; i++) {
        const v = x[i]! / peak;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      const yHi = (0.5 - hi * 0.47) * H;
      const yLo = (0.5 - lo * 0.47) * H;
      g.fillRect(col, yHi, 1, Math.max(1, yLo - yHi));
    }
    const span = t1 - t0;
    const tickStep = span <= 0.5 ? 0.05 : span <= 3 ? 0.15 : 2.4;
    for (let t = Math.ceil(t0 / tickStep) * tickStep; t < t1; t += tickStep) {
      g.fillStyle = 'rgba(255,255,255,.25)';
      g.fillRect(X(t), H - 24, 1, 24);
      label(g, t.toFixed(2), X(t) + 3, H - 8);
    }
  }
  for (const m of o.marks ?? []) {
    g.fillStyle = 'rgba(57,230,255,.8)';
    g.fillRect(X(m.t), 0, 1, 26);
    label(g, m.label, X(m.t) + 3, 40, '#7ff0ff');
  }
  label(g, o.title, 6, 18, '#ffe25e');
}
