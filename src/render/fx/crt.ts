// The custom last-but-one effect: flash, glitch, scan and grain in one pass, and the final alpha write (section 6.6).
import { BlendFunction, Effect } from 'postprocessing';
import { Uniform, Vector3 } from 'three';
import source from './crt.frag.glsl?raw';
import type { PostParams } from './postParams';

const ALPHA_ONE = 'outputColor = vec4(max(c, vec3(0.)), 1.);';
const ALPHA_KEEP = 'outputColor = vec4(max(c, vec3(0.)), inputColor.a);';

/** 'keep' is the alpha gate's negative control. It writes what the scene wrote, so the page shows through. */
function fragmentFor(alpha: 'one' | 'keep'): string {
  if (alpha === 'one') return source;
  if (!source.includes(ALPHA_ONE)) throw new Error('crt.frag.glsl: the alpha line changed, so the control cannot find it');
  return source.replace(ALPHA_ONE, ALPHA_KEEP);
}

export class CrtEffect extends Effect {
  // Direct references, so a frame does no Map lookups. Vector3 rather than Color, whose setters may convert (Agents.md).
  private readonly scan: Uniform<number>;
  private readonly scanPeriod: Uniform<number>;
  private readonly grain: Uniform<number>;
  private readonly grainFrame: Uniform<number>;
  private readonly flash: Uniform<number>;
  private readonly flashColor: Uniform<Vector3>;
  private readonly glitch: Uniform<number>;

  constructor(alpha: 'one' | 'keep' = 'one') {
    const scan = new Uniform(0);
    const scanPeriod = new Uniform(3);
    const grain = new Uniform(0);
    const grainFrame = new Uniform(0);
    const flash = new Uniform(0);
    const flashColor = new Uniform(new Vector3());
    const glitch = new Uniform(0);
    super('CrtEffect', fragmentFor(alpha), {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, Uniform>([
        ['uScan', scan], ['uScanPeriod', scanPeriod], ['uGrain', grain], ['uGrainFrame', grainFrame],
        ['uFlash', flash], ['uFlashColor', flashColor], ['uGlitch', glitch],
      ]),
    });
    this.scan = scan;
    this.scanPeriod = scanPeriod;
    this.grain = grain;
    this.grainFrame = grainFrame;
    this.flash = flash;
    this.flashColor = flashColor;
    this.glitch = glitch;
  }

  /** Writes the frame's values. scanPeriodOverride is the dev-only moire control. No allocation. */
  apply(p: Readonly<PostParams>, scanPeriodOverride: number | null): void {
    this.scan.value = p.scan;
    this.scanPeriod.value = scanPeriodOverride ?? p.scanPeriod;
    this.grain.value = p.grain;
    this.grainFrame.value = p.grainFrame;
    this.flash.value = p.flash;
    this.flashColor.value.set(p.flashR, p.flashG, p.flashB);
    this.glitch.value = p.glitch;
  }
}
