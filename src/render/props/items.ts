// The six playable objects, plus the fence's additive beam. Pure, no three. GATE, SPIKE, DRONE and TRAFFIC are authored to fit
// radius 1 in (x, y) and scaled by the record's radius, so what you see is what hits you. SHARD draws at a fixed half-size (S-10).
// FENCE is laid out in the shader from its record, so its mesh holds layout coordinates rather than a shape.
import { ItemKind, PLAY_Y_MAX } from '../../contracts/index';
import { MeshBuilder, type V3 } from './builders';
import { Look, Motion, type MeshDef } from './archetypes';
import { bipyramid, loft, rectRing } from './shapes';

const TAU = 2 * Math.PI;
export const SHARD_HALF = 1.2;

function buildShard(b: MeshBuilder): void {
  bipyramid(b, [0, 0, 0], SHARD_HALF, SHARD_HALF, 4, { part: 0 });
}

function buildGate(b: MeshBuilder): void {
  // An octagon, unit inner radius across flats, so a ship's centre within radius threads it. 8 segments of 2 quads each:
  // a front band and an inner band. 32 tris, under section 6.5's 64. It floats: DI-118 removed the two legs to the floor,
  // the operator's one fix at T11's review (Q3).
  const n = 8;
  const inner = 1 / Math.cos(Math.PI / n);
  const outer = inner * 1.14;
  const depth = 0.16;
  const at = (r: number, i: number, z: number): V3 => {
    const a = Math.PI / n + (TAU * i) / n;
    return [r * Math.cos(a), r * Math.sin(a), z];
  };
  for (let i = 0; i < n; i++) {
    // Front, facing +z. uv.x runs along the segment, uv.y from the opening out.
    b.panel(at(inner, i, 0), at(outer, i, 0), at(outer, i + 1, 0), at(inner, i + 1, 0), {
      part: 0, edges: 15, uv: [[-0.5, 0], [-0.5, 1], [0.5, 1], [0.5, 0]],
    });
    // Inner band, seen as you approach.
    b.panel(at(inner, i, -depth), at(inner, i, 0), at(inner, i + 1, 0), at(inner, i + 1, -depth), { part: 1, edges: 10 });
  }
}

function buildSpike(b: MeshBuilder): void {
  // Five spires, 4 tris each, rooted on the floor. Base vertices (param 1) are pinned to y = 0, tips reach y + radius at most.
  const spires: readonly (readonly [number, number, number, number])[] = [
    // x, z, half width, tip y
    [0, 0, 0.3, 1],
    [0.5, 0.18, 0.2, 0.42],
    [-0.46, 0.14, 0.22, 0.58],
    [0.2, -0.45, 0.17, 0.2],
    [-0.2, 0.46, 0.15, 0.05],
  ];
  for (const [x, z, h, tipY] of spires) {
    const base = rectRing(x, -1, z, h, h);
    const tip: V3 = [x, tipY, z];
    for (let i = 0; i < 4; i++) {
      b.tri(base[i]!, base[(i + 1) % 4]!, tip, { part: 0, edges: 7, param: [1, 1, 0] });
    }
  }
}

function buildFencePosts(b: MeshBuilder): void {
  // Layout coordinates: x is an offset from the post in u, y absolute, part says which post. Two posts, 2 tris each.
  const top = PLAY_Y_MAX + 1;
  const w = 0.45;
  b.panel([-w, 0, 0], [w, 0, 0], [w, top, 0], [-w, top, 0], { part: 0, edges: 15 });
  b.panel([-w, 0, 0], [w, 0, 0], [w, top, 0], [-w, top, 0], { part: 1, edges: 15 });
}

function buildFenceBeam(b: MeshBuilder): void {
  // Layout coordinates: x in [0, 1] from post to gap edge, y absolute. Two quads, 4 tris, one each side of the gap.
  const top = PLAY_Y_MAX + 1;
  b.panel([0, 0, 0], [1, 0, 0], [1, top, 0], [0, top, 0], { part: 2, edges: 0 });
  b.panel([0, 0, 0], [1, 0, 0], [1, top, 0], [0, top, 0], { part: 3, edges: 0 });
}

function buildDrone(b: MeshBuilder): void {
  // A small hovering wedge with a red eye, facing the approaching camera. Fits radius 1.
  const stations: readonly (readonly [number, number, number, number])[] = [
    // z, half width, half height, y
    [-0.8, 0.14, 0.06, 0.08],
    [0.1, 0.56, 0.2, 0.03],
    [0.62, 0.42, 0.14, -0.02],
  ];
  const rings = stations.map(([z, hw, hh, y]): V3[] => {
    const out: V3[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (TAU * i) / 6 + Math.PI / 6;
      out.push([hw * Math.cos(a), y + hh * Math.sin(a), z]);
    }
    return out;
  });
  // Rings run along +z with their winding seen from +z, so this loft faces outward.
  loft(b, rings, { mask: (band) => (band === 0 ? 9 : 1), part: 0, arcUv: false });
  // Closed nose and tail, 6 tris each.
  const nose: V3 = [0, 0.08, -1];
  const front = rings[0]!;
  for (let i = 0; i < 6; i++) b.tri(front[(i + 1) % 6]!, front[i]!, nose, { part: 0, edges: 0 });
  const tail = rings[2]!;
  const faceC: V3 = [0, -0.02, 0.66];
  for (let i = 0; i < 6; i++) b.tri(tail[i]!, tail[(i + 1) % 6]!, faceC, { part: 0, edges: 1 });
  // Swept wings, drooping, a top fin and a chin: what makes it a wedge rather than a lozenge. 12 tris.
  for (const s of [-1, 1]) {
    const root: V3 = [s * 0.5, 0.05, 0.28];
    const rootB: V3 = [s * 0.3, 0.1, -0.35];
    const tip: V3 = [s * 0.98, -0.26, 0.42];
    b.tri(s > 0 ? root : rootB, s > 0 ? rootB : root, tip, { part: 0, edges: 7 });
    b.tri(s > 0 ? rootB : root, s > 0 ? root : rootB, [s * 0.5, -0.1, 0.25], { part: 0, edges: 0 });
  }
  b.tri([0, 0.2, 0.3], [0, 0.24, -0.25], [0, 0.72, 0.42], { part: 2, edges: 7 });
  b.tri([0, 0.24, -0.25], [0, 0.2, 0.3], [0, 0.72, 0.42], { part: 2, edges: 7 });
  b.tri([0.14, -0.14, 0.4], [-0.14, -0.14, 0.4], [0, -0.52, 0.46], { part: 2, edges: 7 });
  b.tri([-0.14, -0.14, 0.4], [0.14, -0.14, 0.4], [0, -0.52, 0.46], { part: 2, edges: 0 });
  // The red eye, a small fan standing proud of the face. Built last, so with no depth buffer it still paints on top.
  const eyeC: V3 = [0, -0.02, 0.74];
  const eye: V3[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (TAU * i) / 6;
    eye.push([0.2 * Math.cos(a), -0.02 + 0.14 * Math.sin(a), 0.7]);
  }
  for (let i = 0; i < 6; i++) b.tri(eye[i]!, eye[(i + 1) % 6]!, eyeC, { part: 1, edges: 0 });
}

function buildTraffic(b: MeshBuilder): void {
  // A low hover wedge seen from behind: rear at +z. Fits radius 1 in (x, y), about 3.4 radii long. The fin reaches y = 1,
  // so the drawn top is T01's 5.5 u at radius 3 and y 2.5.
  const hw = 0.84;
  const rear = 1.7;
  const nose = -1.7;
  const y0 = -0.5;
  const y1 = 0.22;
  const nw = 0.42;
  const bl: V3 = [-hw, y0, rear];
  const br: V3 = [hw, y0, rear];
  const tl: V3 = [-hw * 0.82, y1, rear];
  const tr: V3 = [hw * 0.82, y1, rear];
  const fl: V3 = [-nw, y0 + 0.1, nose];
  const fr: V3 = [nw, y0 + 0.1, nose];
  const ftl: V3 = [-nw * 0.8, y0 + 0.3, nose];
  const ftr: V3 = [nw * 0.8, y0 + 0.3, nose];
  const roofL: V3 = [-hw * 0.5, y1 + 0.2, rear * 0.1];
  const roofR: V3 = [hw * 0.5, y1 + 0.2, rear * 0.1];
  // Rear face, the plate the taillights sit on: 2 tris, with part 1 strips over it.
  b.panel(bl, br, tr, tl, { part: 0, edges: 15 });
  // Bottom, flanks, deck and nose.
  b.panel(fl, fr, br, bl, { part: 0, edges: 0 });
  b.panel(br, fr, ftr, tr, { part: 0, edges: 3 });
  b.panel(fl, bl, tl, ftl, { part: 0, edges: 3 });
  // Roof wedge, rising to the cabin and falling away.
  b.panel(tl, tr, roofR, roofL, { part: 0, edges: 15 });
  b.panel(roofL, roofR, ftr, ftl, { part: 0, edges: 15 });
  b.tri(tr, ftr, roofR, { part: 0, edges: 5 });
  b.tri(tl, roofL, ftl, { part: 0, edges: 5 });
  b.panel(ftl, ftr, fr, fl, { part: 0, edges: 1 });
  // Rear fin up to the top of the circle, 2 tris per side.
  const finY = 1;
  const fz0 = rear * 0.86;
  const fz1 = rear * 0.28;
  // A blade, tapering toward its tip, so from behind it reads as a fin and not a handle.
  const fh = 0.1;
  const tipH = 0.018;
  b.panel([fh, y1 + 0.02, fz0], [fh, y1 + 0.1, fz1], [tipH, finY, fz0 + 0.05], [tipH, finY, fz0 + 0.2], { part: 2, edges: 15 });
  b.panel([-fh, y1 + 0.1, fz1], [-fh, y1 + 0.02, fz0], [-tipH, finY, fz0 + 0.2], [-tipH, finY, fz0 + 0.05], { part: 2, edges: 15 });
  // The fin's trailing edge, the part seen from behind.
  b.panel([-fh, y1 + 0.02, fz0], [fh, y1 + 0.02, fz0], [tipH, finY, fz0 + 0.2], [-tipH, finY, fz0 + 0.2], { part: 2, edges: 15 });
  // A thin hover skirt under the rear edge, so the lower edge reads as floating.
  b.panel([-hw * 0.96, y0 - 0.12, rear], [hw * 0.96, y0 - 0.12, rear], br, bl, { part: 3, edges: 1 });
  // Wide taillights, standing just proud of the rear face. Built last, so with no depth buffer they still paint on top.
  const lz = rear + 0.015;
  b.panel([-hw * 0.92, y1 - 0.34, lz], [-0.12, y1 - 0.34, lz], [-0.12, y1 - 0.14, lz], [-hw * 0.86, y1 - 0.14, lz], { part: 1, edges: 0 });
  b.panel([0.12, y1 - 0.34, lz], [hw * 0.92, y1 - 0.34, lz], [hw * 0.86, y1 - 0.14, lz], [0.12, y1 - 0.14, lz], { part: 1, edges: 0 });
}

const NOT_GROUNDED = false;

export const ITEM_DEFS: readonly MeshDef[] = [
  {
    id: 20 + ItemKind.SHARD, name: 'SHARD', build: buildShard, look: Look.SHARD, motion: Motion.SHARD, tints: [6, 6, 6],
    bodyL: 1, edgeL: 2.4, edgeW: 0.05, yaw: false, grounded: NOT_GROUNDED,
  },
  {
    id: 20 + ItemKind.GATE, name: 'GATE', build: buildGate, look: Look.GATE, motion: Motion.GATE, tints: [3, 3, 3],
    bodyL: 1, edgeL: 2.0, edgeW: 0.012, yaw: false, grounded: NOT_GROUNDED,
  },
  {
    id: 20 + ItemKind.SPIKE, name: 'SPIKE', build: buildSpike, look: Look.SPIKE, motion: Motion.SPIKE, tints: [6, 6, 6],
    bodyL: 1, edgeL: 2.0, edgeW: 0.02, yaw: false, grounded: NOT_GROUNDED,
  },
  {
    id: 20 + ItemKind.FENCE, name: 'FENCE', build: buildFencePosts, look: Look.FENCE, motion: Motion.FENCE, tints: [6, 6, 6],
    bodyL: 1, edgeL: 2.0, edgeW: 0.06, yaw: false, grounded: NOT_GROUNDED,
    buildBeam: buildFenceBeam,
    // T11 r12: the wall's lines at L .9, under bloom's knee (threshold .95, smoothing .25), so a fence no longer hazes the mid frame
    // pink (M9 review, J5); was 1.05. The gap's verticals keep L 1.5 and their bloom: they are what the player steers by.
    beam: { look: Look.FENCE_BEAM, motion: Motion.FENCE, tints: [6, 6, 6], bodyL: 0, edgeL: 0.9, edgeW: 0, yaw: false, grounded: NOT_GROUNDED },
  },
  {
    id: 20 + ItemKind.DRONE, name: 'DRONE', build: buildDrone, look: Look.DRONE, motion: Motion.DRONE, tints: [6, 5, 6],
    bodyL: 1, edgeL: 1.8, edgeW: 0.02, yaw: false, grounded: NOT_GROUNDED,
  },
  {
    id: 20 + ItemKind.TRAFFIC, name: 'TRAFFIC', build: buildTraffic, look: Look.TRAFFIC, motion: Motion.TRAFFIC, tints: [6, 5, 3],
    bodyL: 1, edgeL: 1.7, edgeW: 0.02, yaw: false, grounded: NOT_GROUNDED,
  },
];
