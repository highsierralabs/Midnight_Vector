// The bus graph of plan M4, for any BaseAudioContext, plus duck and mode automation. Automation on these long-lived
// params uses only cancelScheduledValues(t) and setTargetAtTime, which start from the current value by definition,
// so nothing reads .value and a re-hit in mid-duck cannot jump.
// The graph is built as queued work (D-009): first every node the AudioGraph names, with the master and SFX path wired,
// so a cue can sound at once; then the music chain, the effects and their impulse and noise fills. buildGraph drains
// the queue at once, for an OfflineAudioContext; the live engine spreads it over frames.
import { impulseJob, noiseJob } from './impulse';
import {
  HIT_ATTACK_TAU_S, HIT_FILTER, HIT_FILTER_RELEASE_TAU_S, HIT_GAIN, HIT_GAIN_RELEASE_TAU_S, HIT_S, MIX, MODE_FILTER, MODE_GAIN,
  MODE_TAU_S, RESUME_RAMP_S, VOLUME_TAU_S, WIND_TAU_S,
} from './mix';
import { WIRE_MS, createQueue, drain, fill, once, type WorkQueue } from './work';

export interface AudioGraph {
  readonly ctx: BaseAudioContext;
  // Inputs
  readonly drums: GainNode;
  readonly bass: GainNode;
  readonly padL: GainNode;
  readonly padR: GainNode;
  readonly arp: GainNode;
  readonly lead: GainNode;
  readonly sfx: GainNode;
  // Stages reachable from a scene's faults and from a live tap
  readonly master: GainNode;
  /** The music bus after its volume, one of the master's two inputs with sfx. The dev page taps both. */
  readonly musicVol: GainNode;
  readonly reverbReturn: GainNode;
  readonly softClip: WaveShaperNode;
  /** The last stage, and the node a live tap reads. */
  readonly safetyClip: WaveShaperNode;
  /** A linear gain per bus, for a volume. */
  setVolume(music: number, sfx: number, t: number): void;
  /** Sets both at once, with no ramp, before anything sounds. */
  initVolume(music: number, sfx: number): void;
  setMode(mode: number, t: number): void;
  hitDuck(t: number): void;
  /** target in [0, 1], the boost fraction. */
  setWind(target: number, t: number): void;
  /** Master from 0 to 1 over 300 ms: the guard against an audible burst on resume. */
  rampIn(t: number): void;
}

/** 4097 points over u in [-2, 2]: y = u up to .7, above that .7 + .28 * tanh((|u| - .7) / .28). Bounded near .98. */
export function softClipCurve(): Float32Array<ArrayBuffer> {
  const n = 4097;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = ((i / (n - 1)) * 2 - 1) * 2;
    const a = Math.abs(u);
    const y = a <= 0.7 ? a : 0.7 + 0.28 * Math.tanh((a - 0.7) / 0.28);
    curve[i] = u < 0 ? -y : y;
  }
  return curve;
}

/**
 * Identity up to .97, then a tight knee that tops out at .982. The soft clip's 2x oversampling rings when it is driven
 * hard, up to 1.15 at +12 dB [O: A9c], so its own curve does not bound the output. This stage does, with no
 * oversampling of its own, and at normal levels it never does anything because they stay under .97.
 */
export function safetyClipCurve(): Float32Array<ArrayBuffer> {
  const n = 4097;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= 0.97 ? a : 0.97 + 0.012 * Math.tanh((a - 0.97) / 0.012);
    curve[i] = x < 0 ? -y : y;
  }
  return curve;
}

/**
 * Where each reverb channel's impulse is cut, so no single convolver buffer set holds a frame (D-009). Binary
 * fractions of a second, so each segment's delay is a whole number of samples at 44.1 and 48 kHz and exact.
 */
export const REVERB_CUTS_S: readonly number[] = [0.75, 1.5];

function gainOf(ctx: BaseAudioContext, value = 1): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

/** For an OfflineAudioContext: the whole graph, now. */
export function buildGraph(ctx: BaseAudioContext): AudioGraph {
  const q = createQueue();
  const graph = queueGraph(ctx, q);
  drain(q);
  return graph;
}

/**
 * Creates every node the returned AudioGraph names and wires the master and SFX path now, so a cue played through
 * `sfx` sounds at once. Everything else, the music chain, chorus, delay, reverb and wind with their fills, is
 * appended to `q` in that order. Until it has run the music buses lead nowhere, and the reverb and wind are silent.
 * `curves` lets the live engine compute the two clip curves in an earlier slice; by default they are computed here.
 */
export function queueGraph(
  ctx: BaseAudioContext, q: WorkQueue,
  curves: { soft: Float32Array<ArrayBuffer>; safety: Float32Array<ArrayBuffer> } = { soft: softClipCurve(), safety: safetyClipCurve() },
): AudioGraph {
  const sr = ctx.sampleRate;

  // Master: gain .5 then the soft clip, so nothing past here can exceed about .98.
  const master = gainOf(ctx);
  const pre = gainOf(ctx, MIX.masterPre);
  const softClip = ctx.createWaveShaper();
  softClip.curve = curves.soft;
  softClip.oversample = '2x';
  const safetyClip = ctx.createWaveShaper();
  safetyClip.curve = curves.safety;
  master.connect(pre);
  pre.connect(softClip);
  softClip.connect(safetyClip);
  safetyClip.connect(ctx.destination);

  // SFX bypass the duck.
  const sfxVol = gainOf(ctx, MIX.defaultSfx);
  sfxVol.connect(master);

  // The rest of what the AudioGraph names or its methods move, unwired for now.
  const music = gainOf(ctx);
  const duckFilter = ctx.createBiquadFilter();
  duckFilter.type = 'lowpass';
  duckFilter.frequency.value = MODE_FILTER[0]!;
  duckFilter.Q.value = 0.707;
  const duckGain = gainOf(ctx, MODE_GAIN[0]!);
  const musicVol = gainOf(ctx, MIX.musicTrim * MIX.defaultMusic);
  const drums = gainOf(ctx);
  const bass = gainOf(ctx);
  const padL = gainOf(ctx);
  const padR = gainOf(ctx);
  const arp = gainOf(ctx);
  const lead = gainOf(ctx);
  const reverbReturn = gainOf(ctx, MIX.reverbReturn);
  const windGain = gainOf(ctx, 0);

  // Each wiring item below is expected at WIRE_MS, so it starts a slice: in code the JIT has not compiled yet, one took
  // up to 2.4 ms [O: D-009 item timing]. Music chain. The compressor sits before the duck, or it would give the duck back.
  once(q, () => {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = MIX.compThreshold;
    comp.knee.value = MIX.compKnee;
    comp.ratio.value = MIX.compRatio;
    comp.attack.value = MIX.compAttack;
    comp.release.value = MIX.compRelease;
    const musicHp = ctx.createBiquadFilter();
    musicHp.type = 'highpass';
    musicHp.frequency.value = MIX.musicHighpass;
    musicHp.Q.value = 0.707;
    music.connect(comp);
    comp.connect(musicHp);
    musicHp.connect(duckFilter);
    duckFilter.connect(duckGain);
    duckGain.connect(musicVol);
    musicVol.connect(master);
    drums.connect(music);
    bass.connect(music);
    arp.connect(music);
    lead.connect(music);
  }, false, WIRE_MS);

  // Pad: L and R, then the chorus, one shared LFO in anti-phase.
  const padOut = gainOf(ctx);
  once(q, () => {
    const padMerge = ctx.createChannelMerger(2);
    padL.connect(padMerge, 0, 0);
    padR.connect(padMerge, 0, 1);
    const padSplit = ctx.createChannelSplitter(2);
    padMerge.connect(padSplit);
    const chorusL = ctx.createDelay(0.05);
    const chorusR = ctx.createDelay(0.05);
    chorusL.delayTime.value = MIX.chorusA;
    chorusR.delayTime.value = MIX.chorusB;
    padSplit.connect(chorusL, 0);
    padSplit.connect(chorusR, 1);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = MIX.chorusHz;
    const lfoA = gainOf(ctx, MIX.chorusDepth);
    const lfoB = gainOf(ctx, -MIX.chorusDepth);
    lfo.connect(lfoA);
    lfo.connect(lfoB);
    lfoA.connect(chorusL.delayTime);
    lfoB.connect(chorusR.delayTime);
    lfo.start(0);
    const chorusMerge = ctx.createChannelMerger(2);
    chorusL.connect(chorusMerge, 0, 0);
    chorusR.connect(chorusMerge, 0, 1);
    const wet = gainOf(ctx, MIX.chorusWet);
    const dry = gainOf(ctx, MIX.chorusDry);
    chorusMerge.connect(wet);
    padMerge.connect(dry);
    const padHp = ctx.createBiquadFilter();
    padHp.type = 'highpass';
    padHp.frequency.value = MIX.padHighpass;
    wet.connect(padHp);
    dry.connect(padHp);
    padHp.connect(padOut);
    padOut.connect(music);
  }, false, WIRE_MS);

  // Reverb: highpass, then a unit-energy stereo impulse, as mono convolvers: L from the input's L and R from its R,
  // which is what one convolver with a 2-channel impulse does, with a stereo input L from L and R from R, and with a
  // mono one both from it. reverbIn is held at two channels, so a mono input up-mixes to both and the split gives that
  // same result [O: D-009, max difference 0 on noise, against 3.18 with the channels swapped]. Each channel's impulse
  // is also cut at REVERB_CUTS_S, each later segment on its own convolver behind a delay of exactly its start, which is
  // the same convolution by linearity [O: D-009, a cut at 1 s read a max difference of 2.4e-7 at a peak of 2.8, and a
  // delay one sample long .27]. Setting the whole 2.2 s stereo impulse on one convolver held the main thread for 4.6
  // to 6.1 ms in one call, and one 2.2 s channel 3.7 to 4.8 ms, over DI-79's 4 ms slice [O: D-009 item timing].
  const reverbIn = ctx.createBiquadFilter();
  const cuts = [0, ...REVERB_CUTS_S.map((c) => Math.round(c * sr))];   // segment starts, in samples
  const segs = cuts.length;
  const convs: ConvolverNode[] = [];   // channel-major: L segments, then R segments
  for (let i = 0; i < 2 * segs; i++) convs.push(ctx.createConvolver());
  const irData: Float32Array<ArrayBuffer>[] = [];   // the full impulse per channel, cut into the segments once filled
  const bufs = { wind: null as AudioBuffer | null };
  once(q, () => {
    reverbIn.type = 'highpass';
    reverbIn.frequency.value = MIX.reverbHighpass;
    reverbIn.channelCount = 2;
    reverbIn.channelCountMode = 'explicit';
    const split = ctx.createChannelSplitter(2);
    const merge = ctx.createChannelMerger(2);
    reverbIn.connect(split);
    for (let ch = 0; ch < 2; ch++) {
      for (let k = 0; k < segs; k++) {
        const conv = convs[ch * segs + k]!;
        conv.normalize = false;
        split.connect(conv, ch);
        if (k === 0) {
          conv.connect(merge, 0, ch);
        } else {
          const late = ctx.createDelay(cuts[k]! / sr + 0.5);
          late.delayTime.value = cuts[k]! / sr;
          conv.connect(late);
          late.connect(merge, 0, ch);
        }
      }
    }
    merge.connect(reverbReturn);
    reverbReturn.connect(music);
  }, false, WIRE_MS);

  // Delay: lowpass, L, R, feedback into the lowpass. A dotted eighth, ping-pong. Then the sends into both.
  once(q, () => {
    const delayIn = gainOf(ctx);
    const delayLp = ctx.createBiquadFilter();
    delayLp.type = 'lowpass';
    delayLp.frequency.value = MIX.delayLowpass;
    const delayL = ctx.createDelay(1);
    const delayR = ctx.createDelay(1);
    delayL.delayTime.value = MIX.delayS;
    delayR.delayTime.value = MIX.delayS;
    const feedback = gainOf(ctx, MIX.delayFeedback);
    delayIn.connect(delayLp);
    delayLp.connect(delayL);
    delayL.connect(delayR);
    delayR.connect(feedback);
    feedback.connect(delayLp);
    const delayMerge = ctx.createChannelMerger(2);
    delayL.connect(delayMerge, 0, 0);
    delayR.connect(delayMerge, 0, 1);
    const delayOut = gainOf(ctx, MIX.delayToMusic);
    const delayRev = gainOf(ctx, MIX.delayToReverb);
    delayMerge.connect(delayOut);
    delayMerge.connect(delayRev);
    delayOut.connect(music);
    delayRev.connect(reverbIn);

    const padSend = gainOf(ctx, MIX.padToReverb);
    padOut.connect(padSend);
    padSend.connect(reverbIn);
    const arpSend = gainOf(ctx, MIX.arpToDelay);
    arp.connect(arpSend);
    arpSend.connect(delayIn);
    const leadDelay = gainOf(ctx, MIX.leadToDelay);
    lead.connect(leadDelay);
    leadDelay.connect(delayIn);
    const leadRev = gainOf(ctx, MIX.leadToReverb);
    lead.connect(leadRev);
    leadRev.connect(reverbIn);
  }, false, WIRE_MS);
  once(q, () => {
    const n = Math.ceil(MIX.reverbS * sr);
    irData.push(new Float32Array(n), new Float32Array(n));
  });
  fill(q, () => impulseJob(irData[0]!, sr, MIX.reverbTau, MIX.reverbSeed, MIX.reverbDarken), 'impulse');
  fill(q, () => impulseJob(irData[1]!, sr, MIX.reverbTau, MIX.reverbSeed + 1, MIX.reverbDarken), 'impulse');
  // Each set is one native call that prepares a convolution, the largest single pieces of the build: a slice each.
  for (let i = 0; i < 2 * segs; i++) {
    once(q, () => {
      const data = irData[Math.floor(i / segs)]!;
      const k = i % segs;
      const part = data.subarray(cuts[k]!, k + 1 < segs ? cuts[k + 1]! : data.length);
      const b = ctx.createBuffer(1, part.length, sr);
      b.copyToChannel(part, 0);
      convs[i]!.buffer = b;
      // The convolvers hold their own copies now. The full impulses would otherwise live as long as the graph,
      // because its methods share this scope with the closures that filled them.
      if (i === 2 * segs - 1) irData.length = 0;
    }, true);
  }

  // Wind: looped noise, gain 0 until a boost.
  once(q, () => { bufs.wind = ctx.createBuffer(1, 2 * sr, sr); });
  fill(q, () => noiseJob(bufs.wind!.getChannelData(0), 53), 'noise');
  once(q, () => {
    const wind = ctx.createBufferSource();
    wind.buffer = bufs.wind;
    wind.loop = true;
    const windBp = ctx.createBiquadFilter();
    windBp.type = 'bandpass';
    windBp.frequency.value = 1200;
    windBp.Q.value = 0.6;
    wind.connect(windBp);
    windBp.connect(windGain);
    windGain.connect(sfxVol);
    wind.start(0);
  }, false, WIRE_MS);

  const state = { baseFilter: MODE_FILTER[0]!, baseGain: MODE_GAIN[0]!, duckUntil: -Infinity };

  function duckTo(t: number, end: number): void {
    const G = duckGain.gain;
    const F = duckFilter.frequency;
    G.cancelScheduledValues(t);
    F.cancelScheduledValues(t);
    G.setTargetAtTime(state.baseGain * HIT_GAIN, t, HIT_ATTACK_TAU_S);
    F.setTargetAtTime(HIT_FILTER, t, HIT_ATTACK_TAU_S);
    G.setTargetAtTime(state.baseGain, end, HIT_GAIN_RELEASE_TAU_S);
    F.setTargetAtTime(state.baseFilter, end, HIT_FILTER_RELEASE_TAU_S);
    state.duckUntil = end;
  }

  return {
    ctx, drums, bass, padL, padR, arp, lead, sfx: sfxVol, master, musicVol, reverbReturn, softClip, safetyClip,

    setVolume(musicLevel: number, sfxLevel: number, t: number): void {
      musicVol.gain.setTargetAtTime(MIX.musicTrim * musicLevel, t, VOLUME_TAU_S);
      sfxVol.gain.setTargetAtTime(sfxLevel, t, VOLUME_TAU_S);
    },

    initVolume(musicLevel: number, sfxLevel: number): void {
      musicVol.gain.value = MIX.musicTrim * musicLevel;
      sfxVol.gain.value = sfxLevel;
    },

    setMode(mode: number, t: number): void {
      state.baseFilter = MODE_FILTER[mode] ?? MODE_FILTER[0]!;
      state.baseGain = MODE_GAIN[mode] ?? MODE_GAIN[0]!;
      if (t < state.duckUntil) {
        duckTo(t, state.duckUntil);   // a hit is still ducking: keep its flat 400 ms, over the new base
        return;
      }
      const G = duckGain.gain;
      const F = duckFilter.frequency;
      G.cancelScheduledValues(t);
      F.cancelScheduledValues(t);
      G.setTargetAtTime(state.baseGain, t, MODE_TAU_S);
      F.setTargetAtTime(state.baseFilter, t, MODE_TAU_S);
    },

    hitDuck(t: number): void {
      duckTo(t, t + HIT_S);
    },

    setWind(target: number, t: number): void {
      windGain.gain.setTargetAtTime(target * MIX.wind, t, WIND_TAU_S);
    },

    rampIn(t: number): void {
      const G = master.gain;
      G.cancelScheduledValues(t);
      G.setValueAtTime(0, t);
      G.linearRampToValueAtTime(1, t + RESUME_RAMP_S);
    },
  };
}
