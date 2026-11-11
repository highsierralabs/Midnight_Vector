// Dev only: index.ts never imports this. Implementations arrive by injection, so this file imports contracts alone and
// keeps the module boundary. It runs synchronously to completion, so the page is ready when goto returns, because a
// polling wait before a first gesture would grant activation and void the gesture tests.
import {
  Ev, Objective, PALETTE_COUNT, SimMode,
  type ControlFrame, type CreateInput, type CreateUi, type FatalReason, type FrameView, type InputSource, type SimState, type Tier, type Travel, type Ui,
} from '../contracts/index';

export interface DevEvent { kind: Ev; x: number; y: number; value: number; chunk: number; index: number }
/** The parts of T00's ScriptedFrameOptions this page uses, plus two fields it writes onto the zone itself. */
export interface DevFrameOptions {
  at?: Travel; tick?: number; palette?: number;
  sim?: Partial<SimState>; feel?: { shipHold?: number };
  tier?: Tier; reducedMotion?: boolean; events?: readonly DevEvent[];
  objective?: Objective; objectiveTarget?: number;
}
export interface DevCall { name: string; args: readonly unknown[]; event: string; audio?: string }

export interface DevState {
  mode: SimMode;
  /** Where the run starts, and so where km is measured from. Defaults to at. */
  start?: Travel;
  at: Travel;
  sim?: Partial<SimState>;
  objective?: Objective;
  objectiveTarget?: number;
  contextLost?: boolean;
  /** Stops short of the banner's expiry, with a grade one frame before the sector change. */
  banner?: boolean;
  fatal?: FatalReason;
}

const BASE_SIM: Partial<SimState> = { autopilot: false, score: 1284500, sync: 8, shields: 2, overdrive: 0.62, objectiveProgress: 6 };

export const STATES = {
  title: { mode: SimMode.DEMO, at: { chunk: 1, local: 0 }, sim: { autopilot: true, score: 0, sync: 1, shields: 3, overdrive: 0 } },
  play: { mode: SimMode.PLAY, at: { chunk: 777, local: 32 }, sim: { ...BASE_SIM, travel: { chunk: 971, local: 0 } } },
  'play-max': {
    mode: SimMode.PLAY, start: { chunk: 1, local: 0 }, at: { chunk: 2 ** 44, local: 0 },
    sim: { ...BASE_SIM, score: 2 ** 53, sync: 16, shields: 3, overdrive: 1, objectiveProgress: 12345 },
    objective: Objective.BOOST, objectiveTarget: 32000,
  },
  'play-low': {
    mode: SimMode.PLAY, at: { chunk: 777, local: 32 },
    sim: { ...BASE_SIM, score: 48200, sync: 2, shields: 1, overdrive: 0.1, ghost: 1, objectiveProgress: 1234, travel: { chunk: 800, local: 0 } },
    objective: Objective.NO_HIT, objectiveTarget: 3200,
  },
  autopilot: { mode: SimMode.PLAY, at: { chunk: 777, local: 32 }, sim: { ...BASE_SIM, autopilot: true, travel: { chunk: 971, local: 0 } } },
  cruise: { mode: SimMode.CRUISE, at: { chunk: 777, local: 32 }, sim: { ...BASE_SIM, autopilot: true, travel: { chunk: 971, local: 0 } } },
  /** The longest run and best lines the card can show: a 10-character score and a 9-character km. */
  'cruise-max': {
    mode: SimMode.CRUISE, start: { chunk: 1, local: 0 }, at: { chunk: 2 ** 44, local: 0 },
    sim: { ...BASE_SIM, autopilot: true, score: 9_999_999_999, sync: 16, shields: 3, overdrive: 1 },
  },
  'signal-lost': {
    mode: SimMode.SIGNAL_LOST, at: { chunk: 777, local: 32 },
    sim: { ...BASE_SIM, autopilot: true, shields: 0, sync: 1, overdrive: 0.2, travel: { chunk: 971, local: 0 } },
  },
  'context-lost': { mode: SimMode.PLAY, at: { chunk: 777, local: 32 }, sim: { ...BASE_SIM, travel: { chunk: 971, local: 0 } }, contextLost: true },
  'banner-sector': { mode: SimMode.PLAY, at: { chunk: 799, local: 32 }, sim: { ...BASE_SIM, travel: { chunk: 971, local: 0 } }, banner: true },
  'fatal-no-webgl2': { mode: SimMode.PLAY, at: { chunk: 777, local: 32 }, fatal: 'no-webgl2' },
} as const satisfies Readonly<Record<string, DevState>>;
export type StateName = keyof typeof STATES;

export interface DevUi {
  /** Every UiCommands call in order, plus probe records. */
  readonly calls: DevCall[];
  frame(t: number, o?: DevFrameOptions): FrameView;
  /** Puts the UI in a named state, past every throttle. */
  state(name: StateName): void;
  /** Advances n frames of the current state, each 8 ticks on, at whatever mode the commands have reached. */
  step(n?: number): void;
  sample(): ControlFrame;
  readonly ui: Ui;
  readonly input: InputSource;
  /** The last FrameView. */
  readonly view: FrameView | null;
  readonly stage: HTMLElement;
  /** Seconds, as frame takes them. */
  clock(): number;
  /** A deliberate allocator, the negative control for the alloc gate. */
  allocProbe(n: number): number;
}

declare global { interface Window { __ui?: DevUi } }

export interface DevDeps {
  createUi: CreateUi;
  createInput: CreateInput;
  scriptedFrame: (t: number, o?: DevFrameOptions) => FrameView;
}

const SLOT_SAFE_TICKS = 8;
const BANNER_EXPIRED_TICKS = 370;

let allocSink: unknown = null;

export function installDevPage(deps: DevDeps): void {
  const q = new URLSearchParams(location.search);
  const stage = document.getElementById('stage');
  const uiRoot = document.getElementById('ui');
  if (!stage || !uiRoot) throw new Error('dev/ui.html needs #stage and #ui');

  const bg = q.get('bg');
  if (bg !== null) stage.setAttribute('data-bg', bg);
  const paletteParam = q.get('palette');
  const palette = paletteParam === null ? undefined : ((Number(paletteParam) % PALETTE_COUNT) + PALETTE_COUNT) % PALETTE_COUNT;
  if (palette !== undefined) stage.setAttribute('data-palette', String(palette));

  // ?boot=loading stands in for T10's html[data-mv-boot] while the app loads (DI-95), set before mount as main.ts does.
  // ?bootms=N then flips it to running on a timer, so a test can wait for it without touching the page.
  const boot = q.get('boot');
  if (boot !== null) {
    document.documentElement.setAttribute('data-mv-boot', boot);
    const ms = Number(q.get('bootms'));
    if (ms > 0) setTimeout(() => { document.documentElement.setAttribute('data-mv-boot', 'running'); }, ms);
  }

  const probe = q.get('audioprobe');
  const calls: DevCall[] = [];

  function audioState(): string {
    return new AudioContext().state;
  }
  function record(name: string, args: readonly unknown[], audio?: string): void {
    const call: DevCall = { name, args, event: window.event?.type ?? '' };
    if (audio !== undefined) call.audio = audio;
    calls.push(call);
  }

  if (probe === 'early') record('early', [], audioState());
  if (probe !== null) {
    // The control: these keys must not launch, and what they grant is read in their own handler.
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' || e.code === 'Tab') record(`probe-${e.code}`, [], audioState());
    }, { capture: true });
  }

  let devMode: SimMode = SimMode.DEMO;
  let reduced = false;
  let view: FrameView | null = null;

  const ui = deps.createUi();
  const input = deps.createInput();
  const out: ControlFrame = { moveX: 0, moveY: 0, absolute: false, boost: false, human: false };

  if (q.get('mount') !== '0') {
    ui.mount(uiRoot, {
      launch() {
        record('launch', [], probe !== null ? audioState() : undefined);
        if (devMode === SimMode.DEMO) devMode = SimMode.PLAY;
      },
      togglePause() {
        record('togglePause', []);
        // FH-37: as the sim's own command does (src/sim/rules.ts command()), at once, on the state the last frame showed.
        // On the app FrameView.sim is that live state, so a toggle made inside ui.frame, as FH-8's, is seen by the rest
        // of the same frame. scriptedFrame returns one object mutated in place, so this writes it as the sim would.
        if (devMode === SimMode.PLAY) {
          devMode = SimMode.CRUISE;
          if (view) Object.assign(view.sim, { mode: SimMode.CRUISE, autopilot: true });
        } else if (devMode === SimMode.CRUISE) {
          devMode = SimMode.PLAY;
          if (view) Object.assign(view.sim, { mode: SimMode.PLAY, autopilot: false });
        }
      },
      setQuality(t) { record('setQuality', [t]); },
      setVolume(m, s) { record('setVolume', [m, s]); },
      setReducedMotion(on) {
        record('setReducedMotion', [on]);
        reduced = on;
      },
    });
    input.attach(stage);
  }

  let clock = 0;
  let current: DevFrameOptions = {};

  function frame(t: number, o: DevFrameOptions = {}): FrameView {
    if (o.sim?.mode !== undefined) devMode = o.sim.mode;
    const merged: DevFrameOptions = {
      ...o,
      sim: { mode: devMode, ...o.sim },
      reducedMotion: o.reducedMotion ?? reduced,
    };
    if (palette !== undefined && o.palette === undefined) merged.palette = palette;
    const v = deps.scriptedFrame(t, merged);
    // T00 promises zone is a plain mutable object at run time. It fills objective from at, so override after that.
    if (o.objective !== undefined) Object.assign(v.zone, { objective: o.objective });
    if (o.objectiveTarget !== undefined) Object.assign(v.zone, { objectiveTarget: o.objectiveTarget });
    view = v;
    ui.frame(v);
    return v;
  }

  function advance(ticks: number): number {
    clock += ticks / 120;
    return clock;
  }

  function state(name: StateName): void {
    const s: DevState = STATES[name];
    if (s.fatal) {
      ui.showFatal(s.fatal);
      return;
    }
    ui.showContextLost(s.contextLost === true);
    const start = s.start ?? s.at;
    const hold: DevFrameOptions = {};
    if (s.objective !== undefined) hold.objective = s.objective;
    if (s.objectiveTarget !== undefined) hold.objectiveTarget = s.objectiveTarget;

    // A DEMO frame, then the first frame out of it, which is where the run's km starts.
    frame(advance(SLOT_SAFE_TICKS), { ...hold, at: start, sim: { autopilot: true, mode: SimMode.DEMO, travel: start } });
    if (s.mode === SimMode.DEMO) {
      current = { ...hold, at: s.at, sim: { ...s.sim, mode: SimMode.DEMO } };
      frame(advance(SLOT_SAFE_TICKS), current);
      return;
    }
    // The launch, then the run so far in scoring PLAY, because run distance counts only while score does (DI-61). Then
    // the state's own mode, which for CRUISE, autopilot or SIGNAL_LOST holds that distance.
    frame(advance(SLOT_SAFE_TICKS), { ...hold, at: start, sim: { ...s.sim, mode: SimMode.PLAY, autopilot: false, travel: start } });
    frame(advance(SLOT_SAFE_TICKS), { ...hold, at: s.at, sim: { ...s.sim, mode: SimMode.PLAY, autopilot: false } });
    current = { ...hold, at: s.at, sim: { ...s.sim, mode: s.mode } };
    frame(advance(SLOT_SAFE_TICKS), current);
    // Past a banner that a jump in zone index set off, and past every throttle.
    frame(advance(BANNER_EXPIRED_TICKS), current);

    if (s.banner) {
      const grade: DevEvent = { kind: Ev.GRADE, x: 0, y: 6, value: 1200, chunk: s.at.chunk, index: 1 };
      frame(advance(SLOT_SAFE_TICKS), { ...current, events: [grade] });
      current = { ...current, at: { chunk: s.at.chunk + 1, local: 0 } };
      frame(advance(2), current);
      frame(advance(SLOT_SAFE_TICKS), current);
    }
    current = { ...current, sim: { ...current.sim } };
    delete current.sim?.mode;
  }

  function step(n = 1): void {
    for (let i = 0; i < n; i++) frame(advance(SLOT_SAFE_TICKS), current);
  }

  const dev: DevUi = {
    calls,
    frame,
    state,
    step,
    sample() {
      input.sample(out);
      return { ...out };
    },
    ui,
    input,
    get view() { return view; },
    stage,
    clock() { return clock; },
    allocProbe(n) {
      let total = 0;
      for (let i = 0; i < n; i++) {
        const a = [i, i + 1];
        allocSink = a;
        total += a[1]!;
      }
      return total + (allocSink === null ? 1 : 0);
    },
  };
  window.__ui = dev;

  const initial = q.get('state');
  if (initial !== null && initial in STATES) state(initial as StateName);

  if (q.get('live') === '1') {
    const loop = (): void => {
      requestAnimationFrame(loop);
      frame(advance(2), current);
    };
    requestAnimationFrame(loop);
  }
}
