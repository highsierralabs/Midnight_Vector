// The drum one-shots, pre-rendered once with OfflineAudioContext, each normalised to peak 1. Recipes per plan M4.
// Built as queued work (D-009): each sound's noise and impulse fills, then its wiring and startRendering, and when a
// render comes back, its normalising. The renders themselves run off the main thread. renderKit drains the queue at
// once for an offline scene; the live engine spreads it over frames. The same items run in the same order either way.
import { impulseJob, noiseJob, normaliseJob } from './impulse';
import { WIRE_MS, createQueue, drain, fill, once, type WorkQueue } from './work';

export interface Kit {
  kick: AudioBuffer; snare: AudioBuffer; hat: AudioBuffer; ohat: AudioBuffer; tom: AudioBuffer; crash: AudioBuffer; riser: AudioBuffer;
  /** One second of plain noise for graze, hit and signal-lost cues. Not normalised, and it needs no render. */
  noise: AudioBuffer;
}

export interface KitOptions {
  /** A scene's fault only: leaves the gate open, as the negative control for the snare's cliff. */
  gateOff?: boolean;
}

type Sound = 'kick' | 'snare' | 'tom' | 'hat' | 'ohat' | 'crash' | 'riser';

/** A noise buffer to fill: `seconds` long, channel ch seeded `seed + ch`. */
interface NoiseSpec { seconds: number; seed: number; channels: number }

interface Recipe {
  sound: Sound;
  channels: number;
  seconds: number;
  noise: readonly NoiseSpec[];
  /** Uses the gated impulse: its wiring fills `convs` with one convolver per impulse channel. */
  gated: boolean;
  wire(c: OfflineAudioContext, noise: readonly AudioBuffer[], convs: ConvolverNode[]): void;
}

function sourceOf(c: OfflineAudioContext, b: AudioBuffer): AudioBufferSourceNode {
  const s = c.createBufferSource();
  s.buffer = b;
  return s;
}

function channelsOf(b: AudioBuffer): Float32Array[] {
  const out: Float32Array[] = [];
  for (let ch = 0; ch < b.numberOfChannels; ch++) out.push(b.getChannelData(ch));
  return out;
}

function kickWire(c: OfflineAudioContext, noise: readonly AudioBuffer[]): void {
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(165, 0);
  o.frequency.exponentialRampToValueAtTime(50, 0.09);
  const g = c.createGain();
  g.gain.setValueAtTime(1, 0);
  g.gain.setValueAtTime(1, 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, 0.34);
  const shape = c.createWaveShaper();
  const curve = new Float32Array(1025);
  const norm = Math.tanh(2.2);
  for (let i = 0; i < 1025; i++) curve[i] = Math.tanh(2.2 * (i / 512 - 1)) / norm;
  shape.curve = curve;
  o.connect(g);
  g.connect(shape);
  shape.connect(c.destination);
  o.start(0);
  const click = sourceOf(c, noise[0]!);
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1500;
  const clickGain = c.createGain();
  clickGain.gain.value = 0.22;
  click.connect(hp);
  hp.connect(clickGain);
  clickGain.connect(c.destination);
  click.start(0);
}

/**
 * The gated path: dry, plus a convolution whose output is cut by a gate at a fixed time. That cut is the 80s sound.
 * The hit bus is mono, and a 2-channel impulse convolves a mono input into L and R, so the convolution is two mono
 * convolvers on the same bus, one per impulse channel, merged. Their buffers are set by later items (`convs`), each in
 * a slice of its own.
 */
function gatedWire(
  c: OfflineAudioContext, convs: ConvolverNode[], gateOpenS: number, gateShutS: number, wet: number, dry: number, gateOff: boolean,
  build: (hit: GainNode) => void,
): void {
  const hit = c.createGain();
  build(hit);
  const d = c.createGain();
  d.gain.value = dry;
  hit.connect(d);
  d.connect(c.destination);
  const merge = c.createChannelMerger(2);
  for (let ch = 0; ch < 2; ch++) {
    const conv = c.createConvolver();
    conv.normalize = false;
    hit.connect(conv);
    conv.connect(merge, 0, ch);
    convs.push(conv);
  }
  const gate = c.createGain();
  gate.gain.setValueAtTime(wet, 0);
  if (!gateOff) {
    gate.gain.setValueAtTime(wet, gateOpenS);
    gate.gain.linearRampToValueAtTime(0, gateShutS);
  }
  merge.connect(gate);
  gate.connect(c.destination);
}

function snareWire(c: OfflineAudioContext, noise: readonly AudioBuffer[], ir: ConvolverNode[], gateOff: boolean): void {
  gatedWire(c, ir, 0.2, 0.235, 1, 0.8, gateOff, (hit) => {
    const a = c.createOscillator();
    a.type = 'triangle';
    a.frequency.setValueAtTime(205, 0);
    a.frequency.exponentialRampToValueAtTime(170, 0.06);
    const ag = c.createGain();
    ag.gain.setValueAtTime(0.8, 0);
    ag.gain.exponentialRampToValueAtTime(0.001, 0.12);
    a.connect(ag);
    ag.connect(hit);
    a.start(0);
    const b = c.createOscillator();
    b.type = 'triangle';
    b.frequency.value = 340;
    const bg = c.createGain();
    bg.gain.setValueAtTime(0.35, 0);
    bg.gain.exponentialRampToValueAtTime(0.001, 0.08);
    b.connect(bg);
    bg.connect(hit);
    b.start(0);
    const n = sourceOf(c, noise[0]!);
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.9, 0);
    ng.gain.exponentialRampToValueAtTime(0.001, 0.16);
    n.connect(hp);
    hp.connect(ng);
    ng.connect(hit);
    n.start(0);
  });
}

function tomWire(c: OfflineAudioContext, noise: readonly AudioBuffer[], ir: ConvolverNode[], gateOff: boolean): void {
  gatedWire(c, ir, 0.24, 0.275, 0.8, 0.9, gateOff, (hit) => {
    const a = c.createOscillator();
    a.type = 'sine';
    a.frequency.setValueAtTime(130, 0);
    a.frequency.exponentialRampToValueAtTime(82, 0.22);
    const ag = c.createGain();
    ag.gain.setValueAtTime(1, 0);
    ag.gain.exponentialRampToValueAtTime(0.001, 0.34);
    a.connect(ag);
    ag.connect(hit);
    a.start(0);
    const n = sourceOf(c, noise[0]!);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1600;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.5, 0);
    ng.gain.exponentialRampToValueAtTime(0.001, 0.05);
    n.connect(lp);
    lp.connect(ng);
    ng.connect(hit);
    n.start(0);
  });
}

function hatWire(c: OfflineAudioContext, noise: readonly AudioBuffer[], seconds: number): void {
  const metal = c.createGain();
  metal.gain.value = 0.16;
  for (const f of [205.3, 304.4, 369.6, 522.7, 540, 800]) {
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.value = f * 1.7;
    o.connect(metal);
    o.start(0);
  }
  const n = sourceOf(c, noise[0]!);
  const ng = c.createGain();
  ng.gain.value = 0.5;
  n.connect(ng);
  n.start(0);
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 7500;
  const peakF = c.createBiquadFilter();
  peakF.type = 'peaking';
  peakF.frequency.value = 10500;
  peakF.gain.value = 6;
  metal.connect(hp);
  ng.connect(hp);
  hp.connect(peakF);
  const g = c.createGain();
  g.gain.setValueAtTime(1, 0);
  g.gain.exponentialRampToValueAtTime(0.001, seconds);
  peakF.connect(g);
  g.connect(c.destination);
}

function crashWire(c: OfflineAudioContext, noise: readonly AudioBuffer[]): void {
  const n = sourceOf(c, noise[0]!);
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 3800;
  const g = c.createGain();
  g.gain.setValueAtTime(1, 0);
  g.gain.exponentialRampToValueAtTime(0.001, 1.85);
  n.connect(hp);
  hp.connect(g);
  g.connect(c.destination);
  n.start(0);
}

function riserWire(c: OfflineAudioContext, noise: readonly AudioBuffer[]): void {
  const n = sourceOf(c, noise[0]!);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 3;
  lp.frequency.setValueAtTime(300, 0);
  lp.frequency.exponentialRampToValueAtTime(9000, 2.38);
  const g = c.createGain();
  g.gain.setValueAtTime(0.001, 0);
  g.gain.exponentialRampToValueAtTime(1, 2.36);
  g.gain.linearRampToValueAtTime(0, 2.4);
  n.connect(lp);
  lp.connect(g);
  g.connect(c.destination);
  n.start(0);
}

function recipes(gateOff: boolean): Recipe[] {
  return [
    { sound: 'kick', channels: 1, seconds: 0.36, noise: [{ seconds: 0.006, seed: 11, channels: 1 }], gated: false, wire: (c, n) => kickWire(c, n) },
    { sound: 'snare', channels: 2, seconds: 0.32, noise: [{ seconds: 0.2, seed: 23, channels: 1 }], gated: true, wire: (c, n, ir) => snareWire(c, n, ir, gateOff) },
    { sound: 'tom', channels: 2, seconds: 0.36, noise: [{ seconds: 0.05, seed: 29, channels: 1 }], gated: true, wire: (c, n, ir) => tomWire(c, n, ir, gateOff) },
    { sound: 'hat', channels: 1, seconds: 0.05, noise: [{ seconds: 0.05, seed: 31, channels: 1 }], gated: false, wire: (c, n) => hatWire(c, n, 0.05) },
    { sound: 'ohat', channels: 1, seconds: 0.3, noise: [{ seconds: 0.3, seed: 37, channels: 1 }], gated: false, wire: (c, n) => hatWire(c, n, 0.3) },
    { sound: 'crash', channels: 2, seconds: 1.9, noise: [{ seconds: 1.9, seed: 41, channels: 2 }], gated: false, wire: (c, n) => crashWire(c, n) },
    { sound: 'riser', channels: 2, seconds: 2.4, noise: [{ seconds: 2.4, seed: 43, channels: 2 }], gated: false, wire: (c, n) => riserWire(c, n) },
  ];
}

export interface KitBuild {
  /** Resolves once every render is back and its normalising is queued; rejects if a render fails. */
  readonly rendered: Promise<void>;
  /** Set by the queue's last item. */
  readonly kit: Kit | null;
}

/**
 * Appends the kit to `q`. The gated impulse is filled once and shared by the snare and the tom, whose recipes use the
 * same one (seeds 77 and 78 for its two channels, tau .42 s, 0.9 s). `onReady` runs from the last queued item, after
 * every buffer is normalised.
 */
export function queueKit(q: WorkQueue, sr: number, o: KitOptions = {}, onReady?: (kit: Kit) => void): KitBuild {
  const gateOff = o.gateOff ?? false;
  const out: Partial<Kit> = {};
  const list = recipes(gateOff);
  let pending = list.length;
  const settle = { resolve: (): void => undefined, reject: (e: unknown): void => { void e; } };
  const rendered = new Promise<void>((resolve, reject) => {
    settle.resolve = resolve;
    settle.reject = reject;
  });
  const build: { kit: Kit | null; rendered: Promise<void> } = { kit: null, rendered };

  // Every context and buffer is made by an item of its own, so queueing the kit costs nothing and each item stays
  // small. Wiring is expected at WIRE_MS, so it starts a slice, and each convolver's buffer gets a slice of its own: in
  // code the JIT has not compiled yet one wiring took up to 2.4 ms, and the snare's wiring with its stereo buffer set
  // up to 5.3 ms [O: D-009 item timing].
  // The gated impulse is one mono buffer per channel, for the two mono convolvers of gatedWire.
  const shared = { irL: null as AudioBuffer | null, irR: null as AudioBuffer | null, noise: null as AudioBuffer | null };
  once(q, () => {
    const n = Math.ceil(0.9 * sr);
    shared.irL = new AudioBuffer({ numberOfChannels: 1, length: n, sampleRate: sr });
    shared.irR = new AudioBuffer({ numberOfChannels: 1, length: n, sampleRate: sr });
  });
  fill(q, () => impulseJob(shared.irL!.getChannelData(0), sr, 0.42, 77, 0), 'impulse');
  fill(q, () => impulseJob(shared.irR!.getChannelData(0), sr, 0.42, 78, 0), 'impulse');

  for (const r of list) {
    const st = { c: null as OfflineAudioContext | null, noise: [] as AudioBuffer[], convs: [] as ConvolverNode[] };
    once(q, () => {
      const c = new OfflineAudioContext(r.channels, Math.ceil(r.seconds * sr), sr);
      st.c = c;
      for (const spec of r.noise) st.noise.push(c.createBuffer(spec.channels, Math.max(1, Math.ceil(spec.seconds * c.sampleRate)), c.sampleRate));
    });
    r.noise.forEach((spec, k) => {
      for (let ch = 0; ch < spec.channels; ch++) fill(q, () => noiseJob(st.noise[k]!.getChannelData(ch), spec.seed + ch), 'noise');
    });
    once(q, () => { r.wire(st.c!, st.noise, st.convs); }, false, WIRE_MS);
    if (r.gated) {
      once(q, () => { st.convs[0]!.buffer = shared.irL; }, true);
      once(q, () => { st.convs[1]!.buffer = shared.irR; }, true);
    }
    once(q, () => {
      const c = st.c!;
      c.startRendering().then((buf) => {
        fill(q, () => normaliseJob(channelsOf(buf)), 'normalise');
        once(q, () => { out[r.sound] = buf; });
        pending -= 1;
        if (pending === 0) {
          once(q, () => {
            const kit: Kit = {
              kick: out.kick!, snare: out.snare!, hat: out.hat!, ohat: out.ohat!, tom: out.tom!, crash: out.crash!,
              riser: out.riser!, noise: out.noise!,
            };
            build.kit = kit;
            if (onReady) onReady(kit);
          });
          settle.resolve();
        }
      }, (e: unknown) => { settle.reject(e); });
    });
  }

  once(q, () => { shared.noise = new AudioBuffer({ numberOfChannels: 1, length: sr, sampleRate: sr }); });
  fill(q, () => noiseJob(shared.noise!.getChannelData(0), 61), 'noise');
  once(q, () => { out.noise = shared.noise!; });
  return build;
}

/** 48 to 76 ms for the set on the prototype [O]. Runs at the context's own rate, so nothing resamples at playback. */
export async function renderKit(sr: number, o: KitOptions = {}): Promise<Kit> {
  const q = createQueue();
  const b = queueKit(q, sr, o);
  drain(q);
  await b.rendered;
  drain(q);
  return b.kit!;
}
