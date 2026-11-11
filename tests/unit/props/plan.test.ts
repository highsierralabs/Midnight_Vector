// A1: RING_PLAN against the numbers in plans/T05-props.md M1 and section 6.5.
import { describe, expect, it } from 'vitest';
import { CHUNK_LEN } from '../../../src/contracts/index';
import { RING_COUNT, RING_PLAN } from '../../../src/render/props/plan';

const CAPS = [270, 390, 130, 63, 162, 81, 98, 480, 272, 98, 49, 126, 49, 4, 147, 34, 68, 34, 168, 60, 180, 27, 60, 30, 45, 116];
const SECTION_6_4_TERRAIN = 120456;

describe('RING_PLAN', () => {
  it('has 26 rings whose caps equal the list', () => {
    expect(RING_COUNT).toBe(26);
    expect(RING_PLAN.map((p) => p.cap)).toEqual(CAPS);
    RING_PLAN.forEach((p, i) => expect(p.id).toBe(i));
  });

  it('has exactly the reaches of the live-row model', () => {
    const props = new Set(RING_PLAN.filter((p) => p.source === 'prop').map((p) => p.reach));
    const items = new Set(RING_PLAN.filter((p) => p.source === 'item').map((p) => p.reach));
    expect([...props].sort((a, b) => a - b)).toEqual([13, 19, 25, 32, 47, 63, 94]);
    expect([...items].sort((a, b) => a - b)).toEqual([13, 25]);
    for (const p of RING_PLAN) expect(p.reach).toBe(Math.ceil(p.maxDist / CHUNK_LEN));
  });

  it('keeps one rear row, except TRAFFIC with three', () => {
    for (const p of RING_PLAN) expect(p.rear).toBe(p.name === 'TRAFFIC' ? 3 : 1);
  });

  it('adds up to the section 6.5 worst case', () => {
    const instances = RING_PLAN.reduce((s, p) => s + p.cap, 0);
    expect(instances).toBe(3241);
    const scenery = RING_PLAN.filter((p) => p.source === 'prop').reduce((s, p) => s + p.cap * p.targetTris, 0);
    expect(scenery).toBe(317284);
    const items = RING_PLAN.filter((p) => p.source === 'item').reduce((s, p) => s + p.cap * p.targetTris, 0);
    const mirrored = RING_PLAN.filter((p) => p.mirror);
    expect(mirrored.length).toBe(12);
    const mirror = mirrored.reduce((s, p) => s + p.cap * p.targetTris, 0);
    const beams = RING_PLAN.filter((p) => p.beam).length;
    expect(beams).toBe(2);
    const shipDraws = 2;
    expect(RING_COUNT + mirrored.length + beams + shipDraws).toBe(42);
    const total = mirror + scenery + items + SECTION_6_4_TERRAIN;
    console.log(`A1 instances ${instances}, scenery ${scenery}, items ${items}, mirror ${mirror}, with terrain ${total}`);
    expect(total).toBeLessThan(1_500_000);
  });

  it('fits 152 KB of instance data under the 0.2 MB ceiling', () => {
    const bytes = RING_PLAN.reduce((s, p) => s + p.cap * 48, 0);
    expect(bytes).toBeLessThan(0.2 * 1024 * 1024);
  });
});
