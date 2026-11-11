// dev/props.html's boot. Reads the query string and starts T00's shell, which dev/props.html hands in, so this folder imports no
// src/testing. Query beyond T00's: scene=road|worst|one|sheet|keepout, arch=<id,id>, items=none|<id,id>, naive=1, sil=1, placeholder=1,
// period=1024, ship=0, props=0, reachMinus=1, mprobe=1 (A15's mirror probe), biome set via set=<0..5> or the union set=<a>,<b>.
import { Vector3 } from 'three';
import type { WorldSource } from '../../../contracts/index';
import { createPropsLayer, type PropsDebug, type PropsLayerOptions } from '../layer';
import { RING_PLAN } from '../plan';
import { createBackdrop } from './backdrop';
import { BIOME_SETS } from './biomeSets';
import { createKeepoutWorld } from './keepoutWorld';
import * as metrics from './metrics';
import { createSheet } from './sheet';
import { createSheetWorld } from './sheetWorld';
import type { BootDeps } from './types';
import { createWorstCaseWorld } from './worstCaseWorld';

function ids(raw: string | null): number[] | undefined {
  if (raw === null) return undefined;
  if (raw === 'none' || raw === '') return [];
  return raw.split(',').map(Number).filter((n) => Number.isInteger(n) && n >= 0);
}

export function bootPropsDev(deps: BootDeps): void {
  const q = new URLSearchParams(location.search);
  const scene = q.get('scene') ?? 'road';
  const placeholder = q.get('placeholder') === '1';
  const silhouette = q.get('sil') === '1';
  const period = Number(q.get('period') ?? 0) || 0;
  const biomeSet = q.get('set');

  let archetypes = ids(q.get('arch'));
  let items = ids(q.get('items'));
  if (biomeSet !== null) {
    // set=a or set=a,b: one biome's set, or the union of two, which a zone change puts in the rings at once (A32).
    const a = new Set<number>();
    const it = new Set<number>();
    for (const n of biomeSet.split(',')) {
      const s = BIOME_SETS[Number(n)];
      if (!s) continue;
      for (const x of s.archetypes) a.add(x);
      for (const x of s.items) it.add(x);
    }
    if (a.size > 0 || it.size > 0) {
      archetypes = [...a].sort((x, y) => x - y);
      items = [...it].sort((x, y) => x - y);
    }
  }
  const fakeOptions: { periodChunks?: number; archetypes?: readonly number[]; items?: readonly number[] } = {};
  if (period > 0) fakeOptions.periodChunks = period;
  if (archetypes) fakeOptions.archetypes = archetypes;
  if (items) fakeOptions.items = items;
  const base = deps.createFakeWorld(fakeOptions);

  const sheetWorld = scene === 'one' || scene === 'sheet' ? createSheetWorld(base) : null;
  let world: WorldSource = base;
  if (sheetWorld) world = sheetWorld;
  else if (scene === 'worst') {
    const wo: { archetypes?: readonly number[]; items?: readonly number[] } = {};
    if (archetypes) wo.archetypes = archetypes;
    if (items) wo.items = items;
    world = createWorstCaseWorld(base, wo);
  } else if (scene === 'keepout') {
    world = createKeepoutWorld(base);
  }

  // scene=one and scene=sheet imply ship=0, so a sheet's masks never contain the ship's blob.
  const shipFlag = q.get('ship') === '0' || scene === 'one' || scene === 'sheet' ? false : true;
  const options: PropsLayerOptions = {
    debug: true, naiveEdges: q.get('naive') === '1', silhouette, placeholder, ship: shipFlag, clipRoots: scene === 'sheet',
    mirrorProbe: q.get('mprobe') === '1',
  };
  // A6n's negative control: every ring a row short of its reach.
  if (q.get('reachMinus') === '1') {
    options.plan = RING_PLAN.map((p) => ({ ...p, reach: p.reach - 1, cap: p.perChunk * (p.reach + p.rear) }));
  }
  const layer = q.get('props') === '0' ? null : createPropsLayer(options);
  const backdrop = createBackdrop();
  const layers = layer ? [backdrop, layer] : [backdrop];
  const shell = deps.startDevShell(layers, undefined, { world });
  if (silhouette) {
    // Opaque black on white, no bloom: the spec loads with post=off.
    shell.ctx.renderer.setClearColor(0xffffff, 1);
  }
  const debug: PropsDebug | null = layer?.debug ?? null;

  const tmp = new Vector3();
  window.__props = {
    shell,
    layer,
    debug,
    backdrop,
    world,
    sheetWorld,
    metrics,
    project(x: number, y: number, z: number): [number, number] {
      const camera = shell.ctx.camera;
      const gl = shell.ctx.renderer.getContext();
      tmp.set(x, y, z).project(camera);
      return [(tmp.x * 0.5 + 0.5) * gl.drawingBufferWidth, (0.5 - tmp.y * 0.5) * gl.drawingBufferHeight];
    },
  };
  if (scene === 'sheet' && sheetWorld && debug) {
    window.__sheet = createSheet(deps, shell, debug, backdrop, sheetWorld, placeholder);
  }
}
