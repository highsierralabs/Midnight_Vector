// Every note: bass, pad, arp, lead, one-shots and SFX. Nodes allocate per note, bounded by the polyphony cap and
// never per frame. Each voice ends with stop, and its last source's onended disconnects its chain.
import type { Kit } from './kit';
import { Layer, type BarPattern } from './composer';
import type { AudioGraph } from './graph';
import { Drop, MAX_LIVE_SOURCES, MIX, admits } from './mix';
import type { VoiceSink } from './sequencer';
import type { SfxSink } from './sfx';
import { BAR_S, STEP_S, midiToHz } from './theory';

const PAD_ATTACK_S = 0.12;
const PAD_RELEASE_S = 0.7;
const PUMP_FLOOR = 0.55;
const PUMP_DOWN_S = 0.017;
const PUMP_UP_S = 0.32;
const FLOOR = 0.0001;

export interface Voices extends VoiceSink, SfxSink {
  setKit(kit: Kit): void;
  launch(t: number): void;
  /** The hit's own sound, with no duck. hit(t) is this plus the duck. */
  hitSound(t: number): void;
  /** Stops and disconnects every live voice now, and zeroes the count: onended does not fire while suspended. */
  stopAll(): void;
  readonly live: number;
  readonly peak: number;
  readonly created: number;
  readonly dropped: number;
}

interface Voice {
  alive: boolean;
  remaining: number;
  slot: number;
  readonly sources: AudioScheduledSourceNode[];
  readonly nodes: AudioNode[];
}

/**
 * The pump is in the chord's own envelope, so it is sample accurate and no long-lived param carries per-kick
 * automation. T0's kicks at steps 6 and 8 are closer than the recovery, so a recovery stops early at the next kick
 * at the value it had reached, and no ramp ever crosses another.
 */
function writePadEnvelope(g: AudioParam, t0: number, durS: number, kickMask: number, floor: number): void {
  const end = t0 + durS;
  const elapsed = BAR_S - durS;   // how far into the bar a recovered chord starts
  const attack = PAD_ATTACK_S < durS * 0.5 ? PAD_ATTACK_S : durS * 0.5;
  const kickAtStart = elapsed <= 1e-6 && (kickMask & 1) !== 0;
  g.setValueAtTime(0, t0);
  let cur = kickAtStart ? floor : 1;
  g.linearRampToValueAtTime(cur, t0 + attack);
  let at = t0 + attack;
  let nextKick = nextKickAfter(kickMask, elapsed, t0, at);
  if (kickAtStart) {
    // The chord opens on a kick: it is already at the floor when the attack ends, and back at 1 by 320 ms.
    const full = t0 + PUMP_UP_S;
    const stop = Math.min(full, nextKick, end);
    cur = floor + ((1 - floor) * (stop - at)) / (full - at);
    g.linearRampToValueAtTime(cur, stop);
    at = stop;
  }
  while (nextKick < end) {
    const k = nextKick;
    const after = nextKickAfter(kickMask, elapsed, t0, k + 1e-6);
    g.setValueAtTime(cur, k);
    const down = Math.min(k + PUMP_DOWN_S, end);
    g.linearRampToValueAtTime(floor, down);
    const full = k + PUMP_UP_S;
    const stop = Math.min(full, after, end);
    cur = stop > down ? floor + ((1 - floor) * (stop - down)) / (full - down) : floor;
    g.linearRampToValueAtTime(cur, stop);
    at = stop;
    nextKick = after;
  }
  g.setValueAtTime(cur, end > at ? end : at);
  g.linearRampToValueAtTime(0, end + PAD_RELEASE_S);
}

/** The first kick at or after time `from`, Infinity if the bar has no more. */
function nextKickAfter(kickMask: number, elapsed: number, t0: number, from: number): number {
  for (let i = 0; i < 16; i++) {
    if ((kickMask & (1 << i)) === 0) continue;
    const k = t0 + i * STEP_S - elapsed;
    if (k >= from) return k;
  }
  return Infinity;
}

/**
 * cap: the live-source cap. pumpFloor: the pad's gain at the bottom of a pump, for offline.ts's shallow-pump fault,
 * A13's negative control. The engine passes neither.
 */
export function createVoices(g: AudioGraph, o: { cap?: number; pumpFloor?: number } = {}): Voices {
  const c = g.ctx;
  const cap = o.cap ?? MAX_LIVE_SOURCES;
  const pumpFloor = o.pumpFloor ?? PUMP_FLOOR;
  const list: Voice[] = [];
  const st = { live: 0, peak: 0, created: 0, dropped: 0, kit: null as Kit | null };

  function open(): Voice {
    const v: Voice = { alive: true, remaining: 0, slot: list.length, sources: [], nodes: [] };
    list.push(v);
    return v;
  }

  function finish(v: Voice): void {
    v.alive = false;
    const last = list.pop()!;
    if (last !== v) {
      list[v.slot] = last;
      last.slot = v.slot;
    }
    disconnect(v);
  }

  function disconnect(v: Voice): void {
    for (const s of v.sources) s.disconnect();
    for (const n of v.nodes) n.disconnect();
  }

  function ended(v: Voice): void {
    if (!v.alive) return;   // a late onended from a voice stopAll already cleared must not decrement
    st.live -= 1;
    v.remaining -= 1;
    if (v.remaining === 0) finish(v);
  }

  function play(v: Voice, s: AudioScheduledSourceNode, t: number, stop: number): void {
    v.sources.push(s);
    v.remaining += 1;
    st.live += 1;
    st.created += 1;
    if (st.live > st.peak) st.peak = st.live;
    s.onended = () => ended(v);
    s.start(t);
    if (stop > 0) s.stop(stop);
  }

  function gain(v: Voice, value: number, dest: AudioNode): GainNode {
    const n = c.createGain();
    n.gain.value = value;
    n.connect(dest);
    v.nodes.push(n);
    return n;
  }

  function filter(v: Voice, type: BiquadFilterType, q: number, dest: AudioNode): BiquadFilterNode {
    const n = c.createBiquadFilter();
    n.type = type;
    n.Q.value = q;
    n.connect(dest);
    v.nodes.push(n);
    return n;
  }

  function osc(type: OscillatorType, hz: number, cents: number): OscillatorNode {
    const n = c.createOscillator();
    n.type = type;
    n.frequency.value = hz;
    if (cents !== 0) n.detune.value = cents;
    return n;
  }

  function panned(v: Voice, pan: number): AudioNode {
    const p = c.createStereoPanner();
    p.pan.value = pan;
    p.connect(g.sfx);
    v.nodes.push(p);
    return p;
  }

  /** Never before the context's own clock, so an automation time cannot fall in the past. */
  function clampT(t: number): number {
    const now = c.currentTime;
    return t > now ? t : now;
  }

  function bufferOf(kit: Kit, layer: number): AudioBuffer {
    switch (layer) {
      case Layer.KICK: return kit.kick;
      case Layer.SNARE: return kit.snare;
      case Layer.HAT: return kit.hat;
      case Layer.OHAT: return kit.ohat;
      case Layer.TOM: return kit.tom;
      case Layer.CRASH: return kit.crash;
      default: return kit.riser;
    }
  }

  function levelOf(layer: number): number {
    switch (layer) {
      case Layer.KICK: return MIX.kick;
      case Layer.SNARE: return MIX.snare;
      case Layer.HAT: return MIX.hat;
      case Layer.OHAT: return MIX.ohat;
      case Layer.TOM: return MIX.tom;
      case Layer.CRASH: return MIX.crash;
      default: return MIX.riser;
    }
  }

  function noiseBurst(v: Voice, t: number, dur: number, dest: AudioNode): void {
    const kit = st.kit;
    if (!kit) return;
    const s = c.createBufferSource();
    s.buffer = kit.noise;
    s.connect(dest);
    play(v, s, t, t + dur);
  }

  const voices: Voices = {
    get live() { return st.live; },
    get peak() { return st.peak; },
    get created() { return st.created; },
    get dropped() { return st.dropped; },

    setKit(kit: Kit): void {
      st.kit = kit;
    },

    stopAll(): void {
      for (const v of list) {
        v.alive = false;
        for (const s of v.sources) {
          try { s.stop(); } catch { /* an already stopped source can only be left alone */ }
        }
        disconnect(v);
      }
      list.length = 0;
      st.live = 0;
    },

    oneShot(layer: number, t: number, vel: number, rate: number): void {
      const kit = st.kit;
      if (!kit) return;
      const hat = layer === Layer.HAT || layer === Layer.OHAT;
      if (hat && !admits(Drop.HAT, st.live, cap)) {
        st.dropped += 1;
        return;
      }
      const v = open();
      const s = c.createBufferSource();
      s.buffer = bufferOf(kit, layer);
      if (rate !== 1) s.playbackRate.value = rate;
      s.connect(gain(v, vel * levelOf(layer), g.drums));
      play(v, s, clampT(t), 0);
    },

    bass(t: number, midi: number, lenS: number, vel: number): void {
      const t0 = clampT(t);
      const f = midiToHz(midi);
      const v = open();
      const pk = vel * MIX.bass;
      const a = gain(v, 0, g.bass);
      a.gain.setValueAtTime(0, t0);
      a.gain.linearRampToValueAtTime(pk, t0 + 0.004);
      a.gain.linearRampToValueAtTime(pk * 0.85, t0 + lenS * 0.7);
      a.gain.linearRampToValueAtTime(0, t0 + lenS);
      const lp = filter(v, 'lowpass', 5, a);
      lp.frequency.setValueAtTime(1200, t0);
      lp.frequency.exponentialRampToValueAtTime(320, t0 + (lenS < 0.14 ? lenS : 0.14));
      const saws = gain(v, 0.55, lp);
      const stop = t0 + lenS + 0.01;
      const o1 = osc('sawtooth', f, -6);
      const o2 = osc('sawtooth', f, 6);
      o1.connect(saws);
      o2.connect(saws);
      play(v, o1, t0, stop);
      play(v, o2, t0, stop);
      const sub = osc('sine', f, 0);
      sub.connect(gain(v, 0.6, a));
      play(v, sub, t0, stop);
    },

    padChord(t: number, p: Readonly<BarPattern>, durS: number): void {
      if (durS <= 0) return;
      const t0 = clampT(t);
      const dur = durS - (t0 - t);
      if (dur <= 0) return;
      const v = open();
      const eL = gain(v, 0, g.padL);
      const eR = gain(v, 0, g.padR);
      writePadEnvelope(eL.gain, t0, dur, p.kickMask, pumpFloor);
      writePadEnvelope(eR.gain, t0, dur, p.kickMask, pumpFloor);
      const lpL = filter(v, 'lowpass', 0.8, eL);
      const lpR = filter(v, 'lowpass', 0.8, eR);
      const f0 = 900 + 1400 * Math.sin((Math.PI * (((p.bar % 16) + 16) % 16)) / 16);
      for (const lp of [lpL, lpR]) {
        lp.frequency.setValueAtTime(f0, t0);
        lp.frequency.linearRampToValueAtTime(f0 * 1.25, t0 + dur * 0.5);
        lp.frequency.linearRampToValueAtTime(f0, t0 + dur);
      }
      const stop = t0 + dur + PAD_RELEASE_S + 0.02;
      for (let i = 0; i < p.count; i++) {
        if (p.layer[i] !== Layer.PAD) continue;
        const f = midiToHz(p.midi[i]!);
        const level = p.vel[i]! * MIX.pad;
        const inL = gain(v, level, lpL);
        const inR = gain(v, level, lpR);
        const quietL = gain(v, level * 0.7, lpL);
        const quietR = gain(v, level * 0.7, lpR);
        const a = osc('sawtooth', f, -11);
        const b = osc('sawtooth', f, 11);
        const d = osc('sawtooth', f, -4);
        const e = osc('sawtooth', f, 4);
        a.connect(inL);
        b.connect(inR);
        d.connect(quietR);
        e.connect(quietL);
        play(v, a, t0, stop);
        play(v, b, t0, stop);
        play(v, d, t0, stop);
        play(v, e, t0, stop);
      }
    },

    arp(t: number, midi: number, lenS: number, vel: number): void {
      if (!admits(Drop.ARP, st.live, cap)) {
        st.dropped += 1;
        return;
      }
      const t0 = clampT(t);
      const f = midiToHz(midi);
      const v = open();
      const pk = vel * MIX.arp;
      const a = gain(v, 0, g.arp);
      a.gain.setValueAtTime(0, t0);
      a.gain.linearRampToValueAtTime(pk, t0 + 0.003);
      a.gain.exponentialRampToValueAtTime(pk * 0.05, t0 + lenS);
      a.gain.linearRampToValueAtTime(0, t0 + lenS + 0.005);
      const lp = filter(v, 'lowpass', 4, a);
      lp.frequency.setValueAtTime(Math.min(8000, f * 6), t0);
      lp.frequency.exponentialRampToValueAtTime(Math.max(500, f * 1.2), t0 + lenS);
      const mix = gain(v, 0.6, lp);
      const stop = t0 + lenS + 0.02;
      const o1 = osc('sawtooth', f, 0);
      const o2 = osc('square', f, 7);
      o1.connect(mix);
      o2.connect(mix);
      play(v, o1, t0, stop);
      play(v, o2, t0, stop);
    },

    lead(t: number, midi: number, lenS: number, vel: number): void {
      const t0 = clampT(t);
      const f = midiToHz(midi);
      const v = open();
      const pk = vel * MIX.lead;
      const end = t0 + lenS;
      const a = gain(v, 0, g.lead);
      a.gain.setValueAtTime(0, t0);
      a.gain.linearRampToValueAtTime(pk, t0 + 0.012);
      a.gain.setValueAtTime(pk, end);
      a.gain.linearRampToValueAtTime(0, end + 0.03);
      const lp = filter(v, 'lowpass', 1.5, a);
      lp.frequency.setValueAtTime(f * 2.5, t0);
      lp.frequency.linearRampToValueAtTime(f * 5, t0 + 0.08);
      lp.frequency.linearRampToValueAtTime(f * 3.5, t0 + 0.4);
      const stop = end + 0.05;
      const o1 = osc('sawtooth', f, -5);
      const o2 = osc('sawtooth', f, 5);
      o1.connect(lp);
      o2.connect(lp);
      const vib = osc('sine', 5.3, 0);
      const depth = c.createGain();
      v.nodes.push(depth);
      depth.connect(o1.detune);
      depth.connect(o2.detune);
      depth.gain.setValueAtTime(0, t0);
      depth.gain.setValueAtTime(0, t0 + 0.25);
      depth.gain.linearRampToValueAtTime(9, t0 + 0.6);
      vib.connect(depth);
      play(v, o1, t0, stop);
      play(v, o2, t0, stop);
      play(v, vib, t0, stop);
    },

    blip(t: number, midi: number, vel: number, pan: number): void {
      if (!admits(Drop.BLIP, st.live, cap)) {
        st.dropped += 1;
        return;
      }
      const t0 = clampT(t);
      const f = midiToHz(midi);
      const v = open();
      const pk = vel * MIX.blip;
      const a = gain(v, 0, panned(v, pan));
      a.gain.setValueAtTime(0, t0);
      a.gain.linearRampToValueAtTime(pk, t0 + 0.002);
      a.gain.exponentialRampToValueAtTime(pk * 0.02, t0 + 0.14);
      a.gain.linearRampToValueAtTime(0, t0 + 0.15);
      const lp = filter(v, 'lowpass', 0.7, a);
      lp.frequency.value = 4500;
      const o1 = osc('square', f, 0);
      const o2 = osc('sine', f * 2, 0);
      o1.connect(lp);
      o2.connect(lp);
      play(v, o1, t0, t0 + 0.16);
      play(v, o2, t0, t0 + 0.16);
    },

    stab(t: number, m0: number, m1: number, m2: number, m3: number, vel: number): void {
      // Four saws a gate. At the cap a stab goes with the blips, first: 40 gates in one frame reached 212 live
      // sources against 96 before it had a drop class [O: A20 cap stress, V1 verifier].
      if (!admits(Drop.STAB, st.live, cap)) {
        st.dropped += 1;
        return;
      }
      const t0 = clampT(t);
      const v = open();
      const pk = vel * MIX.stab;
      const a = gain(v, 0, g.sfx);
      a.gain.setValueAtTime(0, t0);
      a.gain.linearRampToValueAtTime(pk, t0 + 0.003);
      a.gain.exponentialRampToValueAtTime(pk * 0.05, t0 + 0.27);
      a.gain.linearRampToValueAtTime(0, t0 + 0.28);
      const lp = filter(v, 'lowpass', 0.9, a);
      lp.frequency.value = 3000;
      const stop = t0 + 0.29;
      for (const m of [m0, m1, m2, m3]) {
        const s = osc('sawtooth', midiToHz(m), 0);
        s.connect(lp);
        play(v, s, t0, stop);
      }
    },

    miss(t: number, midi: number, vel: number): void {
      const t0 = clampT(t);
      const f = midiToHz(midi);
      const v = open();
      const pk = vel * MIX.miss;
      const a = gain(v, 0, g.sfx);
      a.gain.setValueAtTime(0, t0);
      a.gain.linearRampToValueAtTime(pk, t0 + 0.003);
      a.gain.exponentialRampToValueAtTime(pk * 0.05, t0 + 0.17);
      a.gain.linearRampToValueAtTime(0, t0 + 0.18);
      const s = osc('square', f, 0);
      s.frequency.setValueAtTime(f, t0);
      s.frequency.exponentialRampToValueAtTime(midiToHz(midi - 5), t0 + 0.18);
      s.connect(a);
      play(v, s, t0, t0 + 0.19);
    },

    graze(t: number, vel: number, pan: number): void {
      const t0 = clampT(t);
      const v = open();
      const pk = vel * MIX.graze;
      const a = gain(v, 0, panned(v, pan));
      a.gain.setValueAtTime(0, t0);
      a.gain.linearRampToValueAtTime(pk, t0 + 0.004);
      a.gain.exponentialRampToValueAtTime(pk * 0.03, t0 + 0.11);
      a.gain.linearRampToValueAtTime(0, t0 + 0.12);
      const hp = filter(v, 'highpass', 1, a);
      hp.frequency.setValueAtTime(2000, t0);
      hp.frequency.exponentialRampToValueAtTime(9000, t0 + 0.12);
      noiseBurst(v, t0, 0.13, hp);
    },

    hitSound(t: number): void {
      const kit = st.kit;
      if (!kit) return;
      const t0 = clampT(t);
      const v = open();
      const s = c.createBufferSource();
      s.buffer = kit.tom;
      s.playbackRate.value = 0.5;
      s.connect(gain(v, MIX.hit, g.sfx));
      play(v, s, t0, 0);
      const a = gain(v, 0, g.sfx);
      a.gain.setValueAtTime(0, t0);
      a.gain.linearRampToValueAtTime(MIX.hitNoise, t0 + 0.003);
      a.gain.exponentialRampToValueAtTime(FLOOR, t0 + 0.25);
      const lp = filter(v, 'lowpass', 0.7, a);
      lp.frequency.value = 2500;
      noiseBurst(v, t0, 0.26, lp);
    },

    hit(t: number): void {
      voices.hitSound(t);
      g.hitDuck(clampT(t));
    },

    lost(t: number): void {
      const t0 = clampT(t);
      const v = open();
      const a = gain(v, 0, g.sfx);
      a.gain.setValueAtTime(0, t0);
      a.gain.linearRampToValueAtTime(MIX.lost, t0 + 0.01);
      a.gain.setValueAtTime(MIX.lost, t0 + 0.9);
      a.gain.linearRampToValueAtTime(0, t0 + 1.2);
      const s = osc('sawtooth', 880, 0);
      s.frequency.setValueAtTime(880, t0);
      s.frequency.exponentialRampToValueAtTime(55, t0 + 1.2);
      s.connect(a);
      play(v, s, t0, t0 + 1.21);
      const na = gain(v, 0, g.sfx);
      na.gain.setValueAtTime(0, t0);
      na.gain.linearRampToValueAtTime(MIX.lostNoise, t0 + 0.01);
      na.gain.exponentialRampToValueAtTime(FLOOR, t0 + 0.9);
      noiseBurst(v, t0, 0.95, na);
    },

    launch(t: number): void {
      const t0 = clampT(t);
      const v = open();
      const a = gain(v, 0, g.sfx);
      a.gain.setValueAtTime(0, t0);
      a.gain.linearRampToValueAtTime(MIX.launch, t0 + 0.02);
      a.gain.setValueAtTime(MIX.launch, t0 + 0.42);
      a.gain.linearRampToValueAtTime(0, t0 + 0.5);
      const s = osc('sawtooth', 110, 0);
      s.frequency.setValueAtTime(110, t0);
      s.frequency.exponentialRampToValueAtTime(880, t0 + 0.5);
      s.connect(a);
      play(v, s, t0, t0 + 0.51);
    },
  };
  return voices;
}
