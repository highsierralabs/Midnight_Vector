// The default post stack of the dev shell: HDR half-float, MSAA from the profile, Bloom and Neutral tone mapping at
// section 6.6 values, a final alpha-1 write. No CA, Crt or vignette, so T03 to T05 shots lack scanlines and grain, and
// T06 and T11 own the final look. setQuality and resize only record, and apply at the next frame, render or precompile,
// like the real PostStack (section 8.1).
import { BlendFunction, BloomEffect, Effect, EffectComposer, EffectPass, RenderPass, ToneMappingEffect, ToneMappingMode } from 'postprocessing';
import { HalfFloatType } from 'three';
import type { PostStack, PostVariant, QualityProfile, RenderContext } from '../contracts/index';

const FALLBACK_LEVELS = 6;

/** The first build's bloom levels. A bloom built at 0 never renders its target, so a first profile with none keeps a working count (DI-46). */
export function firstBloomLevels(q: Readonly<QualityProfile>): number {
  return q.bloomLevels > 0 ? q.bloomLevels : FALLBACK_LEVELS;
}

class AlphaOneEffect extends Effect {
  constructor() {
    super('AlphaOneEffect', 'void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) { outputColor = vec4(inputColor.rgb, 1.); }', {
      blendFunction: BlendFunction.SRC,
    });
  }
}

/** The one sanctioned cast in Agents.md: timeScale works but is untyped, and section 4.5 requires the freeze. */
function freezeEffectTime(pass: EffectPass): void {
  (pass as unknown as { timeScale: number }).timeScale = 0;
}

export function createDevPost(): PostStack {
  let ctx: RenderContext | null = null;
  let composer: EffectComposer | null = null;
  let bloom: BloomEffect | null = null;
  let quality: Readonly<QualityProfile> | null = null;
  let qualityDirty = false;
  let size: { w: number; h: number; dpr: number } | null = null;
  let sizeDirty = false;
  let variant: PostVariant | 'off' | null = null;
  let forcedMsaa: 0 | 2 | 4 | null = null;
  let msaaDirty = false;

  function applySize(c: RenderContext, built: EffectComposer): void {
    if (!size || !quality) return;
    const ratio = Math.min(size.dpr, quality.dprCap, Math.sqrt(quality.maxPixels / (size.w * size.h)));
    c.renderer.setPixelRatio(ratio);
    c.renderer.setSize(size.w, size.h);
    built.setSize(size.w, size.h);
  }

  /** The one place GL state changes, so GL is never touched while the context is lost. */
  function apply(): void {
    if (!ctx || !quality) return;
    if (!composer) {
      composer = new EffectComposer(ctx.renderer, { frameBufferType: HalfFloatType, multisampling: forcedMsaa ?? quality.msaa });
      composer.addPass(new RenderPass(ctx.scene, ctx.camera));
      bloom = new BloomEffect({
        mipmapBlur: true,
        luminanceThreshold: 0.95,
        luminanceSmoothing: 0.25,
        intensity: 0.8,
        radius: 0.68,
        levels: firstBloomLevels(quality),
      });
      const tone = new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL });
      const pass = new EffectPass(ctx.camera, bloom, tone, new AlphaOneEffect());
      pass.dithering = true;
      freezeEffectTime(pass);
      composer.addPass(pass);
      qualityDirty = false;
      msaaDirty = false;
      sizeDirty = false;
      applySize(ctx, composer);
      return;
    }
    if (qualityDirty || msaaDirty) {
      composer.multisampling = forcedMsaa ?? quality.msaa;
      msaaDirty = false;
    }
    if (qualityDirty) {
      // DI-46: at bloomLevels 0 the levels are left unchanged.
      if (bloom && quality.bloomLevels > 0) bloom.mipmapBlurPass.levels = quality.bloomLevels;
    }
    if (qualityDirty || sizeDirty) applySize(ctx, composer);
    qualityDirty = false;
    sizeDirty = false;
  }

  return {
    attach(c: RenderContext): void {
      ctx = c;
    },
    async precompile(): Promise<void> {
      apply();
      if (!ctx || !composer) return;
      // A program's cache key includes the output colour space, so compile with the composer's target bound (Agents.md).
      ctx.renderer.setRenderTarget(composer.inputBuffer);
      await ctx.renderer.compileAsync(ctx.scene, ctx.camera);
      ctx.renderer.setRenderTarget(null);
      composer.render(0);
    },
    setQuality(q: Readonly<QualityProfile>): void {
      quality = q;
      qualityDirty = true;
    },
    resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void {
      size = { w: cssWidth, h: cssHeight, dpr: devicePixelRatio };
      sizeDirty = true;
    },
    frame(): void {
      apply();
    },
    render(dt: number): void {
      apply();
      if (!ctx || !composer) return;
      if (variant === 'off') {
        const { renderer, scene, camera } = ctx;
        const auto = renderer.autoClear;
        renderer.setRenderTarget(null);
        renderer.autoClear = true;
        renderer.render(scene, camera);
        renderer.autoClear = auto;
        return;
      }
      composer.render(dt);
    },
    rebuild(): void {
      // Cheap and GL-free, per section 8.1. The stack has no state of its own to refill.
    },
    forceVariant(v: PostVariant | 'off' | null): void {
      variant = v;
    },
    forceMsaa(n: 0 | 2 | 4 | null): void {
      forcedMsaa = n;
      msaaDirty = true;
    },
    dispose(): void {
      composer?.dispose();
      composer = null;
      bloom = null;
      ctx = null;
    },
  };
}
