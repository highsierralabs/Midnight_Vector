// The sky layer: one fullscreen triangle in the scene, plus a nebula density target it draws for itself.
// Its output is a pure function of seed, zone fields, tick mod 30720, alpha, uBend, camera rotation, FOV and y, canvas
// height, quality and reducedMotion. It reads neither v.cam nor uTravel, so it cannot degrade with distance.
import {
  BufferAttribute, BufferGeometry, Camera, HalfFloatType, LinearFilter, Mesh, RGBAFormat, Scene, WebGLRenderTarget,
  type ShaderMaterial,
} from 'three';
import { RenderOrder, type FrameView, type QualityProfile, type RenderContext, type RenderLayer } from '../../contracts/index';
import { createSkyEvents, nightFactor, writeSkyEvents } from './events';
import { createNebulaMaterial, createSkyMaterial, createSkyUniforms, type SkyOptions, type SkyUniforms } from './skyMaterial';
import { NEBULA_DEFAULT_WIDTH, NEBULA_GAIN_DAY, STAR_GAIN_DAY } from './skyParams';

export type { SkyOptions } from './skyMaterial';
export interface SkyCore extends RenderLayer { readonly nebulaSize: readonly [number, number] }

/** Indices into PHASE_PERIOD_TICKS. Reduced motion puts everything on the 256 s phase, per section 10.3. */
const PHASE_16S = 5;
const PHASE_64S = 6;
const PHASE_256S = 7;

/** The nebula is created at this ratio: width / 2. */
function nebulaHeight(width: number): number {
  return width / 2;
}

function skyMesh(geometry: BufferGeometry, material: ShaderMaterial): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.renderOrder = RenderOrder.SKY;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

export function createSkyCore(o: SkyOptions = {}): SkyCore {
  let ctx: RenderContext | null = null;
  let geometry: BufferGeometry | null = null;
  let uniforms: SkyUniforms | null = null;
  let skyMaterial: ShaderMaterial | null = null;
  let lowMaterial: ShaderMaterial | null = null;
  let nebulaMaterial: ShaderMaterial | null = null;
  let mainMesh: Mesh | null = null;
  let lowMesh: Mesh | null = null;
  let target: WebGLRenderTarget | null = null;
  let nebulaOn = false;
  let low = false;
  let visible = true;
  const events = createSkyEvents();
  const size: [number, number] = [NEBULA_DEFAULT_WIDTH, nebulaHeight(NEBULA_DEFAULT_WIDTH)];
  const nebulaScene = new Scene();
  nebulaScene.matrixWorldAutoUpdate = false;
  const nebulaCamera = new Camera();

  /** One sky mesh draws: tier 0's program at tier 0, the other at tiers 1 to 4. Visibility is not a program key. */
  function showMeshes(): void {
    if (mainMesh) mainMesh.visible = visible && !low;
    if (lowMesh) lowMesh.visible = visible && low;
  }

  function writeUniforms(v: Readonly<FrameView>): void {
    if (!ctx || !uniforms) return;
    writeSkyEvents(ctx.world.seed, v.tick, v.alpha, v.zone, v.reducedMotion, events);
    const u = uniforms;
    const night = nightFactor(v.zone.dayPhase);
    u['uStarGain']!.value = STAR_GAIN_DAY + (1 - STAR_GAIN_DAY) * night;
    u['uNebGain']!.value = nebulaOn ? NEBULA_GAIN_DAY + (1 - NEBULA_GAIN_DAY) * night : 0;
    u['uStarPx']!.value = Math.max(1, ctx.renderer.domElement.height / 1080);
    const p = v.phases;
    const slow = p[PHASE_256S]!;
    u['uTwPhase']!.value = v.reducedMotion ? slow : p[PHASE_16S]!;
    const aurora = u['uAuP']!.value as Float32Array;
    aurora[0] = v.reducedMotion ? slow : p[PHASE_64S]!;
    aurora[1] = v.reducedMotion ? slow : p[PHASE_16S]!;
    u['uAurora']!.value = events.aurora;
    u['uBoltK']!.value = events.boltK;
    u['uFlash']!.value = events.flash;
  }

  function drawNebula(): void {
    if (!ctx || !target) return;
    const { renderer } = ctx;
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(nebulaScene, nebulaCamera);
    renderer.setRenderTarget(previous);
  }

  return {
    name: 'sky',
    get nebulaSize(): readonly [number, number] { return size; },
    attach(c: RenderContext): void {
      ctx = c;
      target = new WebGLRenderTarget(size[0], size[1], {
        type: HalfFloatType, format: RGBAFormat, depthBuffer: false, stencilBuffer: false,
        minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false,
      });
      geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
      uniforms = createSkyUniforms(target.texture, events);
      skyMaterial = createSkyMaterial(c.shared, uniforms, o);
      // Both sky meshes are in the scene from here, so precompile links both programs and a tier change links none.
      lowMaterial = createSkyMaterial(c.shared, uniforms, o, true);
      nebulaMaterial = createNebulaMaterial(c.shared);
      mainMesh = skyMesh(geometry, skyMaterial);
      lowMesh = skyMesh(geometry, lowMaterial);
      c.scene.add(mainMesh, lowMesh);
      showMeshes();
      const nebulaMesh = new Mesh(geometry, nebulaMaterial);
      nebulaMesh.frustumCulled = false;
      nebulaMesh.matrixAutoUpdate = false;
      nebulaScene.add(nebulaMesh);
    },
    setQuality(q: Readonly<QualityProfile>): void {
      nebulaOn = q.nebulaWidth > 0;
      low = q.tier === 0 && o.fullAtTier0 !== true;
      showMeshes();
      // At 0 the current target stays, the draw is skipped and the gain is 0, so the sampler stays valid.
      if (nebulaOn && target) {
        size[0] = q.nebulaWidth;
        size[1] = nebulaHeight(q.nebulaWidth);
        target.setSize(size[0], size[1]);   // reallocates only on a real change
      }
    },
    frame(v: Readonly<FrameView>): void {
      writeUniforms(v);
      // Every frame, as section 6.3 says: skipping frames would make the image depend on history and break identity.
      if (visible && nebulaOn) drawNebula();
    },
    rebuild(v: Readonly<FrameView>): void {
      writeUniforms(v);
      // Always, even at nebulaWidth 0: the program compiles at boot on every tier, and a context restore re-bakes the target.
      drawNebula();
    },
    setVisible(on: boolean): void {
      visible = on;
      showMeshes();
    },
    setDebugMode(): void {
      // No debug mode concerns the sky. A crack or edge-paint run that needs a clear background calls setVisible(false).
    },
    dispose(): void {
      if (ctx && mainMesh && lowMesh) ctx.scene.remove(mainMesh, lowMesh);
      target?.dispose();
      skyMaterial?.dispose();
      lowMaterial?.dispose();
      nebulaMaterial?.dispose();
      geometry?.dispose();
      ctx = null;
      target = null;
      uniforms = null;
      skyMaterial = null;
      lowMaterial = null;
      nebulaMaterial = null;
      mainMesh = null;
      lowMesh = null;
      geometry = null;
    },
  };
}
