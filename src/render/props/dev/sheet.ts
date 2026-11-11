// The contact sheets. Each tile is composed in the same task as its render, because a later drawImage yields black
// [O: 251,933 lit tile pixels in the same task, 0 after a 100 ms timeout]. The spec writes the PNG from toDataURL.
import {
  ARCHETYPE_COUNT, ARCHETYPE_SPEC, Archetype, CAMERA_PITCH, CAMERA_Y, ItemKind, ITEM_KIND_COUNT, ITEM_SPEC, PLAY_Y_MAX, SHIP_FORWARD,
  type Travel, type WorldSource,
} from '../../../contracts/index';
import { hash01 } from '../../../core/hash';
import { ARCHETYPE_DEFS } from '../archetypes';
import { MeshBuilder } from '../builders';
import { ITEM_DEFS } from '../items';
import type { PropsDebug } from '../layer';
import { buildShipBody } from '../ship';
import { BIOME_SETS } from './biomeSets';
import { contractChroma, contractNearWhite, meanChroma, nearWhiteFraction, pairScores, silhouetteMask, type PairScore } from './metrics';
import type { Selection, SheetWorld } from './sheetWorld';
import type { BackdropControls, BootDeps, ShellLike } from './types';

export interface SheetApi {
  render(kind: 'close' | 'far' | 'silhouette' | 'road', o?: { palette?: number; yaw?: number; shuffle?: number }): { tiles: number; key: string[] };
  png(): string;                     // canvas.toDataURL, written to disk by the spec
  masks(): Uint8Array[];             // per-tile 64x64 aspect-preserving silhouette masks
  oneShot(id: number, o: { scale: number }): string;   // 1280x720 of one object, for closer judging
  /** Beyond the plan's list: the names in tile order, the pair scores, and a road frame with its washout numbers. */
  names(): string[];
  pairs(top: number): { a: string; b: string; iou: number }[];
  maxIou(): number;
  litCounts(): number[];
  roadFrame(biome: number, palette: number, withProps: boolean): { png: string; nearWhite: number; chroma: number; contractNearWhite: number; contractChroma: number; calls: number; triangles: number };
  ringFrame(distance: number): string;
}

const TILE_W = 320;
const TILE_H = 180;
const COLS = 6;
const ROWS = 5;
const HALF_TAN = Math.tan((29 * Math.PI) / 180);
const AT: Travel = { chunk: 1000, local: 0 };
const TICK = 240;
/** Lateral bands for the far tile: where the object usually stands. */
const SMALL = new Set<number>([Archetype.PALM, Archetype.REFLECTOR, Archetype.CHEVRON, Archetype.CACTUS, Archetype.TOTEM, Archetype.COLONNADE, Archetype.BILLBOARD]);

interface Extent { top: number; bottom: number; width: number }

interface Tile {
  name: string;
  source: 'prop' | 'item' | 'ship';
  kind: number;
  ext: Extent;
  maxDist: number;
}

function extentOf(build: (b: MeshBuilder) => void, widthAlongZ = true): Extent {
  const b = new MeshBuilder();
  build(b);
  const m = b.finish();
  const dx = m.bbox.max[0] - m.bbox.min[0];
  const dz = m.bbox.max[2] - m.bbox.min[2];
  return { top: m.bbox.max[1], bottom: m.bbox.min[1], width: widthAlongZ ? Math.max(dx, dz) : dx };
}

function allTiles(): Tile[] {
  const out: Tile[] = [];
  for (let a = 0; a < ARCHETYPE_COUNT; a++) {
    const def = ARCHETYPE_DEFS[a]!;
    // A pylon's wires run 64 u back along z, and a searchlight's cone leans, so neither frames by its bounding box.
    const ext = extentOf(def.build, a !== Archetype.PYLON);
    if (a === Archetype.SEARCHLIGHT) ext.width = 40;
    out.push({ name: def.name, source: 'prop', kind: a, ext, maxDist: ARCHETYPE_SPEC[a]!.maxDist });
  }
  for (let k = 0; k < ITEM_KIND_COUNT; k++) {
    const def = ITEM_DEFS[k]!;
    out.push({ name: def.name, source: 'item', kind: k, ext: extentOf(def.build), maxDist: ITEM_SPEC[k]!.maxDist });
  }
  const ship = buildShipBody();
  out.push({
    name: 'SHIP', source: 'ship', kind: 0,
    ext: { top: ship.bbox.max[1], bottom: ship.bbox.min[1], width: ship.bbox.max[0] - ship.bbox.min[0] },
    maxDist: 100,
  });
  return out;
}

/** A record's scale at a tile, in u per mesh unit, and the extents after it. */
function itemRadius(kind: number): number {
  if (kind === ItemKind.SHARD) return 1;
  if (kind === ItemKind.GATE) return 9;
  if (kind === ItemKind.SPIKE) return 3.5;
  if (kind === ItemKind.DRONE) return 2.5;
  if (kind === ItemKind.TRAFFIC) return 3;
  return 1;
}

export function createSheet(
  deps: BootDeps,
  shell: ShellLike,
  debug: PropsDebug,
  backdrop: BackdropControls,
  world: SheetWorld,
  placeholder: boolean,
): SheetApi {
  const tiles = allTiles();
  const canvas = document.createElement('canvas');
  canvas.width = TILE_W * COLS;
  canvas.height = TILE_H * ROWS;
  const ctx2d = canvas.getContext('2d')!;
  const masks: Uint8Array[] = [];
  const lit: number[] = [];

  function selectionFor(t: Tile, distance: number, x: number, y: number, yaw: number, scale: number): Selection | null {
    if (t.source === 'ship') return null;
    const place: Selection['place'] = { at: AT, distance, x, y, yaw, scale, tintSeed: 0.1, variant: 0.75 };
    if (t.source === 'item') {
      place.seed = 0.1;
      place.radius = t.kind === ItemKind.SHARD ? 2.5 : (scale > 1 ? scale : itemRadius(t.kind));
      if (t.kind === ItemKind.FENCE) {
        place.radius = 42;
        place.a = x + 8;
        place.b = 12;
      }
      if (t.kind === ItemKind.TRAFFIC) {
        // A car at the start of its run, solid, seen from behind.
        place.a = 0;
        place.b = 0;
        place.seed = 0.5;
      }
      if (t.kind === ItemKind.DRONE) {
        place.a = 0;
        place.b = 1;
      }
    }
    return { source: t.source, kind: t.kind, place };
  }

  /** The close framing: at distance D, with the object's middle on the view axis. */
  function renderClose(t: Tile, yaw: number, palette: number): void {
    let scale = 1;
    let height = t.ext.top - t.ext.bottom;
    let width = t.ext.width;
    if (t.source === 'item') {
      scale = t.kind === ItemKind.FENCE ? 1 : itemRadius(t.kind);
      height *= scale;
      width *= scale;
      if (t.kind === ItemKind.FENCE) {
        height = PLAY_Y_MAX + 1;
        width = 84;
      }
    }
    if (placeholder) {
      // Every box the same relative size, so only identical shapes are compared.
      scale = Math.max(height, width);
      height = scale;
      width = scale;
    }
    const radius = Math.max(height, width) / 2;
    // A shard and a drone shrink past the ship plane, on purpose, so their tiles stay beyond it.
    const nearLimit = t.source === 'item' && (t.kind === ItemKind.SHARD || t.kind === ItemKind.DRONE) ? 14 : 0;
    const D = Math.max(Math.max(height, width) / (2 * HALF_TAN * 0.72), radius + 2, nearLimit);
    const axisY = CAMERA_Y + D * Math.tan(CAMERA_PITCH);
    // Yaw fits a road-facing front, and items ignore it.
    const useYaw = t.source === 'prop' && t.kind !== Archetype.RING ? yaw : 0;
    if (t.source === 'ship') {
      world.select(null);
      debug.setShipVisible(true);
      debug.setShipForward(D + 2.2);
      shell.rebuild();
      shell.frameAt(0, { at: AT, tick: TICK, palette, bend: { a: 0, c: 0 }, sim: { x: 0, prevX: 0, y: axisY, prevY: axisY }, camX: 0, camY: CAMERA_Y });
      debug.setShipVisible(false);
      debug.setShipForward(SHIP_FORWARD);
      return;
    }
    let y: number;
    if (placeholder) y = axisY;
    else if (t.source === 'item' && t.kind === ItemKind.FENCE) y = 8;
    else {
      const mid = ((t.ext.top + t.ext.bottom) / 2) * scale;
      y = axisY - mid;
    }
    // Grounded objects sit at their ground line in a tile, because the floor is hidden and the root collapses.
    if (!placeholder && t.source === 'prop' && !ARCHETYPE_SPEC[t.kind]!.floats) {
      const top = t.ext.top;
      y = axisY - top / 2;
      const h2 = top;
      const d2 = Math.max(Math.max(h2, width) / (2 * HALF_TAN * 0.72), Math.max(h2, width) / 2 + 2);
      const ax2 = CAMERA_Y + d2 * Math.tan(CAMERA_PITCH);
      y = ax2 - top / 2;
      // A searchlight leans away from x = 0 and fades over the disc, so its tile stands it clear of the disc.
      const tileX = t.kind === Archetype.SEARCHLIGHT ? -0.36 * d2 : 0;
      world.select(selectionFor(t, d2, tileX, y, useYaw, 1));
      shell.rebuild();
      shell.frameAt(0, { at: AT, tick: TICK, palette, bend: { a: 0, c: 0 } });
      return;
    }
    world.select(selectionFor(t, D, 0, y, useYaw, scale));
    shell.rebuild();
    shell.frameAt(0, { at: AT, tick: TICK, palette, bend: { a: 0, c: 0 } });
  }

  function bandX(t: Tile): number {
    if (t.source === 'item') return t.kind === ItemKind.FENCE ? 0 : -9;
    if (t.kind === Archetype.RING) return 0;
    if (SMALL.has(t.kind)) return -58;
    if (t.kind === Archetype.PYLON) return -100;
    if (t.kind === Archetype.ORB) return -70;
    if (t.kind === Archetype.CRYSTAL) return -74;
    if (t.kind === Archetype.SAUCER) return -160;
    return -170;
  }

  /** The far framing: real placement, real floor and mirror, a native crop. Returns the pixel the object projects to. */
  function renderFar(t: Tile, palette: number, project: (x: number, y: number, z: number) => [number, number], base: WorldSource): [number, number] {
    if (t.source === 'ship') {
      world.select(null);
      debug.setShipVisible(true);
      shell.frameAt(0, { at: AT, tick: TICK, palette, bend: { a: 0, c: 0 }, sim: { x: 0, prevX: 0, y: 6, prevY: 6 }, camX: 0, camY: CAMERA_Y });
      shell.rebuild();
      shell.frameAt(0, { at: AT, tick: TICK, palette, bend: { a: 0, c: 0 }, sim: { x: 0, prevX: 0, y: 6, prevY: 6 }, camX: 0, camY: CAMERA_Y });
      debug.setShipVisible(false);
      return project(0, 6, -SHIP_FORWARD);
    }
    const x = bandX(t);
    const D = Math.min(0.55 * t.maxDist, 1500);
    let y: number;
    if (t.source === 'item') {
      y = t.kind === ItemKind.SPIKE ? 3.5 : t.kind === ItemKind.GATE ? 8 : t.kind === ItemKind.TRAFFIC ? 2.5 : 7;
    } else if (t.kind === Archetype.RING) {
      y = 65.14;
    } else {
      const ground = base.height(x, AT.chunk, 64, 0);
      if (ARCHETYPE_SPEC[t.kind]!.floats) {
        y = ground + (t.kind === Archetype.SAUCER ? 40 : t.kind === Archetype.ORB ? 6 : 8);
      } else {
        y = ground;
      }
    }
    const scale = t.source === 'item' ? (t.kind === ItemKind.FENCE ? 1 : itemRadius(t.kind)) : 1;
    world.select(selectionFor(t, D, x, y, 0, scale));
    shell.rebuild();
    shell.frameAt(0, { at: AT, tick: TICK, palette, bend: { a: 0, c: 0 } });
    const mid = t.source === 'prop' && !ARCHETYPE_SPEC[t.kind]!.floats ? t.ext.top / 2 : 0;
    return project(x, y + mid, -D);
  }

  function label(i: number, text: string, dark: boolean): void {
    const x = (i % COLS) * TILE_W;
    const y = Math.floor(i / COLS) * TILE_H;
    ctx2d.font = '12px monospace';
    ctx2d.fillStyle = dark ? 'rgba(0,0,0,.65)' : 'rgba(255,255,255,.85)';
    ctx2d.fillText(text, x + 4, y + TILE_H - 5);
  }

  function shuffled(seed: number): number[] {
    const order = tiles.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(hash01(seed, i, 7, 3) * (i + 1));
      const t = order[i]!;
      order[i] = order[j]!;
      order[j] = t;
    }
    return order;
  }

  const api: SheetApi = {
    render(kind, o = {}) {
      const palette = o.palette ?? 0;
      const yaw = o.yaw ?? 0.5;
      const renderer = shell.ctx.renderer;
      const gl = renderer.getContext();
      ctx2d.imageSmoothingEnabled = true;
      ctx2d.imageSmoothingQuality = 'high';
      ctx2d.fillStyle = kind === 'silhouette' ? '#ffffff' : '#000000';
      ctx2d.fillRect(0, 0, canvas.width, canvas.height);

      if (kind === 'road') {
        debug.setMirrorAllowed(true);
        world.useBaseRows(true);
        backdrop.setFloor(true);
        backdrop.setSky(true);
        canvas.width = 640 * 3;
        canvas.height = 360 * 2;
        for (let b = 0; b < BIOME_SETS.length; b++) {
          const set = BIOME_SETS[b]!;
          world.setBase(deps.createFakeWorld({ archetypes: set.archetypes, items: set.items }));
          const start = { chunk: 2000 + b * 200, local: 0 };
          world.useBaseRows(true);
          shell.frameAt(0, { at: start, tick: 0, palette });
          shell.rebuild();
          // 2 s of motion in, at 80 u/s and 60 fps.
          for (let f = 1; f <= 120; f++) {
            const dist = (f * 80) / 60;
            const rows = Math.floor(dist / 64);
            shell.frameAt(0, { at: { chunk: start.chunk + rows, local: dist - rows * 64 }, tick: f * 2, palette });
          }
          ctx2d.drawImage(renderer.domElement, 0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, (b % 3) * 640, Math.floor(b / 3) * 360, 640, 360);
          ctx2d.font = '14px monospace';
          ctx2d.fillStyle = 'rgba(255,255,255,.85)';
          ctx2d.fillText(set.name, (b % 3) * 640 + 6, Math.floor(b / 3) * 360 + 354);
        }
        world.useBaseRows(false);
        return { tiles: BIOME_SETS.length, key: BIOME_SETS.map((s) => s.name) };
      }

      canvas.width = TILE_W * COLS;
      canvas.height = TILE_H * ROWS;
      ctx2d.fillStyle = kind === 'silhouette' ? '#ffffff' : '#000000';
      ctx2d.fillRect(0, 0, canvas.width, canvas.height);
      const project = window.__props!.project;
      const base = window.__props!.world;
      const order = kind === 'silhouette' ? shuffled(o.shuffle ?? 1985) : tiles.map((_, i) => i);
      const key: string[] = [];
      masks.length = 0;
      lit.length = 0;
      for (let slot = 0; slot < order.length; slot++) {
        const id = order[slot]!;
        const t = tiles[id]!;
        key.push(t.name);
        const tx = (slot % COLS) * TILE_W;
        const ty = Math.floor(slot / COLS) * TILE_H;
        debug.setMirrorAllowed(kind === 'far');
        if (kind === 'close' || kind === 'silhouette') {
          backdrop.setFloor(false);
          backdrop.setSky(kind === 'close');
          renderClose(t, yaw, palette);
          ctx2d.drawImage(renderer.domElement, 0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, tx, ty, TILE_W, TILE_H);
          if (kind === 'silhouette') {
            const px = shell.pixels();
            masks[id] = silhouetteMask(px, gl.drawingBufferWidth, gl.drawingBufferHeight);
            let n = 0;
            for (let p = 0; p < px.length; p += 4) if (px[p]! < 128) n++;
            lit[id] = n;
          } else {
            const px = shell.pixels();
            lit[id] = px.length;
          }
        } else {
          backdrop.setFloor(true);
          backdrop.setSky(true);
          const [px, py] = renderFar(t, palette, project, base);
          const sx = Math.max(0, Math.min(gl.drawingBufferWidth - TILE_W, Math.round(px - TILE_W / 2)));
          const sy = Math.max(0, Math.min(gl.drawingBufferHeight - TILE_H, Math.round(py - TILE_H / 2)));
          ctx2d.drawImage(renderer.domElement, sx, sy, TILE_W, TILE_H, tx, ty, TILE_W, TILE_H);
        }
        if (kind !== 'silhouette') label(slot, t.name, false);
      }
      return { tiles: order.length, key };
    },
    png(): string {
      return canvas.toDataURL('image/png');
    },
    masks(): Uint8Array[] {
      return masks.slice();
    },
    oneShot(id: number, o: { scale: number }): string {
      const t = tiles[id]!;
      debug.setMirrorAllowed(false);
      backdrop.setFloor(false);
      backdrop.setSky(true);
      renderClose(t, 0.5, 0);
      const out = document.createElement('canvas');
      out.width = 1280;
      out.height = 720;
      const c = out.getContext('2d')!;
      const r = shell.ctx.renderer.domElement;
      c.imageSmoothingQuality = 'high';
      const sw = r.width / o.scale;
      const sh = r.height / o.scale;
      c.drawImage(r, (r.width - sw) / 2, (r.height - sh) / 2, sw, sh, 0, 0, 1280, 720);
      return out.toDataURL('image/png');
    },
    names: () => tiles.map((t) => t.name),
    pairs(top: number) {
      const scores: PairScore[] = pairScores(masks);
      return scores.slice(0, top).map((s) => ({ a: tiles[s.a]!.name, b: tiles[s.b]!.name, iou: s.iou }));
    },
    maxIou(): number {
      const scores: PairScore[] = pairScores(masks);
      return scores.length ? scores[0]!.iou : 0;
    },
    litCounts: () => lit.slice(),
    roadFrame(biome: number, palette: number, withProps: boolean) {
      const set = BIOME_SETS[biome]!;
      world.setBase(deps.createFakeWorld({ archetypes: set.archetypes, items: set.items }));
      world.useBaseRows(true);
      debug.setMirrorAllowed(true);
      backdrop.setFloor(true);
      backdrop.setSky(true);
      shell.setLayerVisible('props', withProps);
      const start = { chunk: 2000 + biome * 200, local: 0 };
      shell.frameAt(0, { at: start, tick: 0, palette });
      shell.rebuild();
      for (let f = 1; f <= 120; f++) {
        const dist = (f * 80) / 60;
        const rows = Math.floor(dist / 64);
        shell.frameAt(0, { at: { chunk: start.chunk + rows, local: dist - rows * 64 }, tick: f * 2, palette });
      }
      const st = shell.stats();
      const px = shell.pixels();
      const png = shell.ctx.renderer.domElement.toDataURL('image/png');
      const out = {
        png, nearWhite: nearWhiteFraction(px), chroma: meanChroma(px), contractNearWhite: contractNearWhite(px), contractChroma: contractChroma(px),
        calls: st.calls, triangles: st.triangles,
      };
      shell.setLayerVisible('props', true);
      world.useBaseRows(false);
      return out;
    },
    ringFrame(distance: number): string {
      debug.setMirrorAllowed(true);
      backdrop.setFloor(true);
      backdrop.setSky(true);
      const place: Selection['place'] = { at: AT, distance, x: 0, y: 65.14, yaw: 0, scale: 1, tintSeed: 0.1, variant: 0.5 };
      world.select({ source: 'prop', kind: Archetype.RING, place });
      shell.frameAt(0, { at: AT, tick: TICK, palette: 0, bend: { a: 0, c: 0 } });
      shell.rebuild();
      shell.frameAt(0, { at: AT, tick: TICK, palette: 0, bend: { a: 0, c: 0 } });
      return shell.ctx.renderer.domElement.toDataURL('image/png');
    },
  };
  return api;
}
