// The planner behind DEMO, CRUISE, SIGNAL_LOST and idle PLAY. It writes a ControlFrame, and stage C of sim.step turns
// that frame into motion exactly as it does for a player, so it cannot have different physics.
//
// Hot path: on V8 a call that is not inlined boxes each double it takes or returns. So the planner passes integer
// indices, keeps its doubles in typed arrays and object fields, and has no closures per call (T02 section 10).
// A conditional that joins a double with a constant read from an import or a closure boxes the double too, because such a
// read has no known number type: `v > LIMIT ? LIMIT : v` allocated 16 B each time it passed v through. Math.min and
// Math.max are typed and inline, so clamps against such a constant use them.
import {
  ITEM_STRIDE, ItemField, ItemKind, PHASE_PERIOD_TICKS, PLAY_HALF_X, PLAY_Y_MAX, PLAY_Y_MIN, SHIP_FORWARD, SIM_HZ, TRAFFIC_FADE,
  type ControlFrame, type SimState, type Travel,
} from '../contracts/index';
import { between } from '../core/coords';
import { droneOffset, phaseOf } from '../core/motion';
import type { ItemRing } from './collision';
import type { Tuning } from './tuning';

const TAU = 2 * Math.PI;
const DT = 1 / SIM_HZ;
const COMMIT_POINTS = 15;
/** A car moves a * b / TRAFFIC_PHASE_S u/s: b wraps of a in one period of phase 7, 256 s. */
const TRAFFIC_PHASE_S = PHASE_PERIOD_TICKS[7] / SIM_HZ;
const { KIND, X, Y, Z_LOCAL, RADIUS, A, B, SEED } = ItemField;

export interface Autopilot {
  /** Written by update, read by stage C. Normalised and absolute, like any absolute frame. */
  readonly control: ControlFrame;
  /** Called when the planner takes over: starts from where the ship is. The next replan is the next multiple of AP_REPLAN_TICKS. */
  activate(): void;
  update(): void;
}

export function createAutopilot(ring: ItemRing, s: Readonly<SimState>, t: Tuning): Autopilot {
  const maxDigest = t.AP_MAX_DIGEST;
  const dKind = new Int32Array(maxDigest);
  const dTt = new Float64Array(maxDigest);
  const dX = new Float64Array(maxDigest);
  const dY = new Float64Array(maxDigest);
  const dR = new Float64Array(maxDigest);
  const dA = new Float64Array(maxDigest);
  const dB = new Float64Array(maxDigest);
  const dReachX = new Float64Array(maxDigest);
  const dReachY = new Float64Array(maxDigest);
  let digestCount = 0;
  let gateIndex = -1;

  const maxCandidates = Math.max(COMMIT_POINTS, (t.AP_GRID_NX + 1) * t.AP_GRID_NY + 1);
  const candX = new Float64Array(maxCandidates);
  const candY = new Float64Array(maxCandidates);
  const best = new Float64Array(3);   // cost, x, y

  const origin: Travel = { chunk: 0, local: 0 };
  const m = { wantX: s.x, wantY: s.y, targetX: s.x, targetY: s.y, weaveScale: 1 };
  const control: ControlFrame = { moveX: 0, moveY: 0, absolute: true, boost: false, human: false };

  const rateX = t.SHIP_RATE_X;
  const rateY = t.SHIP_RATE_Y;
  const shipR = t.SHIP_HIT_RADIUS;
  const lag = t.AP_LAG_S;
  const horizon = t.AP_HORIZON_S;
  const wGate = t.AP_W_GATE;
  const wHazard = t.AP_W_HAZARD;
  const wShard = t.AP_W_SHARD;
  const wSwitch = t.AP_W_SWITCH;
  const wSwitchY = t.AP_W_SWITCH_Y * t.AP_W_SWITCH;
  const sigma2 = t.AP_SHARD_SIGMA2;
  const shardUrgency = t.AP_SHARD_URGENCY_S;
  const feas = t.AP_FEAS;
  const gateInner = t.AP_GATE_INNER;
  const shortXU = t.AP_GATE_SHORT_X_U;
  const shortYU = t.AP_GATE_SHORT_Y_U;
  const fenceBase = t.AP_FENCE_BASE;
  const fenceOffU = t.AP_FENCE_OFF_U;
  const fenceClear = t.AP_FENCE_CLEAR_U;
  const hazardMargin = t.AP_HAZARD_MARGIN;
  const hazardBase = t.AP_HAZARD_BASE;
  const urgency = t.AP_URGENCY_S;
  const targetK = 1 - Math.exp(-DT / t.AP_TARGET_TAU);

  /** One pass over the ring per replan: what can be met within the horizon, flattened, so candidates read arrays only. */
  function digest(): void {
    const tick = s.tick;
    const speed = s.speed;
    const c = s.travel.chunk;
    let n = 0;
    let gate = -1;
    let gateRel = Infinity;
    for (let rc = c - t.ITEM_ROWS_BACK; rc <= c + t.ITEM_ROWS_AHEAD && n < maxDigest; rc++) {
      const row = ring.rowOf(rc);
      const count = row.count;
      if (count === 0) continue;
      const d = row.data;
      origin.chunk = rc;
      const rowRel = between(origin, s.travel) - SHIP_FORWARD;
      for (let i = 0; i < count && n < maxDigest; i++) {
        const o = i * ITEM_STRIDE;
        const kind = d[o + KIND]!;
        if (kind !== ItemKind.SHARD && kind !== ItemKind.GATE && kind !== ItemKind.SPIKE
          && kind !== ItemKind.FENCE && kind !== ItemKind.DRONE && kind !== ItemKind.TRAFFIC) continue;
        const a = d[o + A]!;
        const b = d[o + B]!;
        const seed = d[o + SEED]!;
        if (kind === ItemKind.GATE && a === 1) continue;   // A checkpoint's opening spans the play box.
        let rel = rowRel + d[o + Z_LOCAL]!;
        let closing = speed;
        if (kind === ItemKind.TRAFFIC) {
          const closingSpeed = speed - (a * b) / TRAFFIC_PHASE_S;
          closing = closingSpeed > 1 ? closingSpeed : 1;
          const q0 = b * phaseOf(tick, 0, 7) + seed;
          const f0 = q0 - Math.floor(q0);
          const est = (rel + a * f0) / closing;
          const fut = tick + Math.floor(est > 0 ? est * SIM_HZ : 0);
          const q1 = b * phaseOf(fut, 0, 7) + seed;
          const f1 = q1 - Math.floor(q1);
          if (f1 < TRAFFIC_FADE || f1 > 1 - TRAFFIC_FADE) continue;
          rel += a * f1;
        }
        if (!(rel > 0)) continue;
        const tt = rel / closing;
        if (!(tt <= horizon)) continue;
        let x = d[o + X]!;
        if (kind === ItemKind.DRONE) x += droneOffset(a, b, seed, phaseOf(tick + Math.floor(tt * SIM_HZ), 0, 3));
        const y = d[o + Y]!;
        const radius = d[o + RADIUS]!;
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius)) continue;
        const left = tt - lag;
        const reach = left > 0 ? left : 0;
        dKind[n] = kind;
        dTt[n] = tt;
        dX[n] = x;
        dY[n] = y;
        dR[n] = radius;
        dA[n] = a;
        dB[n] = b;
        dReachX[n] = rateX * reach;
        dReachY[n] = rateY * reach;
        if (kind === ItemKind.GATE && rel < gateRel) {
          gateRel = rel;
          gate = n;
        }
        n++;
      }
    }
    digestCount = n;
    gateIndex = gate;
  }

  /** Lowest cost wins, and a tie keeps the first. Writes to `best`. */
  function score(ci: number): void {
    const cx = candX[ci]!;
    const cy = candY[ci]!;
    const sx = s.x;
    const sy = s.y;
    let cost = wSwitch * Math.abs(cx - m.wantX) + wSwitchY * Math.abs(cy - m.wantY);
    const tcx = Math.abs(cx - sx) / rateX;
    const tcy = Math.abs(cy - sy) / rateY;
    const wantDx = cx - sx;
    const wantDy = cy - sy;
    for (let q = 0; q < digestCount; q++) {
      const kind = dKind[q]!;
      const tt = dTt[q]!;
      const ix = dX[q]!;
      const iy = dY[q]!;
      const r = dR[q]!;
      const rx = dReachX[q]!;
      const ry = dReachY[q]!;
      // Where this candidate puts the ship when the item arrives, within what the rates allow.
      const px = sx + (wantDx < -rx ? -rx : wantDx > rx ? rx : wantDx);
      const py = sy + (wantDy < -ry ? -ry : wantDy > ry ? ry : wantDy);
      if (kind === ItemKind.GATE) {
        // Two-segment feasibility: fly to the candidate, then the rest of the way to the gate.
        const nx = Math.abs(ix - cx) - r * gateInner;
        const ny = Math.abs(iy - cy) - r * gateInner;
        const needX = nx > 0 ? nx : 0;
        const needY = ny > 0 ? ny : 0;
        const leftX = tt - tcx;
        const leftY = tt - tcy;
        const shortX = needX - (leftX > 0 ? leftX : 0) * rateX * feas;
        const shortY = needY - (leftY > 0 ? leftY : 0) * rateY * feas;
        if (shortX > 0) cost += wGate * (1 + shortX / shortXU);
        if (shortY > 0) cost += wGate * (1 + shortY / shortYU);
      } else if (kind === ItemKind.SHARD) {
        const dx = px - ix;
        const dy = py - iy;
        cost -= (wShard / (shardUrgency + tt)) * Math.exp(-(dx * dx + dy * dy) / sigma2);
      } else if (kind === ItemKind.FENCE) {
        if (Math.abs(px - ix) <= r + shipR) {
          const off = Math.abs(px - dA[q]!) - (dB[q]! - shipR - fenceClear);
          if (off > 0) cost += (wHazard / (urgency + tt)) * (fenceBase + off / fenceOffU);
        }
      } else {
        const dx = px - ix;
        const dy = py - iy;
        const dd = Math.sqrt(dx * dx + dy * dy);
        const margin = (r + shipR) * hazardMargin;
        if (dd < margin) cost += (wHazard / (urgency + tt)) * (1 - dd / margin + hazardBase);
      }
    }
    if (cost < best[0]!) {
      best[0] = cost;
      best[1] = cx;
      best[2] = cy;
    }
  }

  function plan(): void {
    digest();
    best[0] = Infinity;
    best[1] = m.wantX;
    best[2] = m.wantY;
    let n = 0;
    const gate = gateIndex;
    const committed = gate >= 0 && dTt[gate]! < t.AP_COMMIT_S;
    if (committed) {
      // Hazards can then only choose among points that still thread the gate.
      const radius = dR[gate]!;
      const aperture = radius * t.AP_APERTURE;
      const gx = dX[gate]!;
      const gy = dY[gate]!;
      for (let iy = -1; iy <= 1; iy++) {
        const cy = Math.max(PLAY_Y_MIN, Math.min(PLAY_Y_MAX, gy + iy * aperture));
        for (let ix = -2; ix <= 2; ix++) {
          candX[n] = Math.max(-PLAY_HALF_X, Math.min(PLAY_HALF_X, gx + (ix * aperture) / 2));
          candY[n] = cy;
          n++;
        }
      }
      const weave = (t.AP_COMMIT_WEAVE_R * radius) / t.AP_WEAVE_X;
      m.weaveScale = weave < 1 ? weave : 1;
    } else {
      const nx = t.AP_GRID_NX;
      const ny = t.AP_GRID_NY;
      for (let iy = 0; iy < ny; iy++) {
        const cy = PLAY_Y_MIN + ((PLAY_Y_MAX - PLAY_Y_MIN) * iy) / (ny - 1);
        for (let ix = 0; ix < nx; ix++) {
          candX[n] = -PLAY_HALF_X + (2 * PLAY_HALF_X * ix) / (nx - 1);
          candY[n] = cy;
          n++;
        }
        candX[n] = m.wantX;
        candY[n] = cy;
        n++;
      }
      if (gate >= 0) {
        candX[n] = dX[gate]!;
        candY[n] = dY[gate]!;
        n++;
      }
      m.weaveScale = 1;
    }
    for (let i = 0; i < n; i++) score(i);
    m.wantX = best[1]!;
    m.wantY = best[2]!;
  }

  return {
    control,
    activate(): void {
      m.wantX = m.targetX = s.x;
      m.wantY = m.targetY = s.y;
    },
    update(): void {
      let goalX: number;
      let goalY: number;
      if (t.AP_ENABLED) {
        if (s.tick % t.AP_REPLAN_TICKS === 0) plan();
        // Integer harmonics of the bar phase, so the ship sways with the music and the wrap cannot pop.
        const bar = phaseOf(s.tick, 0, 1);
        goalX = m.wantX + m.weaveScale * t.AP_WEAVE_X * Math.sin(TAU * bar);
        goalY = m.wantY + m.weaveScale * t.AP_WEAVE_Y * Math.sin(TAU * 2 * bar);
      } else {
        goalX = 0;
        goalY = 8;
      }
      m.targetX += (goalX - m.targetX) * targetK;
      m.targetY += (goalY - m.targetY) * targetK;
      control.moveX = m.targetX / PLAY_HALF_X;
      control.moveY = ((m.targetY - PLAY_Y_MIN) / (PLAY_Y_MAX - PLAY_Y_MIN)) * 2 - 1;
    },
  };
}
