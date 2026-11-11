// The scene audit of section 9.3, the finite checks, the non-flat check and the biome search. info.memory covers only
// geometries and textures, so this walks the scene for what could actually grow. three types only.
import type { BufferAttribute, BufferGeometry, InterleavedBufferAttribute, Material, Mesh, Object3D, Texture } from 'three';
import { CHUNK_LEN, CHUNK_LIMIT, VALLEY_HALF, ZONE_CHUNKS, type HarnessHost, type RenderContext, type WorldSource } from '../contracts/index';
import { createZoneState } from '../core/alloc';

export interface Audit {
  objects: number; meshes: number;
  /** Bytes of every distinct geometry attribute, instanced ones included. */
  attributeBytes: number;
  /** Bytes of instanced attributes and instance matrices, the part of attributeBytes that section 9.3 limits. */
  instanceBytes: number;
  dataTextureBytes: number;
  /** Update ranges waiting on visible meshes. Must read 0 after a render. */
  pendingVisible: number;
  /** The largest count waiting on any one attribute or texture of a hidden mesh. */
  pendingHiddenMax: number;
}

interface Ranged { updateRanges?: readonly unknown[] }
type AnyAttribute = BufferAttribute | InterleavedBufferAttribute;

function attributeBytes(a: AnyAttribute): number {
  if ('isInterleavedBufferAttribute' in a && a.isInterleavedBufferAttribute) return a.data.array.byteLength;
  return (a as BufferAttribute).array.byteLength;
}

function isInstanced(a: AnyAttribute): boolean {
  if ('isInterleavedBufferAttribute' in a && a.isInterleavedBufferAttribute) {
    return (a.data as unknown as { isInstancedInterleavedBuffer?: boolean }).isInstancedInterleavedBuffer === true;
  }
  return (a as unknown as { isInstancedBufferAttribute?: boolean }).isInstancedBufferAttribute === true;
}

function pending(o: Ranged): number {
  return o.updateRanges?.length ?? 0;
}

function dataTexturesOf(material: Material | Material[]): Texture[] {
  const out: Texture[] = [];
  const list = Array.isArray(material) ? material : [material];
  for (const m of list) {
    const uniforms = (m as unknown as { uniforms?: Record<string, { value: unknown }> }).uniforms;
    if (!uniforms) continue;
    for (const name of Object.keys(uniforms)) {
      const value = uniforms[name]?.value as { isDataTexture?: boolean } | null | undefined;
      if (value && value.isDataTexture === true) out.push(value as unknown as Texture);
    }
  }
  return out;
}

export function auditScene(scene: Object3D): Audit {
  const out: Audit = { objects: 0, meshes: 0, attributeBytes: 0, instanceBytes: 0, dataTextureBytes: 0, pendingVisible: 0, pendingHiddenMax: 0 };
  const seen = new Set<unknown>();

  function walk(o: Object3D, visible: boolean): void {
    out.objects++;
    const shown = visible && o.visible;
    const mesh = o as Mesh & { isMesh?: boolean; instanceMatrix?: AnyAttribute; instanceColor?: AnyAttribute | null };
    if (mesh.isMesh === true) {
      out.meshes++;
      visitMesh(mesh, shown);
    }
    for (const child of o.children) walk(child, shown);
  }

  function note(count: number, shown: boolean): void {
    if (shown) out.pendingVisible += count;
    else if (count > out.pendingHiddenMax) out.pendingHiddenMax = count;
  }

  function visitAttribute(a: AnyAttribute, shown: boolean, forcedInstance: boolean): void {
    note(pending(a as Ranged), shown);
    if (seen.has(a)) return;
    seen.add(a);
    const bytes = attributeBytes(a);
    out.attributeBytes += bytes;
    if (forcedInstance || isInstanced(a)) out.instanceBytes += bytes;
  }

  function visitGeometry(g: BufferGeometry, shown: boolean): void {
    for (const name of Object.keys(g.attributes)) visitAttribute(g.attributes[name] as AnyAttribute, shown, false);
    if (g.index) visitAttribute(g.index, shown, false);
  }

  function visitMesh(mesh: Mesh & { instanceMatrix?: AnyAttribute; instanceColor?: AnyAttribute | null }, shown: boolean): void {
    visitGeometry(mesh.geometry, shown);
    if (mesh.instanceMatrix) visitAttribute(mesh.instanceMatrix, shown, true);
    if (mesh.instanceColor) visitAttribute(mesh.instanceColor, shown, true);
    for (const t of dataTexturesOf(mesh.material)) {
      note(pending(t as unknown as Ranged), shown);
      if (seen.has(t)) continue;
      seen.add(t);
      const data = (t.image as { data?: { byteLength?: number } } | null)?.data;
      out.dataTextureBytes += data?.byteLength ?? 0;
    }
  }

  walk(scene, true);
  return out;
}

export interface FiniteReport { ok: boolean; bad: string[] }

function checkArray(name: string, values: ArrayLike<number>, bad: string[]): void {
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i]!)) {
      bad.push(`${name}[${i}]=${values[i]}`);
      return;
    }
  }
}

/** SimState numbers, shared uniforms and camera matrices. A NaN anywhere here would blank or tear the frame silently. */
export function finiteReport(host: HarnessHost): FiniteReport {
  const bad: string[] = [];
  const s = host.sim.state as unknown as Record<string, unknown>;
  for (const name of Object.keys(s)) {
    const v = s[name];
    if (typeof v === 'number' && !Number.isFinite(v)) bad.push(`sim.${name}=${v}`);
  }
  const { travel } = host.sim.state;
  if (!Number.isFinite(travel.chunk) || !Number.isFinite(travel.local)) bad.push(`sim.travel=${travel.chunk},${travel.local}`);
  const shared = host.ctx.shared as unknown as Record<string, { value: number | ArrayLike<number> }>;
  for (const name of Object.keys(shared)) {
    const v = shared[name]!.value;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) bad.push(`${name}=${v}`);
    } else {
      checkArray(name, v, bad);
    }
  }
  const { camera } = host.ctx as RenderContext;
  checkArray('camera.projectionMatrix', camera.projectionMatrix.elements, bad);
  checkArray('camera.matrixWorld', camera.matrixWorld.elements, bad);
  checkArray('camera.matrixWorldInverse', camera.matrixWorldInverse.elements, bad);
  return { ok: bad.length === 0, bad };
}

export interface NonFlat { std: number; meanStep: number }

const NON_FLAT_ROWS = 8;
const NON_FLAT_STEP = 16;
const NON_FLAT_COLS = 120;

/**
 * Samples true height beside the valley, across a few rows of this chunk. Proves integration only: T01's per-octave
 * test is the real guard. A whole row at a time, since T01 memoises one row.
 */
export function nonFlat(world: WorldSource, chunk: number): NonFlat {
  let sum = 0;
  let sq = 0;
  let steps = 0;
  let stepSum = 0;
  let n = 0;
  for (let r = 0; r < NON_FLAT_ROWS; r++) {
    let prev = Number.NaN;
    for (let c = 0; c < NON_FLAT_COLS; c++) {
      const x = VALLEY_HALF + NON_FLAT_STEP * (c + 1);
      const h = world.height(x, chunk + r, CHUNK_LEN, 0);
      sum += h;
      sq += h * h;
      n++;
      if (c > 0) {
        stepSum += Math.abs(h - prev);
        steps++;
      }
      prev = h;
    }
  }
  const mean = sum / n;
  return { std: Math.sqrt(Math.max(0, sq / n - mean * mean)), meanStep: stepSum / steps };
}

const BIOME_SEARCH_ZONES = 4096;

/** Five chunks into the first zone at or after fromChunk whose biomeA is biome with biomeMix 0, or -1. */
export function findBiomeChunk(world: WorldSource, biome: number, fromChunk: number): number {
  const zone = createZoneState();
  const at = { chunk: 0, local: 0 };
  const first = Math.ceil(fromChunk / ZONE_CHUNKS);
  for (let i = 0; i < BIOME_SEARCH_ZONES; i++) {
    const c = (first + i) * ZONE_CHUNKS + 5;
    if (c >= CHUNK_LIMIT) return -1;
    at.chunk = c;
    world.zoneAt(at, zone);
    if (zone.biomeA === biome && zone.biomeMix === 0) return c;
  }
  return -1;
}
