// What dev/fx.html needs: the card, the speed lines and the post stack wired from the query string, plus window.__fx.
// Lint keeps this module away from src/testing, so the page itself hands the result to the dev shell.
// Query: bindtarget=0 rendervariants=0 keepalive=0 crtalpha=keep dither=0 gainmax=<n> flashwhite=1 scanperiod=<n>
// lineperiod=<n> governor=1 bootp95=<ms>, plus the card's own, see testCard.ts.
import type { Governor, PostStack, QualityProfile, RenderLayer, Tier } from '../../../contracts/index';
import { createGovernorImpl } from '../governor';
import { createPostStack, type PostDebug, type PostOptions } from '../post';
import { TIERS } from '../quality';
import { createSpeedLinesLayer } from '../speedLines';
import * as metrics from './metrics';
import { createTestCard } from './testCard';

/** Calls to linkProgram. renderer.info.programs.length is not a compile detector: it stayed at 8 across 12 links. */
let linkCount = 0;
let spying = false;

function installLinkSpy(): void {
  if (spying) return;
  spying = true;
  const real = WebGL2RenderingContext.prototype.linkProgram;
  WebGL2RenderingContext.prototype.linkProgram = function linkProgram(this: WebGL2RenderingContext, program: WebGLProgram): void {
    linkCount++;
    real.call(this, program);
  };
}

function optionsFrom(q: URLSearchParams): PostOptions {
  const o: PostOptions = {};
  if (q.get('bindtarget') === '0') o.bindTarget = false;
  if (q.get('rendervariants') === '0') o.renderVariants = false;
  if (q.get('keepalive') === '0') o.keepAlive = false;
  if (q.get('crtalpha') === 'keep') o.crtAlpha = 'keep';
  if (q.get('dither') === '0') o.dithering = false;
  const gain = q.get('gainmax');
  if (gain !== null) o.gainMax = Number(gain);
  if (q.get('flashwhite') === '1') o.flashWhite = true;
  const scan = q.get('scanperiod');
  if (scan !== null) o.scanPeriod = Number(scan);
  return o;
}

async function decodePng(b64: string): Promise<{ data: Uint8Array; width: number; height: number }> {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const c = canvas.getContext('2d', { willReadFrequently: true });
  if (!c) throw new Error('decodePng: no 2d context');
  c.drawImage(bitmap, 0, 0);
  const image = c.getImageData(0, 0, bitmap.width, bitmap.height);
  return { data: new Uint8Array(image.data.buffer), width: bitmap.width, height: bitmap.height };
}

export interface FxApi {
  post: PostStack;
  debug: PostDebug;
  fx: RenderLayer;
  TIERS: readonly Readonly<QualityProfile>[];
  metrics: typeof metrics;
  links(): number;
  /** The real table, on post and the fx layer. */
  setTier(t: Tier): void;
  showHidden(): void;
  /** The canvas drawn to w by h, read back. Same task as the frame, because the drawing buffer is not preserved. */
  compositeTo(w: number, h: number): Uint8Array;
  decodePng(b64: string): Promise<{ data: Uint8Array; width: number; height: number }>;
  /** Present under ?governor=1: feeds the governor one delta, applying any change through the real table. */
  governor: Governor | null;
  governorStep(ms: number): Tier | null;
}

declare global { interface Window { __fx?: FxApi } }

export interface FxDev {
  layers: RenderLayer[];
  post: PostStack;
  shellOptions: { tier?: Tier };
}

export function createFxDev(q: URLSearchParams): FxDev {
  installLinkSpy();
  const card = createTestCard(q);
  const period = q.get('lineperiod');
  const fx = createSpeedLinesLayer(period === null ? {} : { linePeriod: Number(period) });
  const post = createPostStack(optionsFrom(q));
  const governor = q.get('governor') === '1'
    ? createGovernorImpl({ software: false, bootP95Ms: Number(q.get('bootp95') ?? 0), forced: null })
    : null;

  function setTier(t: Tier): void {
    const profile = TIERS[t]!;
    fx.setQuality(profile);
    post.setQuality(profile);
  }

  window.__fx = {
    post,
    get debug() { return post.debug; },
    fx,
    TIERS,
    metrics,
    links: () => linkCount,
    setTier,
    showHidden: () => { card.showHidden(); },
    compositeTo(w: number, h: number): Uint8Array {
      const source = post.debug.composer.getRenderer().domElement;
      const canvas = new OffscreenCanvas(w, h);
      const c = canvas.getContext('2d', { willReadFrequently: true });
      if (!c) throw new Error('compositeTo: no 2d context');
      c.imageSmoothingEnabled = true;
      c.imageSmoothingQuality = 'high';
      c.drawImage(source, 0, 0, w, h);
      return new Uint8Array(c.getImageData(0, 0, w, h).data.buffer);
    },
    decodePng,
    governor,
    governorStep(ms: number): Tier | null {
      if (!governor) throw new Error('governorStep needs ?governor=1');
      const out = governor.sample(ms);
      if (out !== null) setTier(out);
      return out;
    },
  };

  // The shell's first tier comes from ?tier; under ?governor=1 the governor's boot tier stands in for it.
  const shellOptions: { tier?: Tier } = governor ? { tier: governor.profile.tier } : {};
  return { layers: [card, fx], post, shellOptions };
}
