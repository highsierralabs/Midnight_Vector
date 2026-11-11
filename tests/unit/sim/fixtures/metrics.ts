// measureAutopilot flies a sim in DEMO and scores it. Crossings come from the sim's own sweep through its test probe, so
// the shape tests are the ones the rules use. T10 runs this on the real world from tests/unit/app.
import { SIM_HZ, type ControlFrame, type WorldSource } from '../../../../src/contracts/index';
import { Crossing } from '../../../../src/sim/collision';
import { createSimInternal } from '../../../../src/sim/sim';
import { TUNING, type Tuning } from '../../../../src/sim/tuning';

export interface AutopilotMetrics {
  gates: number; threadPct: number;
  hazards: number; hitPct: number; grazes: number;
  shards: number; shardPct: number;
  /** Longest run with both axis speeds under 0.5 u/s. */
  maxStillS: number;
  /** Sign changes of vx beyond 2 u/s, per second. */
  flipsPerS: number;
  /** Smallest standard deviation of x over any 10 s window, sampled each second. */
  minStd10s: number;
  rmsAccel: number;
}

const IDLE: ControlFrame = { moveX: 0, moveY: 0, absolute: false, boost: false, human: false };

export function measureAutopilot(world: WorldSource, seconds: number, tuning?: Partial<Tuning>): AutopilotMetrics {
  const t: Tuning = tuning ? { ...TUNING, ...tuning } : TUNING;
  let gates = 0;
  let threaded = 0;
  let hazards = 0;
  let hits = 0;
  let grazes = 0;
  let shards = 0;
  let taken = 0;
  const sim = createSimInternal(world, t, {
    onCrossing(outcome): void {
      if (outcome === Crossing.GATE_THREADED) { gates++; threaded++; }
      else if (outcome === Crossing.GATE_MISSED) gates++;
      else if (outcome === Crossing.SHARD_TAKEN) { shards++; taken++; }
      else if (outcome === Crossing.SHARD_MISSED) shards++;
      else if (outcome === Crossing.HAZARD_HIT) { hazards++; hits++; }
      else if (outcome === Crossing.HAZARD_GRAZE) { hazards++; grazes++; }
      else if (outcome === Crossing.HAZARD_CLEAR) hazards++;
    },
  });
  const s = sim.state;
  const steps = Math.round(seconds * SIM_HZ);
  const windowSteps = 10 * SIM_HZ;
  const xs = new Float64Array(windowSteps);
  let stillRun = 0;
  let maxStill = 0;
  let flips = 0;
  let lastSign = 0;
  let prevVx = 0;
  let accelSum = 0;
  let minStd = Infinity;
  for (let i = 0; i < steps; i++) {
    sim.step(IDLE);
    sim.events.count = 0;
    const vx = (s.x - s.prevX) * SIM_HZ;
    const vy = (s.y - s.prevY) * SIM_HZ;
    const ax = (vx - prevVx) * SIM_HZ;
    prevVx = vx;
    accelSum += ax * ax;
    if (Math.abs(vx) < 0.5 && Math.abs(vy) < 0.5) {
      stillRun++;
      if (stillRun > maxStill) maxStill = stillRun;
    } else {
      stillRun = 0;
    }
    const sign = vx > 2 ? 1 : vx < -2 ? -1 : 0;
    if (sign !== 0 && sign !== lastSign) {
      if (lastSign !== 0) flips++;
      lastSign = sign;
    }
    xs[i % windowSteps] = s.x;
    if (i >= windowSteps && i % SIM_HZ === 0) {
      let mean = 0;
      for (let k = 0; k < windowSteps; k++) mean += xs[k]!;
      mean /= windowSteps;
      let v = 0;
      for (let k = 0; k < windowSteps; k++) v += (xs[k]! - mean) ** 2;
      const std = Math.sqrt(v / windowSteps);
      if (std < minStd) minStd = std;
    }
  }
  return {
    gates,
    threadPct: gates > 0 ? (100 * threaded) / gates : 0,
    hazards,
    hitPct: hazards > 0 ? (100 * hits) / hazards : 0,
    grazes,
    shards,
    shardPct: shards > 0 ? (100 * taken) / shards : 0,
    maxStillS: maxStill / SIM_HZ,
    flipsPerS: flips / seconds,
    minStd10s: minStd,
    rmsAccel: Math.sqrt(accelSum / steps),
  };
}
