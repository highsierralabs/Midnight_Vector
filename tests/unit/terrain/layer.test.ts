import { DataTexture, DoubleSide, Mesh, PerspectiveCamera, Scene, ShaderMaterial, type BufferGeometry, type WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';
import {
  CHUNK_LEN, CHUNK_LIMIT, CLIP_LEVELS, CLIP_ROWS, RenderOrder,
  type CreateLayer, type FrameView, type RenderContext, type RenderLayer, type Travel,
} from '../../../src/contracts/index';
import { advance } from '../../../src/core/coords';
import { createSharedUniforms } from '../../../src/core/uniforms';
import { AtlasWriter } from '../../../src/render/terrain/atlas';
import { createTerrainLayer } from '../../../src/render/terrain/index';
import { baseRow, forwardOf, halfWidthOf } from '../../../src/render/terrain/layout';
import { GRID_GLSL, GRID_PROBE_FRAG, TERRAIN_FRAG } from '../../../src/render/terrain/shaders';
import { createFakeWorld } from '../../../src/testing/fakeWorld';
import { fakeProfile, scriptedFrame } from '../../../src/testing/scriptedFrame';
import { gcDuring } from './gcWindow';

const W = 129;
type TerrainMesh = Mesh<BufferGeometry, ShaderMaterial>;

function setup(): { ctx: RenderContext; layer: RenderLayer; meshes: () => TerrainMesh[] } {
  // A renderer stub that throws on any access: T03 calls no method on renderer, which is what keeps this test in Node.
  const renderer = new Proxy({}, {
    get(_t, name) { throw new Error(`layer touched renderer.${String(name)}`); },
  }) as WebGLRenderer;
  const ctx: RenderContext = {
    renderer, scene: new Scene(), camera: new PerspectiveCamera(), shared: createSharedUniforms(), world: createFakeWorld(),
  };
  const layer = createTerrainLayer();
  layer.attach(ctx);
  layer.setQuality(fakeProfile(3));
  return { ctx, layer, meshes: () => ctx.scene.children as TerrainMesh[] };
}

function view(ctx: RenderContext, at: Travel, tick = 504, extra: { reducedMotion?: boolean } = {}): FrameView {
  return scriptedFrame(0, { at, tick, world: ctx.world, ...extra });
}

function atlasOf(m: TerrainMesh[]): DataTexture {
  return m[0]!.material.uniforms['uH']!.value as DataTexture;
}

function floorOf(m: TerrainMesh[]): number {
  return m[0]!.material.uniforms['uMorphFloor']!.value as number;
}

function liveRowsEqualFresh(data: Float32Array, ctx: RenderContext, cam: Travel): void {
  const fresh = new AtlasWriter(ctx.world);
  fresh.refill(cam);
  for (let k = 0; k < CLIP_LEVELS; k++) {
    const base = baseRow(k, cam);
    for (let q = base - 2; q <= base + CLIP_ROWS; q++) {
      const from = ((((q % 128) + 128) % 128) + k * 128) * W * 4;
      for (let i = from; i < from + W * 4; i++) {
        if (data[i] !== fresh.data[i]) throw new Error(`level ${k} row ${q}: ${data[i]} vs ${fresh.data[i]}`);
      }
    }
  }
}

// Assignable to the composition root's factory type, since every option is optional (section 4).
const factory: CreateLayer = createTerrainLayer;

describe('terrain layer in Node', () => {
  it('createTerrainLayer fits CreateLayer and is named terrain', () => {
    expect(factory().name).toBe('terrain');
  });

  it('has six meshes with the settings of section 4', () => {
    const { meshes } = setup();
    const m = meshes();
    expect(m.length).toBe(6);
    m.forEach((mesh, k) => {
      expect(mesh.renderOrder).toBe(RenderOrder.TERRAIN + k);
      expect(mesh.frustumCulled).toBe(false);
      expect(mesh.material.transparent).toBe(true);
      expect(mesh.material.depthWrite).toBe(true);
      expect(mesh.material.depthTest).toBe(true);
      expect(mesh.material.side).toBe(DoubleSide);
      expect(mesh.material.uniforms['uLevel']!.value).toBe(k);
      // glslVersion unset: GLSL3 removes the gl_FragColor define (Agents.md).
      expect(mesh.material.glslVersion).toBeNull();
    });
    // Two geometries that share one position attribute.
    expect(m[0]!.geometry).not.toBe(m[1]!.geometry);
    expect(m[1]!.geometry).toBe(m[5]!.geometry);
    expect(m[0]!.geometry.getAttribute('position')).toBe(m[1]!.geometry.getAttribute('position'));
    expect(new Set(m.map((mesh) => mesh.material.vertexShader)).size).toBe(1);
    expect(new Set(m.map((mesh) => mesh.material.fragmentShader)).size).toBe(1);
  });

  it('shares ctx.shared by reference in every material', () => {
    const { ctx, meshes } = setup();
    for (const mesh of meshes()) {
      for (const [name, u] of Object.entries(ctx.shared)) expect(mesh.material.uniforms[name]).toBe(u);
    }
    const first = meshes()[0]!.material.uniforms;
    for (const mesh of meshes()) {
      for (const name of ['uH', 'uMorphFloor', 'uMirror', 'uPulsePhase', 'uBeatPhase']) expect(mesh.material.uniforms[name]).toBe(first[name]);
    }
  });

  it('setQuality changes uMirror and never transparent or side', () => {
    const { layer, meshes } = setup();
    const m = meshes();
    expect(m[3]!.material.uniforms['uMirror']!.value).toBe(1);
    layer.setQuality(fakeProfile(2));
    expect(m[3]!.material.uniforms['uMirror']!.value).toBe(0);
    for (const mesh of m) {
      expect(mesh.material.transparent).toBe(true);
      expect(mesh.material.side).toBe(DoubleSide);
    }
  });

  it('reducedMotion selects phases[2] for pulse and beat', () => {
    const { ctx, layer, meshes } = setup();
    const u = meshes()[0]!.material.uniforms;
    const at = { chunk: 40, local: 1 };
    layer.rebuild(view(ctx, at, 100));
    const normal = view(ctx, at, 100);
    layer.frame(normal);
    expect((u['uPulsePhase']!.value as Float32Array)[0]).toBe(normal.phases[1]);
    expect((u['uBeatPhase']!.value as Float32Array)[0]).toBe(normal.phases[0]);
    const slow = view(ctx, at, 100, { reducedMotion: true });
    layer.frame(slow);
    expect((u['uPulsePhase']!.value as Float32Array)[0]).toBe(slow.phases[2]);
    expect((u['uBeatPhase']!.value as Float32Array)[0]).toBe(slow.phases[2]);
    expect(slow.phases[2]).not.toBe(slow.phases[1]);
  });

  it('keeps per-level uniforms small at the world limit', () => {
    const { ctx, layer, meshes } = setup();
    const at = { chunk: CHUNK_LIMIT - 1, local: 63.5 };
    layer.rebuild(view(ctx, at));
    layer.frame(view(ctx, at));
    meshes().forEach((mesh, k) => {
      const u = mesh.material.uniforms;
      // Everything position-derived or small. uHalfW and uForward are table constants of up to 6016, no function of position (section 11).
      for (const name of ['uBaseMod', 'uS', 'uDrop', 'uLevel']) {
        expect(Math.abs(u[name]!.value as number)).toBeLessThan(300);
      }
      expect(Math.abs((u['uRowOffset']!.value as Float32Array)[0]!)).toBeLessThan(300);
      expect(u['uHalfW']!.value).toBe(halfWidthOf(k));
      expect(u['uForward']!.value).toBe(forwardOf(k));
      const mod = u['uBaseMod']!.value as number;
      expect(Number.isInteger(mod)).toBe(true);
      expect(mod).toBeGreaterThanOrEqual(0);
      expect(mod).toBeLessThan(128);
    });
  });

  it('rebuild leaves updateRanges empty and bumps the texture version', () => {
    const { ctx, layer, meshes } = setup();
    const atlas = atlasOf(meshes());
    const at = { chunk: 40, local: 0 };
    layer.rebuild(view(ctx, at));
    atlas.onUpdate!(atlas);   // a render uploads the rebuilt atlas
    advance(at, 8);
    layer.frame(view(ctx, at));
    expect(atlas.updateRanges.length).toBeGreaterThan(0);
    const version = atlas.version;
    layer.rebuild(view(ctx, at));
    expect(atlas.updateRanges.length).toBe(0);
    expect(atlas.version).toBeGreaterThan(version);
  });

  it('a row crossed after a rebuild and before the next upload keeps the full upload (repair R2)', () => {
    const { ctx, layer, meshes } = setup();
    const atlas = atlasOf(meshes());
    const at = { chunk: 40, local: 0 };
    layer.rebuild(view(ctx, at));
    const before = [0, 1, 2, 3, 4, 5].map((k) => baseRow(k, at));
    advance(at, 8);
    layer.frame(view(ctx, at));
    const crossed = [0, 1, 2, 3, 4, 5].reduce((sum, k) => sum + baseRow(k, at) - before[k]!, 0);
    expect(crossed).toBeGreaterThan(0);
    // three 0.187 uploads only the listed rows when updateRanges is not empty (WebGLTextures.js:865), so one range here would turn the
    // rebuild's full upload into a per-row one and leave every other row stale on the GPU, or zero on a fresh texture after a restore.
    expect(atlas.updateRanges.length).toBe(0);
    // The CPU copy is whole, so the one full upload carries the rows streamed since the rebuild.
    liveRowsEqualFresh(atlas.image.data as Float32Array, ctx, at);
    // Once a render has uploaded, the next crossing streams single rows again.
    atlas.onUpdate!(atlas);
    advance(at, 8);
    layer.frame(view(ctx, at));
    expect(atlas.updateRanges.length).toBeGreaterThan(0);
  });

  it('a normal frame adds exactly one range per row crossed, each one whole row', () => {
    const { ctx, layer, meshes } = setup();
    const atlas = atlasOf(meshes());
    const at = { chunk: 40, local: 0 };
    layer.rebuild(view(ctx, at));
    atlas.onUpdate!(atlas);   // a render uploads the rebuilt atlas
    const before = [0, 1, 2, 3, 4, 5].map((k) => baseRow(k, at));
    advance(at, 8);
    const version = atlas.version;
    layer.frame(view(ctx, at));
    const crossed = [0, 1, 2, 3, 4, 5].reduce((sum, k) => sum + baseRow(k, at) - before[k]!, 0);
    expect(crossed).toBeGreaterThan(0);
    expect(atlas.updateRanges.length).toBe(crossed);
    for (const r of atlas.updateRanges) {
      expect(r.count).toBe(W * 4);
      expect(r.start % (W * 4)).toBe(0);
    }
    expect(atlas.version).toBe(version + 1);
    // A frame that crosses no row changes nothing.
    const quiet = atlas.version;
    layer.frame(view(ctx, at));
    expect(atlas.version).toBe(quiet);
    expect(atlas.updateRanges.length).toBe(crossed);
  });

  it('a hidden layer holds at most 64 pending ranges, section 9.3', () => {
    const { ctx, layer, meshes } = setup();
    const atlas = atlasOf(meshes());
    const at = { chunk: 40, local: 0 };
    layer.rebuild(view(ctx, at));
    atlas.onUpdate!(atlas);   // rendered once after the rebuild, then hidden
    let most = 0;
    for (let i = 0; i < 2000; i++) {
      advance(at, 2.5);
      layer.frame(view(ctx, at));
      most = Math.max(most, atlas.updateRanges.length);
    }
    console.log(`PENDING most ${most}`);
    // Section 9.3's scene audit, and T09's pendingHiddenMax, allow at most 64 on a hidden mesh. A 2.5 u step crosses at most 2 rows of
    // level 0 and 1 of each other level, so a frame-end sample within 7 of the cap shows the walk reached it.
    expect(most).toBeLessThanOrEqual(64);
    expect(most).toBeGreaterThanOrEqual(64 - 7);
    // A later render then does a full upload, with an empty list.
    expect(atlas.updateRanges.length).toBe(0);
    // Every row is still correct in the CPU copy.
    liveRowsEqualFresh(atlas.image.data as Float32Array, ctx, at);
    // Once a render has uploaded, streaming goes back to single rows. Without this, every later row would cost a full upload.
    atlas.onUpdate!(atlas);
    advance(at, 8);
    layer.frame(view(ctx, at));
    expect(atlas.updateRanges.length).toBeGreaterThan(0);
  });

  it('the ramp reaches stride 2 in exactly 30 frames, and a reversal at frame 15 returns with no jump', () => {
    const { ctx, layer, meshes } = setup();
    const m = meshes();
    const at = { chunk: 40, local: 0 };
    const v = (): FrameView => view(ctx, at);
    const holed = (): number => m[1]!.geometry.index!.count / 3;
    const REST = 19176;                        // stride 1, hole rows [0, 45)
    const RAMPING = (128 * 96 - 60 * 44) * 2;  // stride 1, hole rows [0, 44)
    const STRIDE2 = 4824;
    const STEP = 1 / 29;
    layer.rebuild(v());
    expect(floorOf(m)).toBe(0);
    expect(holed()).toBe(REST);

    layer.setQuality(fakeProfile(1));
    for (let i = 1; i <= 29; i++) {
      layer.frame(v());
      expect(floorOf(m)).toBeCloseTo(i * STEP, 10);
      expect(holed()).toBe(RAMPING);
    }
    expect(floorOf(m)).toBe(1);
    // Frame 30 is the swap, and it changes nothing but the index, which is what A21 measures.
    layer.frame(v());
    expect(floorOf(m)).toBe(1);
    expect(holed()).toBe(STRIDE2);
    expect(m[0]!.geometry.index!.count).toBe(6144 * 3);

    // Back: the index swaps at once with the even hole, the floor stays at 1, then ramps down, and the resting hole returns at morph 0.
    layer.setQuality(fakeProfile(3));
    layer.frame(v());
    expect(floorOf(m)).toBe(1);
    expect(holed()).toBe(RAMPING);
    for (let i = 28; i >= 1; i--) {
      layer.frame(v());
      expect(floorOf(m)).toBeCloseTo(i * STEP, 10);
      expect(holed()).toBe(RAMPING);
    }
    layer.frame(v());
    expect(floorOf(m)).toBe(0);
    expect(holed()).toBe(REST);

    // A reversal at frame 15, with no jump bigger than one step, and never stride 2.
    layer.setQuality(fakeProfile(1));
    let last = floorOf(m);
    for (let i = 0; i < 15; i++) {
      layer.frame(v());
      expect(Math.abs(floorOf(m) - last)).toBeLessThanOrEqual(STEP + 1e-9);
      expect(holed()).toBe(RAMPING);
      last = floorOf(m);
    }
    expect(last).toBeCloseTo(15 * STEP, 10);
    layer.setQuality(fakeProfile(3));
    for (let i = 0; i < 15; i++) {
      layer.frame(v());
      expect(Math.abs(floorOf(m) - last)).toBeLessThanOrEqual(STEP + 1e-9);
      last = floorOf(m);
    }
    expect(last).toBe(0);
    expect(holed()).toBe(REST);
  });

  it('the first setQuality and every rebuild snap with no ramp', () => {
    const ctx: RenderContext = {
      renderer: {} as WebGLRenderer, scene: new Scene(), camera: new PerspectiveCamera(), shared: createSharedUniforms(), world: createFakeWorld(),
    };
    const layer = createTerrainLayer();
    layer.attach(ctx);
    layer.setQuality(fakeProfile(1));
    const m = ctx.scene.children as TerrainMesh[];
    expect(floorOf(m)).toBe(1);
    expect(m[1]!.geometry.index!.count).toBe(4824 * 3);
    layer.setQuality(fakeProfile(3));
    expect(floorOf(m)).toBe(1);
    layer.rebuild(view(ctx, { chunk: 5, local: 0 }));
    expect(floorOf(m)).toBe(0);
    expect(m[1]!.geometry.index!.count).toBe(19176 * 3);
  });

  it('D-007: a tier 0 first setQuality builds the tier-0 shader, any other first tier does not, and no later call flips it', () => {
    const TIER0 = { NO_SUN_COLUMN: 1, NO_SLOPE_NORMAL: 1 };
    const boot = (tier: 0 | 1 | 2 | 3 | 4): { ctx: RenderContext; layer: RenderLayer; m: TerrainMesh[] } => {
      const ctx: RenderContext = {
        renderer: {} as WebGLRenderer, scene: new Scene(), camera: new PerspectiveCamera(), shared: createSharedUniforms(), world: createFakeWorld(),
      };
      const layer = createTerrainLayer();
      layer.attach(ctx);
      layer.setQuality(fakeProfile(tier));
      return { ctx, layer, m: ctx.scene.children as TerrainMesh[] };
    };
    const tier0Keys = (mesh: TerrainMesh): string[] => Object.keys(mesh.material.defines ?? {}).filter((k) => k in TIER0).sort();

    // A software boot: the first setQuality is tier 0, before any compile.
    const s = boot(0);
    expect(s.m.length).toBe(6);
    for (const mesh of s.m) {
      expect(mesh.material.defines).toEqual(TIER0);
      expect(mesh.material.fragmentShader).toBe(TERRAIN_FRAG);
    }
    const versions = s.m.map((mesh) => mesh.material.version);
    // Later calls, any tier, and rebuilds never flip a define and never mark a recompile.
    for (const t of [3, 1, 4, 2, 0] as const) {
      s.layer.setQuality(fakeProfile(t));
      s.layer.frame(view(s.ctx, { chunk: 5, local: 0 }));
    }
    s.layer.rebuild(view(s.ctx, { chunk: 9, local: 3 }));
    s.m.forEach((mesh, k) => {
      expect(mesh.material.defines).toEqual(TIER0);
      expect(mesh.material.version).toBe(versions[k]);
    });
    // Debug materials are separate fragments and stay as they were.
    s.layer.setDebugMode('crack');
    for (const mesh of s.m) expect(tier0Keys(mesh)).toEqual([]);
    s.layer.setDebugMode('none');
    for (const mesh of s.m) expect(mesh.material.defines).toEqual(TIER0);

    // Every other first tier keeps the full shader, and reaching tier 0 later at runtime does not add the defines.
    for (const t of [1, 2, 3, 4] as const) {
      const g = boot(t);
      for (const mesh of g.m) expect(tier0Keys(mesh)).toEqual([]);
      const v = g.m.map((mesh) => mesh.material.version);
      g.layer.setQuality(fakeProfile(0));
      g.layer.rebuild(view(g.ctx, { chunk: 5, local: 0 }));
      g.m.forEach((mesh, k) => {
        expect(tier0Keys(mesh)).toEqual([]);
        expect(mesh.material.version).toBe(v[k]);
      });
    }
  });

  it('D-007: the tier-0 defines remove exactly the floor sunDisc call and the derivative normal from the floor shader', () => {
    const at = (s: string): number => TERRAIN_FRAG.indexOf(s);
    // sunDisc is called once, inside #ifndef NO_SUN_COLUMN; the derivative normal sits in the #else of #ifdef NO_SLOPE_NORMAL.
    expect(TERRAIN_FRAG.split('sunDisc(rr, .55)').length - 1).toBe(1);
    expect(at('#ifndef NO_SUN_COLUMN')).toBeGreaterThan(-1);
    expect(at('#ifndef NO_SUN_COLUMN')).toBeLessThan(at('sunDisc(rr, .55)'));
    expect(TERRAIN_FRAG.indexOf('#endif', at('sunDisc(rr, .55)'))).toBeGreaterThan(at('sunDisc(rr, .55)'));
    expect(at('#ifdef NO_SLOPE_NORMAL')).toBeGreaterThan(-1);
    expect(at('#ifdef NO_SLOPE_NORMAL')).toBeLessThan(at('cross(dFdx(vL), dFdy(vL))'));
    expect(TERRAIN_FRAG.indexOf('#else', at('#ifdef NO_SLOPE_NORMAL'))).toBeLessThan(at('cross(dFdx(vL), dFdy(vL))'));
    // Nothing else in the floor shader depends on either define.
    expect(TERRAIN_FRAG.split('NO_SUN_COLUMN').length - 1).toBe(1);
    expect(TERRAIN_FRAG.split('NO_SLOPE_NORMAL').length - 1).toBe(1);
  });

  it('setCrackControl changes the index, never the geometry, and 0 restores it', () => {
    const { layer, meshes } = setup();
    const m = meshes();
    const geometry = m[1]!.geometry;
    const index = geometry.index;
    layer.setCrackControl!(4);
    expect(m[1]!.geometry).toBe(geometry);
    expect(geometry.index!.count).toBe((128 * 96 - 68 * 49) * 6);
    expect(m[0]!.geometry.index!.count).toBe(24576 * 3);
    layer.setCrackControl!(0);
    expect(geometry.index).toBe(index);
  });

  it('the far-grid probe runs the floor\'s own gridLines, so A12 measures what the floor draws', () => {
    const count = (text: string, part: string): number => text.split(part).length - 1;
    // grid.glsl holds the only definitions: the production one and the naive control, one per #ifdef branch.
    expect(count(GRID_GLSL, 'vec2 gridLines(')).toBe(2);
    for (const frag of [TERRAIN_FRAG, GRID_PROBE_FRAG]) {
      expect(count(frag, GRID_GLSL)).toBe(1);
      expect(count(frag, 'vec2 gridLines(')).toBe(2);
    }
    expect(TERRAIN_FRAG).toContain('gridLines(uv / 8., vec2(.03))');
    expect(GRID_PROBE_FRAG).toContain('vec2 l = gridLines(uv, vec2(.04));');
    const { meshes } = setup();
    for (const mesh of meshes()) expect(mesh.material.fragmentShader).toBe(TERRAIN_FRAG);
    const probeCtx: RenderContext = {
      renderer: {} as WebGLRenderer, scene: new Scene(), camera: new PerspectiveCamera(), shared: createSharedUniforms(), world: createFakeWorld(),
    };
    createTerrainLayer({ gridProbe: 'pristine' }).attach(probeCtx);
    const probe = (probeCtx.scene.children as TerrainMesh[])[0]!.material;
    expect(probe.fragmentShader).toBe(GRID_PROBE_FRAG);
    expect(probe.defines).toEqual({});
  });

  it('debug modes swap materials lazily and none restores production', () => {
    const { layer, meshes } = setup();
    const m = meshes();
    const production = m.map((mesh) => mesh.material);
    layer.setDebugMode('crack');
    expect(m[2]!.material).not.toBe(production[2]);
    expect(m[2]!.material.fragmentShader).toContain('.1, .6, .3');
    layer.setDebugMode('edge-paint');
    expect(m[2]!.material.fragmentShader).toContain('uLevel == 5');
    layer.setDebugMode('none');
    m.forEach((mesh, k) => expect(mesh.material).toBe(production[k]));
  });

  it('setVisible hides every mesh, and dispose empties the scene', () => {
    const { ctx, layer, meshes } = setup();
    layer.setVisible(false);
    for (const mesh of meshes()) expect(mesh.visible).toBe(false);
    layer.setVisible(true);
    for (const mesh of meshes()) expect(mesh.visible).toBe(true);
    layer.dispose();
    expect(ctx.scene.children.length).toBe(0);
  });

  it('a frame that crosses no row allocates nothing, and the control shows the observer can see garbage', async () => {
    const { ctx, layer } = setup();
    // Fractional on purpose: at local 0 the row offsets are integers, and at tick 504 the beat phase is 0, and neither of those would box.
    const at = { chunk: 40, local: 21.3 };
    layer.rebuild(view(ctx, at, 505));
    // The view is built once and reused, so only the layer can allocate here.
    const v = view(ctx, at, 505);
    expect(Number.isInteger(v.phases[0])).toBe(false);
    expect(Number.isInteger(v.phases[1])).toBe(false);
    for (let i = 0; i < 20_000; i++) layer.frame(v);
    // Only entries that start inside the body count (gcWindow.ts): a mark-compact in the trailing wait is not the body's.
    const clean = await gcDuring(() => { for (let i = 0; i < 2_000_000; i++) layer.frame(v); });
    let keep = 0;
    const control = await gcDuring(() => {
      for (let i = 0; i < 200_000; i++) {
        layer.frame(v);
        keep += new Float64Array(129).length;
      }
    });
    console.log(`FRAME ALLOC clean gc=${clean.inBody} (outside ${clean.outside}: ${clean.detail}) control gc=${control.inBody} (outside ${control.outside}) keep=${keep}`);
    // The control must be seen inside its own window, or the observer is not working in this pool.
    expect(control.inBody).toBeGreaterThanOrEqual(1);
    expect(clean.inBody).toBe(0);
  });

  it('self heal: frame alone across a forward 2000 u jump and a backward 100 u jump', () => {
    const { ctx, layer, meshes } = setup();
    const atlas = atlasOf(meshes());
    const at = { chunk: 40, local: 21 };
    layer.rebuild(view(ctx, at));
    layer.frame(view(ctx, at));

    for (const jump of [2000, -100]) {
      advance(at, jump);
      const version = atlas.version;
      layer.frame(view(ctx, at));
      expect(atlas.version).toBeGreaterThan(version);
      expect(atlas.updateRanges.length).toBe(0);
      liveRowsEqualFresh(atlas.image.data as Float32Array, ctx, at);
    }
    // And, once a render has uploaded the healed atlas, a step that stays inside the ring is incremental.
    atlas.onUpdate!(atlas);
    advance(at, CHUNK_LEN / 8);
    const version = atlas.version;
    layer.frame(view(ctx, at));
    expect(atlas.version).toBe(version + 1);
    expect(atlas.updateRanges.length).toBeGreaterThan(0);
  });

  it('DI-93: past R1\'s exact range, rebuild and frame throw a RangeError out of the layer, for the loop\'s fatal route', () => {
    // The app's loop catches what a layer's frame or rebuild throws and calls onFatal (src/app/loop.ts, fail). The height source
    // throws a plain Error past a call budget, so a layer that spins fails here instead of hanging the worker.
    const far = { chunk: 2 ** 49 + 5, local: 0 };
    const results: string[] = [];
    for (const path of ['rebuild', 'frame'] as const) {
      let calls = 0;
      const base = createFakeWorld();
      const world = { ...base, height: (x: number, iz: number, zs: number, zl: number): number => {
        if (++calls > 2_000_000) throw new Error('height budget spent');
        return base.height(x, iz, zs, zl);
      } };
      const ctx: RenderContext = { ...setup().ctx, scene: new Scene(), world };
      // A fresh layer on the budgeted world. Its first frame refills, as a harness jump with no rebuild does.
      const layer = createTerrainLayer();
      layer.attach(ctx);
      layer.setQuality(fakeProfile(3));
      let thrown: unknown = null;
      try {
        if (path === 'rebuild') layer.rebuild(view(ctx, far));
        else layer.frame(view(ctx, far));
      } catch (e) {
        thrown = e;
      }
      results.push(`${path}: ${String(thrown)}`);
      expect(thrown, path).toBeInstanceOf(RangeError);
    }
    console.log(`DI93 layer ${results.join(' | ')}`);
  });
});
