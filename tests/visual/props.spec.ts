// All of T05's browser tests. Tests needing 1080p skip outside gpu, and software: tests skip outside software, because
// T00's routing puts every plain *.spec.ts under both. Comparisons are between frames in one run, so nothing goes stale between machines.
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page, PlaywrightWorkerArgs, TestInfo } from 'playwright/test';
import type { Mesh, Object3D, PerspectiveCamera, ShaderMaterial, WebGLRenderer } from 'three';
import { findChromium } from '../support/browser';
import { expect, openDevPage, test } from '../support/pw';
import { checkRasterizer } from '../support/rasterizer';
import type {} from '../../src/harness/index';
import type {} from '../../src/render/props/dev/types';

const PAGE = '/dev/props.html';

function savePng(info: TestInfo, name: string, dataUrl: string): string {
  const path = info.outputPath(name);
  writeFileSync(path, Buffer.from(dataUrl.split(',')[1]!, 'base64'));
  console.log(`SCREENSHOT ${path}`);
  return path;
}

async function open(page: Page, query: Record<string, string | number>): Promise<void> {
  await openDevPage(page, PAGE, { manual: 1, ...query });
}

function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 === 0 ? (s[n / 2 - 1]! + s[n / 2]!) / 2 : s[(n - 1) / 2]!;
}

type Backend = 'd3d11' | 'vulkan';

/**
 * Same-state pixel comparisons (A6, A7, A10, A11) compare single frames, each with a self-compare beside it: the same state drawn again,
 * which must stay within SELF_BYTES with no byte over 1 level, or the comparison would be measuring noise. On ANGLE's D3D11 path a
 * blended sample at MSAA 2 or 4 varies from frame to frame, by 1 level at up to 173 bytes here, even under MAX blending, which is exact
 * and order-free. MSAA 0 on D3D11, and MSAA 4 on ANGLE's Vulkan backend on the same GPU and page, repeat exactly (plan section 10). So
 * these rows run at tier 2 (MSAA 0) on the gpu project's D3D11, and at tier 3 (MSAA 2) on Vulkan in the 'gpu vulkan' block. No
 * closest-of-N and no page-load retries remain.
 */
const SELF_BYTES = 16;
const IDENTITY_TIER: Readonly<Record<Backend, 2 | 3>> = { d3d11: 2, vulkan: 3 };

type PlaywrightLib = PlaywrightWorkerArgs['playwright'];

type ByteDiff = { bytes: number; max: number };
interface OrbHeroFrames { width: number; height: number; lit: number; d2: ByteDiff; d3: ByteDiff; self: ByteDiff; strip: string | null }
type OrbHeroRow = OrbHeroFrames & { tier: number };
/** A37's control: at tiers 1 to 4 a hero 2 or 3 frame of the close orbs must differ from hero 0 by more than this. */
const ORB_HERO_MIN_BYTES = 1000;

/**
 * A37 (DI-85), run in the page: three close orbs alone, backdrop hidden and no mirror, drawn at hero 0, again at hero 0, then at
 * hero 2 and 3. Returns each against the first hero 0 frame, the lit pixel count, and optionally a strip of the three modes.
 */
function orbHeroFrames(strip: boolean): OrbHeroFrames {
  const P = window.__props!;
  const shell = P.shell;
  P.backdrop.setVisible(false);
  P.debug!.setMirrorAllowed(false);
  const at0 = { chunk: 4000, local: 0 };
  // One per row (rows start at 0, 64 and 128 u), so tier 0's density, .08 of each row's rank-lifted keep, keeps all three.
  P.sheetWorld!.selectMany([
    { source: 'prop', kind: 3, place: { at: at0, distance: 26, x: -7, y: 7, scale: 2.2 } },
    { source: 'prop', kind: 3, place: { at: at0, distance: 70, x: 9, y: 9, scale: 3 } },
    { source: 'prop', kind: 3, place: { at: at0, distance: 140, x: -20, y: 14, scale: 4 } },
  ]);
  const frame = (hero: 0 | 2 | 3): void => { shell.frameAt(0, { at: at0, tick: 0, palette: 0, hero, bend: { a: 0, c: 0 } }); };
  frame(0);
  shell.rebuild();
  const gl = shell.ctx.renderer.getContext();
  const w = gl.drawingBufferWidth;
  const h = gl.drawingBufferHeight;
  const out = strip ? document.createElement('canvas') : null;
  const ctx = out ? out.getContext('2d')! : null;
  if (out) { out.width = 3 * 640; out.height = 360; }
  const grab = (hero: 0 | 2 | 3, slot: number): Uint8Array => {
    frame(hero);
    // Same task as the render (plan section 10), before the drawing buffer is cleared.
    if (ctx) ctx.drawImage(shell.ctx.renderer.domElement, 0, 0, w, h, slot * 640, 0, 640, 360);
    return shell.pixels();
  };
  const diff = (x: Uint8Array, y: Uint8Array): ByteDiff => {
    let bytes = 0;
    let max = 0;
    for (let i = 0; i < x.length; i++) {
      const d = Math.abs(x[i]! - y[i]!);
      if (d) { bytes++; if (d > max) max = d; }
    }
    return { bytes, max };
  };
  const h0 = grab(0, 0);
  const again = grab(0, 0);
  const h2 = grab(2, 1);
  const h3 = grab(3, 2);
  let lit = 0;
  for (let i = 0; i < h0.length; i += 4) if (h0[i]! + h0[i + 1]! + h0[i + 2]! > 12) lit++;
  return { width: w, height: h, lit, d2: diff(h0, h2), d3: diff(h0, h3), self: diff(h0, again), strip: out ? out.toDataURL('image/png') : null };
}

/**
 * Runs body on a page of the given backend. D3D11 is the gpu project's own fixture page. Vulkan is the same Chromium launched with
 * --use-angle=vulkan, since Playwright allows no launchOptions inside a describe, with the shared fixture's two guards: favicon answered
 * 204, and any console error or page error fails the test.
 */
async function onBackend(backend: Backend, fixturePage: Page, playwright: PlaywrightLib, body: (page: Page) => Promise<void>): Promise<void> {
  if (backend === 'd3d11') {
    await body(fixturePage);
    return;
  }
  const exe = findChromium('gpu');
  const browser = await playwright.chromium.launch({ ...(exe ? { executablePath: exe } : {}), headless: true, args: ['--ignore-gpu-blocklist', '--use-angle=vulkan'] });
  try {
    const baseURL = test.info().project.use.baseURL;
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ...(baseURL ? { baseURL } : {}) });
    const page = await context.newPage();
    await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204 }));
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
    page.on('pageerror', (e) => { errors.push(`pageerror: ${e.message}`); });
    // DI-70: where the launch did not get ANGLE on a Vulkan GPU, the block skips and says why, instead of failing in expectBackend.
    const why = vulkanSkipReason(await launchedRenderer(page));
    if (why !== null) {
      console.log(`SKIP ${test.info().titlePath.slice(1).join(' > ')}: ${why}`);
      test.skip(true, why);
    }
    await body(page);
    expect(errors, 'console errors on the Vulkan page').toEqual([]);
  } finally {
    await browser.close();
  }
}

/** The WebGL2 renderer a freshly launched page reports on about:blank, or null with no WebGL2 context. The probe's context is released. */
async function launchedRenderer(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return renderer;
  });
}

/**
 * Why the 'gpu vulkan' block cannot run on this renderer, or null when it can. SwiftShader names Vulkan in its renderer string
 * ("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device ...") but is not the GPU these rows are about, so it skips too.
 */
function vulkanSkipReason(renderer: string | null): string | null {
  if (renderer === null) return 'the --use-angle=vulkan launch has no WebGL2 context';
  if (!/Vulkan/.test(renderer)) return `the --use-angle=vulkan launch reports ${renderer}, not ANGLE on Vulkan`;
  if (/SwiftShader/i.test(renderer)) return `the --use-angle=vulkan launch reports ${renderer}, a software Vulkan, not a GPU`;
  return null;
}

/** A run cannot pass on the wrong backend: the Vulkan block must not fall back to D3D11 or SwiftShader, nor the gpu project leave D3D11 on Windows. */
async function expectBackend(page: Page, backend: Backend): Promise<void> {
  const renderer = await page.evaluate(() => window.__shell!.rendererInfo().renderer);
  if (backend === 'vulkan') {
    expect(renderer, 'the gpu vulkan block needs ANGLE on Vulkan').toMatch(/Vulkan/);
    expect(renderer, 'the gpu vulkan block needs a GPU, not SwiftShader').not.toMatch(/SwiftShader/i);
  } else if (process.platform === 'win32') expect(renderer, 'the gpu project runs ANGLE on D3D11').toMatch(/Direct3D11|D3D11/);
}

// Rings with no mirror, so a placeholder shows once: PYRAMID reaches 4000 u, BILLBOARD 1600 u.
const UNMIRRORED_FAR = 2;
const UNMIRRORED_1600 = 5;

/** A6, A7, A10 and A11: single frames, each beside a self-compare within SELF_BYTES. Called from the 'gpu' and 'gpu vulkan' blocks. */
function identityRows(backend: Backend): void {
  const tier = IDENTITY_TIER[backend];

  test(`ring: fifo equals rebuild, ${backend} tier ${tier}`, async ({ page: fixturePage, playwright }) => {
    test.setTimeout(900_000);
    await onBackend(backend, fixturePage, playwright, async (page) => {
      for (const chunk of [1000, 65400, 2 ** 40, 2 ** 48 - 2000]) {
        await open(page, { scene: 'worst', tier });
        await expectBackend(page, backend);
        const r = await page.evaluate((chunk) => {
          const P = window.__props!;
          const shell = P.shell;
          // 1200 frames at 16 u is 300 crossings, and a start at local 60 ends at local 60.
          let c = chunk;
          let l = 60;
          shell.frameAt(0, { at: { chunk: c, local: l }, tick: 0 });
          for (let i = 1; i <= 1200; i++) {
            l += 16;
            if (l >= 64) { l -= 64; c += 1; }
            shell.frameAt(0, { at: { chunk: c, local: l }, tick: i });
          }
          const end = { at: { chunk: c, local: l }, tick: 1200 };
          const walked = shell.pixels();
          let self = 0;
          let selfMax = 0;
          const again = (ref: Uint8Array): void => {
            shell.frameAt(0, end);
            const d = P.metrics.pixelDiff(ref, shell.pixels());
            self = Math.max(self, d.bytes);
            selfMax = Math.max(selfMax, d.max);
          };
          again(walked);
          shell.rebuild();
          shell.frameAt(0, end);
          const rebuilt = shell.pixels();
          again(rebuilt);
          return { end: { c, l }, d: P.metrics.pixelDiff(walked, rebuilt), self, selfMax };
        }, chunk);
        console.log(`A6 ${backend} tier ${tier} from ${chunk}: end ${JSON.stringify(r.end)}, single frames differ by ${r.d.bytes} bytes, largest ${r.d.max}; self-compare ${r.self} bytes, largest ${r.selfMax}`);
        expect(r.self).toBeLessThanOrEqual(SELF_BYTES);
        expect(r.selfMax).toBeLessThanOrEqual(1);
        expect(r.d.bytes).toBeLessThanOrEqual(32);
        expect(r.d.max).toBeLessThanOrEqual(2);
      }
    });
  });

  test(`ring: distance identity, ${backend} tier ${tier}`, async ({ page: fixturePage, playwright }) => {
    test.setTimeout(240_000);
    await onBackend(backend, fixturePage, playwright, async (page) => {
      await open(page, { scene: 'road', period: 1024, tier });
      await expectBackend(page, backend);
      const out = await page.evaluate(() => {
        const P = window.__props!;
        const shell = P.shell;
        const frame = (k: number) => {
          shell.frameAt(0, { at: { chunk: k, local: 20 }, tick: 120, palette: 0, bend: { a: 0, c: 0 } });
          shell.rebuild();
          shell.frameAt(0, { at: { chunk: k, local: 20 }, tick: 120, palette: 0, bend: { a: 0, c: 0 } });
          return shell.pixels();
        };
        const far = 5 + 1024 * 2 ** 37;
        const a = frame(5);
        const b = frame(far);
        const d = P.metrics.pixelDiff(a, b);
        // Self-compare: each state drawn again, after the other one.
        const sa = P.metrics.pixelDiff(a, frame(5));
        const sb = P.metrics.pixelDiff(b, frame(far));
        const lumaA = P.metrics.meanLuma(a);
        const lumaB = P.metrics.meanLuma(b);
        // A 30-frame walk from each, by 64 x 36 block average.
        const blocks = (px: Uint8Array, w: number, h: number): Float32Array => {
          const out = new Float32Array(64 * 36 * 3);
          const bw = w / 64;
          const bh = h / 36;
          for (let y = 0; y < h; y++) {
            const by = Math.min(35, Math.floor(y / bh));
            for (let x = 0; x < w; x++) {
              const bx = Math.min(63, Math.floor(x / bw));
              const o = (y * w + x) * 4;
              const t = (by * 64 + bx) * 3;
              out[t] = out[t]! + px[o]!;
              out[t + 1] = out[t + 1]! + px[o + 1]!;
              out[t + 2] = out[t + 2]! + px[o + 2]!;
            }
          }
          const n = bw * bh;
          for (let i = 0; i < out.length; i++) out[i] = out[i]! / n;
          return out;
        };
        const gl = shell.ctx.renderer.getContext();
        const walk = (k: number): Float32Array[] => {
          const list: Float32Array[] = [];
          shell.frameAt(0, { at: { chunk: k, local: 20 }, tick: 120, palette: 0, bend: { a: 0, c: 0 } });
          shell.rebuild();
          let c = k;
          let l = 20;
          for (let f = 1; f <= 30; f++) {
            l += 16;
            if (l >= 64) { l -= 64; c += 1; }
            shell.frameAt(0, { at: { chunk: c, local: l }, tick: 120 + f, palette: 0, bend: { a: 0, c: 0 } });
            list.push(blocks(shell.pixels(), gl.drawingBufferWidth, gl.drawingBufferHeight));
          }
          return list;
        };
        const wa = walk(5);
        const wb = walk(far);
        let worst = 0;
        for (let f = 0; f < wa.length; f++) {
          for (let i = 0; i < wa[f]!.length; i++) worst = Math.max(worst, Math.abs(wa[f]![i]! - wb[f]![i]!));
        }
        return { d, self: Math.max(sa.bytes, sb.bytes), selfMax: Math.max(sa.max, sb.max), lumaA, lumaB, worst };
      });
      console.log(`A7 ${backend} tier ${tier}: single frames differ by ${out.d.bytes} bytes, largest ${out.d.max}; self-compare ${out.self} bytes, largest ${out.selfMax}; mean luma ${out.lumaA.toFixed(2)} and ${out.lumaB.toFixed(2)}; 30-frame walk block difference at most ${out.worst.toFixed(3)} levels`);
      expect(out.self).toBeLessThanOrEqual(SELF_BYTES);
      expect(out.selfMax).toBeLessThanOrEqual(1);
      expect(out.d.bytes).toBeLessThanOrEqual(16);
      expect(out.d.max).toBeLessThanOrEqual(1);
      expect(out.lumaA).toBeGreaterThan(1);
      expect(out.lumaB).toBeGreaterThan(1);
      expect(out.worst).toBeLessThanOrEqual(1);
    });
  });

  test(`ring: uploads, ${backend} tier ${tier}`, async ({ page: fixturePage, playwright }) => {
    test.setTimeout(240_000);
    await onBackend(backend, fixturePage, playwright, async (page) => {
      await open(page, { scene: 'worst', tier });
      await expectBackend(page, backend);
      const out = await page.evaluate(() => {
        const P = window.__props!;
        const shell = P.shell;
        const gl = shell.ctx.renderer.getContext() as WebGL2RenderingContext;
        let c = 3000;
        const step = (n: number, tick: number): void => {
          for (let i = 0; i < n; i++) {
            c++;
            shell.frameAt(0, { at: { chunk: c, local: 0 }, tick: tick + i });
          }
        };
        shell.frameAt(0, { at: { chunk: c, local: 0 }, tick: 0 });
        let calls = 0;
        let bytes = 0;
        const orig = gl.bufferSubData.bind(gl) as (...a: unknown[]) => void;
        const wrapped = (...a: unknown[]): void => {
          calls++;
          const data = a[2] as ArrayBufferView;
          const length = (a[4] as number | undefined);
          bytes += length !== undefined && length > 0 ? length * 4 : data.byteLength;
          orig(...a);
        };
        (gl as unknown as { bufferSubData: unknown }).bufferSubData = wrapped;
        const perCrossing: { calls: number; bytes: number }[] = [];
        for (let i = 0; i < 20; i++) {
          calls = 0;
          bytes = 0;
          step(1, 100 + i);
          perCrossing.push({ calls, bytes });
        }
        const pendingAfterRender = [];
        for (let i = 0; i < 26; i++) pendingAfterRender.push(P.debug!.pendingRanges(i));

        // Hidden for 200 crossings: ranges stay bounded, and the first frame after showing equals a rebuild.
        shell.setLayerVisible('props', false);
        step(200, 200);
        const pendingHidden = [];
        for (let i = 0; i < 26; i++) pendingHidden.push(P.debug!.pendingRanges(i));
        shell.setLayerVisible('props', true);
        const at = { at: { chunk: c, local: 0 }, tick: 500 };
        shell.frameAt(0, at);
        const shown = shell.pixels();
        shell.rebuild();
        shell.frameAt(0, at);
        const rebuilt = shell.pixels();
        // Self-compare on the rebuilt state, which owes no upload, so a stale first frame after showing cannot hide in it.
        shell.frameAt(0, at);
        const self = P.metrics.pixelDiff(rebuilt, shell.pixels());
        return { perCrossing, pendingAfterRender, pendingHidden, d: P.metrics.pixelDiff(shown, rebuilt), self };
      });
      const maxCalls = Math.max(...out.perCrossing.map((p) => p.calls));
      const maxBytes = Math.max(...out.perCrossing.map((p) => p.bytes));
      console.log(`A10 ${backend} tier ${tier} per crossing: at most ${maxCalls} calls and ${maxBytes} bytes; pending after render ${Math.max(...out.pendingAfterRender)}; pending hidden ${Math.max(...out.pendingHidden)}; after showing, single frames differ by ${out.d.bytes} bytes, largest ${out.d.max}; self-compare ${out.self.bytes} bytes, largest ${out.self.max}`);
      expect(maxCalls).toBeLessThanOrEqual(30);
      expect(maxBytes).toBeLessThan(16 * 1024);
      expect(Math.max(...out.pendingAfterRender)).toBe(0);
      expect(Math.max(...out.pendingHidden)).toBeLessThanOrEqual(64);
      expect(out.self.bytes).toBeLessThanOrEqual(SELF_BYTES);
      expect(out.self.max).toBeLessThanOrEqual(1);
      expect(out.d.bytes).toBeLessThanOrEqual(32);
      expect(out.d.max).toBeLessThanOrEqual(2);
    });
  });

  test(`ring: context restore, ${backend} tier ${tier}`, async ({ page: fixturePage, playwright }) => {
    test.setTimeout(120_000);
    await onBackend(backend, fixturePage, playwright, async (page) => {
      await open(page, { scene: 'worst', tier });
      await expectBackend(page, backend);
      const before = await page.evaluate(() => {
        const P = window.__props!;
        const at = { at: { chunk: 1000, local: 20 }, tick: 120, bend: { a: 0, c: 0 } };
        P.shell.frameAt(0, at);
        const first = P.shell.pixels();
        P.shell.frameAt(0, at);
        const self = P.metrics.pixelDiff(first, P.shell.pixels());
        (window as unknown as { __before: Uint8Array }).__before = first;
        return { luma: P.metrics.meanLuma(first), self };
      });
      await page.evaluate(async () => {
        const canvas = window.__props!.shell.ctx.renderer.domElement;
        const lost = new Promise<void>((resolve) => canvas.addEventListener('webglcontextlost', () => resolve(), { once: true }));
        window.__props!.shell.ctx.renderer.forceContextLoss();
        await lost;
      });
      // Yield a task, then restore: restoring inside the loss event is one of section 11.3's traps.
      await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
      await page.evaluate(async () => {
        const canvas = window.__props!.shell.ctx.renderer.domElement;
        const restored = new Promise<void>((resolve) => canvas.addEventListener('webglcontextrestored', () => resolve(), { once: true }));
        window.__props!.shell.ctx.renderer.forceContextRestore();
        await restored;
      });
      const out = await page.evaluate(() => {
        const P = window.__props!;
        P.shell.rebuild();
        const old = (window as unknown as { __before: Uint8Array }).__before;
        const at = { at: { chunk: 1000, local: 20 }, tick: 120, bend: { a: 0, c: 0 } };
        P.shell.frameAt(0, at);
        const px = P.shell.pixels();
        P.shell.frameAt(0, at);
        const self = P.metrics.pixelDiff(px, P.shell.pixels());
        return { d: P.metrics.pixelDiff(old, px), luma: P.metrics.meanLuma(px), self };
      });
      console.log(`A11 ${backend} tier ${tier}: luma ${before.luma.toFixed(2)} -> ${out.luma.toFixed(2)}; single frames differ by ${out.d.bytes} bytes, largest ${out.d.max}; self-compare ${before.self.bytes} before and ${out.self.bytes} after, largest ${Math.max(before.self.max, out.self.max)}`);
      expect(Math.max(before.self.bytes, out.self.bytes)).toBeLessThanOrEqual(SELF_BYTES);
      expect(Math.max(before.self.max, out.self.max)).toBeLessThanOrEqual(1);
      expect(out.d.bytes).toBeLessThanOrEqual(16);
      expect(out.d.max).toBeLessThanOrEqual(1);
    });
  });
}

/**
 * Where the MSAA noise comes from, so the choice above stays checked: the full road scene, one state drawn 25 times, at tier 4 (MSAA 4)
 * and at tier 2 (MSAA 0). Printed on D3D11. Gated on what the rows rely on: MSAA 0 quiet on D3D11, and MSAA 4 quiet on Vulkan.
 */
function msaaNoise(backend: Backend): void {
  test(`ring: msaa repeat noise, ${backend}`, async ({ page: fixturePage, playwright }) => {
    test.setTimeout(240_000);
    await onBackend(backend, fixturePage, playwright, async (page) => {
      const read = async (tier: 2 | 4): Promise<{ distinct: number; worst: number; max: number }> => {
        await open(page, { scene: 'road', tier });
        await expectBackend(page, backend);
        return page.evaluate(() => {
          const P = window.__props!;
          const shell = P.shell;
          const st = { at: { chunk: 5, local: 20 }, tick: 120, palette: 0, bend: { a: 0, c: 0 } };
          shell.frameAt(0, st);
          shell.rebuild();
          shell.frameAt(0, st);
          const first = shell.pixels();
          const hash = (px: Uint8Array): number => {
            let h = 2166136261 >>> 0;
            for (let i = 0; i < px.length; i++) h = Math.imul(h ^ px[i]!, 16777619) >>> 0;
            return h;
          };
          const seen = new Set<number>([hash(first)]);
          let worst = 0;
          let max = 0;
          for (let i = 0; i < 24; i++) {
            shell.frameAt(0, st);
            const px = shell.pixels();
            seen.add(hash(px));
            const d = P.metrics.pixelDiff(first, px);
            worst = Math.max(worst, d.bytes);
            max = Math.max(max, d.max);
          }
          return { distinct: seen.size, worst, max };
        });
      };
      const msaa = await read(4);
      const plain = await read(2);
      console.log(`A6 noise, ${backend}: tier 4 (MSAA 4) ${msaa.distinct} distinct frames of 25, worst ${msaa.worst} bytes, largest ${msaa.max}; tier 2 (MSAA 0) ${plain.distinct} distinct, worst ${plain.worst} bytes`);
      expect(plain.worst).toBeLessThanOrEqual(SELF_BYTES);
      if (backend === 'vulkan') expect(msaa.worst).toBeLessThanOrEqual(SELF_BYTES);
    });
  });
}

test.describe('gpu', () => {
  test.beforeEach(({ browserName }, info) => {
    test.skip(browserName !== 'chromium' || info.project.name !== 'gpu', 'needs the 1080p gpu project');
  });

  // ---- M2: rings on the GPU with placeholder boxes ----

  test('ring: position', async ({ page }) => {
    await open(page, { post: 'off', scene: 'one', placeholder: 1 });
    const out = await page.evaluate((kind) => {
      const P = window.__props!;
      const shell = P.shell;
      shell.setLayerVisible('sky', false);
      const measure = (chunk: number, distance: number, x: number, y: number, scale: number) => {
        const at = { chunk, local: 10 };
        P.sheetWorld!.select({ source: 'prop', kind, place: { at, distance, x, y, scale, yaw: 0 } });
        shell.frameAt(0, { at, tick: 0, bend: { a: 0, c: 0 } });
        shell.rebuild();
        shell.frameAt(0, { at, tick: 0, bend: { a: 0, c: 0 } });
        const px = shell.pixels();
        const gl = shell.ctx.renderer.getContext();
        const c = P.metrics.centroid(px, gl.drawingBufferWidth, gl.drawingBufferHeight);
        const [ex, ey] = P.project(x, y, -distance);
        return { chunk, distance, cx: c.x, cy: c.y, count: c.count, ex, ey, err: Math.hypot(c.x - ex, c.y - ey) };
      };
      const rows = [];
      for (const chunk of [5, 65530, 2 ** 40, 2 ** 48 - 2024]) {
        rows.push(measure(chunk, 30, 12, 7.5, 1));
        // Far enough to put the row across the 65536 wrap when the camera sits at 65530.
        rows.push(measure(chunk, 480, 40, 12, 10));
      }
      const control = measure(5, 31, 12, 7.5, 1);
      return { rows, control };
    }, UNMIRRORED_FAR);
    for (const r of out.rows) {
      console.log(`A4 chunk ${r.chunk} dist ${r.distance}: centroid (${r.cx.toFixed(2)}, ${r.cy.toFixed(2)}) expected (${r.ex.toFixed(2)}, ${r.ey.toFixed(2)}) err ${r.err.toFixed(3)} px, ${r.count} px`);
      expect(r.count).toBeGreaterThan(0);
      expect(r.err).toBeLessThanOrEqual(1);
    }
    const near = out.rows[0]!;
    const moved = Math.hypot(out.control.cx - near.cx, out.control.cy - near.cy);
    console.log(`A4 negative control: +1 u moved the centroid ${moved.toFixed(2)} px`);
    expect(moved).toBeGreaterThan(1);
  });

  test('ring: retire', async ({ page }) => {
    await open(page, { post: 'off', scene: 'one', placeholder: 1, ship: 0 });
    const out = await page.evaluate((kind) => {
      const P = window.__props!;
      const shell = P.shell;
      shell.setLayerVisible('sky', false);
      const at = { chunk: 40, local: 0 };
      const maxDist = 1600;
      const shot = (distance: number, keep = 0) => {
        P.sheetWorld!.select({ source: 'prop', kind, place: { at, distance, x: 0, y: 7 + distance * Math.tan(0.05), scale: 60, keep } });
        shell.frameAt(0, { at, tick: 0, bend: { a: 0, c: 0 } });
        shell.rebuild();
        shell.frameAt(0, { at, tick: 0, bend: { a: 0, c: 0 } });
        const gl = shell.ctx.renderer.getContext();
        const c = P.metrics.centroid(shell.pixels(), gl.drawingBufferWidth, gl.drawingBufferHeight);
        return { count: c.count, height: c.maxY - c.minY + 1 };
      };
      const a = shot(0.9 * maxDist);
      const b = shot(0.96 * maxDist);
      const c = shot(maxDist + 1);
      const quality = (propDensity: number) => ({ tier: 2 as const, dprCap: 1, maxPixels: 2073600, msaa: 0 as const, mirror: false, post: 'noCa' as const, bloomLevels: 5, nebulaWidth: 192, propDensity, terrainStride: 1 as const, speedLines: 32 });
      P.layer!.setQuality(quality(0.4));
      const d = shot(400, 0.5);
      P.layer!.setQuality(quality(0.6));
      const e = shot(400, 0.5);
      return { a, b, c, d, e };
    }, UNMIRRORED_1600);
    console.log(`A5 0.90: ${JSON.stringify(out.a)} 0.96: ${JSON.stringify(out.b)} past: ${JSON.stringify(out.c)} density .4: ${JSON.stringify(out.d)} density .6: ${JSON.stringify(out.e)}`);
    const full = (60 * 974.3) / 1440;
    expect(Math.abs(out.a.height - full)).toBeLessThan(full * 0.1);
    expect(out.b.height).toBeLessThan(out.a.height * 0.8);
    expect(out.b.height).toBeGreaterThan(0);
    expect(out.c.count).toBe(0);
    expect(out.d.count).toBe(0);
    expect(out.e.count).toBeGreaterThan(0);
  });

  // A6, A7, A10 and A11 on D3D11 at MSAA 0, and the noise they avoid; the same rows run on Vulkan at MSAA 2 below.
  identityRows('d3d11');
  msaaNoise('d3d11');

  test('ring: fifo negative control', async ({ page, context }) => {
    test.setTimeout(600_000);
    // One ring's upload skipped: the buffer on the GPU goes stale while the walk proceeds.
    await open(page, { scene: 'worst', tier: 2 });
    const skip = await page.evaluate(() => {
      const P = window.__props!;
      const shell = P.shell;
      const buf = P.debug!.buffer(0);
      let c = 1000;
      let l = 60;
      shell.frameAt(0, { at: { chunk: c, local: l }, tick: 0 });
      // Advance one frame so the first upload has landed, then starve the PALM ring.
      Object.defineProperty(buf, 'needsUpdate', { set() { /* skipped */ }, configurable: true });
      for (let i = 1; i <= 300; i++) {
        l += 16;
        if (l >= 64) { l -= 64; c += 1; }
        shell.frameAt(0, { at: { chunk: c, local: l }, tick: i });
      }
      const walked = shell.pixels();
      delete (buf as unknown as { needsUpdate?: unknown }).needsUpdate;
      shell.rebuild();
      shell.frameAt(0, { at: { chunk: c, local: l }, tick: 300 });
      const rebuilt = shell.pixels();
      return P.metrics.pixelDiff(walked, rebuilt);
    });
    console.log(`A6n one ring's upload skipped: ${skip.bytes} differing bytes, largest ${skip.max}`);
    expect(skip.bytes).toBeGreaterThan(1000);

    // Reach minus 1: compared across two pages, because a rebuild under the same mutated plan would agree with itself.
    const shot = async (p: Page, query: Record<string, string | number>, endLocal: number): Promise<string> => {
      await open(p, { scene: 'worst', tier: 2, ...query });
      return p.evaluate((endLocal) => {
        const P = window.__props!;
        const shell = P.shell;
        const start = endLocal % 16;
        let c = 1000;
        let l = start;
        shell.frameAt(0, { at: { chunk: c, local: l }, tick: 0 });
        // A walk of 320 crossings, so every ring is on its FIFO, ending at endLocal.
        const frames = 320 * 4 + (endLocal - start) / 16;
        for (let i = 1; i <= frames; i++) {
          l += 16;
          if (l >= 64) { l -= 64; c += 1; }
          shell.frameAt(0, { at: { chunk: c, local: l }, tick: 0 });
        }
        const px = shell.pixels();
        let s = '';
        const step = 0x8000;
        for (let i = 0; i < px.length; i += step) s += String.fromCharCode(...px.subarray(i, Math.min(i + step, px.length)));
        return btoa(s);
      }, endLocal);
    };
    for (const endLocal of [60, 3]) {
      const other = await context.newPage();
      const a = Buffer.from(await shot(page, {}, endLocal), 'base64');
      const b = Buffer.from(await shot(other, { reachMinus: 1 }, endLocal), 'base64');
      await other.close();
      let bytes = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) bytes++;
      console.log(`A6n reach minus 1, end local ${endLocal}: ${bytes} differing bytes (weak by design: scale-in hides the far edge; A2n is the real guard)`);
    }
  });

  test('ring: idle hide', async ({ page }) => {
    const layerCalls = async (arch: string): Promise<{ calls: number; visible: number[] }> => {
      await open(page, { post: 'off', scene: 'road', arch, items: 'none', ship: 0 });
      return page.evaluate(() => {
        const P = window.__props!;
        const shell = P.shell;
        const at = { chunk: 1000, local: 0 };
        shell.frameAt(0, { at, tick: 0 });
        const on = shell.stats().calls;
        shell.setLayerVisible('props', false);
        shell.frameAt(0, { at, tick: 0 });
        const off = shell.stats().calls;
        const visible = [];
        for (let i = 0; i < 26; i++) if (P.debug!.ring(i).visible) visible.push(i);
        return { calls: on - off, visible };
      });
    };
    const pyramid = await layerCalls('2');
    console.log(`A8 PYRAMID only: ${pyramid.calls} calls, visible rings ${JSON.stringify(pyramid.visible)}`);
    expect(pyramid.calls).toBe(1);
    expect(pyramid.visible).toEqual([2]);
    const both = await layerCalls('2,0');
    console.log(`A8 with PALM: ${both.calls} calls, visible rings ${JSON.stringify(both.visible)}`);
    expect(both.calls).toBe(3);
    expect(both.visible).toEqual([0, 2]);
  });

  test('ring: stats', async ({ page }) => {
    test.setTimeout(600_000);
    await open(page, { props: 0, tier: 3, scene: 'worst' });
    const programsWithout = await page.evaluate(() => {
      window.__props!.shell.frameAt(0, { at: { chunk: 1000, local: 0 }, tick: 0 });
      return window.__props!.shell.stats().programs;
    });
    await open(page, { scene: 'worst', tier: 3 });
    const out = await page.evaluate(() => {
      const P = window.__props!;
      const shell = P.shell;
      const at = { chunk: 1000, local: 0 };
      shell.frameAt(0, { at, tick: 0 });
      const withAll = shell.stats();
      shell.setLayerVisible('props', false);
      shell.frameAt(0, { at, tick: 0 });
      const off = shell.stats();
      shell.setLayerVisible('props', true);
      shell.frameAt(0, { at, tick: 0 });
      const before = shell.stats();
      for (let i = 1; i <= 2000; i++) shell.frameAt(0, { at: { chunk: 1000 + i, local: 0 }, tick: i });
      const after = shell.stats();
      const rings = [];
      for (let i = 0; i < 26; i++) rings.push(P.debug!.ring(i));
      return { calls: withAll.calls - off.calls, triangles: withAll.triangles - off.triangles, programs: withAll.programs, before, after, truncated: rings.map((r) => r.truncated), counts: P.debug!.counts() };
    });
    console.log(`A9 layer calls ${out.calls}, triangles ${out.triangles}, programs ${out.programs} of which the layer ${out.programs - programsWithout}, geometries ${out.before.geometries} -> ${out.after.geometries}, textures ${out.before.textures} -> ${out.after.textures}, counts ${JSON.stringify(out.counts)}`);
    expect(out.calls).toBe(42);
    expect(out.programs - programsWithout).toBeLessThanOrEqual(6);
    expect(out.after.geometries).toBe(out.before.geometries);
    expect(out.after.textures).toBe(out.before.textures);
    expect(out.truncated.every((t) => t === 0)).toBe(true);
    expect(out.counts.fillProps).toBeGreaterThanOrEqual(2000);
    expect(out.counts.catchUps).toBe(0);
  });

  const TIER_QUERY = { post: 'off', placeholder: 1, ship: 0, scene: 'worst' } as const;

  /** A12's measurement on the current page: one tier change at one position. Returns the ratio, and whether refill frames held. */
  async function tierRun(page: Page, i: number, from: 1 | 2 | 3, to: 1 | 2 | 3, midChange: (1 | 2 | 3) | null): Promise<{
    ratio: number; maxFrame: number; meanFrame: number; rampFrames: number; refillBytes: number; refillMax: number; refillFrames: number;
    trisBefore: number; trisAfter: number; callsBefore: number; callsAfter: number; links: number; steppedPixels: number;
  }> {
    return page.evaluate(({ i, from, to, midChange }) => {
      const P = window.__props!;
      const shell = P.shell;
      const at = { chunk: 5000 + 13 * i, local: (17 * i) % 64 };
      const frame = (tick: number) => shell.frameAt(0, { at, tick, bend: { a: 0, c: 0 } });
      let tick = 1000;
      shell.setTier(from);
      frame(tick);
      shell.rebuild();
      frame(tick);
      const before = shell.stats();
      // No new program may appear on any switch. A spy on linkProgram, per Agents.md, because info.programs can also fall.
      const gl = shell.ctx.renderer.getContext() as WebGL2RenderingContext;
      const realLink = gl.linkProgram.bind(gl);
      let links = 0;
      (gl as unknown as { linkProgram: unknown }).linkProgram = (p: WebGLProgram): void => { links++; realLink(p); };
      shell.setTier(to);
      // The frame where q.mirror, canvas size and the rest step: printed by the caller and skipped.
      tick += 1;
      frame(tick);
      let prev = shell.pixels();
      const steppedPixels = prev.length / 4;
      const changed: number[] = [];
      let refillBytes = 0;
      let refillMax = 0;
      let refillFrames = 0;
      let turned = midChange === null;
      for (let f = 0; f < 400; f++) {
        tick += 1;
        if (!turned && changed.length >= 40) {
          turned = true;
          shell.setTier(midChange!);
          // Its step frame is skipped too, and the ratio then reads the second ramp alone: the two run at different speeds by design.
          frame(tick);
          prev = shell.pixels();
          changed.length = 0;
          continue;
        }
        const phaseBefore = P.debug!.density().phase;
        const uBefore = P.debug!.density().current;
        frame(tick);
        const phase = P.debug!.density().phase;
        const uAfter = P.debug!.density().current;
        const px = shell.pixels();
        if (px.length !== prev.length) {
          prev = px;
          continue;
        }
        const d = P.metrics.pixelDiff(prev, px);
        // A frame where uDensity held still and a refill ran. The ramp's last step can land on the same frame the refill phase begins, and that is ramp.
        if (uBefore === uAfter && (phaseBefore === 'refill' || phase === 'refill')) {
          refillBytes = Math.max(refillBytes, d.bytes);
          refillMax = Math.max(refillMax, d.max);
          refillFrames++;
        } else if (uBefore !== uAfter) {
          changed.push(d.pixels);
        }
        prev = px;
        if (phase === 'idle' && phaseBefore === 'idle') break;
      }
      frame(tick + 1);
      const after = shell.stats();
      (gl as unknown as { linkProgram: unknown }).linkProgram = realLink;
      const total = changed.reduce((s, v) => s + v, 0);
      const mean = changed.length ? total / changed.length : 0;
      const maxFrame = changed.length ? Math.max(...changed) : 0;
      return {
        ratio: mean > 0 ? maxFrame / mean : 0, maxFrame, meanFrame: mean, rampFrames: changed.length,
        refillBytes, refillMax, refillFrames,
        trisBefore: before.triangles, trisAfter: after.triangles, callsBefore: before.calls, callsAfter: after.calls,
        links, steppedPixels,
      };
    }, { i, from, to, midChange });
  }

  test('ring: tier ramp', async ({ page }) => {
    test.setTimeout(900_000);
    await open(page, { ...TIER_QUERY, tier: 3 });
    await page.evaluate(() => window.__props!.shell.setLayerVisible('sky', false));
    const down: number[] = [];
    const up: number[] = [];
    const mid: number[] = [];
    for (let i = 0; i < 8; i++) {
      const d = await tierRun(page, i, 3, 1, null);
      console.log(`A12 position ${i} 3->1: step frame skipped at ${d.steppedPixels} px, ratio ${d.ratio.toFixed(2)} (max ${d.maxFrame}, mean ${d.meanFrame.toFixed(0)}, ${d.rampFrames} frames), refill ${d.refillFrames} frames at most ${d.refillBytes} bytes by ${d.refillMax}, triangles ${d.trisBefore} -> ${d.trisAfter} (${(d.trisAfter / d.trisBefore).toFixed(3)}), calls ${d.callsBefore} -> ${d.callsAfter}, new program links ${d.links}`);
      down.push(d.ratio);
      expect(d.refillBytes, 'a refill must be invisible').toBeLessThanOrEqual(16);
      expect(d.refillMax).toBeLessThanOrEqual(1);
      expect(d.trisAfter / d.trisBefore).toBeLessThanOrEqual(0.55);
      expect(d.callsBefore - d.callsAfter).toBe(12);
      expect(d.links).toBe(0);

      const u = await tierRun(page, i, 1, 3, null);
      console.log(`A12 position ${i} 1->3: ratio ${u.ratio.toFixed(2)} (max ${u.maxFrame}, mean ${u.meanFrame.toFixed(0)}), refill ${u.refillFrames} frames at most ${u.refillBytes} bytes by ${u.refillMax}, calls ${u.callsBefore} -> ${u.callsAfter}, new program links ${u.links}`);
      up.push(u.ratio);
      expect(u.refillBytes, 'a refill must be invisible').toBeLessThanOrEqual(16);
      expect(u.refillMax).toBeLessThanOrEqual(1);
      expect(u.callsAfter - u.callsBefore).toBe(12);
      expect(u.links).toBe(0);

      const m = await tierRun(page, i, 3, 2, 1);
      console.log(`A12 position ${i} 3->2, then 1 mid-ramp: ratio ${m.ratio.toFixed(2)}, refill ${m.refillFrames} frames at most ${m.refillBytes} bytes by ${m.refillMax}`);
      mid.push(m.ratio);
    }
    console.log(`A12 median ratio: down ${median(down).toFixed(2)}, up ${median(up).toFixed(2)}, second change ${median(mid).toFixed(2)}`);
    expect(median(down)).toBeLessThanOrEqual(4);
    expect(median(up)).toBeLessThanOrEqual(4);
    expect(median(mid)).toBeLessThanOrEqual(4);
  });

  test('ring: tier ramp negative control', async ({ page }) => {
    test.setTimeout(600_000);
    // The executor's own control (review note): with the .03 window closed, each box pops in one frame, and the gate should see it.
    await open(page, { ...TIER_QUERY, tier: 3 });
    await page.evaluate(() => {
      const P = window.__props!;
      P.shell.setLayerVisible('sky', false);
      P.debug!.setDensityWindow(1e-5);
    });
    const down: number[] = [];
    const up: number[] = [];
    for (let i = 0; i < 8; i++) {
      down.push((await tierRun(page, i, 3, 1, null)).ratio);
      up.push((await tierRun(page, i, 1, 3, null)).ratio);
    }
    console.log(`A12 negative control, one-frame pop: down ${down.map((v) => v.toFixed(2)).join(' ')}, median ${median(down).toFixed(2)}; up ${up.map((v) => v.toFixed(2)).join(' ')}, median ${median(up).toFixed(2)}`);
    expect(median(down)).toBeGreaterThan(4);
  });

  test('ring: tier ramp on art', async ({ page }, info) => {
    test.setTimeout(600_000);
    // On the art build the ratio is printed and not gated (DI-42). post=off has no depth buffer, so the strip runs with DevPost on.
    await open(page, { post: 'off', ship: 0, scene: 'worst', tier: 3 });
    await page.evaluate(() => window.__props!.shell.setLayerVisible('sky', false));
    const ratios: number[] = [];
    for (let i = 0; i < 8; i++) ratios.push((await tierRun(page, i, 3, 1, null)).ratio);
    console.log(`A12 art ratio, not gated: ${ratios.map((v) => v.toFixed(2)).join(' ')}, median ${median(ratios).toFixed(2)}`);

    await open(page, { scene: 'one', ship: 0, tier: 3 });
    const strip = await page.evaluate(() => {
      const P = window.__props!;
      const shell = P.shell;
      const at = { chunk: 1000, local: 0 };
      const place = { at, distance: 170, x: -62, y: 0, yaw: 0.4, scale: 1, keep: 0.6, tintSeed: 0.1, variant: 0.75 };
      P.sheetWorld!.select({ source: 'prop', kind: 1, place });
      shell.frameAt(0, { at, tick: 1000, bend: { a: 0, c: 0 }, palette: 0 });
      shell.rebuild();
      shell.frameAt(0, { at, tick: 1000, bend: { a: 0, c: 0 }, palette: 0 });
      shell.setTier(1);
      let tick = 1000;
      const out = document.createElement('canvas');
      out.width = 1280;
      out.height = 720;
      const c = out.getContext('2d')!;
      const heights: number[] = [];
      // The ramp reaches keep .6 about 61 ticks in, at 2 ticks per frame, the 60 fps rate.
      let shots = 0;
      for (let f = 0; f < 70; f++) {
        tick += 2;
        shell.frameAt(0, { at, tick, bend: { a: 0, c: 0 }, palette: 0 });
        const u = P.debug!.density().current;
        if (u < 0.655 && shots < 12) {
          const r = shell.ctx.renderer.domElement;
          const sw = r.width / 4;
          const sh = r.height / 4;
          const [cx, cy] = P.project(-62, 25, -170);
          c.drawImage(r, cx - sw / 2, cy - sh / 2, sw, sh, (shots % 4) * 320, Math.floor(shots / 4) * 240, 320, 240);
          c.fillStyle = '#fff';
          c.font = '12px monospace';
          c.fillText(`f${shots} u=${u.toFixed(3)}`, (shots % 4) * 320 + 4, Math.floor(shots / 4) * 240 + 14);
          heights.push(u);
          shots++;
        }
      }
      return { png: out.toDataURL('image/png'), heights };
    });
    savePng(info, 'tier-strip.png', strip.png);
    console.log(`A12 strip uDensity by frame: ${strip.heights.map((v) => v.toFixed(3)).join(' ')}`);
  });

  // ---- M3: neon ----

  test('neon: reference', async ({ page }, info) => {
    test.setTimeout(120_000);
    await open(page, { scene: 'one', ship: 0, tier: 3 });
    const shots = await page.evaluate(() => {
      const P = window.__props!;
      const shell = P.shell;
      const at = { chunk: 1000, local: 0 };
      const take = (kind: number, distance: number, x: number): string => {
        // On T01's band: a pyramid stands at abs(x) 150 or more, where the floor is opaque, so its root does not show.
        const y = P.world.height(x, 1000, 64, 0);
        P.sheetWorld!.select({ source: 'prop', kind, place: { at, distance, x, y, yaw: 0.4, scale: 1, tintSeed: 0.1, variant: 0.2 } });
        shell.frameAt(0, { at, tick: 120, palette: 0, bend: { a: 0, c: 0 } });
        shell.rebuild();
        shell.frameAt(0, { at, tick: 120, palette: 0, bend: { a: 0, c: 0 } });
        return shell.ctx.renderer.domElement.toDataURL('image/png');
      };
      return { pyramid: take(2, 260, -160), palm: take(0, 36, -16) };
    });
    savePng(info, 'neon-pyramid.png', shots.pyramid);
    savePng(info, 'neon-palm.png', shots.palm);
    await open(page, { scene: 'road', arch: '0,2,7,19', tier: 3 });
    const road = await page.evaluate(() => {
      const shell = window.__props!.shell;
      shell.frameAt(0, { at: { chunk: 1000, local: 0 }, tick: 240, palette: 0 });
      return shell.ctx.renderer.domElement.toDataURL('image/png');
    });
    savePng(info, 'neon-road.png', road);
  });

  test('neon: mirror', async ({ page }, info) => {
    test.setTimeout(120_000);
    await open(page, { scene: 'one', ship: 0, tier: 3 });
    const out = await page.evaluate(() => {
      const P = window.__props!;
      const shell = P.shell;
      const at = { chunk: 1000, local: 0 };
      const frame = { at, tick: 120, palette: 0, bend: { a: 0, c: 0 } };
      const place = { at, distance: 44, x: -16, y: 0, yaw: 0.4, scale: 1, tintSeed: 0.1, variant: 0.2 };
      P.sheetWorld!.select({ source: 'prop', kind: 0, place });
      shell.frameAt(0, frame);
      shell.rebuild();
      shell.frameAt(0, frame);
      const png = shell.ctx.renderer.domElement.toDataURL('image/png');
      const gl = shell.ctx.renderer.getContext();
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const on = shell.pixels();
      const onStats = shell.stats();
      // The ground row for the object: above it is the source, below it the reflection.
      const [px, py] = P.project(-16, 0, -44);
      const [, topY] = P.project(-16, 14, -44);
      const span = py - topY;
      // Compared with props off, so the floor's own grid does not count as a reflection.
      shell.setLayerVisible('props', false);
      shell.frameAt(0, frame);
      const off = shell.pixels();
      shell.setLayerVisible('props', true);
      const diffPeak = (a: Uint8Array, b: Uint8Array, y0: number, y1: number): number => {
        let best = 0;
        for (let y = Math.max(0, Math.round(y0)); y < Math.min(h, Math.round(y1)); y++) {
          for (let x = Math.max(0, Math.round(px - 200)); x < Math.min(w, Math.round(px + 200)); x++) {
            const o = ((h - 1 - y) * w + x) * 4;
            const d = 0.2126 * Math.abs(a[o]! - b[o]!) + 0.7152 * Math.abs(a[o + 1]! - b[o + 1]!) + 0.0722 * Math.abs(a[o + 2]! - b[o + 2]!);
            best = Math.max(best, d);
          }
        }
        return best;
      };
      const sourcePeak = diffPeak(on, off, topY - 20, py);
      const reflectionPeak = diffPeak(on, off, py + 4, py + span);

      // Mirror off through a quality change: only the reflection goes, and only its draw.
      const noMirror = { tier: 3 as const, dprCap: 1.5, maxPixels: 2073600, msaa: 2 as const, mirror: false, post: 'full' as const, bloomLevels: 6, nebulaWidth: 384, propDensity: 1, terrainStride: 1 as const, speedLines: 64 };
      P.layer!.setQuality(noMirror);
      P.backdrop.setQuality(noMirror);
      shell.frameAt(0, frame);
      const offStats = shell.stats();
      const noMirrorPx = shell.pixels();
      shell.setLayerVisible('props', false);
      shell.frameAt(0, frame);
      const noMirrorOff = shell.pixels();
      shell.setLayerVisible('props', true);
      const reflectionWithout = diffPeak(noMirrorPx, noMirrorOff, py + 4, py + span);
      return { png, sourcePeak, reflectionPeak, reflectionWithout, callsOn: onStats.calls, callsOff: offStats.calls };
    });
    savePng(info, 'neon-mirror.png', out.png);
    console.log(`A15 source peak ${out.sourcePeak.toFixed(1)}; reflection peak ${out.reflectionPeak.toFixed(1)} with the mirror, ${out.reflectionWithout.toFixed(1)} without; calls ${out.callsOn} -> ${out.callsOff}`);
    expect(out.reflectionPeak).toBeGreaterThan(out.reflectionWithout);
    expect(out.reflectionPeak).toBeLessThan(out.sourcePeak);
    expect(out.callsOn - out.callsOff).toBe(1);

    // No buried root above the floor, judged per fragment. Rejected form (V1): lit pixels over the 800 u floor line, which a near flipped
    // root never reaches, and REFLECTOR's .3 u root, which can never rise past y = 1. Here: the four mirrored types with 1.5 u roots, at
    // scale 2, so each root is 3 u deep, 20 to 50 u away in the valley. Only the mirror draws, and ?mprobe=1 makes its program paint a
    // fragment red when its world y after the flip, before the bend, is above the floor (y > .001), and dim green when it is not.
    await open(page, { scene: 'one', ship: 0, post: 'off', tier: 3, mprobe: 1 });
    const buried = await page.evaluate(() => {
      const P = window.__props!;
      const shell = P.shell;
      const gl = shell.ctx.renderer.getContext();
      P.backdrop.setVisible(false);
      const at = { chunk: 2000, local: 0 };
      const frame = { at, tick: 0, bend: { a: 0, c: 0 } };
      const place = (distance: number, x: number) => ({ at, distance, x, y: 0, yaw: 0.3, scale: 2, tintSeed: 0.1, variant: 0.2 });
      P.sheetWorld!.selectMany([
        { source: 'prop', kind: 0, place: place(20, -9) },    // PALM, root 1.5
        { source: 'prop', kind: 18, place: place(30, 8) },    // CACTUS, root 1.5
        { source: 'prop', kind: 11, place: place(40, -14) },  // TOTEM, root 1.5
        { source: 'prop', kind: 4, place: place(50, 16) },    // COLONNADE, root 1.5
      ]);
      shell.frameAt(0, frame);
      shell.rebuild();
      shell.frameAt(0, frame);
      // Only the mirrored draws: every other mesh of the layer off, by its render order.
      shell.ctx.scene.traverse((o) => {
        const m = o as unknown as { isMesh?: boolean; visible: boolean; renderOrder: number };
        if (m.isMesh && m.renderOrder >= 0) m.visible = false;
      });
      shell.frameAt(0, frame);
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const px = shell.pixels();
      const png = shell.ctx.renderer.domElement.toDataURL('image/png');
      let red = 0;
      let green = 0;
      for (let i = 0; i < w * h * 4; i += 4) {
        if (px[i]! > 128 && px[i + 1]! < 64) red++;
        else if (px[i + 1]! > 32 && px[i]! < 32) green++;
      }
      return { red, green, png };
    });
    savePng(info, 'neon-mirror-probe.png', buried.png);
    console.log(`A15 buried roots, mirror-only draws with the probe: ${buried.green} pixels at or under the floor, ${buried.red} above it`);
    expect(buried.green).toBeGreaterThan(1000);
    expect(buried.red).toBe(0);
  });

  test('neon: shimmer', async ({ page }, info) => {
    test.setTimeout(300_000);
    const run = async (naive: number): Promise<{ mean: number; strip: string | null }> => {
      await open(page, { scene: 'worst', arch: '2,1', items: 'none', ship: 0, tier: 3, ...(naive ? { naive: 1 } : {}) });
      return page.evaluate((withStrip) => {
        const P = window.__props!;
        const shell = P.shell;
        // Props only, on black, with fog pushed out of range: fogged far bodies would otherwise read as bright silhouettes that no edge filter touches,
        // and they would be the same in both runs. What is left is lines and patterns, which is what the filter is for.
        P.backdrop.setVisible(false);
        const fog = shell.ctx.shared.uFog.value;
        fog[0] = 1e6;
        fog[1] = 1e6 + 1;
        const gl = shell.ctx.renderer.getContext();
        const w = gl.drawingBufferWidth;
        const h = gl.drawingBufferHeight;
        let prev: Uint8Array | null = null;
        let sum = 0;
        let n = 0;
        let c = 3000;
        let l = 0;
        const out = document.createElement('canvas');
        out.width = 6 * 320;
        out.height = 2 * 90;
        const ctx = out.getContext('2d')!;
        for (let f = 0; f < 48; f++) {
          l += 1.17;
          if (l >= 64) { l -= 64; c += 1; }
          shell.frameAt(0, { at: { chunk: c, local: l }, tick: 0, palette: 0, bend: { a: 0, c: 0 } });
          if (f >= 20 && f < 26 && withStrip) {
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(shell.ctx.renderer.domElement, 800, 540, 160, 90, (f - 20) * 320, 0, 320, 180);
          }
          const px = shell.pixels();
          if (prev) {
            sum += P.metrics.frameDiff(prev, px, w, h, 560, 600, true);
            n++;
          }
          prev = px;
        }
        return { mean: sum / n, strip: withStrip ? out.toDataURL('image/png') : null };
      }, naive === 0);
    };
    const filtered = await run(0);
    const naive = await run(1);
    if (filtered.strip) savePng(info, 'neon-seq.png', filtered.strip);
    console.log(`A16 mean frame diff rows 560-600: filtered ${filtered.mean.toFixed(3)}, naive ${naive.mean.toFixed(3)}, ratio ${(filtered.mean / naive.mean).toFixed(3)}`);
    expect(naive.mean).toBeGreaterThan(0);
    expect(filtered.mean).toBeLessThanOrEqual(0.85 * naive.mean);
  });

  // A16b, D-002 and DI-74: props' aliasing on T10's app, all layers on, B10's exact sequence (tier 3, full post, MSAA 2, sim tick
  // 1200, start (5, 0, 28800), 48 frames of 1.17 u, tick held). The reference draws every frame at 4 x 4 sub-pixel offsets on an
  // ordered grid and averages them: 16 samples a pixel, box-weighted, which samples the scene as a render at 4 times the width and
  // height box-filtered 4 x 4 would, while bloom, grain, scanlines and the shaders' derivative filters run at native size as in the
  // frame under test. A 2x render was tried first and differs from native by sharpness and bloom footprint, not only by sampling:
  // it read above native everywhere, and NAIVE_EDGES moved its excess by only .025 with all layers (plan section 10).
  // Two statistics, in the band rows 615 to 650 of B10's metric: the literal excess, native shimmer minus the reference's, and the
  // blurred excess, the mean of |G9 * (dN - dR)|, G9 a 9 x 9 box and dX a frame difference: the part of native's change the reference
  // lacks at a 9 px scale, where an edge that only moves cancels and a flicker of light does not. Each is gated as the props' share,
  // all layers minus props hidden, so terrain's and sky's own aliasing is not counted here. Control: NAIVE_EDGES on every props
  // material, set from the test through the scene, must exceed both limits. Limits proposed from measurement (plan section 11), for
  // T11 to confirm on the real scene.
  test('neon: shimmer against a supersampled reference', async ({ page }, info) => {
    test.skip(!existsSync(resolve('index.html')), 'needs T10\'s app (index.html)');
    test.setTimeout(900_000);
    const SHARE_LIMIT = 0.2;
    const BLUR_SHARE_LIMIT = 0.4;
    // Siblings edit files on the shared dev server: mock Vite's HMR socket, as T09's isolateFromHmr does, so no reload lands mid-run.
    await page.routeWebSocket(/.*/, () => { /* swallowed */ });
    const ready = page.waitForEvent('console', { predicate: (m) => m.text() === 'MV_READY', timeout: 60_000 });
    // DI-109: the limits below were set on seed 1985's opening scene, so the page names it. DEFAULT_SEED is 155 since DI-102,
    // whose opening (Sunset Drive / Boulevard) read excess .149 and blurred .588 here: a finding for T05 and the operator (Q6).
    await page.goto('/?harness&tier=3&seed=1985');
    await ready;
    const rast = await page.evaluate(() => window.__mvLab!.rendererInfo());
    expect(checkRasterizer(info.project.name, rast.webgl2, rast.renderer), `renderer string: ${rast.renderer}`).toBeNull();
    const r = await page.evaluate(({ start, simTick, jitter }) => {
      type Host = { ctx: { scene: Object3D; camera: PerspectiveCamera; renderer: WebGLRenderer } };
      const host = (window as unknown as { __mvE2e: { host: Host } }).__mvE2e.host;
      const mv = window.__mv!;
      const lab = window.__mvLab!;
      const W = 1920, H = 1080, Y0 = 560, Y1 = 720, B0 = 615, B1 = 650, R = 4;
      const ROWS = Y1 - Y0, WN = ROWS * W * 3, FRAMES = 48, STEP = 1.17;
      const raw = new Uint8Array(W * ROWS * 4);
      const gl = host.ctx.renderer.getContext();
      if (gl.drawingBufferWidth !== W || gl.drawingBufferHeight !== H) throw new Error(`drawing buffer ${gl.drawingBufferWidth}x${gl.drawingBufferHeight}`);
      // Rows Y0 to Y1 from the top of the frame just drawn, as RGB, added into out with weight k.
      function read(out: Float32Array, k: number): void {
        host.ctx.renderer.setRenderTarget(null);
        gl.readPixels(0, H - Y1, W, ROWS, gl.RGBA, gl.UNSIGNED_BYTE, raw);
        for (let y = 0; y < ROWS; y++) {
          const src = (ROWS - 1 - y) * W * 4;
          const dst = y * W * 3;
          for (let x = 0; x < W; x++) {
            out[dst + x * 3] = out[dst + x * 3]! + raw[src + x * 4]! * k;
            out[dst + x * 3 + 1] = out[dst + x * 3 + 1]! + raw[src + x * 4 + 1]! * k;
            out[dst + x * 3 + 2] = out[dst + x * 3 + 2]! + raw[src + x * 4 + 2]! * k;
          }
        }
      }
      function draw(local: number, out: Float32Array, n: number): void {
        out.fill(0);
        if (n === 0) {
          mv.renderAt(start.chunk, local, start.tick);
          read(out, 1);
          return;
        }
        const cam = host.ctx.camera;
        for (let j = 0; j < n * n; j++) {
          cam.setViewOffset(W, H, ((j % n) + 0.5) / n - 0.5, (Math.floor(j / n) + 0.5) / n - 0.5, W, H);
          mv.renderAt(start.chunk, local, start.tick);
          read(out, 1 / (n * n));
        }
        cam.clearViewOffset();
      }
      function bandDiff(a: Float32Array, b: Float32Array): number {
        let s = 0;
        for (let i = (B0 - Y0) * W * 3; i < (B1 - Y0) * W * 3; i++) s += Math.abs(a[i]! - b[i]!);
        return s / ((B1 - B0) * W * 3);
      }
      const rowSum = new Float32Array(WN);
      // Mean over the band of |G9 * D| per channel, by running sums: horizontal along each row, then 9 rows down.
      function blurredMean(d: Float32Array): number {
        for (let y = B0 - Y0 - R; y < B1 - Y0 + R; y++) {
          const o = y * W * 3;
          for (let c = 0; c < 3; c++) {
            let s = 0;
            for (let x = 0; x <= R; x++) s += d[o + x * 3 + c]!;
            for (let x = 0; x < W; x++) {
              rowSum[o + x * 3 + c] = s;
              if (x + R + 1 < W) s += d[o + (x + R + 1) * 3 + c]!;
              if (x - R >= 0) s -= d[o + (x - R) * 3 + c]!;
            }
          }
        }
        let t = 0;
        for (let y = B0 - Y0; y < B1 - Y0; y++) {
          for (let i = 0; i < W * 3; i++) {
            let s = 0;
            for (let yy = y - R; yy <= y + R; yy++) s += rowSum[yy * W * 3 + i]!;
            t += Math.abs(s) / ((2 * R + 1) * (2 * R + 1));
          }
        }
        return t / ((B1 - B0) * W * 3);
      }
      const names = ['sky', 'terrain', 'props', 'fx'] as const;
      const stored = new Float32Array(WN * FRAMES);
      function measure(layers: readonly string[]): { native: number; reference: number; excess: number; blurred: number } {
        for (const n of names) mv.setLayerVisible(n, layers.includes(n));
        mv.renderAt(start.chunk, start.local, start.tick);   // a backward move rebuilds here, outside the sequence
        let local = start.local;
        let nat = 0;
        for (let f = 0; f < FRAMES; f++) {
          if (f > 0) local += STEP;
          const view = stored.subarray(f * WN, (f + 1) * WN);
          draw(local, view, 0);
          if (f > 0) nat += bandDiff(stored.subarray((f - 1) * WN, f * WN), view);
        }
        local = start.local;
        let ref = 0;
        let blur = 0;
        let prev = new Float32Array(WN);
        let next = new Float32Array(WN);
        const d = new Float32Array(WN);
        for (let f = 0; f < FRAMES; f++) {
          if (f > 0) local += STEP;
          draw(local, next, jitter);
          if (f > 0) {
            ref += bandDiff(prev, next);
            for (let k = 0; k < WN; k++) d[k] = (stored[f * WN + k]! - stored[(f - 1) * WN + k]!) - (next[k]! - prev[k]!);
            blur += blurredMean(d);
          }
          const t = prev; prev = next; next = t;
        }
        for (const n of names) mv.setLayerVisible(n, true);
        const native = nat / (FRAMES - 1);
        const reference = ref / (FRAMES - 1);
        return { native, reference, excess: native - reference, blurred: blur / (FRAMES - 1) };
      }
      function setNaive(on: boolean): number {
        const root = host.ctx.scene.children.find((o) => o.name === 'props')!;
        let n = 0;
        root.traverse((o) => {
          if (!(o as Mesh).isMesh) return;
          const m = (o as Mesh).material as ShaderMaterial;
          const defs: Record<string, unknown> = { ...m.defines };
          if (on) defs['NAIVE_EDGES'] = '1'; else delete defs['NAIVE_EDGES'];
          m.defines = defs;
          m.needsUpdate = true;
          n++;
        });
        return n;
      }
      mv.manual(true);
      lab.stepToTick(simTick);
      mv.setPost('full');
      mv.setMsaa(2);
      lab.settle(start, 500);
      const b10 = lab.shimmer(start).mean;
      const all = measure(names);
      const noProps = measure(['sky', 'terrain', 'fx']);
      const propsOnly = measure(['props']);
      const naiveCount = setNaive(true);
      const naiveAll = measure(names);
      setNaive(false);
      return { b10, all, noProps, propsOnly, naiveAll, naiveCount };
    }, { start: { chunk: 5, local: 0, tick: 28800 }, simTick: 1200, jitter: 4 });
    const f = (o: { native: number; reference: number; excess: number; blurred: number }): string =>
      `native ${o.native.toFixed(3)}, reference ${o.reference.toFixed(3)}, excess ${o.excess.toFixed(3)}, blurred ${o.blurred.toFixed(3)}`;
    const share = r.all.excess - r.noProps.excess;
    const blurShare = r.all.blurred - r.noProps.blurred;
    const naiveShare = r.naiveAll.excess - r.noProps.excess;
    const naiveBlurShare = r.naiveAll.blurred - r.noProps.blurred;
    console.log(`A16b B10 shimmer, all layers: ${r.b10.toFixed(3)}`);
    console.log(`A16b all layers: ${f(r.all)}`);
    console.log(`A16b props hidden: ${f(r.noProps)}`);
    console.log(`A16b props only: ${f(r.propsOnly)}`);
    console.log(`A16b control, NAIVE_EDGES on ${r.naiveCount} props materials, all layers: ${f(r.naiveAll)}`);
    console.log(`A16b props' share: excess ${share.toFixed(3)} (limit ${SHARE_LIMIT}), blurred ${blurShare.toFixed(3)} (limit ${BLUR_SHARE_LIMIT}); control ${naiveShare.toFixed(3)}, ${naiveBlurShare.toFixed(3)}`);
    expect(r.naiveCount).toBeGreaterThan(0);
    // The native pass is B10's measurement itself (D3D11 at MSAA 2 can move a few bytes by a level between renders of one state).
    expect(r.all.native).toBeCloseTo(r.b10, 3);
    expect(share).toBeLessThanOrEqual(SHARE_LIMIT);
    expect(blurShare).toBeLessThanOrEqual(BLUR_SHARE_LIMIT);
    expect(naiveShare).toBeGreaterThan(SHARE_LIMIT);
    expect(naiveBlurShare).toBeGreaterThan(BLUR_SHARE_LIMIT);
  });

  // ---- M4 to M7: the sheets ----

  test('sheet: placeholders fail', async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, { scene: 'sheet', sil: 1, post: 'off', tier: 3, placeholder: 1 });
    const out = await page.evaluate(() => {
      window.__sheet!.render('silhouette', { yaw: 0.5, shuffle: 1985 });
      return { max: window.__sheet!.maxIou(), pairs: window.__sheet!.pairs(3) };
    });
    console.log(`A18 identical boxes: maxPairIoU ${out.max.toFixed(3)}, top ${out.pairs.map((p) => `${p.a}/${p.b} ${p.iou.toFixed(3)}`).join(', ')}`);
    expect(out.max).toBeGreaterThan(0.9);
    // The gate reports failure on them: this is its negative control.
    expect(out.max > 0.75).toBe(true);
  });

  test('sheet: tool', async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, { scene: 'sheet', sil: 1, post: 'off', tier: 3 });
    const a = await page.evaluate(() => {
      const r = window.__sheet!.render('silhouette', { yaw: 0.5, shuffle: 1985 });
      return { r, lit: window.__sheet!.litCounts(), names: window.__sheet!.names(), png: window.__sheet!.png() };
    });
    const b = await page.evaluate(() => {
      const r = window.__sheet!.render('silhouette', { yaw: 0.5, shuffle: 1985 });
      return { r, png: window.__sheet!.png() };
    });
    expect(a.r.tiles).toBe(27);
    expect([...a.r.key].sort()).toEqual([...a.names].sort());
    expect(new Set(a.r.key).size).toBe(27);
    expect(a.r.key).not.toEqual(a.names);
    expect(b.r.key).toEqual(a.r.key);
    expect(b.png).toBe(a.png);
    for (let i = 0; i < 27; i++) expect(a.lit[i], `tile ${a.names[i]} has object pixels`).toBeGreaterThan(0);
    await open(page, { scene: 'sheet', tier: 3 });
    const close = await page.evaluate(() => window.__sheet!.render('close', { palette: 0 }));
    expect(close.tiles).toBe(27);
  });

  test('sheet: close', async ({ page }, info) => {
    test.setTimeout(300_000);
    await open(page, { scene: 'sheet', tier: 3 });
    const r = await page.evaluate(() => window.__sheet!.render('close', { palette: 0 }));
    expect(r.tiles).toBe(27);
    savePng(info, 'sheet-close-p0.png', await page.evaluate(() => window.__sheet!.png()));
  });

  test('sheet: oneshot', async ({ page }, info) => {
    test.setTimeout(120_000);
    test.skip(!process.env['T05_SHOTS'], 'only when asked for by T05_SHOTS');
    await open(page, { scene: 'sheet', tier: 3 });
    const ids = (process.env['T05_SHOTS'] ?? '13').split(',').map(Number);
    for (const id of ids) {
      savePng(info, `one-${id}.png`, await page.evaluate((id) => window.__sheet!.oneShot(id, { scale: 1 }), id));
    }
  });

  test('sheet: far', async ({ page }, info) => {
    test.setTimeout(300_000);
    await open(page, { scene: 'sheet', tier: 3 });
    const r = await page.evaluate(() => window.__sheet!.render('far', { palette: 0 }));
    expect(r.tiles).toBe(27);
    savePng(info, 'sheet-far-p0.png', await page.evaluate(() => window.__sheet!.png()));
  });

  test('sheet: silhouette', async ({ page }, info) => {
    test.setTimeout(300_000);
    await open(page, { scene: 'sheet', sil: 1, post: 'off', tier: 3 });
    const r = await page.evaluate(() => window.__sheet!.render('silhouette', { yaw: 0.5, shuffle: 1985 }));
    expect(r.tiles).toBe(27);
    savePng(info, 'sheet-silhouette.png', await page.evaluate(() => window.__sheet!.png()));
    const pairs = await page.evaluate(() => window.__sheet!.pairs(5));
    const max = await page.evaluate(() => window.__sheet!.maxIou());
    writeFileSync(info.outputPath('sheet-silhouette-key.txt'), r.key.join('\n'));
    console.log(`A20 maxPairIoU ${max.toFixed(3)}; top pairs ${pairs.map((p) => `${p.a}/${p.b} ${p.iou.toFixed(3)}`).join(', ')}`);
    expect(max).toBeLessThanOrEqual(0.75);
  });

  test('sheet: orb motion', async ({ page }, info) => {
    test.setTimeout(240_000);
    await open(page, { scene: 'one', ship: 0, tier: 3 });
    const run = (fade: boolean) => page.evaluate(({ fade, strip }) => {
      const P = window.__props!;
      const shell = P.shell;
      P.backdrop.setVisible(false);
      P.debug!.setOrbFade(fade);
      // ORB only, at 100 to 1200 u, in T01's lateral band, stepped so no row holds more than its 3.
      const at0 = { chunk: 3000, local: 0 };
      const list = [];
      for (let i = 0; i < 44; i++) {
        const distance = 100 + 25 * i;
        const side = i % 2 === 0 ? -1 : 1;
        list.push({ source: 'prop' as const, kind: 3, place: { at: at0, distance, x: side * (50 + (i * 37) % 130), y: 12, scale: 1 + (i % 3) * 0.5 } });
      }
      P.sheetWorld!.selectMany(list);
      shell.frameAt(0, { at: at0, tick: 0, palette: 0, bend: { a: 0, c: 0 } });
      shell.rebuild();
      let prev: Uint8Array | null = null;
      let sum = 0;
      let n = 0;
      let c = 3000;
      let l = 0;
      const out = document.createElement('canvas');
      out.width = 6 * 320;
      out.height = 2 * 90;
      const ctx = out.getContext('2d')!;
      for (let f = 0; f < 48; f++) {
        l += 1.17;
        if (l >= 64) { l -= 64; c += 1; }
        shell.frameAt(0, { at: { chunk: c, local: l }, tick: 0, palette: 0, bend: { a: 0, c: 0 } });
        if (strip && f >= 20 && f < 26) {
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(shell.ctx.renderer.domElement, 800, 500, 160, 90, (f - 20) * 320, 0, 320, 180);
        }
        const px = shell.pixels();
        if (prev) {
          // Over orb pixels only: lit in both frames, so a silhouette moving against black, the same either way, does not drown the number.
          let s = 0;
          let m = 0;
          for (let i = 0; i < px.length; i += 4) {
            if (px[i]! + px[i + 1]! + px[i + 2]! > 12 && prev[i]! + prev[i + 1]! + prev[i + 2]! > 12) {
              s += Math.abs(px[i]! - prev[i]!) + Math.abs(px[i + 1]! - prev[i + 1]!) + Math.abs(px[i + 2]! - prev[i + 2]!);
              m += 3;
            }
          }
          if (m > 0) {
            sum += s / m;
            n++;
          }
        }
        prev = px;
      }
      return { mean: sum / n, strip: strip ? out.toDataURL('image/png') : null };
    }, { fade, strip: fade });
    const on = await run(true);
    const off = await run(false);
    if (on.strip) savePng(info, 'sheet-orb-seq.png', on.strip);
    console.log(`A22 mean frame diff over orb pixels: fade on ${on.mean.toFixed(3)}, off ${off.mean.toFixed(3)}, ratio ${(on.mean / off.mean).toFixed(3)}`);
    expect(on.mean).toBeLessThanOrEqual(0.85 * off.mean);
  });

  test('tier0: orb sun only', async ({ page }, info) => {
    test.setTimeout(240_000);
    // A37 (DI-85): at tier 0 the sky draws mode 0's sun in every hero mode, so an orb must reflect that sun, not a ringed planet or
    // a wire moon. Each tier is its own page load, since the tier-0 program is chosen at the layer's first setQuality.
    const rows: OrbHeroRow[] = [];
    for (const tier of [0, 1, 2, 3, 4] as const) {
      await open(page, { scene: 'one', ship: 0, post: 'off', tier });
      const r = await page.evaluate(orbHeroFrames, tier === 0 || tier === 3);
      if (r.strip) savePng(info, `orb-hero-t${tier}.png`, r.strip);
      console.log(`A37 tier ${tier} (${r.width}x${r.height}): orbs lit ${r.lit} px; hero 2 against 0 ${r.d2.bytes} bytes (max ${r.d2.max}), hero 3 against 0 ${r.d3.bytes} bytes (max ${r.d3.max}); self-compare ${r.self.bytes} bytes (max ${r.self.max})`);
      rows.push({ tier, ...r });
    }
    for (const r of rows) {
      expect(r.lit, `tier ${r.tier}: the orbs are in frame`).toBeGreaterThan(5000);
      expect(r.self.bytes, `tier ${r.tier}: self-compare`).toBeLessThanOrEqual(SELF_BYTES);
      expect(r.self.max).toBeLessThanOrEqual(1);
      if (r.tier === 0) {
        // The same state as hero 0: HERO_SUN_ONLY leaves uHero unread.
        expect(r.d2.bytes, 'tier 0: an orb under hero 2 reflects the plain sun').toBeLessThanOrEqual(SELF_BYTES);
        expect(r.d2.max).toBeLessThanOrEqual(1);
        expect(r.d3.bytes, 'tier 0: an orb under hero 3 reflects the plain sun').toBeLessThanOrEqual(SELF_BYTES);
        expect(r.d3.max).toBeLessThanOrEqual(1);
      } else {
        // The control: tiers 1 to 4 keep the full shader, so the same comparison differs there.
        expect(r.d2.bytes, `tier ${r.tier}: an orb reflects the ringed planet`).toBeGreaterThan(ORB_HERO_MIN_BYTES);
        expect(r.d3.bytes, `tier ${r.tier}: an orb reflects the wire moon`).toBeGreaterThan(ORB_HERO_MIN_BYTES);
      }
    }
  });

  test('sheet: palettes', async ({ page }, info) => {
    test.setTimeout(300_000);
    await open(page, { scene: 'sheet', tier: 3 });
    for (const palette of [2, 3, 4, 5]) {
      await page.evaluate((palette) => window.__sheet!.render('close', { palette }), palette);
      savePng(info, `sheet-close-p${palette}.png`, await page.evaluate(() => window.__sheet!.png()));
    }
  });

  test('sheet: road', async ({ page }, info) => {
    test.setTimeout(600_000);
    await open(page, { scene: 'sheet', tier: 3 });
    await page.evaluate(() => window.__sheet!.render('road', { palette: 0 }));
    savePng(info, 'sheet-road.png', await page.evaluate(() => window.__sheet!.png()));
    for (let b = 0; b < 6; b++) {
      const r = await page.evaluate((b) => window.__sheet!.roadFrame(b, b, true), b);
      savePng(info, `road-b${b}.png`, r.png);
      console.log(`A29 biome ${b}: calls ${r.calls}, triangles ${r.triangles}`);
    }
    for (const d of [430, 200]) {
      savePng(info, `ring-frame-${d}.png`, await page.evaluate((d) => window.__sheet!.ringFrame(d), d));
    }
  });

  // ---- M8: items, events and the ship ----

  test('items: motion twin', async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, { post: 'off', ship: 0, scene: 'one', tier: 2 });
    const out = await page.evaluate(() => {
      const P = window.__props!;
      const shell = P.shell;
      shell.setLayerVisible('sky', false);
      const gl = shell.ctx.renderer.getContext();
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const at = { chunk: 1000, local: 0 };
      const fract = (x: number): number => x - Math.floor(x);
      const phase = (tick: number, period: number): number => (tick % period) / period;
      const rows: { tick: number; kind: string; cx: number; ex: number; err: number; wrong: number }[] = [];
      const fades: { f: number; width: number }[] = [];
      // The red lights only: they sit on one plane, so perspective on the rest of the mesh cannot bias the reading.
      const redX = (): number => {
        const px = shell.pixels();
        let sum = 0;
        let n = 0;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const o = (y * w + x) * 4;
            if (px[o]! > 200 && px[o + 1]! < 90 && px[o + 2]! < 120) {
              sum += x + 0.5;
              n++;
            }
          }
        }
        return n ? sum / n : -1;
      };
      const carRearPlane = 1.715 * 3;
      const droneEyePlane = 0.72 * 2.5;

      // TRAFFIC, phase 7, period 30720 ticks. Off to one side, so its screen x says how far along it is.
      const trafficX = 10;
      const a = 128;
      const k = 1;
      const seed = 0.2;
      const yT = 7;
      P.sheetWorld!.select({ source: 'item', kind: 5, place: { at, distance: 60, x: trafficX, y: yT, radius: 3, a, b: k, seed } });
      for (let i = 0; i < 8; i++) {
        // Stay well inside the solid part of its run.
        const tick = Math.floor(30720 * (0.02 + 0.08 * i));
        shell.frameAt(0, { at, tick, palette: 0, bend: { a: 0, c: 0 } });
        shell.rebuild();
        shell.frameAt(0, { at, tick, palette: 0, bend: { a: 0, c: 0 } });
        const cx = redX();
        const f = fract(k * phase(tick, 30720) + seed);
        const zf = 60 + a * f;
        const [ex] = P.project(trafficX, yT, -(zf - carRearPlane));
        const fWrong = fract(k * phase(tick, 7680) + seed);
        const [wrong] = P.project(trafficX, yT, -(60 + a * fWrong - carRearPlane));
        rows.push({ tick, kind: 'TRAFFIC', cx, ex, err: Math.abs(cx - ex), wrong: Math.abs(cx - wrong) });
      }
      // Fade: at f = .1 and .9 scale is full, at f = .02 about .2.
      for (const f of [0.5, 0.1, 0.9, 0.02]) {
        P.sheetWorld!.select({ source: 'item', kind: 5, place: { at, distance: 30, x: 0, y: 7 + 30 * Math.tan(0.05), radius: 3, a: 0, b: 0, seed: f } });
        shell.frameAt(0, { at, tick: 0, bend: { a: 0, c: 0 } });
        shell.rebuild();
        shell.frameAt(0, { at, tick: 0, bend: { a: 0, c: 0 } });
        const c = P.metrics.centroid(shell.pixels(), w, h);
        fades.push({ f, width: c.maxX - c.minX + 1 });
      }
      // DRONE, phase 3, period 120 ticks.
      const droneX = 0;
      const amp = 6;
      const yD = 7;
      const dSeed = 0.15;
      P.sheetWorld!.select({ source: 'item', kind: 4, place: { at, distance: 40, x: droneX, y: yD, radius: 2.5, a: amp, b: 1, seed: dSeed } });
      for (let i = 0; i < 8; i++) {
        const tick = 13 * i + 3;
        shell.frameAt(0, { at, tick, palette: 0, bend: { a: 0, c: 0 } });
        shell.rebuild();
        shell.frameAt(0, { at, tick, palette: 0, bend: { a: 0, c: 0 } });
        const cx = redX();
        const off = amp * Math.sin(2 * Math.PI * (phase(tick, 120) + dSeed));
        const [ex] = P.project(droneX + off, yD, -(40 - droneEyePlane));
        const offWrong = amp * Math.sin(2 * Math.PI * (phase(tick, 480) + dSeed));
        const [wrong] = P.project(droneX + offWrong, yD, -(40 - droneEyePlane));
        rows.push({ tick, kind: 'DRONE', cx, ex, err: Math.abs(cx - ex), wrong: Math.abs(cx - wrong) });
      }
      return { rows, fades };
    });
    for (const r of out.rows) console.log(`A25 ${r.kind} tick ${r.tick}: centroid x ${r.cx.toFixed(2)} expected ${r.ex.toFixed(2)} err ${r.err.toFixed(2)}; wrong phase misses by ${r.wrong.toFixed(1)}`);
    for (const r of out.rows) expect(r.err, `${r.kind} at ${r.tick}`).toBeLessThanOrEqual(1.5);
    const wrongT = Math.max(...out.rows.filter((r) => r.kind === 'TRAFFIC').map((r) => r.wrong));
    const wrongD = Math.max(...out.rows.filter((r) => r.kind === 'DRONE').map((r) => r.wrong));
    expect(wrongT).toBeGreaterThan(20);
    expect(wrongD).toBeGreaterThan(20);
    console.log(`A25 fade widths ${JSON.stringify(out.fades)}`);
    const full = out.fades[0]!.width;
    expect(Math.abs(out.fades[1]!.width - full)).toBeLessThanOrEqual(2);
    expect(Math.abs(out.fades[2]!.width - full)).toBeLessThanOrEqual(2);
    expect(out.fades[3]!.width / full).toBeGreaterThan(0.12);
    expect(out.fades[3]!.width / full).toBeLessThan(0.3);
  });

  test('items: collect hides', async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, { post: 'off', ship: 0, scene: 'one', tier: 2 });
    const out = await page.evaluate(() => {
      const P = window.__props!;
      const shell = P.shell;
      shell.setLayerVisible('sky', false);
      const gl = shell.ctx.renderer.getContext();
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const at = { chunk: 1000, local: 0 };
      const SHARD = 1;
      const place = { at, distance: 20, x: -6, y: 8, radius: 2.5, seed: 0.1, twin: { dx: 12, dz: 2 } };
      const count = (o: { events?: { kind: 1; x: number; y: number; value: number; chunk: number; index: number }[] } = {}) => {
        shell.frameAt(0, { at, tick: 5, bend: { a: 0, c: 0 }, ...o });
        const px = shell.pixels();
        let left = 0;
        let right = 0;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const i = ((h - 1 - y) * w + x) * 4;
            if (px[i]! + px[i + 1]! + px[i + 2]! > 24) {
              if (x < w / 2) left++;
              else right++;
            }
          }
        }
        return { left, right };
      };
      P.sheetWorld!.select({ source: 'item', kind: 0, place });
      shell.frameAt(0, { at, tick: 5, bend: { a: 0, c: 0 } });
      shell.rebuild();
      const both = count();
      const hit = count({ events: [{ kind: SHARD, x: 0, y: 0, value: 1, chunk: 1000, index: 1 }] });
      const later = count();
      const ignored = count({ events: [{ kind: SHARD, x: 0, y: 0, value: 1, chunk: 123456, index: 0 }] });
      // A fresh run: index 0 hides the other.
      shell.rebuild();
      const fresh = count();
      const hit0 = count({ events: [{ kind: SHARD, x: 0, y: 0, value: 1, chunk: 1000, index: 0 }] });
      return { both, hit, later, ignored, fresh, hit0, hides: P.debug!.counts().hides };
    });
    console.log(`A26 ${JSON.stringify(out)}`);
    expect(out.both.left).toBeGreaterThan(0);
    expect(out.both.right).toBeGreaterThan(0);
    expect(out.hit.left).toBeGreaterThan(0);
    expect(out.hit.right).toBe(0);
    expect(out.later.right).toBe(0);
    expect(out.ignored.left).toBeGreaterThan(0);
    expect(out.fresh.right).toBeGreaterThan(0);
    expect(out.hit0.left).toBe(0);
    expect(out.hit0.right).toBeGreaterThan(0);
  });

  test('items: cruise ghost', async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, { post: 'off', ship: 0, scene: 'one', tier: 2 });
    const out = await page.evaluate(() => {
      const P = window.__props!;
      const shell = P.shell;
      shell.setLayerVisible('sky', false);
      const gl = shell.ctx.renderer.getContext();
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const at = { chunk: 1000, local: 0 };
      const luma = (mode: 0 | 1 | 2 | 3, tick: number) => {
        shell.frameAt(0, { at, tick, bend: { a: 0, c: 0 }, sim: { mode } });
        return P.metrics.meanLuma(shell.pixels()) * (w * h) / 1000;
      };
      const measure = (source: 'prop' | 'item', kind: number, place: Record<string, number>) => {
        P.sheetWorld!.select({ source, kind, place: { at, distance: 40, x: 0, y: 7, ...place } });
        shell.frameAt(0, { at, tick: 720, bend: { a: 0, c: 0 }, sim: { mode: 1 } });
        shell.rebuild();
        const play = luma(1, 720);
        // Into CRUISE, and back to the same tick, so nothing moved: a tick going backwards lands the ramp on its target at once.
        luma(2, 721);
        const cruise = luma(2, 720);
        luma(1, 721);
        const back = luma(1, 720);
        return { play, cruise, back };
      };
      return {
        spike: measure('item', 2, { radius: 3.5, y: 3.5 }),
        fence: measure('item', 3, { radius: 42, a: 8, b: 12, y: 8 }),
        drone: measure('item', 4, { radius: 2.5, a: 0, b: 1 }),
        traffic: measure('item', 5, { radius: 3, a: 0, b: 0, seed: 0.5 }),
        palm: measure('prop', 0, { y: 0, x: -10 }),
        shard: measure('item', 0, { radius: 2.5 }),
      };
    });
    console.log(`A27 ghost ${JSON.stringify(out)}`);
    for (const k of ['spike', 'fence', 'drone', 'traffic'] as const) {
      expect(out[k].cruise / out[k].play, k).toBeLessThanOrEqual(0.5);
      expect(out[k].back / out[k].play, `${k} comes back`).toBeGreaterThan(0.9);
    }
    expect(Math.abs(out.palm.cruise / out.palm.play - 1)).toBeLessThan(0.1);
    expect(Math.abs(out.shard.cruise / out.shard.play - 1)).toBeLessThan(0.1);
  });

  test('items: gate flash', async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, { post: 'off', ship: 0, scene: 'one', tier: 2 });
    const out = await page.evaluate(() => {
      const P = window.__props!;
      const shell = P.shell;
      shell.setLayerVisible('sky', false);
      const at = { chunk: 1000, local: 0 };
      const row = 1000;
      P.sheetWorld!.select({ source: 'item', kind: 1, place: { at, distance: 30, x: 0, y: 8, radius: 9 } });
      shell.frameAt(0, { at, tick: 720, bend: { a: 0, c: 0 } });
      shell.rebuild();
      const luma = (tick: number, o: { events?: { kind: 2; x: number; y: number; value: number; chunk: number; index: number }[] } = {}) => {
        shell.frameAt(0, { at, tick, bend: { a: 0, c: 0 }, ...o });
        return P.metrics.meanLuma(shell.pixels());
      };
      const GATE = 2;
      // The flash at 792, then the gate checked 120 ticks later, 1 s, the flash length in layer.ts. Each is compared with a frame at the
      // same tick and no flash, drawn first, so the beat pulse cancels: the flash exists only from its event's tick on.
      const at792 = luma(792);
      const at912 = luma(912);
      const flash = luma(792, { events: [{ kind: GATE, x: 0, y: 8, value: 1, chunk: row, index: 0 }] });
      const after = luma(912);
      return { base: at792, flash, base912: at912, after };
    });
    console.log(`A27 flash ${JSON.stringify(out)}`);
    expect(out.flash).toBeGreaterThan(out.base * 1.2);
    expect(Math.abs(out.after / out.base912 - 1)).toBeLessThan(0.02);
  });

  test('items: ship', async ({ page }, info) => {
    test.setTimeout(120_000);
    await open(page, { scene: 'one', tier: 3 });
    const out = await page.evaluate(() => {
      const P = window.__props!;
      const shell = P.shell;
      const at = { chunk: 1000, local: 0 };
      P.sheetWorld!.select(null);
      P.debug!.setShipVisible(true);
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      const c = canvas.getContext('2d')!;
      const poses: { x: number; prevX: number; y: number; prevY: number; speed: number; ghost?: number }[] = [
        { x: 0, prevX: 0, y: 6, prevY: 6, speed: 80 },
        { x: 0.2, prevX: 0, y: 6, prevY: 6, speed: 80 },
        { x: 0, prevX: 0, y: 6, prevY: 6, speed: 150 },
        { x: 0, prevX: 0, y: 6, prevY: 6, speed: 80, ghost: 1 },
      ];
      // At tick 8, phase 3 is 8/120, and 8 * that is .53: in the dim half of the blink.
      const tick = (i: number) => (i === 3 ? 8 : 0);
      for (let i = 0; i < poses.length; i++) {
        const o = { at, tick: tick(i), palette: 0, bend: { a: 0, c: 0 }, camX: 0, camY: 7, sim: poses[i]! };
        shell.frameAt(0, o);
        shell.rebuild();
        shell.frameAt(0, o);
        const r = shell.ctx.renderer.domElement;
        c.drawImage(r, r.width * 0.25, r.height * 0.42, r.width * 0.5, r.height * 0.5, (i % 2) * 640, Math.floor(i / 2) * 360, 640, 360);
      }
      // Stays on the lerp position: measured against the additive glow's centre on a black backdrop.
      P.backdrop.setVisible(false);
      const gl = shell.ctx.renderer.getContext();
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const errs: number[] = [];
      // A camera on the lerp position should see the ship dead centre, whatever perspective does elsewhere. shipHold keeps bank at 0.
      const prevX = -3;
      const x = 5;
      for (const alpha of [0, 0.25, 0.5, 0.75]) {
        const lerpX = prevX + (x - prevX) * alpha;
        const t = (240 + alpha) / 120;
        shell.frameAt(t, { palette: 0, bend: { a: 0, c: 0 }, camX: lerpX, camY: 7, feel: { shipHold: 1 }, sim: { x, prevX, y: 6, prevY: 6, speed: 80 } });
        const m = P.metrics.centroid(shell.pixels(), w, h, 170);
        errs.push(Math.abs(m.x - w / 2));
      }
      // The negative control: the same frame with the camera on x instead reads far off centre.
      shell.frameAt((240 + 0.5) / 120, { palette: 0, bend: { a: 0, c: 0 }, camX: x, camY: 7, feel: { shipHold: 1 }, sim: { x, prevX, y: 6, prevY: 6, speed: 80 } });
      const control = Math.abs(P.metrics.centroid(shell.pixels(), w, h, 170).x - w / 2);
      return { png: canvas.toDataURL('image/png'), errs, control };
    });
    savePng(info, 'ship.png', out.png);
    console.log(`A28 lerp position error ${out.errs.map((e) => e.toFixed(2)).join(', ')} px; camera on x instead reads ${out.control.toFixed(1)} px off`);
    for (const e of out.errs) expect(e).toBeLessThanOrEqual(2);
    expect(out.control).toBeGreaterThan(20);

    // Under reducedMotion, tip blink transitions over 120 frames drop by at least half.
    await open(page, { scene: 'one', ship: 0, tier: 3 });
    const blink = await page.evaluate(() => {
      const P = window.__props!;
      const shell = P.shell;
      P.backdrop.setVisible(false);
      const at = { chunk: 1000, local: 0 };
      P.sheetWorld!.select({ source: 'prop', kind: 7, place: { at, distance: 6, x: 0, y: 6.7, scale: 3 } });
      shell.frameAt(0, { at, tick: 0, bend: { a: 0, c: 0 } });
      shell.rebuild();
      const series = (reduced: boolean): number => {
        let prev = -1;
        let total = 0;
        for (let i = 0; i < 120; i++) {
          shell.frameAt(0, { at, tick: i * 2, bend: { a: 0, c: 0 }, reducedMotion: reduced });
          const l = P.metrics.meanLuma(shell.pixels());
          if (prev >= 0) total += Math.abs(l - prev);
          prev = l;
        }
        return total;
      };
      return { normal: series(false), reduced: series(true) };
    });
    console.log(`A28 blink travel over 120 frames: normal ${blink.normal.toFixed(3)}, reduced ${blink.reduced.toFixed(3)}`);
    expect(blink.reduced).toBeLessThanOrEqual(blink.normal * 0.5);
  });

  // ---- M9: the whole ----

  test('budget: worst case', async ({ page }) => {
    test.setTimeout(240_000);
    const measure = (): Promise<{ p50: number; p95: number; max: number; stats: { calls: number; triangles: number } }> => page.evaluate(() => {
      const P = window.__props!;
      const shell = P.shell;
      const times: number[] = [];
      let c = 3000;
      let l = 0;
      for (let f = 0; f < 140; f++) {
        l += 1.33;
        if (l >= 64) { l -= 64; c += 1; }
        const ms = shell.frameAt(0, { at: { chunk: c, local: l }, tick: f, palette: 0 });
        if (f >= 20) times.push(ms);
      }
      times.sort((a, b) => a - b);
      return { p50: times[Math.floor(times.length * 0.5)]!, p95: times[Math.floor(times.length * 0.95)]!, max: times[times.length - 1]!, stats: shell.stats() };
    });
    // The same loop with no props beside it, so a run on a busy GPU can be read.
    await open(page, { scene: 'worst', tier: 3, props: 0 });
    const base = await measure();
    await open(page, { scene: 'worst', tier: 3 });
    // DI-86(3): the first pass after a page load is noisy, so one pass of the same sequence runs first and is discarded, and
    // the pass after it is the one gated. The warm-up is printed, and so is the lower p95 of the two, the figure gated before.
    const warm = await measure();
    const out = await measure();
    console.log(`A30 no props: p50 ${base.p50.toFixed(2)} ms, p95 ${base.p95.toFixed(2)} ms`);
    console.log(`A30 warm-up pass, discarded: p50 ${warm.p50.toFixed(2)} ms, p95 ${warm.p95.toFixed(2)} ms, max ${warm.max.toFixed(2)} ms`);
    console.log(`A30 worst case, backdrop plus props, DevPost, tier 3, 1080p, gated pass: p50 ${out.p50.toFixed(2)} ms, p95 ${out.p95.toFixed(2)} ms, max ${out.max.toFixed(2)} ms; calls ${out.stats.calls}, triangles ${out.stats.triangles}; lower p95 of the two passes ${Math.min(warm.p95, out.p95).toFixed(2)}`);
    expect(out.p95).toBeLessThanOrEqual(2.0);
  });

  test('budget: streaming', async ({ page }) => {
    test.setTimeout(240_000);
    await open(page, { scene: 'road', tier: 3 });
    const out = await page.evaluate(() => {
      const P = window.__props!;
      const shell = P.shell;
      const layer = P.layer!;
      const times: number[] = [];
      const original = layer.frame.bind(layer);
      let c = 3000;
      shell.frameAt(0, { at: { chunk: c, local: 0 }, tick: 0 });
      layer.frame = (v) => {
        const t0 = performance.now();
        original(v);
        times.push(performance.now() - t0);
      };
      for (let i = 1; i <= 2000; i++) {
        c++;
        shell.frameAt(0, { at: { chunk: c, local: 0 }, tick: i });
      }
      layer.frame = original;
      times.sort((a, b) => a - b);
      const rebuilds: number[] = [];
      for (let i = 0; i < 20; i++) {
        c += 1000;
        shell.frameAt(0, { at: { chunk: c, local: 0 }, tick: i });
        const t0 = performance.now();
        shell.rebuild();
        rebuilds.push(performance.now() - t0);
      }
      return { p50: times[Math.floor(times.length * 0.5)]!, p99: times[Math.floor(times.length * 0.99)]!, max: times[times.length - 1]!, rebuildMax: Math.max(...rebuilds) };
    });
    console.log(`A31 layer.frame on crossings: p50 ${out.p50.toFixed(2)} ms, p99 ${out.p99.toFixed(2)} ms, max ${out.max.toFixed(2)} ms; rebuild max ${out.rebuildMax.toFixed(2)} ms`);
    expect(out.p99).toBeLessThanOrEqual(2);
    expect(out.rebuildMax).toBeLessThanOrEqual(30);
  });

  test('keepout: disc occlusion', async ({ page }, info) => {
    test.setTimeout(300_000);
    // Grounded props of Neon City's set only: floating objects, landmark rings, searchlights and items are exempt from section 5.6.
    await open(page, { scene: 'keepout', arch: '1,5,6,14', items: 'none', ship: 0, tier: 3 });
    const out = await page.evaluate(() => {
      const P = window.__props!;
      const shell = P.shell;
      const gl = shell.ctx.renderer.getContext();
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const fracs: number[] = [];
      let worst = -1;
      let worstPng = '';
      for (let i = 0; i < 20; i++) {
        const at = { chunk: 1000 + 37 * i, local: 0 };
        const frame = { at, tick: 240, palette: 0, bend: { a: 0, c: 0 } };
        shell.setLayerVisible('props', true);
        shell.frameAt(0, frame);
        shell.rebuild();
        shell.frameAt(0, frame);
        const on = shell.pixels();
        const png = shell.ctx.renderer.domElement.toDataURL('image/png');
        shell.setLayerVisible('props', false);
        shell.frameAt(0, frame);
        const off = shell.pixels();
        let inDisc = 0;
        let changed = 0;
        // Analytic disc pixels: the gnomonic disc, from the camera's own projection at a far plane.
        const [cx, cy] = P.project(0, 7 + 1000 * 0.125, -1000);
        const [ex] = P.project(1000 * 0.215, 7 + 1000 * 0.125, -1000);
        const R = ex - cx;
        // Above the horizon only: below it the disc is under the floor already.
        const [, horizon] = P.project(0, 0, -6000);
        for (let y = Math.max(0, Math.floor(cy - R)); y < Math.min(h, Math.ceil(cy + R), Math.floor(horizon)); y++) {
          for (let x = Math.max(0, Math.floor(cx - R)); x < Math.min(w, Math.ceil(cx + R)); x++) {
            if (Math.hypot(x - cx, y - cy) > R) continue;
            inDisc++;
            const o = ((h - 1 - y) * w + x) * 4;
            if (Math.abs(on[o]! - off[o]!) + Math.abs(on[o + 1]! - off[o + 1]!) + Math.abs(on[o + 2]! - off[o + 2]!) > 24) changed++;
          }
        }
        const frac = inDisc > 0 ? changed / inDisc : 0;
        fracs.push(frac);
        if (frac > worst) {
          worst = frac;
          worstPng = png;
        }
      }
      return { fracs, worst, worstPng };
    });
    savePng(info, 'keepout-worst.png', out.worstPng);
    console.log(`A33 disc pixels changed by props: ${out.fracs.map((f) => (f * 100).toFixed(1)).join(' ')} %; worst ${(out.worst * 100).toFixed(1)}%`);
    expect(out.worst).toBeLessThanOrEqual(0.15);
  });

  test('whole: washout', async ({ page }) => {
    test.setTimeout(600_000);
    await open(page, { scene: 'sheet', tier: 3 });
    // Both definitions, side by side: T05's own (all channels >= 245, chroma over pixels with max >= 32) and section 8.1's (min > 235,
    // chroma over every pixel), which section 6.7 now points to. Both are gated, since under 8.1 the fence crossing a pale disc once
    // added .394 points (plan section 10).
    const rows: string[] = [];
    let worstNearWhiteP0 = 0;
    let worstContractP0 = 0;
    let worstChromaP0 = 1e9;
    const over: string[] = [];
    const overContract: string[] = [];
    let worstAdded = { t05: 0, contract: 0, at: '' };
    for (let palette = 0; palette < 6; palette++) {
      for (let b = 0; b < 6; b++) {
        const r = await page.evaluate(({ b, palette }) => {
          const on = window.__sheet!.roadFrame(b, palette, true);
          const off = window.__sheet!.roadFrame(b, palette, false);
          return { on: { nw: on.nearWhite, ch: on.chroma, cnw: on.contractNearWhite, cch: on.contractChroma }, off: { nw: off.nearWhite, cnw: off.contractNearWhite } };
        }, { b, palette });
        const addT05 = r.on.nw - r.off.nw;
        const addContract = r.on.cnw - r.off.cnw;
        rows.push(`p${palette} b${b}: T05 near-white ${(r.on.nw * 100).toFixed(3)}% (+${(addT05 * 100).toFixed(3)} points), chroma ${r.on.ch.toFixed(1)}; section 8.1 near-white ${(r.on.cnw * 100).toFixed(3)}% (+${(addContract * 100).toFixed(3)} points), chroma ${r.on.cch.toFixed(1)}`);
        if (palette === 0) {
          worstNearWhiteP0 = Math.max(worstNearWhiteP0, r.on.nw);
          worstContractP0 = Math.max(worstContractP0, r.on.cnw);
          worstChromaP0 = Math.min(worstChromaP0, r.on.ch);
        } else {
          if (addT05 > 0.002) over.push(`p${palette} b${b}: ${(addT05 * 100).toFixed(3)} points`);
          if (addContract > 0.002) overContract.push(`p${palette} b${b}: ${(addContract * 100).toFixed(3)} points`);
          if (addContract > worstAdded.contract) worstAdded = { t05: addT05, contract: addContract, at: `p${palette} b${b}` };
        }
      }
    }
    console.log(`A34\n${rows.join('\n')}`);
    console.log(`A34 palette 0: near-white at most ${(worstNearWhiteP0 * 100).toFixed(3)}% (T05) and ${(worstContractP0 * 100).toFixed(3)}% (section 8.1), chroma at least ${worstChromaP0.toFixed(1)}. Palettes 1 to 5, most added under section 8.1: ${(worstAdded.contract * 100).toFixed(3)} points at ${worstAdded.at || 'none'}. Over .2 points: T05 ${over.length === 0 ? 'none' : over.join(', ')}; section 8.1 ${overContract.length === 0 ? 'none' : overContract.join(', ')}`);
    expect(worstNearWhiteP0).toBeLessThan(0.005);
    expect(worstContractP0).toBeLessThan(0.005);
    expect(worstChromaP0).toBeGreaterThan(55);
    expect(over).toEqual([]);
    expect(overContract).toEqual([]);
  });
});

test.describe('gpu vulkan', () => {
  // The gpu project's Chromium with one change, ANGLE's Vulkan backend, where MSAA frames repeat exactly on this GPU (plan section 10).
  // Each test launches it through onBackend, which skips, printing why, when the launch reports no ANGLE on a Vulkan GPU (DI-70).
  // expectBackend then still checks every page it opens.
  test.beforeEach(({ browserName }, info) => {
    test.skip(browserName !== 'chromium' || info.project.name !== 'gpu' || process.platform !== 'win32', 'needs the 1080p gpu project on Windows');
  });

  identityRows('vulkan');
  msaaNoise('vulkan');
});

test.describe('software', () => {
  test.beforeEach(({ browserName }, info) => {
    test.skip(browserName !== 'chromium' || info.project.name !== 'software', 'needs the software project');
  });

  test('software: tier 0', async ({ page }, info) => {
    test.setTimeout(900_000);
    // DevPost keeps its bloom at tier 0, where the real 'bare' variant has none (DI-46), and that alone costs more than a third of the 50 ms.
    // So the gate reads backdrop plus props with post off, in each biome's set, and the heaviest counts, as section 9.2's proxy gate does.
    // With post off there is no depth buffer, so this overdraws more than the real path: an upper bound on the fragment part.
    const timed = async (query: Record<string, string | number>): Promise<{ p50: number; calls: number; triangles: number }> => {
      await open(page, { scene: 'road', tier: 0, ...query });
      return page.evaluate(() => {
        const shell = window.__props!.shell;
        const times: number[] = [];
        let c = 3000;
        let l = 0;
        shell.frameAt(0, { at: { chunk: c, local: l }, tick: 0, palette: 0 });
        for (let f = 0; f < 30; f++) {
          l += 1.33;
          if (l >= 64) { l -= 64; c += 1; }
          times.push(shell.frameAt(0, { at: { chunk: c, local: l }, tick: f, palette: 0 }));
        }
        times.sort((a, b) => a - b);
        const st = shell.stats();
        return { p50: times[15]!, calls: st.calls, triangles: st.triangles };
      });
    };
    // The statistic: p50 of 30 frameAt calls, each synced by readPixels, the 16th of the 30 sorted (times[15]).
    const biomes: number[] = [];
    for (let set = 0; set < 6; set++) {
      const r = await timed({ post: 'off', set });
      console.log(`A32 biome set ${set}, post off: p50 ${r.p50.toFixed(1)} ms, calls ${r.calls}, triangles ${r.triangles}`);
      biomes.push(r.p50);
    }
    // A zone change crossfades the biome by spawn probability per row, so long-reach rings hold two biomes' sets at once (V1's condition).
    // Biomes follow a hashed permutation per block of six, so any of the 15 pairs can meet. Every union is timed, and the heaviest is gated.
    const unions: { pair: string; p50: number; triangles: number }[] = [];
    for (let a = 0; a < 6; a++) {
      for (let b = a + 1; b < 6; b++) {
        const r = await timed({ post: 'off', set: `${a},${b}` });
        unions.push({ pair: `${a}+${b}`, p50: r.p50, triangles: r.triangles });
      }
    }
    unions.sort((x, y) => y.p50 - x.p50);
    console.log(`A32 two-biome unions, post off, p50 heaviest first: ${unions.map((u) => `${u.pair} ${u.p50.toFixed(1)} ms (${u.triangles} tris)`).join(', ')}`);
    const every = await timed({ post: 'off' });
    const devPost = await timed({ set: 0 });
    const noProps = await timed({ post: 'off', props: 0 });
    console.log(`A32 for reading: every type at once ${every.p50.toFixed(1)} ms, DevPost on biome 0 ${devPost.p50.toFixed(1)} ms, backdrop alone ${noProps.p50.toFixed(1)} ms`);
    await open(page, { scene: 'road', tier: 0 });
    const out = await page.evaluate(() => {
      const P = window.__props!;
      const shell = P.shell;
      const times: number[] = [];
      let c = 3000;
      let l = 0;
      shell.frameAt(0, { at: { chunk: c, local: l }, tick: 0, palette: 0 });
      const rings = [];
      for (let i = 0; i < 26; i++) rings.push(P.debug!.ring(i));
      for (let f = 0; f < 40; f++) {
        l += 1.33;
        if (l >= 64) { l -= 64; c += 1; }
        times.push(shell.frameAt(0, { at: { chunk: c, local: l }, tick: f, palette: 0 }));
      }
      times.sort((a, b) => a - b);
      const png = shell.ctx.renderer.domElement.toDataURL('image/png');
      return { p50: times[20]!, p95: times[38]!, stats: shell.stats(), ringVisible: rings[13]!.visible, palmModulus: rings[0]!.modulus, palmCap: rings[0]!.cap, density: P.debug!.density(), png };
    });
    savePng(info, 'software-tier0.png', out.png);
    console.log(`A32 tier 0 software: p50 ${out.p50.toFixed(1)} ms, p95 ${out.p95.toFixed(1)} ms, ${out.stats.width}x${out.stats.height}, calls ${out.stats.calls}, triangles ${out.stats.triangles}; RING visible ${out.ringVisible}; PALM modulus ${out.palmModulus} of ${out.palmCap}; density ${JSON.stringify(out.density)}`);
    expect(out.ringVisible).toBe(true);
    expect(out.palmModulus).toBeLessThan(out.palmCap);
    expect(Math.max(...biomes)).toBeLessThanOrEqual(25);
    expect(unions[0]!.p50).toBeLessThanOrEqual(25);
  });

  test('software: tier 0 orb sun only', async ({ page }, info) => {
    test.setTimeout(240_000);
    // A37 (DI-85) where tier 0 actually runs: on SwiftShader, same-state frames repeat exactly (DI-58), so 0 bytes.
    await open(page, { scene: 'one', ship: 0, post: 'off', tier: 0 });
    const r = await page.evaluate(orbHeroFrames, true);
    if (r.strip) savePng(info, 'orb-hero-t0-software.png', r.strip);
    console.log(`A37 software tier 0 (${r.width}x${r.height}): orbs lit ${r.lit} px; hero 2 against 0 ${r.d2.bytes} bytes (max ${r.d2.max}), hero 3 against 0 ${r.d3.bytes} bytes (max ${r.d3.max}); self-compare ${r.self.bytes} bytes`);
    expect(r.lit).toBeGreaterThan(1000);
    expect(r.self.bytes).toBe(0);
    expect(r.d2.bytes, 'tier 0: an orb under hero 2 reflects the plain sun').toBe(0);
    expect(r.d3.bytes, 'tier 0: an orb under hero 3 reflects the plain sun').toBe(0);
  });
});
