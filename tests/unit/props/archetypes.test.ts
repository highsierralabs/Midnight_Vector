// A21: for all 26 plus the ship. Triangle budgets, extents against ARCHETYPE_SPEC, reach bounds, no degenerate triangles.
import { describe, expect, it } from 'vitest';
import { ARCHETYPE_COUNT, ARCHETYPE_SPEC, Archetype, ITEM_KIND_COUNT, PLAY_Y_MAX } from '../../../src/contracts/index';
import { ARCHETYPE_DEFS, SEARCHLIGHT_LENGTH, searchlightLean, type MeshDef } from '../../../src/render/props/archetypes';
import { EDGE_SENTINEL, MeshBuilder, type BuiltMesh } from '../../../src/render/props/builders';
import { ITEM_DEFS } from '../../../src/render/props/items';
import { RING_PLAN } from '../../../src/render/props/plan';
import { buildShipBody, buildShipGlow, SHIP_HALF_LENGTH, SHIP_HALF_WIDTH } from '../../../src/render/props/ship';

function build(def: MeshDef): BuiltMesh {
  const b = new MeshBuilder();
  def.build(b);
  return b.finish();
}

function triArea(m: BuiltMesh, i: number): number {
  const at = (k: number): [number, number, number] => {
    const o = m.index[i + k]! * 3;
    return [m.position[o]!, m.position[o + 1]!, m.position[o + 2]!];
  };
  const a = at(0), b = at(1), c = at(2);
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  return 0.5 * Math.hypot(nx, ny, nz);
}

function checkMesh(name: string, m: BuiltMesh): void {
  for (let i = 0; i < m.position.length; i++) expect(Number.isFinite(m.position[i]!), `${name} position`).toBe(true);
  for (let i = 0; i < m.edge.length; i++) expect(Number.isFinite(m.edge[i]!), `${name} edge`).toBe(true);
  const n = m.position.length / 3;
  for (let i = 0; i < m.index.length; i++) expect(m.index[i]!, `${name} index`).toBeLessThan(n);
  for (let i = 0; i < m.index.length; i += 3) {
    expect(triArea(m, i), `${name} triangle ${i / 3} degenerate`).toBeGreaterThan(1e-6);
  }
}

function rootFacesAreDark(name: string, m: BuiltMesh): void {
  for (let i = 0; i < m.index.length; i += 3) {
    let maxY = -Infinity;
    for (let k = 0; k < 3; k++) maxY = Math.max(maxY, m.position[m.index[i + k]! * 3 + 1]!);
    if (maxY >= -1e-3) continue;
    for (let k = 0; k < 3; k++) {
      const v = m.index[i + k]!;
      for (let e = 0; e < 4; e++) {
        expect(m.edge[v * 4 + e], `${name}: a face wholly below ground carries a line`).toBe(EDGE_SENTINEL);
      }
    }
  }
}

const TRI_ALLOWANCE = 1.3;

describe('the 20 archetypes', () => {
  for (let a = 0; a < ARCHETYPE_COUNT; a++) {
    const def = ARCHETYPE_DEFS[a]!;
    const spec = ARCHETYPE_SPEC[a]!;
    const plan = RING_PLAN[a]!;

    it(`${def.name}: budget, extents, reach, roots`, () => {
      expect(def.id).toBe(a);
      const m = build(def);
      expect(m.tris, `${def.name} triangles against ${plan.targetTris}`).toBeLessThanOrEqual(plan.targetTris * TRI_ALLOWANCE);
      checkMesh(def.name, m);
      if (def.grounded) rootFacesAreDark(def.name, m);
      if (a === Archetype.SEARCHLIGHT) return;   // its top and root describe a housing T05 does not draw
      expect(m.bbox.max[1], `${def.name} top`).toBeLessThanOrEqual(spec.top + 1e-3);
      expect(m.bbox.max[1], `${def.name} top`).toBeGreaterThanOrEqual(spec.top * 0.9);
      if (spec.floats) {
        expect(Math.abs(m.bbox.min[1] + spec.top), `${def.name} bottom`).toBeLessThan(1e-3);
      } else {
        expect(Math.abs(m.bbox.min[1] + spec.root), `${def.name} bottom against root ${spec.root}`).toBeLessThan(1e-3);
      }
      // Horizontal reach, without PYLON's wires, so a mesh cannot spill over T01's bands.
      let reach = 0;
      for (let v = 0; v < m.position.length / 3; v++) {
        if (a === Archetype.PYLON && m.tag[v * 2]! > 1.5) continue;
        reach = Math.max(reach, Math.hypot(m.position[v * 3]!, m.position[v * 3 + 2]!));
      }
      expect(reach, `${def.name} reach`).toBeLessThanOrEqual(plan.radiusBound);
    });
  }

  it('sums to the worst case in section 9.2 at most', () => {
    let scenery = 0;
    let mirror = 0;
    for (const def of ARCHETYPE_DEFS) {
      const p = RING_PLAN[def.id]!;
      scenery += build(def).tris * p.cap;
      if (p.mirror) mirror += build(def).tris * p.cap;
    }
    console.log(`A21 built scenery ${scenery}, mirror ${mirror}`);
    expect(scenery + mirror).toBeLessThan(1_500_000 - 120_456);
  });
});

describe('searchlight', () => {
  const m = build(ARCHETYPE_DEFS[Archetype.SEARCHLIGHT]!);
  it('has a beam under 600 u long', () => {
    expect(m.bbox.max[1]).toBeLessThan(600);
    expect(SEARCHLIGHT_LENGTH).toBeLessThan(600);
  });
  it('leans outward at every phase', () => {
    for (let p = 0; p < 1; p += 1 / 64) {
      for (let y = 0; y < 2 * Math.PI; y += 0.5) expect(searchlightLean(p, y)).toBeGreaterThan(0.05);
    }
  });
});

describe('the 6 items', () => {
  for (let k = 0; k < ITEM_KIND_COUNT; k++) {
    const def = ITEM_DEFS[k]!;
    const plan = RING_PLAN[ARCHETYPE_COUNT + k]!;
    it(`${def.name}: budget and fit`, () => {
      expect(def.id).toBe(ARCHETYPE_COUNT + k);
      const m = build(def);
      expect(m.tris, `${def.name} triangles against ${plan.targetTris}`).toBeLessThanOrEqual(plan.targetTris * TRI_ALLOWANCE);
      checkMesh(def.name, m);
    });
  }
  it('fits radius 1 in (x, y) for SPIKE, DRONE and TRAFFIC', () => {
    for (const k of [2, 4, 5]) {
      const m = build(ITEM_DEFS[k]!);
      for (let v = 0; v < m.position.length / 3; v++) {
        const pinned = m.tag[v * 2 + 1]! > 0.5;
        if (pinned) continue;
        expect(Math.abs(m.position[v * 3]!), ITEM_DEFS[k]!.name).toBeLessThanOrEqual(1.001);
        expect(Math.abs(m.position[v * 3 + 1]!), ITEM_DEFS[k]!.name).toBeLessThanOrEqual(1.001);
      }
    }
  });
  it('has TRAFFIC about 3.4 radii long, and its fin at the top of the circle', () => {
    const m = build(ITEM_DEFS[5]!);
    expect(m.bbox.max[2] - m.bbox.min[2]).toBeGreaterThan(3.2);
    expect(m.bbox.max[2] - m.bbox.min[2]).toBeLessThan(3.8);
    expect(m.bbox.max[1]).toBeCloseTo(1, 3);
  });
  it('has a gate opening of unit radius across flats', () => {
    const m = build(ITEM_DEFS[1]!);
    let closest = Infinity;
    for (let v = 0; v < m.position.length / 3; v++) {
      if (m.tag[v * 2]! > 0.5) continue;
      closest = Math.min(closest, Math.hypot(m.position[v * 3]!, m.position[v * 3 + 1]!));
    }
    expect(closest).toBeCloseTo(1 / Math.cos(Math.PI / 8), 3);
  });
  it('has a fence full height, to PLAY_Y_MAX + 1', () => {
    const def = ITEM_DEFS[3]!;
    const m = build(def);
    expect(m.bbox.max[1]).toBeCloseTo(PLAY_Y_MAX + 1, 6);
    const beam = new MeshBuilder();
    def.buildBeam!(beam);
    expect(beam.finish().tris).toBe(4);
  });
});

describe('the ship', () => {
  const body = buildShipBody();
  const glow = buildShipGlow();
  it('is 3.2 u wide and 4.4 u long, about 180 tris in two draws', () => {
    expect(body.bbox.max[0] - body.bbox.min[0]).toBeCloseTo(2 * SHIP_HALF_WIDTH, 3);
    expect(SHIP_HALF_WIDTH * 2).toBeCloseTo(3.2, 6);
    expect(SHIP_HALF_LENGTH * 2).toBeCloseTo(4.4, 6);
    expect(body.bbox.min[2]).toBeCloseTo(-SHIP_HALF_LENGTH, 3);
    expect(body.tris + glow.tris).toBeLessThanOrEqual(180 * TRI_ALLOWANCE);
    checkMesh('SHIP', body);
    checkMesh('SHIP glow', glow);
  });
  it('is closed and faces outward, so the one-sided body material shows its outside from every side (DI-118)', () => {
    // The operator saw through the ship and a "floating triangle" under it: the upper hull was wound inside out, so the culled
    // faces were the ones toward the camera. Every connected shell must be wound consistently (each shared edge run once each
    // way), have positive signed volume (outward), and be open only at the engines' intakes, which sit inside the hull.
    const P = body.position, I = body.index, T = I.length / 3;
    const key = (i: number): string => `${P[i * 3]!.toFixed(4)},${P[i * 3 + 1]!.toFixed(4)},${P[i * 3 + 2]!.toFixed(4)}`;
    const edges = new Map<string, { f: number; r: number; tris: number[] }>();
    for (let t = 0; t < T; t++) {
      const k = [key(I[t * 3]!), key(I[t * 3 + 1]!), key(I[t * 3 + 2]!)];
      for (let e = 0; e < 3; e++) {
        const u = k[e]!, v = k[(e + 1) % 3]!;
        const id = u < v ? `${u}|${v}` : `${v}|${u}`;
        const rec = edges.get(id) ?? { f: 0, r: 0, tris: [] };
        if (u < v) rec.f++; else rec.r++;
        rec.tris.push(t);
        edges.set(id, rec);
      }
    }
    const parent = Array.from({ length: T }, (_, i) => i);
    const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
    for (const e of edges.values()) for (const t of e.tris) parent[find(t)] = find(e.tris[0]!);
    const shells = new Map<number, number[]>();
    for (let t = 0; t < T; t++) shells.set(find(t), [...(shells.get(find(t)) ?? []), t]);
    const problems: string[] = [];
    let openEdges = 0;
    for (const tris of shells.values()) {
      const set = new Set(tris);
      let vol = 0;
      for (const t of tris) {
        const [a, b, c] = [I[t * 3]!, I[t * 3 + 1]!, I[t * 3 + 2]!].map((i) => [P[i * 3]!, P[i * 3 + 1]!, P[i * 3 + 2]!]) as [number[], number[], number[]];
        vol += (a[0]! * (b[1]! * c[2]! - b[2]! * c[1]!) - a[1]! * (b[0]! * c[2]! - b[2]! * c[0]!) + a[2]! * (b[0]! * c[1]! - b[1]! * c[0]!)) / 6;
      }
      for (const e of edges.values()) {
        if (!e.tris.some((t) => set.has(t))) continue;
        if (e.f + e.r === 1) openEdges++;
        else if (e.f !== e.r) problems.push(`a shell of ${tris.length} tris runs an edge the same way twice`);
      }
      if (vol < 0) problems.push(`a shell of ${tris.length} tris faces inward, volume ${vol.toFixed(3)}`);
    }
    expect([...new Set(problems)]).toEqual([]);
    // Two engine intakes, 6 edges each, at z .7 inside the hull.
    expect(openEdges).toBe(12);
  });
  it('points its nose along -z', () => {
    let noseWidth = 0;
    for (let v = 0; v < body.position.length / 3; v++) {
      if (body.position[v * 3 + 2]! < -2) noseWidth = Math.max(noseWidth, Math.abs(body.position[v * 3]!));
    }
    expect(noseWidth).toBeLessThan(0.3);
  });
});

describe('look definitions', () => {
  it('keeps every prop tint on a palette slot the plan names', () => {
    for (const d of [...ARCHETYPE_DEFS, ...ITEM_DEFS]) for (const t of d.tints) expect([2, 3, 5, 6]).toContain(t);
  });
});
