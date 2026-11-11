// A small real composer stack for the shell target: real bloom, real half-float, real three allocation, with no T06.
// T00's DevPost is not used because its bloom is not specified to read bloomGain. full: Bloom at section 6.6 values,
// Neutral tone mapping, an alpha-1 write. bare: Neutral and alpha-1. full, noCa and min all select full. Variants are
// prebuilt and swapped with .enabled, as section 6.6 says.
import { BlendFunction, BloomEffect, Effect, EffectComposer, EffectPass, RenderPass, ToneMappingEffect, ToneMappingMode } from 'postprocessing';
import { HalfFloatType } from 'three';
import type { FrameView, PostStack, PostVariant, QualityProfile, RenderContext } from '../../../src/contracts/index';

const FALLBACK_LEVELS = 6;

class AlphaOneEffect extends Effect {
  constructor() {
    super('AlphaOneEffect', 'void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) { outputColor = vec4(inputColor.rgb, 1.); }', {
      blendFunction: BlendFunction.SRC,
    });
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function createLabPost(): PostStack {
  let ctx: RenderContext | null = null;
  let composer: EffectComposer | null = null;
  let bloom: BloomEffect | null = null;
  let passFull: EffectPass | null = null;
  let passBare: EffectPass | null = null;
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

  function selectPass(): void {
    if (!passFull || !passBare || !quality) return;
    const v = variant === null || variant === 'off' ? quality.post : variant;
    const bare = v === 'bare';
    passFull.enabled = !bare;
    passBare.enabled = bare;
  }

  function pass(c: RenderContext, ...effects: Effect[]): EffectPass {
    const p = new EffectPass(c.camera, ...effects);
    p.dithering = true;
    // The one sanctioned cast in Agents.md: timeScale works but is untyped, and section 4.5 requires the freeze.
    (p as unknown as { timeScale: number }).timeScale = 0;
    p.renderToScreen = true;
    return p;
  }

  /** The one place GL state changes, so GL is never touched while the context is lost. */
  function apply(): void {
    if (!ctx || !quality) return;
    if (!composer) {
      composer = new EffectComposer(ctx.renderer, { frameBufferType: HalfFloatType, multisampling: forcedMsaa ?? quality.msaa });
      composer.autoRenderToScreen = false;
      composer.addPass(new RenderPass(ctx.scene, ctx.camera));
      bloom = new BloomEffect({
        mipmapBlur: true,
        luminanceThreshold: 0.95,
        luminanceSmoothing: 0.25,
        intensity: 0.8,
        radius: 0.68,
        levels: quality.bloomLevels > 0 ? quality.bloomLevels : FALLBACK_LEVELS,
      });
      passFull = pass(ctx, bloom, new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL }), new AlphaOneEffect());
      passBare = pass(ctx, new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL }), new AlphaOneEffect());
      composer.addPass(passFull);
      composer.addPass(passBare);
      selectPass();
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
    if (qualityDirty && bloom && quality.bloomLevels > 0) bloom.mipmapBlurPass.levels = quality.bloomLevels;
    if (qualityDirty || sizeDirty) applySize(ctx, composer);
    qualityDirty = false;
    sizeDirty = false;
    selectPass();
  }

  function drawDirect(c: RenderContext): void {
    const { renderer, scene, camera } = c;
    const auto = renderer.autoClear;
    renderer.setRenderTarget(null);
    renderer.autoClear = true;
    renderer.render(scene, camera);
    renderer.autoClear = auto;
  }

  return {
    attach(c: RenderContext): void {
      ctx = c;
    },
    async precompile(): Promise<void> {
      apply();
      if (!ctx || !composer || !passFull || !passBare) return;
      // A program's cache key includes the output colour space, so compile with the composer's target bound (Agents.md).
      ctx.renderer.setRenderTarget(composer.inputBuffer);
      await ctx.renderer.compileAsync(ctx.scene, ctx.camera);
      ctx.renderer.setRenderTarget(null);
      passFull.enabled = true;
      passBare.enabled = false;
      composer.render(0);
      passFull.enabled = false;
      passBare.enabled = true;
      composer.render(0);
      drawDirect(ctx);
      selectPass();
    },
    setQuality(q: Readonly<QualityProfile>): void {
      quality = q;
      qualityDirty = true;
    },
    resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void {
      size = { w: cssWidth, h: cssHeight, dpr: devicePixelRatio };
      sizeDirty = true;
    },
    frame(v: Readonly<FrameView>): void {
      apply();
      if (bloom) bloom.intensity = 0.8 * clamp(v.feel.bloomGain, 0, 1.5);
    },
    render(dt: number): void {
      apply();
      if (!ctx || !composer) return;
      if (variant === 'off') {
        drawDirect(ctx);
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
      passFull = null;
      passBare = null;
      ctx = null;
    },
  };
}
