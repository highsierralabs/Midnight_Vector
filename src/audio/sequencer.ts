// The step walk: pure, no Web Audio types, driven by a fake sink and clock in Node. Called from a 25 ms timer in
// production and from an OfflineAudioContext suspend in virtual time; never from rAF.
import { Layer, chordAt, createBarPattern, patternFor, type BarPattern, type SectorMusic } from './composer';
import { stepAtOrAfter, timeOfStep, type BeatClock } from './clock';
import { BAR_S, STEP_S, TOM_RATES, normKey } from './theory';

export const WINDOW_S = 0.12;
export const LATE_LIMIT_S = 0.03;
/** Behind by this much with no re-anchor, the walk jumps rather than step through every missed step. */
const LOST_S = 1;

export interface VoiceSink {
  oneShot(layer: number, t: number, vel: number, rate: number): void;
  bass(t: number, midi: number, lenS: number, vel: number): void;
  padChord(t: number, p: Readonly<BarPattern>, durS: number): void;
  arp(t: number, midi: number, lenS: number, vel: number): void;
  lead(t: number, midi: number, lenS: number, vel: number): void;
}

export interface SequencerStats { scheduled: number; late: number; skipped: number; fills: number; sectorChanges: number }

export interface Sequencer {
  sync: number; zoneIndex: number; zoneKey: number;           // written by engine.frame
  tick(audioNow: number): void;                               // the only scheduling entry point
  restart(audioNow: number): void;
  /** The chord at a step, with a pending sector change applied where it will have happened. */
  chordAtStep(step: number): number;
  keyAtStep(step: number): number;
  readonly stats: SequencerStats;
  /** The bar last computed, NaN before the first. */
  readonly currentBar: number;
  /** For the dev page's probes only: the next step to schedule, and the bar the 32-bar form counts from. */
  readonly nextStep: number;
  readonly formOrigin: number;
}

export interface SequencerOptions {
  windowS?: number;
  /** Virtual-time scenes only: start at this step and this form origin, not at a launch-aligned section A. */
  firstStep?: number;
  formOrigin?: number;
}

export function createSequencer(clock: BeatClock, sink: VoiceSink, o: SequencerOptions = {}): Sequencer {
  const windowS = o.windowS ?? WINDOW_S;
  const pat = createBarPattern();
  const sector: SectorMusic = { index: 0, key: 0, fillNext: false, entered: false };
  const stats: SequencerStats = { scheduled: 0, late: 0, skipped: 0, fills: 0, sectorChanges: 0 };

  const st = {
    started: false,
    nextStep: 0,
    curBar: NaN,
    padBar: NaN,
    formOrigin: 0,
    activeIndex: 0,
    activeKey: 0,
    armed: false,      // a fill bar has run, or is running, for a change that has not activated yet
    seenAnchors: 0,
  };

  function changed(): boolean {
    return seq.zoneIndex !== st.activeIndex || normKey(seq.zoneKey) !== st.activeKey;
  }

  /** The sector reducer, then the bar. A jump over bars leaves a pending change armed until the next phrase line. */
  function computeBar(bar: number): void {
    st.curBar = bar;
    const r = bar - st.formOrigin;
    const phrase = ((r % 4) + 4) % 4;
    let entered = false;
    if (st.armed && phrase === 0) {
      st.armed = false;
      if (changed()) {
        st.activeIndex = seq.zoneIndex;
        st.activeKey = normKey(seq.zoneKey);
        entered = true;
        stats.sectorChanges += 1;
      }
    }
    const fillNext = phrase === 3 && changed();
    if (fillNext) st.armed = true;
    sector.index = st.activeIndex;
    sector.key = st.activeKey;
    sector.fillNext = fillNext;
    sector.entered = entered;
    patternFor(r, sector, seq.sync, pat);
    if (fillNext || ((r % 32) + 32) % 32 === 31) stats.fills += 1;
  }

  function scheduleStep(step: number, t: number, now: number): void {
    const bar = Math.floor(step / 16);
    if (bar !== st.curBar) computeBar(bar);
    let at = t;
    if (t < now) {
      if (now - t > LATE_LIMIT_S) {
        stats.skipped += 1;
        return;   // a pad chord missed here comes back on the next step that plays
      }
      stats.late += 1;
      at = now;
    }
    stats.scheduled += 1;
    if (st.padBar !== bar) {
      st.padBar = bar;
      sink.padChord(at, pat, timeOfStep(clock, bar * 16) + BAR_S - at);
    }
    const inBar = step - bar * 16;
    const n = pat.count;
    for (let i = 0; i < n; i++) {
      if (pat.step[i] !== inBar) continue;
      const layer = pat.layer[i]!;
      switch (layer) {
        case Layer.PAD:
          break;
        case Layer.BASS:
          sink.bass(at, pat.midi[i]!, pat.len[i]! * STEP_S, pat.vel[i]!);
          break;
        case Layer.ARP:
          sink.arp(at, pat.midi[i]!, pat.len[i]! * STEP_S, pat.vel[i]!);
          break;
        case Layer.LEAD:
          sink.lead(at, pat.midi[i]!, pat.len[i]! * STEP_S, pat.vel[i]!);
          break;
        case Layer.TOM:
          sink.oneShot(layer, at, pat.vel[i]!, TOM_RATES[inBar - 8]!);
          break;
        default:
          sink.oneShot(layer, at, pat.vel[i]!, 1);
      }
    }
  }

  const seq: Sequencer = {
    sync: 1,
    zoneIndex: 0,
    zoneKey: 0,
    stats,
    get currentBar() { return st.curBar; },
    get nextStep() { return st.nextStep; },
    get formOrigin() { return st.formOrigin; },

    tick(now: number): void {
      if (!st.started) return;
      if (clock.anchors !== st.seenAnchors) {
        st.seenAnchors = clock.anchors;
        // A re-anchor can move time either way. nextStep never decreases, so no step is ever repeated.
        const s = stepAtOrAfter(clock, now);
        if (s > st.nextStep) st.nextStep = s;
      }
      let t = timeOfStep(clock, st.nextStep);
      if (now - t > LOST_S) {
        const s = stepAtOrAfter(clock, now);
        stats.skipped += s - st.nextStep;
        st.nextStep = s;
        t = timeOfStep(clock, s);
      }
      while (t < now + windowS) {
        scheduleStep(st.nextStep, t, now);
        st.nextStep += 1;
        t = timeOfStep(clock, st.nextStep);
      }
    },

    restart(now: number): void {
      st.seenAnchors = clock.anchors;
      if (!st.started) {
        st.started = true;
        st.nextStep = o.firstStep ?? stepAtOrAfter(clock, now);
        const firstBar = Math.floor(st.nextStep / 16);
        // A multiple of 4 keeps phases[2] in step, and launch always lands in section A, never maybe in the break.
        st.formOrigin = o.formOrigin ?? Math.floor(firstBar / 4) * 4;
        st.activeIndex = seq.zoneIndex;      // the first start adopts the current zone at once, with no fill
        st.activeKey = normKey(seq.zoneKey);
        st.curBar = NaN;
        st.padBar = NaN;
        return;
      }
      // Live voices were cut, so the current bar's chord has to come back. formOrigin is not reset.
      const s = stepAtOrAfter(clock, now);
      if (s > st.nextStep) st.nextStep = s;
      st.padBar = NaN;
    },

    chordAtStep(step: number): number {
      const b = Math.floor(step / 16);
      return chordAt(b - st.formOrigin, st.armed && b > st.curBar ? seq.zoneIndex : st.activeIndex);
    },

    keyAtStep(step: number): number {
      const b = Math.floor(step / 16);
      return st.armed && b > st.curBar ? normKey(seq.zoneKey) : st.activeKey;
    },
  };
  return seq;
}
