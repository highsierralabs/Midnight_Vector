// AudioEngine: unlock, the 25 ms timer, lifecycle, gesture retry and the failure guard. createAudio creates no audio
// object, so this constructs in Node and in a page with no AudioContext. An audio fault disposes the engine: silence
// beats §10.1's fatal page, and R1 outranks audio.
// D-009, DI-79: the launch gesture creates and resumes the AudioContext and nothing else. The graph, voices, launch
// sweep and kit are queued, and each frame() runs one slice of that queue of at most SLICE_MS plus one bounded item,
// so no frame carries the whole build. The kit's renders run off the main thread in OfflineAudioContexts.
import { SPEED_CRUISE, SPEED_MAX, type AudioEngine, type FrameView } from '../contracts/index';
import { anchorClock, createBeatClock, observe, setOutputLatency, type BeatClock } from './clock';
import { queueGraph, safetyClipCurve, softClipCurve, type AudioGraph } from './graph';
import { queueKit, type Kit } from './kit';
import { MIX, WIND_DEADBAND, WIND_INTERVAL_S } from './mix';
import { createSequencer, type Sequencer } from './sequencer';
import { createSfx, type Sfx } from './sfx';
import { createVoices, type Voices } from './voices';
import { createQueue, once, runSlice, type WorkQueue } from './work';

export const TICK_MS = 25;
/**
 * A build slice runs items while their expected cost fits in this budget. Fills size their runs to about .25 to .6
 * ms, and the items that can take longer, wiring, each convolver's buffer and a fill's first run, are alone and start
 * a slice of their own, at up to about 3 ms each [O: D-009 item timing], so a slice stays inside DI-79's 4 ms.
 */
export const SLICE_MS = 2.5;
const UNLOCK_TIMEOUT_MS = 1000;
const REDUCED_MOTION_SPEED = 0.6;
const nowMs = (): number => performance.now();

/** What the dev page reads. Nothing in production uses it. */
export interface EngineProbe {
  readonly ctx: AudioContext | null;
  readonly graph: AudioGraph | null;
  readonly voices: Voices | null;
  readonly sequencer: Sequencer | null;
  readonly sfx: Sfx | null;
  readonly clock: BeatClock;
  readonly kit: Kit | null;
  readonly retryArmed: boolean;
  readonly disposed: boolean;
  readonly timerRunning: boolean;
  /** The post-gesture build has work left or a render outstanding. */
  readonly building: boolean;
}

export interface ProbedEngine extends AudioEngine {
  probe(): EngineProbe;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function createEngine(): ProbedEngine {
  // Scalars live in one object: a module-level let holding a large double allocates [O: T07 prototype].
  const s = {
    ctx: null as AudioContext | null,
    graph: null as AudioGraph | null,
    voices: null as Voices | null,
    seq: null as Sequencer | null,
    sfx: null as Sfx | null,
    kit: null as Kit | null,
    work: null as WorkQueue | null,
    clock: createBeatClock(),
    disposed: false,
    running: false,
    hostSuspended: false,
    needsAnchor: true,
    timer: null as ReturnType<typeof setInterval> | null,
    retryArmed: false,
    music: MIX.defaultMusic as number,
    sfxLevel: MIX.defaultSfx as number,
    mode: -1,
    lastNow: 0,
    latencyBar: NaN,
    wind: 0,
    windAt: -Infinity,
    clockDue: true,
  };

  function warnOnce(e: unknown): void {
    if (s.disposed) return;
    console.warn('audio: disabled after an error', e);
    engine.dispose();
  }

  // ---- retry on a later gesture (§10.5) ----

  function onGesture(e: Event): void {
    if (e.type === 'keydown' && (e as KeyboardEvent).key === 'Escape') return;   // Escape does not activate (T08 section 10)
    try {
      const ctx = s.ctx;
      if (!ctx) return;
      void ctx.resume().catch(() => undefined);
      if (ctx.state === 'running') disarmRetry();
    } catch (err) {
      warnOnce(err);
    }
  }

  function armRetry(): void {
    if (s.retryArmed || typeof document === 'undefined') return;
    s.retryArmed = true;
    document.addEventListener('pointerup', onGesture, true);
    document.addEventListener('click', onGesture, true);
    document.addEventListener('keydown', onGesture, true);
  }

  function disarmRetry(): void {
    if (!s.retryArmed) return;
    s.retryArmed = false;
    document.removeEventListener('pointerup', onGesture, true);
    document.removeEventListener('click', onGesture, true);
    document.removeEventListener('keydown', onGesture, true);
  }

  function onStateChange(): void {
    const ctx = s.ctx;
    if (!ctx || s.disposed) return;
    s.running = ctx.state === 'running';
    if (s.running) disarmRetry();
    else if (!s.hostSuspended && ctx.state !== 'closed') armRetry();
  }

  // ---- the timer ----

  function tick(): void {
    try {
      const ctx = s.ctx;
      const seq = s.seq;
      if (!ctx || !seq || s.needsAnchor || !s.running) return;
      // The frame reads the audio clock at most once per timer tick. A read boxes a double in Chromium (Decision log).
      s.clockDue = true;
      const bar = seq.currentBar;
      if (bar !== s.latencyBar) {
        s.latencyBar = bar;
        setOutputLatency(s.clock, ctx.outputLatency || ctx.baseLatency || 0);
      }
      seq.tick(ctx.currentTime);
    } catch (e) {
      warnOnce(e);
    }
  }

  function startTimer(): void {
    if (s.timer === null) s.timer = setInterval(tick, TICK_MS);
  }

  function stopTimer(): void {
    if (s.timer !== null) {
      clearInterval(s.timer);
      s.timer = null;
    }
  }

  function kitReady(kit: Kit): void {
    if (s.disposed || !s.voices) return;
    s.kit = kit;
    s.voices.setKit(kit);
    s.work = null;   // the kit's own last item, so nothing is left in the queue
    if (!s.hostSuspended) startTimer();
  }

  /**
   * The first item of the post-gesture queue. It queues the kit, so its renders start early, then makes the graph's
   * master and SFX path now and queues the rest of the graph after the kit. Render callbacks append the kit's
   * normalising after all of that, so the graph is complete before the kit is ready and music starts.
   */
  function startGraph(ctx: AudioContext, q: WorkQueue, curves: { soft: Float32Array<ArrayBuffer>; safety: Float32Array<ArrayBuffer> }): void {
    queueKit(q, ctx.sampleRate, {}, kitReady).rendered.catch(warnOnce);
    const graph = queueGraph(ctx, q, curves);
    s.graph = graph;
    graph.initVolume(s.music, s.sfxLevel);
  }

  /** The second item, ahead of everything startGraph queued: voices, sequencer and cues, then the launch sweep. */
  function startVoices(ctx: AudioContext): void {
    const voices = createVoices(s.graph!);
    s.voices = voices;
    const seq = createSequencer(s.clock, voices);
    s.seq = seq;
    s.sfx = createSfx(s.clock, seq, voices);
    voices.launch(ctx.currentTime);
  }

  function whenRunning(): Promise<void> {
    const ctx = s.ctx;
    if (!ctx || ctx.state === 'running') return Promise.resolve();
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timeout);
        ctx.removeEventListener('statechange', check);
        resolve();
      };
      const check = (): void => {
        if (ctx.state === 'running') done();
      };
      const timeout = setTimeout(done, UNLOCK_TIMEOUT_MS);
      ctx.addEventListener('statechange', check);
    });
  }

  const engine: ProbedEngine = {
    unlock(): Promise<void> {
      if (s.disposed) return Promise.resolve();
      try {
        const existing = s.ctx;
        if (existing) {
          if (existing.state !== 'running') {
            void existing.resume().catch(() => undefined);
            armRetry();
          }
          return whenRunning();
        }
        const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
        if (!Ctor) return Promise.resolve();

        // Synchronously in the caller's stack: construction and resume have to stay inside the gesture, and nothing
        // else does (DI-79). The rest waits for the next frame() in the queue.
        const ctx = new Ctor({ latencyHint: 'interactive' });
        s.ctx = ctx;
        void ctx.resume().catch(() => undefined);
        s.running = ctx.state === 'running';
        ctx.addEventListener('statechange', onStateChange);
        // A suspended start arms here, so the click of this same gesture can retry (plan section 4).
        if (!s.running) armRetry();
        // Three items, a slice each, all before anything they queue: as one they ran over 4 ms in code the JIT had not
        // compiled yet [O: D-009, the longest frame() 4.2 to 4.7 ms with one item, and the graph's core alone up to
        // 3.4 ms with its two 4097-point clip curves].
        const q = createQueue();
        const curves = { soft: new Float32Array(0), safety: new Float32Array(0) };
        once(q, () => {
          curves.soft = softClipCurve();
          curves.safety = safetyClipCurve();
        }, true);
        once(q, () => { startGraph(ctx, q, curves); }, true);
        once(q, () => { startVoices(ctx); }, true);
        s.work = q;

        if (s.hostSuspended) {
          void ctx.suspend().catch(() => undefined);
          disarmRetry();
          return Promise.resolve();
        }
        return whenRunning();
      } catch (e) {
        warnOnce(e);
        return Promise.resolve();
      }
    },

    frame(v: Readonly<FrameView>): void {
      if (s.disposed) return;
      try {
        // One slice of the post-gesture build per frame, in every state: it is construction, not playback. A frame
        // that ran a slice does nothing else, so the first anchor and its scheduling never share a frame with one.
        const work = s.work;
        if (work !== null) {
          runSlice(work, SLICE_MS, nowMs);
          return;
        }
        if (!s.kit || s.hostSuspended) return;
        if (!s.running) {
          armRetry();
          return;
        }
        const seq = s.seq!;
        const sim = v.sim;
        seq.sync = sim.sync;
        seq.zoneIndex = v.zone.index;
        seq.zoneKey = v.zone.musicKey;

        if (s.needsAnchor) {
          const now = s.ctx!.currentTime;
          anchorClock(s.clock, sim.beat + v.alpha / 72, now);
          seq.restart(now);
          // Once, with the same now, and not a rAF drive: the first step is at or after now, so scheduling it here
          // cannot be late, where waiting up to 25 ms for the timer can.
          seq.tick(now);
          s.lastNow = now;
          s.needsAnchor = false;
          s.clockDue = false;
        } else if (s.clockDue) {
          s.clockDue = false;
          const now = s.ctx!.currentTime;
          observe(s.clock, sim.beat + v.alpha / 72, now, now - s.lastNow);
          s.lastNow = now;
          updateWind(sim.speed, v.reducedMotion, now);
        }

        const mode = sim.mode;
        if (mode !== s.mode) {
          s.mode = mode;
          s.graph!.setMode(mode, s.lastNow);
        }

        const events = v.events;
        if (events.count > 0) s.sfx!.handle(events, s.ctx!.currentTime);
      } catch (e) {
        warnOnce(e);
      }
    },

    setVolume(music: number, sfx: number): void {
      if (s.disposed) return;
      try {
        if (music === music) s.music = clamp01(music);
        if (sfx === sfx) s.sfxLevel = clamp01(sfx);
        const ctx = s.ctx;
        if (ctx && s.graph) s.graph.setVolume(s.music, s.sfxLevel, ctx.currentTime);
      } catch (e) {
        warnOnce(e);
      }
    },

    suspend(): void {
      if (s.disposed) return;
      try {
        s.hostSuspended = true;
        const ctx = s.ctx;
        if (!ctx) return;
        stopTimer();
        disarmRetry();
        s.voices?.stopAll();
        void ctx.suspend().catch(() => undefined);
      } catch (e) {
        warnOnce(e);
      }
    },

    resume(): void {
      if (s.disposed) return;
      try {
        const was = s.hostSuspended;
        s.hostSuspended = false;
        const ctx = s.ctx;
        if (!ctx) return;
        if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
        if (!was) return;
        if (s.kit) startTimer();
        s.graph?.rampIn(ctx.currentTime);
        s.needsAnchor = true;
        s.mode = -1;
      } catch (e) {
        warnOnce(e);
      }
    },

    dispose(): void {
      if (s.disposed) return;
      s.disposed = true;
      s.work = null;
      stopTimer();
      disarmRetry();
      const ctx = s.ctx;
      try {
        s.voices?.stopAll();
      } catch {
        // Already on the way out; there is nothing left to protect but the caller.
      }
      if (ctx) {
        ctx.removeEventListener('statechange', onStateChange);
        try {
          void ctx.close().catch(() => undefined);
        } catch {
          // As above.
        }
      }
      s.running = false;
    },

    probe(): EngineProbe {
      return {
        ctx: s.ctx, graph: s.graph, voices: s.voices, sequencer: s.seq, sfx: s.sfx, clock: s.clock, kit: s.kit,
        retryArmed: s.retryArmed, disposed: s.disposed, timerRunning: s.timer !== null, building: s.work !== null,
      };
    },
  };

  function updateWind(speed: number, reduced: boolean, now: number): void {
    if (now - s.windAt < WIND_INTERVAL_S) return;
    const scale = reduced ? REDUCED_MOTION_SPEED : 1;
    const cruise = SPEED_CRUISE * scale;
    const max = SPEED_MAX * scale;
    const target = clamp01((speed - cruise) / (max - cruise));
    const moved = Math.abs(target - s.wind);
    if (moved > WIND_DEADBAND || (target === 0 && s.wind !== 0)) {
      s.wind = target;
      s.windAt = now;
      s.graph!.setWind(target, now);
    }
  }

  return engine;
}
