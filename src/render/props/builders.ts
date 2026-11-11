// MeshBuilder: the only way geometry is made here. Stock primitives are banned (section 6.5). Pure, no three.
// aEdge holds, per vertex, the distance in u to up to four edge lines. Distance to a line is affine on a plane, so it
// interpolates exactly over any planar quad or triangle. Edges not in the mask, and all edges on a root face, get the sentinel.

export type V3 = readonly [number, number, number];
export interface FaceOpts {
  /** Bitmask over the face's edges, default all. tri: ab, bc, ca. panel: ab, bc, cd, da. */
  edges?: number;
  part?: number;
  /** One value for the face, or one per vertex. */
  param?: number | readonly number[];
  /** Below ground: carries no lines, because it would show through the floor's alpha as a false reflection. */
  root?: boolean;
  /** Per-vertex override of the default in-plane uv, in u. */
  uv?: readonly (readonly [number, number])[];
}
export interface BuiltMesh {
  readonly position: Float32Array;
  readonly edge: Float32Array;
  readonly uv: Float32Array;
  readonly tag: Float32Array;
  readonly index: Uint16Array;
  readonly tris: number;
  readonly bbox: { readonly min: V3; readonly max: V3 };
}

export const EDGE_SENTINEL = 1000;

export function sub(a: V3, b: V3): V3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
export function add(a: V3, b: V3): V3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
export function scale3(a: V3, k: number): V3 { return [a[0] * k, a[1] * k, a[2] * k]; }
export function dot(a: V3, b: V3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function len(a: V3): number { return Math.hypot(a[0], a[1], a[2]); }
export function norm(a: V3): V3 {
  const l = len(a);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}
export function mix3(a: V3, b: V3, t: number): V3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Distance in u from p to the line through a and b. */
export function distToLine(p: V3, a: V3, b: V3): number {
  const d = sub(b, a);
  const l = len(d);
  if (l === 0) return len(sub(p, a));
  return len(cross(sub(p, a), d)) / l;
}

function paramAt(o: FaceOpts | undefined, i: number): number {
  const p = o?.param;
  if (p === undefined) return 0;
  return typeof p === 'number' ? p : (p[i] ?? 0);
}

export class MeshBuilder {
  private readonly pos: number[] = [];
  private readonly edge: number[] = [];
  private readonly uv: number[] = [];
  private readonly tag: number[] = [];
  private readonly idx: number[] = [];

  /** Counter-clockwise seen from outside. */
  tri(a: V3, b: V3, c: V3, o?: FaceOpts): void {
    const mask = o?.root ? 0 : (o?.edges ?? 7);
    const verts = [a, b, c];
    const lines: readonly (readonly [V3, V3])[] = [[a, b], [b, c], [c, a]];
    this.emit(verts, lines, mask, o);
    const base = this.pos.length / 3 - 3;
    this.idx.push(base, base + 1, base + 2);
  }

  /** Planar quad, counter-clockwise seen from outside. */
  panel(a: V3, b: V3, c: V3, d: V3, o?: FaceOpts): void {
    const mask = o?.root ? 0 : (o?.edges ?? 15);
    const verts = [a, b, c, d];
    const lines: readonly (readonly [V3, V3])[] = [[a, b], [b, c], [c, d], [d, a]];
    this.emit(verts, lines, mask, o);
    const base = this.pos.length / 3 - 4;
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  private emit(verts: readonly V3[], lines: readonly (readonly [V3, V3])[], mask: number, o: FaceOpts | undefined): void {
    const a = verts[0]!;
    const u = norm(sub(verts[1]!, a));
    const n = norm(cross(sub(verts[1]!, a), sub(verts[2]!, a)));
    const v = cross(n, u);
    for (let i = 0; i < verts.length; i++) {
      const p = verts[i]!;
      this.pos.push(p[0], p[1], p[2]);
      for (let e = 0; e < 4; e++) {
        const line = lines[e];
        if (line && (mask & (1 << e)) !== 0) this.edge.push(distToLine(p, line[0], line[1]));
        else this.edge.push(EDGE_SENTINEL);
      }
      const given = o?.uv?.[i];
      if (given) this.uv.push(given[0], given[1]);
      else {
        const r = sub(p, a);
        this.uv.push(dot(r, u), dot(r, v));
      }
      this.tag.push(o?.part ?? 0, paramAt(o, i));
    }
  }

  get triangleCount(): number {
    return this.idx.length / 3;
  }

  finish(): BuiltMesh {
    const n = this.pos.length / 3;
    if (n > 65535) throw new RangeError(`mesh has ${n} vertices, over Uint16`);
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) {
        const v = this.pos[i * 3 + k]!;
        if (v < min[k]!) min[k] = v;
        if (v > max[k]!) max[k] = v;
      }
    }
    return {
      position: Float32Array.from(this.pos),
      edge: Float32Array.from(this.edge),
      uv: Float32Array.from(this.uv),
      tag: Float32Array.from(this.tag),
      index: Uint16Array.from(this.idx),
      tris: this.idx.length / 3,
      bbox: { min, max },
    };
  }
}

/** A centred unit box, the placeholder of M2. */
export function buildUnitBox(): BuiltMesh {
  const b = new MeshBuilder();
  const h = 0.5;
  const c: V3[] = [
    [-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h],
    [-h, -h, -h], [h, -h, -h], [h, h, -h], [-h, h, -h],
  ];
  const at = (i: number): V3 => c[i]!;
  b.panel(at(0), at(1), at(2), at(3));   // +z
  b.panel(at(5), at(4), at(7), at(6));   // -z
  b.panel(at(1), at(5), at(6), at(2));   // +x
  b.panel(at(4), at(0), at(3), at(7));   // -x
  b.panel(at(3), at(2), at(6), at(7));   // +y
  b.panel(at(4), at(5), at(1), at(0));   // -y
  return b.finish();
}
