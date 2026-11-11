// The terrain RenderLayer: six meshes over one grid, one atlas and one program. It calls no method on the renderer, which
// keeps tests/unit/terrain/layer.test.ts running in Node, and it allocates per frame only through addUpdateRange (section 9.2).
import {
  BufferAttribute, BufferGeometry, DataTexture, DoubleSide, FloatType, Mesh, NearestFilter, NoColorSpace, RGBAFormat, ShaderMaterial,
  type IUniform,
} from 'three';
import {
  CLIP_DROP, CLIP_LEVELS, RenderOrder,
  type DebugMode, type FrameView, type QualityProfile, type RenderContext, type RenderLayer, type Travel,
} from '../../contracts/index';
import { ATLAS_HEIGHT, ATLAS_ROW_COMPONENTS, ATLAS_WIDTH, AtlasWriter } from './atlas';
import { buildIndex, buildVertices } from './geometry';
import { HOLE_S2, baseMod, forwardOf, halfWidthOf, rowOffset, spacing } from './layout';
import { CRACK_FRAG, EDGE_PAINT_FRAG, GRID_PROBE_FRAG, TERRAIN_FRAG, TERRAIN_VERT } from './shaders';

export interface TerrainOptions {            // dev only; app/ passes nothing
  holeGrow?: number;                         // initial crack control; 0 default
  gridProbe?: 'pristine' | 'after-fract' | 'unfaded' | 'hard-step';   // replaces the fragment with raw grid coverage at lw .04
  gridLines?: 'pristine' | 'naive';          // 'naive' is the shimmer negative control
  // keep-ranges: rebuild leaves updateRanges non-empty, A17's negative control. wrap-64 and wrap-4096: the floor breaks section 4.3's
  // T = 4096 rule, at every chunk boundary (B11) or at each 4096 wrap (a pulse period of 500), A26's negative controls.
  fault?: 'keep-ranges' | 'wrap-64' | 'wrap-4096';
}

/** Frames from a stride request to the swap, the swap included: morph reaches 1 on frame 29 and the index changes on frame 30. */
const RAMP = 30;

/**
 * D-007: the tier-0 floor shader, for a software boot, whose first setQuality is tier 0 (S-28). NO_SUN_COLUMN drops the floor's
 * sunDisc call and NO_SLOPE_NORMAL the derivative normal (terrain.frag.glsl). They are set on that first call, before precompile, and
 * never flipped afterwards, since a define is in the program key: a boot at any other tier keeps the full shader at every tier, tier 0
 * included, and a tier 0 boot keeps this one if the harness later forces a higher tier.
 */
export const TIER0_DEFINES = { NO_SUN_COLUMN: 1, NO_SLOPE_NORMAL: 1 } as const;

/**
 * Section 9.3: at most 64 pending ranges on a hidden mesh. Past this a full upload replaces them, so a hidden layer or a lost context
 * cannot grow the list. A step of d u crosses about d * 63 / 64 rows, so at 2.5 u a frame streams per row, and a step over about 65 u
 * short of a refill takes one full upload instead: correct, only slower [arithmetic].
 */
const MAX_PENDING_RANGES = 64;

// uRowOffset, uPulsePhase and uBeatPhase change every frame and are fractional, so each is a one-element float array in GLSL, with a
// typed array here. A plain { value: number } store boxes a new number each time, 16 B in Node, and 8 such stores per frame would be
// the whole of section 9.2's 128 B line. uBaseMod is an integer, so it stays a scalar.
interface LevelUniforms extends Record<string, IUniform> {
  uLevel: { value: number }; uBaseMod: { value: number }; uS: { value: number }; uRowOffset: { value: Float32Array };
  uHalfW: { value: number }; uForward: { value: number }; uDrop: { value: number };
}
interface Built {
  readonly ctx: RenderContext;
  readonly writer: AtlasWriter;
  readonly atlas: DataTexture;
  readonly meshes: Mesh<BufferGeometry, ShaderMaterial>[];
  readonly production: ShaderMaterial[];
  readonly levels: LevelUniforms[];
  readonly geometries: readonly [BufferGeometry, BufferGeometry];
  readonly debug: Map<DebugMode, ShaderMaterial[]>;
  readonly indices: Map<number, BufferAttribute>;
}

export function createTerrainLayer(o: TerrainOptions = {}): RenderLayer {
  // One object per uniform, shared by reference between the six materials.
  const uH: IUniform<DataTexture | null> = { value: null };
  const uMorphFloor = { value: 0 };
  const uMirror = { value: 0 };
  const uPulsePhase = { value: new Float32Array(1) };
  const uBeatPhase = { value: new Float32Array(1) };

  let built: Built | null = null;
  let grow = o.holeGrow ?? 0;
  let stride: 1 | 2 = 1;
  let target: 1 | 2 = 1;
  let ramp = 0;
  let qualitySet = false;
  let pendingFull = false;
  let rebuilds = 0;
  let rowWritten = false;

  function indexFor(b: Built, s: 1 | 2, hole: boolean, g: number, evenRows: boolean): BufferAttribute {
    const key = (evenRows ? 10000 : 0) + s * 1000 + (hole ? 100 : 0) + g;
    let attr = b.indices.get(key);
    if (!attr) {
      attr = new BufferAttribute(buildIndex(s, hole, g, evenRows ? HOLE_S2.r1 : undefined), 1);
      b.indices.set(key, attr);
    }
    return attr;
  }

  /**
   * Changes the index, never the geometry, so info.memory.geometries stays constant through a tier change. While a ramp runs at
   * stride 1 the hole already has stride 2's even row bound. Its first frame adds one row of the parent where a level's outer band is
   * almost on the parent's mesh, and the swap frame is then left with only a change of triangulation.
   */
  function applyIndices(b: Built): void {
    const evenRows = stride === 1 && ramp > 0;
    b.geometries[0].setIndex(indexFor(b, stride, false, 0, false));
    b.geometries[1].setIndex(indexFor(b, stride, true, grow, evenRows));
  }

  function snapRamp(b: Built): void {
    stride = target;
    ramp = stride === 2 ? RAMP - 1 : 0;
    uMorphFloor.value = ramp / (RAMP - 1);
    applyIndices(b);
  }

  /**
   * Section 6.10: ramp morph to 1, then swap, in 30 frames. Morph finishes one frame early, so the swap frame changes nothing but the
   * index. Going back swaps first, then ramps down. A reversal needs no special case.
   */
  function stepRamp(b: Built): void {
    if (stride === 1 && target === 2) {
      if (ramp >= RAMP - 1) {
        stride = 2;
        applyIndices(b);
      } else {
        ramp++;
        uMorphFloor.value = ramp / (RAMP - 1);
        if (ramp === 1) applyIndices(b);
      }
    } else if (stride === 2 && target === 1) {
      stride = 1;
      applyIndices(b);
    } else if (stride === 1 && target === 1 && ramp > 0) {
      ramp--;
      uMorphFloor.value = ramp / (RAMP - 1);
      if (ramp === 0) applyIndices(b);
    }
  }

  function writeLevelUniforms(b: Built, cam: Readonly<Travel>): void {
    for (let k = 0; k < CLIP_LEVELS; k++) {
      const u = b.levels[k]!;
      u.uRowOffset.value[0] = rowOffset(k, cam);
      u.uBaseMod.value = baseMod(k, cam);
    }
  }

  function writePhaseUniforms(v: Readonly<FrameView>): void {
    // Section 10.3's slowest harmonic: the phrase phase keeps the same musical meaning.
    uPulsePhase.value[0] = v.reducedMotion ? v.phases[2]! : v.phases[1]!;
    uBeatPhase.value[0] = v.reducedMotion ? v.phases[2]! : v.phases[0]!;
  }

  function refill(b: Built, v: Readonly<FrameView>): void {
    rebuilds++;
    if (o.fault === 'keep-ranges' && rebuilds > 1) {
      // The negative control: a stale range suppresses the full upload, which is the trap of section 10.2. The first
      // rebuild stays clean, so the fault shows at the warp and not as an empty atlas from boot.
      b.atlas.addUpdateRange(0, ATLAS_ROW_COMPONENTS);
    } else {
      b.atlas.clearUpdateRanges();
    }
    // The full upload stays pending until a render uploads (atlas.onUpdate clears this). A row streamed before then must add no range:
    // three 0.187 uploads only the listed rows when there are any (WebGLTextures.js:865), which would leave the rest of the GPU atlas
    // stale, or zero on a fresh texture after a restore (repair R2).
    pendingFull = true;
    b.writer.refill(v.cam);
    b.atlas.needsUpdate = true;
    writeLevelUniforms(b, v.cam);
    writePhaseUniforms(v);
    snapRamp(b);
  }

  // One function, created once. It allocates one small range object per row, at chunk rate, which section 9.2 accepts.
  function onRow(atlasRow: number): void {
    rowWritten = true;
    if (pendingFull || !built) return;
    if (built.atlas.updateRanges.length >= MAX_PENDING_RANGES) {
      built.atlas.clearUpdateRanges();
      pendingFull = true;
      return;
    }
    built.atlas.addUpdateRange(atlasRow * ATLAS_ROW_COMPONENTS, ATLAS_ROW_COMPONENTS);
  }

  function makeMaterial(ctx: RenderContext, level: LevelUniforms, fragmentShader: string, defines?: Record<string, number>): ShaderMaterial {
    return new ShaderMaterial({
      vertexShader: TERRAIN_VERT,
      fragmentShader,
      // Spread by reference. Never clone one of these: clone deep-copies and silently breaks the link (Agents.md).
      uniforms: { ...ctx.shared, ...level, uH, uMorphFloor, uMirror, uPulsePhase, uBeatPhase },
      ...(defines ? { defines } : {}),
      transparent: true,
      depthTest: true,
      depthWrite: true,
      side: DoubleSide,
    });
  }

  function productionMaterial(ctx: RenderContext, level: LevelUniforms): ShaderMaterial {
    if (o.gridProbe) {
      const defines = o.gridProbe === 'after-fract' ? { PROBE_AFTER_FRACT: 1 }
        : o.gridProbe === 'unfaded' ? { PROBE_UNFADED: 1 }
        : o.gridProbe === 'hard-step' ? { PROBE_HARD_STEP: 1 } : undefined;
      return makeMaterial(ctx, level, GRID_PROBE_FRAG, defines);
    }
    const defines: Record<string, number> = {};
    if (o.gridLines === 'naive') defines['NAIVE_GRID'] = 1;
    if (o.fault === 'wrap-64') defines['FAULT_WRAP_64'] = 1;
    if (o.fault === 'wrap-4096') defines['FAULT_WRAP_4096'] = 1;
    return makeMaterial(ctx, level, TERRAIN_FRAG, Object.keys(defines).length > 0 ? defines : undefined);
  }

  function debugMaterials(b: Built, m: DebugMode): ShaderMaterial[] {
    let set = b.debug.get(m);
    if (!set) {
      const frag = m === 'crack' ? CRACK_FRAG : EDGE_PAINT_FRAG;
      set = b.levels.map((u) => makeMaterial(b.ctx, u, frag));
      b.debug.set(m, set);
    }
    return set;
  }

  return {
    name: 'terrain',
    attach(ctx: RenderContext): void {
      const writer = new AtlasWriter(ctx.world);
      const atlas = new DataTexture(writer.data, ATLAS_WIDTH, ATLAS_HEIGHT, RGBAFormat, FloatType);
      atlas.internalFormat = 'RGBA32F';
      atlas.minFilter = NearestFilter;
      atlas.magFilter = NearestFilter;
      atlas.generateMipmaps = false;
      atlas.colorSpace = NoColorSpace;
      atlas.needsUpdate = true;   // a defined, zeroed texture for precompile, before the first rebuild fills it
      atlas.onUpdate = () => { pendingFull = false; };
      uH.value = atlas;

      const position = new BufferAttribute(buildVertices(), 3);
      const full = new BufferGeometry();
      const holed = new BufferGeometry();
      full.setAttribute('position', position);
      holed.setAttribute('position', position);

      const levels: LevelUniforms[] = [];
      const production: ShaderMaterial[] = [];
      const meshes: Mesh<BufferGeometry, ShaderMaterial>[] = [];
      for (let k = 0; k < CLIP_LEVELS; k++) {
        const u: LevelUniforms = {
          uLevel: { value: k }, uBaseMod: { value: 0 }, uS: { value: spacing(k) }, uRowOffset: { value: new Float32Array(1) },
          uHalfW: { value: halfWidthOf(k) }, uForward: { value: forwardOf(k) }, uDrop: { value: CLIP_DROP[k]! },
        };
        levels.push(u);
        const material = productionMaterial(ctx, u);
        production.push(material);
        const mesh = new Mesh(k === 0 ? full : holed, material);
        mesh.frustumCulled = false;   // the bend is false geometry, and displacement is not in the bounds (section 6.1)
        mesh.renderOrder = RenderOrder.TERRAIN + k;
        ctx.scene.add(mesh);
        meshes.push(mesh);
      }
      built = { ctx, writer, atlas, meshes, production, levels, geometries: [full, holed], debug: new Map(), indices: new Map() };
      applyIndices(built);
    },
    setQuality(q: Readonly<QualityProfile>): void {
      uMirror.value = q.mirror ? 1 : 0;
      target = q.terrainStride;
      if (!qualitySet && built) {
        qualitySet = true;
        if (q.tier === 0) {
          // Only the floor's own shader; the grid probe and the debug fragments are other programs (section 3).
          for (const m of built.production) {
            if (m.fragmentShader !== TERRAIN_FRAG) continue;
            m.defines = { ...m.defines, ...TIER0_DEFINES };
            m.needsUpdate = true;   // none is compiled yet at this point of the lifecycle; this only keeps it right if one were
          }
        }
        snapRamp(built);
      }
    },
    frame(v: Readonly<FrameView>): void {
      const b = built;
      if (!b) return;
      if (b.writer.needsRefill(v.cam)) {
        refill(b, v);
        return;
      }
      rowWritten = false;
      b.writer.advance(v.cam, onRow);
      if (rowWritten) b.atlas.needsUpdate = true;
      writeLevelUniforms(b, v.cam);
      writePhaseUniforms(v);
      stepRamp(b);
    },
    rebuild(v: Readonly<FrameView>): void {
      if (built) refill(built, v);
    },
    setVisible(on: boolean): void {
      if (!built) return;
      for (const mesh of built.meshes) mesh.visible = on;
    },
    setDebugMode(m: DebugMode): void {
      const b = built;
      if (!b) return;
      const set = m === 'none' ? b.production : debugMaterials(b, m);
      for (let k = 0; k < CLIP_LEVELS; k++) b.meshes[k]!.material = set[k]!;
    },
    setCrackControl(holeGrow: number): void {
      grow = holeGrow;
      if (built) applyIndices(built);
    },
    dispose(): void {
      const b = built;
      if (!b) return;
      built = null;
      for (const mesh of b.meshes) b.ctx.scene.remove(mesh);
      // three 0.187's destroyGeometry (WebGLGeometries.js) frees geometry.index and each geometry.attributes entry, nothing else, so an
      // index variant bound earlier (stride 2, the even hole, a grown hole) would keep its GL buffer. Each one not bound now rides along
      // as a named attribute of both geometries; WebGLAttributes.remove skips one that never uploaded, or that the first dispose freed.
      for (const [key, attr] of b.indices) {
        if (attr === b.geometries[0].index || attr === b.geometries[1].index) continue;
        for (const g of b.geometries) g.setAttribute(`disposeIndex${key}`, attr);
      }
      b.indices.clear();
      for (const g of b.geometries) g.dispose();
      for (const m of b.production) m.dispose();
      for (const set of b.debug.values()) for (const m of set) m.dispose();
      b.atlas.dispose();
      uH.value = null;
    },
  };
}
