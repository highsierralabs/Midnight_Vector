// The post stack of section 6.6: one composer, one merged EffectPass per variant over shared effect instances.
// setQuality and resize only record. Everything that touches GL happens in flushPending, at the start of the next
// frame, render or precompile, so nothing is applied during a context loss and several resizes in a frame coalesce.
import {
  BloomEffect, ChromaticAberrationEffect, EffectComposer, EffectPass, MipmapBlurPass, RenderPass,
  ToneMappingEffect, ToneMappingMode, VignetteEffect, type Effect,
} from 'postprocessing';
import { HalfFloatType, Vector2 } from 'three';
import type { FrameView, PostStack, PostVariant, QualityProfile, RenderContext } from '../../contracts/index';
import { withTimeout } from './asyncGuard';
import { CrtEffect } from './crt';
import { BLOOM_GAIN_MAX, BLOOM_INTENSITY, computePostParams, createPostParams } from './postParams';
import { pixelRatioFor, scanAmpFor } from './quality';

const VARIANTS: readonly PostVariant[] = ['full', 'noCa', 'min', 'bare'];
const COMPILE_GUARD_MS = 10_000;
const KEEP_ALIVE_LEVELS = 2;
const KEEP_ALIVE_SIZE = 4;
const BUILD_LEVELS = 6;

/** Every option is a dev-only negative control. createPost() passes none. */
export interface PostOptions {
  bindTarget?: boolean;      // false: compile with no target bound
  renderVariants?: boolean;  // false: precompile renders only the active variant
  keepAlive?: boolean;       // false: no keep-alive blur pass
  crtAlpha?: 'one' | 'keep'; // 'keep': Crt writes inputColor.a
  dithering?: boolean;       // false: no dithering on the passes
  gainMax?: number;          // replaces BLOOM_GAIN_MAX
  flashWhite?: boolean;      // flash colour is white at luma .18
  scanPeriod?: number;       // replaces scanPeriodFor, for the moire control and the look comparison
}

export interface PostDebug {
  composer: EffectComposer;
  variants: Record<PostVariant, EffectPass>;
  bloom: BloomEffect;
  ca: ChromaticAberrationEffect;
  tone: ToneMappingEffect;
  vignette: VignetteEffect;
  crt: CrtEffect;
  readonly activeVariant: PostVariant | 'off';
  readonly pixelRatio: number;
}

/** The one sanctioned cast in Agents.md: timeScale works but is untyped, and section 4.5 requires the freeze. */
function freezeTime(pass: EffectPass): void {
  (pass as unknown as { timeScale: number }).timeScale = 0;
}

interface Built extends PostDebug {
  ctx: RenderContext;
  keep: MipmapBlurPass | null;
}

export function createPostStack(o: PostOptions = {}): PostStack & { readonly debug: PostDebug } {
  const gainMax = o.gainMax ?? BLOOM_GAIN_MAX;
  const params = createPostParams();

  let built: Built | null = null;
  let quality: Readonly<QualityProfile> | null = null;
  let forcedVariant: PostVariant | 'off' | null = null;
  let forcedMsaa: 0 | 2 | 4 | null = null;
  let cssW = 0;
  let cssH = 0;
  let cssDpr = 1;

  let dirty = false;
  let active: PostVariant | 'off' = 'off';
  let appliedMsaa = -1;
  let appliedW = -1;
  let appliedH = -1;
  let appliedRatio = 1;

  function build(ctx: RenderContext): Built {
    const { renderer, scene, camera } = ctx;
    const composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType, multisampling: 0 });
    composer.autoRenderToScreen = false;
    composer.addPass(new RenderPass(scene, camera));
    // One instance each, shared by every variant that uses it.
    const ca = new ChromaticAberrationEffect({ offset: new Vector2(0.0006, 0.0003), radialModulation: true, modulationOffset: 0.35 });
    const bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.95, luminanceSmoothing: 0.25, intensity: BLOOM_INTENSITY, radius: 0.68, levels: BUILD_LEVELS });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL });
    const crt = new CrtEffect(o.crtAlpha ?? 'one');
    const vignette = new VignetteEffect({ offset: 0.3, darkness: 0.55 });
    const make = (...effects: Effect[]): EffectPass => {
      const pass = new EffectPass(camera, ...effects);
      freezeTime(pass);
      pass.dithering = o.dithering ?? true;
      pass.renderToScreen = true;
      pass.enabled = false;
      composer.addPass(pass);
      return pass;
    };
    const variants: Record<PostVariant, EffectPass> = {
      full: make(ca, bloom, tone, crt, vignette),
      noCa: make(bloom, tone, crt, vignette),
      min: make(bloom, tone, crt, vignette),
      bare: make(tone, crt),
    };
    let keep: MipmapBlurPass | null = null;
    if (o.keepAlive !== false) {
      keep = new MipmapBlurPass();
      keep.levels = KEEP_ALIVE_LEVELS;
      keep.initialize(renderer, true, HalfFloatType);
      keep.setSize(KEEP_ALIVE_SIZE, KEEP_ALIVE_SIZE);
    }
    return {
      ctx, composer, variants, bloom, ca, tone, vignette, crt, keep,
      get activeVariant() { return active; },
      get pixelRatio() { return appliedRatio; },
    };
  }

  /** The variant whose parameters a frame uses. Under 'off' they are computed but unused, so the profile's serve. */
  function paramVariant(): PostVariant {
    if (forcedVariant !== null && forcedVariant !== 'off') return forcedVariant;
    return quality ? quality.post : 'full';
  }

  function enableOnly(b: Built, v: PostVariant | 'off'): void {
    for (const name of VARIANTS) b.variants[name].enabled = name === v;
  }

  function flushPending(): void {
    if (!dirty || !built || !quality) return;
    dirty = false;
    const b = built;
    const { renderer } = b.ctx;
    const q = quality;
    // A bare profile leaves the levels alone: MipmapBlurPass throws going from non-zero to 0 (DI-46).
    if (q.bloomLevels > 0 && b.bloom.mipmapBlurPass.levels !== q.bloomLevels) b.bloom.mipmapBlurPass.levels = q.bloomLevels;
    const msaa = forcedMsaa ?? q.msaa;
    if (msaa !== appliedMsaa) {
      b.composer.multisampling = msaa;
      appliedMsaa = msaa;
    }
    active = forcedVariant ?? q.post;
    enableOnly(b, active);
    if (cssW >= 1 && cssH >= 1) {
      const r = pixelRatioFor(q, cssW, cssH, cssDpr);
      if (r !== appliedRatio || cssW !== appliedW || cssH !== appliedH) {
        renderer.setPixelRatio(r);
        renderer.setSize(cssW, cssH);
        b.composer.setSize(cssW, cssH);
        appliedRatio = r;
        appliedW = cssW;
        appliedH = cssH;
      }
    }
  }

  function need(): Built {
    if (!built) throw new Error('PostStack: attach has not run');
    return built;
  }

  const stack: PostStack & { readonly debug: PostDebug } = {
    get debug(): PostDebug {
      return need();
    },
    attach(ctx: RenderContext): void {
      built = build(ctx);
      appliedRatio = ctx.renderer.getPixelRatio();
      dirty = true;
    },
    async precompile(): Promise<void> {
      flushPending();
      const b = need();
      const { renderer, scene, camera } = b.ctx;
      if (o.bindTarget !== false) renderer.setRenderTarget(b.composer.inputBuffer);
      const compiled = renderer.compileAsync(scene, camera);   // compile() runs synchronously inside this call
      renderer.setRenderTarget(null);                          // do not hold the binding across the await
      await withTimeout(compiled, COMPILE_GUARD_MS, () => {
        console.warn('PostStack: compileAsync did not finish in 10 s, continuing');
      });
      // A resize or tier change may have arrived during the await.
      flushPending();
      // The active variant goes last in one task, so only it is ever presented.
      if (o.renderVariants !== false) {
        for (const name of VARIANTS) {
          if (name === active) continue;
          enableOnly(b, name);
          b.composer.render(0);
        }
      }
      enableOnly(b, active);
      if (active !== 'off') b.composer.render(0);
      // It keeps both blur programs alive, so a bloom level change links nothing. A restore empties the program
      // cache, so it renders in every precompile. It draws to its own 4x4 target, not the canvas.
      if (b.keep) b.keep.render(renderer, b.composer.inputBuffer, b.composer.outputBuffer);
      renderer.setRenderTarget(null);
    },
    setQuality(q: Readonly<QualityProfile>): void {
      quality = q;
      dirty = true;
    },
    resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void {
      if (cssWidth < 1 || cssHeight < 1) return;
      cssW = cssWidth;
      cssH = cssHeight;
      cssDpr = devicePixelRatio;
      dirty = true;
    },
    frame(v: Readonly<FrameView>): void {
      flushPending();
      const b = need();
      computePostParams(v, paramVariant(), appliedRatio, gainMax, params);
      if (o.scanPeriod !== undefined && params.scan > 0) params.scan = scanAmpFor(o.scanPeriod);
      if (o.flashWhite) {
        params.flashR = 0.18;
        params.flashG = 0.18;
        params.flashB = 0.18;
      }
      b.ca.offset.set(params.caX, params.caY);
      b.bloom.intensity = params.bloomIntensity;
      b.crt.apply(params, o.scanPeriod ?? null);
      b.ctx.renderer.toneMappingExposure = params.exposure;
    },
    render(dt: number): void {
      flushPending();
      const b = need();
      if (active === 'off') {
        const { renderer, scene, camera } = b.ctx;
        renderer.setRenderTarget(null);
        renderer.autoClear = true;
        renderer.render(scene, camera);
        renderer.autoClear = false;
        return;
      }
      b.composer.render(dt);
    },
    rebuild(): void {
      if (built) built.ctx.renderer.autoClear = false;
      dirty = true;
    },
    forceVariant(v: PostVariant | 'off' | null): void {
      forcedVariant = v;
      dirty = true;
    },
    forceMsaa(n: 0 | 2 | 4 | null): void {
      forcedMsaa = n;
      dirty = true;
    },
    dispose(): void {
      if (!built) return;
      built.composer.dispose();
      built.keep?.dispose();
      built = null;
    },
  };
  return stack;
}
