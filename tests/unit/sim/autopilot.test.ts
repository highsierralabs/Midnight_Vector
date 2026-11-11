// A8 and A9: the demo pilot threads gates, avoids hazards, keeps moving, flies through the same physics as a player, and
// writes a picture of its path that someone must open and look at.
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { ItemKind, ITEM_STRIDE, ItemField, SIM_HZ, type ControlFrame } from '../../../src/contracts/index';
import { Crossing } from '../../../src/sim/collision';
import { createFakeWorld } from '../../../src/testing/fakeWorld';
import { HOLD, make, NOBODY, planeU } from './fixtures/drive';
import { measureAutopilot, type AutopilotMetrics } from './fixtures/metrics';
import { createCanvas, type Rgb } from './fixtures/png';
import { emptyWorld, gauntletWorld } from './fixtures/worlds';

const SECONDS = 600;

function show(label: string, m: AutopilotMetrics): void {
  console.log(`AUTOPILOT ${label}: thread ${m.threadPct.toFixed(1)}% of ${m.gates}, hit ${m.hitPct.toFixed(2)}% of ${m.hazards}, grazes ${m.grazes}, shards ${m.shardPct.toFixed(1)}% of ${m.shards}, still ${m.maxStillS.toFixed(2)} s, flips ${m.flipsPerS.toFixed(2)}/s, minStd10s ${m.minStd10s.toFixed(2)}, rmsAccel ${m.rmsAccel.toFixed(1)}`);
}

describe('A8a: density 0.6', () => {
  test.each([1985, 7])('seed %d flies well', (seed) => {
    const m = measureAutopilot(gauntletWorld({ seed, density: 0.6 }), SECONDS);
    show(`A8a seed ${seed}`, m);
    expect(m.gates).toBeGreaterThan(200);
    expect(m.threadPct).toBeGreaterThanOrEqual(95);
    expect(m.hitPct).toBeLessThanOrEqual(4);
    expect(m.shardPct).toBeGreaterThanOrEqual(30);
    expect(m.maxStillS).toBeLessThanOrEqual(1);
    expect(m.minStd10s).toBeGreaterThanOrEqual(2);
    expect(m.flipsPerS).toBeGreaterThanOrEqual(0.3);
    expect(m.flipsPerS).toBeLessThanOrEqual(3);
    expect(m.rmsAccel).toBeLessThanOrEqual(180);
  }, 120000);
});

describe('A8b: harder worlds', () => {
  test.each([1985, 7])('density 1, seed %d', (seed) => {
    const m = measureAutopilot(gauntletWorld({ seed, density: 1 }), SECONDS);
    show(`A8b density 1 seed ${seed}`, m);
    expect(m.threadPct).toBeGreaterThanOrEqual(90);
    expect(m.hitPct).toBeLessThanOrEqual(5);
  }, 120000);

  test.each([1985, 7])('gate radius 3, density 0.6, seed %d', (seed) => {
    const m = measureAutopilot(gauntletWorld({ seed, density: 0.6, gateRadius: 3 }), SECONDS);
    show(`A8b radius 3 seed ${seed}`, m);
    expect(m.threadPct).toBeGreaterThanOrEqual(90);
    expect(m.hitPct).toBeLessThanOrEqual(5);
  }, 120000);
});

describe('A8c: the fake world', () => {
  test('threads at least 80% of its gates', () => {
    const m = measureAutopilot(createFakeWorld(), SECONDS);
    show('A8c fake', m);
    expect(m.gates).toBeGreaterThan(200);
    expect(m.threadPct).toBeGreaterThanOrEqual(80);
  }, 120000);
});

describe('A8n: a pilot that does nothing', () => {
  test('fails A8a on all of its counts, so the metrics can tell a bad pilot from a good one', () => {
    const m = measureAutopilot(gauntletWorld({ seed: 1985, density: 0.6 }), SECONDS, { AP_ENABLED: false });
    show('A8n disabled', m);
    expect(m.threadPct).toBeLessThan(50);
    expect(m.hitPct).toBeGreaterThan(4);
    expect(m.minStd10s).toBe(0);
    expect(m.maxStillS).toBeGreaterThan(100);
  }, 120000);
});

describe('A8r: one physics path', () => {
  test('a player sent the planner\'s frames, in an empty world, flies the identical path', () => {
    const frames: ControlFrame[] = [];
    const a = make(gauntletWorld({ seed: 1985, density: 0.6 }), { AP_DEMO_BOOST_TICKS: 0 }, {
      onControl(c): void { frames.push({ ...c, human: true }); },
    });
    const b = make(emptyWorld());
    b.command('launch');
    for (let i = 0; i < 12000; i++) {
      a.step(NOBODY);
      a.events.count = 0;
      b.step(frames[i]!);
      b.events.count = 0;
      if (!Object.is(a.state.x, b.state.x) || !Object.is(a.state.y, b.state.y)) {
        throw new Error(`diverged at step ${i}: ${a.state.x},${a.state.y} vs ${b.state.x},${b.state.y}`);
      }
    }
    // Not vacuous: the ship travelled, and the frames were the planner's own.
    expect(frames.length).toBe(12000);
    expect(Math.abs(a.state.x) + Math.abs(a.state.y)).toBeGreaterThan(0);
    expect(new Set(frames.map((f) => f.moveX)).size).toBeGreaterThan(1000);
    expect(b.state.mode).toBe(1);
  });

  test('negative control: the same frames on a frame that is not fed in do diverge', () => {
    const frames: ControlFrame[] = [];
    const a = make(gauntletWorld({ seed: 1985, density: 0.6 }), { AP_DEMO_BOOST_TICKS: 0 }, {
      onControl(c): void { frames.push({ ...c, human: true }); },
    });
    const b = make(emptyWorld());
    b.command('launch');
    let diverged = false;
    for (let i = 0; i < 2000; i++) {
      a.step(NOBODY);
      a.events.count = 0;
      b.step(HOLD);
      b.events.count = 0;
      if (!Object.is(a.state.x, b.state.x)) diverged = true;
    }
    expect(diverged).toBe(true);
  });
});

describe('a function of state, the rows and the tick only', () => {
  test('a planner handed the same inputs by two sims stays in step', () => {
    const world = gauntletWorld({ seed: 7, density: 1 });
    const a = make(world);
    const b = make(world);
    for (let i = 0; i < 6000; i++) {
      a.step(NOBODY);
      b.step({ moveX: 1, moveY: -1, absolute: false, boost: true, human: true });
      a.events.count = 0;
      b.events.count = 0;
      expect(Object.is(a.state.x, b.state.x)).toBe(true);
    }
  });

  test('stays inside the box and finite on a world with no items', () => {
    const sim = make(emptyWorld());
    let moved = 0;
    for (let i = 0; i < 6000; i++) {
      sim.step(NOBODY);
      sim.events.count = 0;
      expect(Number.isFinite(sim.state.x)).toBe(true);
      if (sim.state.x !== sim.state.prevX) moved++;
    }
    // Still weaving, with nothing to fly at.
    expect(moved).toBeGreaterThan(5000);
  });
});

describe('A9: the picture', () => {
  test('writes test-results/T02/autopilot-trace.png', () => {
    const path = fileURLToPath(new URL('../../../test-results/T02/autopilot-trace.png', import.meta.url));
    const world = gauntletWorld({ seed: 1985, density: 0.6 });
    const WIDTH = 1800;
    const PANELS = 3;
    const PANEL_H = 250;
    const STRIP_H = 50;
    const GAP = 10;
    const HEIGHT = (PANEL_H + STRIP_H + GAP) * PANELS;
    const SECONDS_SHOWN = 30;
    const canvas = createCanvas(WIDTH, HEIGHT, [12, 12, 20]);
    const CYAN: Rgb = [60, 220, 255];
    const RED: Rgb = [255, 60, 60];
    const DARK_RED: Rgb = [170, 40, 90];
    const ORANGE: Rgb = [255, 130, 40];
    const YELLOW: Rgb = [255, 220, 60];
    const WHITE: Rgb = [255, 255, 255];
    const MISS: Rgb = [255, 0, 255];
    const FRAME: Rgb = [50, 50, 70];
    const STRIP: Rgb = [24, 24, 36];

    const frames: { x: number; y: number; plane: number }[] = [];
    const crossings: { plane: number; x: number; y: number; kind: number; outcome: number; radius: number; a: number; b: number; shipX: number; shipY: number }[] = [];
    const sim = make(world, undefined, {
      onCrossing(outcome, kind, row, index): void {
        const o = index * ITEM_STRIDE;
        const d = row.data;
        crossings.push({
          plane: planeU(sim), x: d[o + ItemField.X]!, y: d[o + ItemField.Y]!, kind, outcome,
          radius: d[o + ItemField.RADIUS]!, a: d[o + ItemField.A]!, b: d[o + ItemField.B]!, shipX: sim.state.x, shipY: sim.state.y,
        });
      },
    });
    const startPlane = planeU(sim);
    for (let i = 0; i < SECONDS_SHOWN * SIM_HZ; i++) {
      sim.step(NOBODY);
      sim.events.count = 0;
      frames.push({ x: sim.state.x, y: sim.state.y, plane: planeU(sim) });
    }
    const span = (frames[frames.length - 1]!.plane - startPlane) / PANELS;

    function toScreen(plane: number): { panel: number; px: number } {
      const rel = plane - startPlane;
      const panel = Math.floor(rel / span);
      return { panel, px: ((rel - panel * span) / span) * (WIDTH - 1) };
    }
    const topOf = (panel: number): number => panel * (PANEL_H + STRIP_H + GAP);
    const lateralY = (panel: number, x: number): number => topOf(panel) + (PANEL_H - 1) * (0.5 - x / 90);
    const heightY = (panel: number, y: number): number => topOf(panel) + PANEL_H + (STRIP_H - 1) * (1 - (y - 2) / 12);

    for (let p = 0; p < PANELS; p++) {
      canvas.hline(lateralY(p, 40), 0, WIDTH - 1, FRAME);
      canvas.hline(lateralY(p, -40), 0, WIDTH - 1, FRAME);
      canvas.fill(0, topOf(p) + PANEL_H, WIDTH - 1, topOf(p) + PANEL_H + STRIP_H - 1, STRIP);
    }
    let gates = 0;
    let missed = 0;
    let hits = 0;
    for (const c of crossings) {
      const { panel, px } = toScreen(c.plane);
      if (panel >= PANELS) continue;
      if (c.kind === ItemKind.GATE) {
        const miss = c.outcome === Crossing.GATE_MISSED;
        gates++;
        if (miss) missed++;
        const colour = miss ? MISS : CYAN;
        canvas.fill(px - 1, lateralY(panel, c.x + c.radius), px + 1, lateralY(panel, c.x - c.radius), colour);
        canvas.fill(px - 1, heightY(panel, c.y + c.radius), px + 1, heightY(panel, c.y - c.radius), colour);
      } else if (c.kind === ItemKind.SHARD) {
        canvas.dot(px, lateralY(panel, c.x), YELLOW, 1);
        canvas.dot(px, heightY(panel, c.y), YELLOW, 0);
      } else if (c.kind === ItemKind.SPIKE) {
        canvas.dot(px, lateralY(panel, c.x), RED, 2);
        canvas.dot(px, heightY(panel, c.y), RED, 1);
      } else if (c.kind === ItemKind.FENCE) {
        // Red bar with the gap open: the narrowed gap is what the ship must fit through.
        for (let x = c.x - c.radius; x <= c.x + c.radius; x += 0.25) {
          if (Math.abs(x - c.a) > c.b) canvas.dot(px, lateralY(panel, x), RED, 1);
        }
      } else if (c.kind === ItemKind.DRONE) {
        canvas.fill(px, lateralY(panel, c.x + c.a), px + 1, lateralY(panel, c.x - c.a), DARK_RED);
        canvas.dot(px, heightY(panel, c.y), DARK_RED, 1);
      } else if (c.kind === ItemKind.TRAFFIC) {
        canvas.dot(px, lateralY(panel, c.x), ORANGE, 2);
        canvas.dot(px, heightY(panel, c.y), ORANGE, 1);
      }
      // Magenta marks where the ship was when the shape test said hit.
      if (c.outcome === Crossing.HAZARD_HIT) {
        canvas.dot(px, lateralY(panel, c.shipX), MISS, 3);
        canvas.dot(px, heightY(panel, c.shipY), MISS, 2);
        hits++;
      }
    }
    for (const f of frames) {
      const { panel, px } = toScreen(f.plane);
      if (panel >= PANELS) continue;
      canvas.dot(px, lateralY(panel, f.x), WHITE, 0);
      canvas.dot(px, heightY(panel, f.y), WHITE, 0);
    }
    canvas.save(path);
    console.log(`TRACE ${path}: ${WIDTH}x${HEIGHT}, ${gates} gates, ${missed} missed, ${hits} hits`);
    expect(gates).toBeGreaterThan(5);
  });
});
