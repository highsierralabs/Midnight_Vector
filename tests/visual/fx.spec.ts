// T06's browser tests, named M2 to M7 so -g selects a milestone. Numbers measured on the card describe the card, not
// the game. Read pixels in the same page.evaluate as frameAt (section 11.3). Timing printed here is informational,
// since sibling tasks may be using the GPU.
import { readFileSync, writeFileSync } from 'node:fs';
import { BlendFunction, ToneMappingMode } from 'postprocessing';
import type { Page, TestInfo } from 'playwright/test';
import { TIERS, pixelRatioFor, scanPeriodFor } from '../../src/render/fx/quality';
import { spectrum } from '../../src/render/fx/dev/metrics';
import { RenderOrder, type Tier } from '../../src/contracts/index';
import type {} from '../../src/render/fx/dev/fxDev';
import { expect, openDevPage, saveShot, test } from '../support/pw';

const PAGE = '/dev/fx.html';
const NEEDS_GPU = 'needs the 1080p viewport and the real GPU';
const REF = { at: { chunk: 1, local: 12.5 }, tick: 0, bend: { a: 0, c: 0 } } as const;
const DAY = { at: { chunk: 375, local: 12.5 }, tick: 0, bend: { a: 0, c: 0 } } as const;
const PALETTES = [0, 1, 2, 3, 4, 5] as const;
const PALETTE_NAMES = ['Sunset', 'Miami', 'Ultraviolet', 'Toxic', 'Ember', 'Arctic'] as const;

type Query = Record<string, string | number>;

/** Every page here is manual: frames happen only inside a test's own evaluate. */
async function open(page: Page, query: Query = {}): Promise<void> {
  await openDevPage(page, PAGE, { manual: 1, ...query });
}

/** Writes a data URL from the page into the test's folder and prints the same SCREENSHOT line saveShot does. */
function saveDataUrl(info: TestInfo, name: string, dataUrl: string): string {
  const path = info.outputPath(`${name}.png`);
  writeFileSync(path, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
  console.log(`SCREENSHOT ${path}`);
  return path;
}

/** A frame at one state, then a screenshot of what actually reached the page. */
async function shotOf(page: Page, info: TestInfo, name: string, frame: Record<string, unknown>): Promise<void> {
  await page.evaluate((o) => { window.__shell!.frameAt(0, o); }, frame);
  await saveShot(page, info, name);
}

test.describe('M2 frame', () => {
  test.beforeEach(({}, i) => { test.skip(i.project.name !== 'gpu', NEEDS_GPU); });

  test('M2 picture', async ({ page }, info) => {
    await open(page);
    const r = await page.evaluate((ref) => {
      const s = window.__shell!;
      const fx = window.__fx!;
      const ms = s.frameAt(0, { ...ref, palette: 0 });
      const c = document.querySelector('canvas')!;
      return {
        ms, cssW: c.clientWidth, cssH: c.clientHeight, w: c.width, h: c.height, renderer: s.rendererInfo().renderer,
        washout: fx.metrics.washout(s.pixels()), stats: s.stats(), links: fx.links(), active: fx.debug.activeVariant,
      };
    }, REF);
    console.log(`A7 ${JSON.stringify(r)}`);
    expect(r.w).toBe(1920);
    expect(r.h).toBe(1080);
    expect(r.cssW).toBe(1920);
    expect(r.cssH).toBe(1080);
    expect(r.active).toBe('full');
    await saveShot(page, info, 'M2-picture');
  });

  test('M2 order', async ({ page }) => {
    await open(page);
    const r = await page.evaluate(() => {
      const s = window.__shell!;
      const d = window.__fx!.debug;
      const full = d.variants.full.fullscreenMaterial as unknown as { uniforms: Record<string, unknown> };
      const keys = ['e0ModulationOffset', 'e1Intensity', 'e2WhitePoint', 'e3UScan', 'e4Darkness'];
      const present = keys.filter((k) => k in full.uniforms);
      for (let i = 0; i < 50; i++) s.frameAt(i / 60);
      const passes = (['full', 'noCa', 'min', 'bare'] as const).map((v) => {
        const m = d.variants[v].fullscreenMaterial as unknown as { uniforms: { time: { value: number } }; dithering: boolean };
        return { v, time: m.uniforms.time.value, dithering: m.dithering };
      });
      return { present, blend: d.bloom.blendMode.blendFunction, tone: d.tone.mode, rendererTone: d.composer.getRenderer().toneMapping, passes };
    });
    console.log(`A8 ${JSON.stringify(r)}`);
    expect(r.present).toEqual(['e0ModulationOffset', 'e1Intensity', 'e2WhitePoint', 'e3UScan', 'e4Darkness']);
    expect(r.blend).toBe(BlendFunction.SCREEN);
    expect(r.tone).toBe(ToneMappingMode.NEUTRAL);
    expect(r.rendererTone).toBe(0);   // NoToneMapping
    expect(r.passes.length).toBe(4);
    for (const p of r.passes) {
      expect(p.time, p.v).toBe(0);
      expect(p.dithering, p.v).toBe(true);
    }
  });

  test('M2 draws', async ({ page }) => {
    await open(page);
    const r = await page.evaluate((ref) => {
      const s = window.__shell!;
      const fx = window.__fx!;
      const out = [];
      for (const t of [4, 3, 2, 1, 0] as const) {
        fx.setTier(t);
        s.frameAt(0, { ...ref, palette: 0 });
        const enabled = (['full', 'noCa', 'min', 'bare'] as const).filter((v) => fx.debug.variants[v].enabled);
        // Sky and sticks. The speed lines are off under a neutral feel, so they add no draw.
        out.push({ t, post: s.stats().calls - 2, enabled, want: fx.TIERS[t]!.post });
      }
      return out;
    }, REF);
    console.log(`A9 ${JSON.stringify(r)}`);
    expect(r.map((x) => x.post)).toEqual([15, 13, 11, 7, 1]);
    for (const x of r) expect(x.enabled).toEqual([x.want]);
  });

  test('M2 alpha', async ({ page }) => {
    await open(page, { alpha: 0.25 });
    const rows = await page.evaluate((ref) => {
      const s = window.__shell!;
      const fx = window.__fx!;
      const out = [];
      for (const v of ['full', 'noCa', 'min', 'bare'] as const) {
        for (const m of [0, 2, 4] as const) {
          fx.post.forceVariant(v);
          fx.post.forceMsaa(m);
          s.frameAt(0, { ...ref, palette: 0 });
          const px = s.pixels();
          let opaque = 0;
          for (let i = 3; i < px.length; i += 4) if (px[i] === 255) opaque++;
          out.push({ v, m, opaque, total: px.length / 4, msaa: fx.debug.composer.multisampling });
        }
      }
      return out;
    }, REF);
    console.log(`A10 ${JSON.stringify(rows)}`);
    expect(rows.length).toBe(12);
    for (const x of rows) {
      expect(x.opaque, `${x.v} msaa ${x.m}`).toBe(x.total);
      expect(x.total).toBe(2073600);
      expect(x.msaa).toBe(x.m);
    }
  });

  test('M2 alpha control', async ({ page }) => {
    await open(page, { alpha: 0.25, crtalpha: 'keep' });
    const r = await page.evaluate((ref) => {
      const s = window.__shell!;
      s.frameAt(0, { ...ref, palette: 0 });
      const px = s.pixels();
      let opaque = 0;
      let min = 255;
      for (let i = 3; i < px.length; i += 4) {
        if (px[i] === 255) opaque++;
        if (px[i]! < min) min = px[i]!;
      }
      return { opaque, min, total: px.length / 4 };
    }, REF);
    console.log(`A10 control ${JSON.stringify(r)}`);
    expect(r.min).toBe(64);
    expect(r.opaque).toBeLessThan(r.total * 0.1);
  });

  for (const [name, query, same] of [
    ['M2 composite', { alpha: 0.25 }, true],
    ['M2 composite control', { alpha: 0.25, crtalpha: 'keep' }, false],
  ] as const) {
    test(name, async ({ page }) => {
      await open(page, query);
      // The same canvas bytes over two page colours: no frame is rendered between the shots.
      await page.evaluate((ref) => {
        document.body.style.background = '#00ff00';
        window.__shell!.frameAt(0, { ...ref, palette: 0 });
      }, REF);
      const green = await page.screenshot();
      await page.evaluate(() => { document.body.style.background = '#ff00ff'; });
      const magenta = await page.screenshot();
      console.log(`A10 ${name} identical ${green.equals(magenta)}`);
      expect(green.equals(magenta)).toBe(same);
    });
  }
});

test.describe('M3 precompile', () => {
  test.beforeEach(({}, i) => { test.skip(i.project.name !== 'gpu', NEEDS_GPU); });

  /** Variants, tier cycle and MSAA, drawing the lines wherever the tier has them. Returns links added. */
  const CYCLE = (page: Page): Promise<{ added: number; programs: [number, number] }> => page.evaluate((ref) => {
    const s = window.__shell!;
    const fx = window.__fx!;
    const o = { ...ref, palette: 0, feel: { speedLines: 1 } };
    const start = fx.links();
    const p0 = s.stats().programs;
    for (const v of ['full', 'noCa', 'min', 'bare'] as const) {
      fx.post.forceVariant(v);
      s.frameAt(0, o);
    }
    fx.post.forceVariant(null);
    for (const t of [4, 3, 2, 1, 0, 1, 2, 3] as const) {
      fx.setTier(t);
      s.frameAt(0, o);
    }
    for (const m of [0, 2, 4] as const) {
      fx.post.forceMsaa(m);
      s.frameAt(0, o);
    }
    fx.post.forceMsaa(null);
    s.frameAt(0, o);
    return { added: fx.links() - start, programs: [p0, s.stats().programs] as [number, number] };
  }, REF);

  const BOOT_LINKS = 9;   // sky, sticks, lines + blur 2, luminance 1, effect 3

  test('M3 links', async ({ page }) => {
    await open(page);
    const boot = await page.evaluate(() => window.__fx!.links());
    const r = await CYCLE(page);
    console.log(`A11 boot ${boot}, cycle ${JSON.stringify(r)}`);
    expect(boot).toBe(BOOT_LINKS);
    expect(r.added).toBe(0);
  });

  test('M3 links hidden mesh', async ({ page }) => {
    await open(page, { hidden: 1 });
    const r = await page.evaluate((ref) => {
      const fx = window.__fx!;
      const boot = fx.links();
      fx.showHidden();
      window.__shell!.frameAt(0, { ...ref, palette: 0 });
      return { boot, added: fx.links() - boot };
    }, REF);
    console.log(`A11 hidden ${JSON.stringify(r)}`);
    expect(r.boot).toBe(BOOT_LINKS + 1);
    expect(r.added).toBe(0);
  });

  test('M3 negative controls: bindtarget', async ({ page }) => {
    await open(page, { bindtarget: 0 });
    const boot = await page.evaluate(() => window.__fx!.links());
    console.log(`A12 bindtarget=0 boot ${boot}, against ${BOOT_LINKS}`);
    expect(boot).toBe(BOOT_LINKS + 3);
  });

  test('M3 negative controls: bindtarget with a hidden mesh', async ({ page }) => {
    await open(page, { bindtarget: 0, hidden: 1 });
    const r = await page.evaluate((ref) => {
      const fx = window.__fx!;
      const boot = fx.links();
      fx.showHidden();
      window.__shell!.frameAt(0, { ...ref, palette: 0 });
      return { boot, added: fx.links() - boot };
    }, REF);
    console.log(`A12 bindtarget=0 hidden ${JSON.stringify(r)}`);
    expect(r.added).toBeGreaterThanOrEqual(1);
  });

  test('M3 negative controls: rendervariants', async ({ page }) => {
    await open(page, { rendervariants: 0 });
    const r = await page.evaluate((ref) => {
      const fx = window.__fx!;
      const boot = fx.links();
      fx.post.forceVariant('bare');
      window.__shell!.frameAt(0, { ...ref, palette: 0 });
      return { boot, added: fx.links() - boot };
    }, REF);
    console.log(`A12 rendervariants=0 ${JSON.stringify(r)}`);
    expect(r.added).toBeGreaterThanOrEqual(1);
  });

  test('M3 negative controls: keepalive', async ({ page }) => {
    await open(page, { keepalive: 0 });
    const r = await CYCLE(page);
    console.log(`A12 keepalive=0 ${JSON.stringify(r)}`);
    // Six level changes in the cycle: 3 to 4, 4 to 3, 3 to 2, 2 to 1, 1 to 2, 2 to 3. 1 to 0 and 0 to 1 keep the levels.
    expect(r.added).toBeGreaterThanOrEqual(12);
    expect(r.programs[1]).toBe(r.programs[0]);
  });

  test('M3 present', async ({ page }) => {
    await open(page);
    const r = await page.evaluate(async ([ref, order]) => {
      const s = window.__shell!;
      const fx = window.__fx!;
      const o = { ...ref, palette: 0 };
      // DI-73: this same-state compare stays at tier 3's MSAA 2 only while nothing blended is drawn, and the speed
      // lines are the one blended mesh. Their visibility is recorded at each compared frame.
      const lines: boolean[] = [];
      const seen = (): void => { s.ctx.scene.traverse((m) => { if (m.renderOrder === order) lines.push(m.visible); }); };
      s.frameAt(0, o);
      await fx.post.precompile();
      // Still the task that ran the last composer.render, so the drawing buffer is intact.
      const presented = s.pixels();
      seen();
      const enabled = (['full', 'noCa', 'min', 'bare'] as const).filter((v) => fx.debug.variants[v].enabled);
      s.frameAt(0, o);
      const fresh = s.pixels();
      seen();
      return { enabled, active: fx.debug.activeVariant, msaa: fx.debug.composer.multisampling, lines, diff: fx.metrics.byteDiff(presented, fresh) };
    }, [REF, RenderOrder.SPEED_LINES] as const);
    console.log(`A13 ${JSON.stringify(r)}`);
    expect(r.enabled).toEqual([r.active]);
    expect(r.diff.bytes).toBeLessThanOrEqual(16);
    expect(r.diff.max).toBeLessThanOrEqual(1);
    expect(r.lines, 'speed lines hidden in both compared frames (DI-73)').toEqual([false, false]);
  });
});

test.describe('M4 photometric', () => {
  test.beforeEach(({}, i) => { test.skip(i.project.name !== 'gpu', NEEDS_GPU); });

  test('M4 washout', async ({ page }) => {
    await open(page);
    const r = await page.evaluate(([night, day, palettes]) => {
      const s = window.__shell!;
      const fx = window.__fx!;
      const out = [];
      for (const palette of palettes) {
        s.frameAt(0, { ...night, palette });
        const n = fx.metrics.washout(s.pixels());
        s.frameAt(0, { ...day, palette });
        const d = fx.metrics.washout(s.pixels());
        out.push({ palette, n, d });
      }
      return out;
    }, [REF, DAY, PALETTES] as const);
    for (const x of r) {
      const label = PALETTE_NAMES[x.palette]!;
      console.log(`A14 ${label} night ${x.n.nearWhitePct.toFixed(3)}%, ${x.n.meanChroma.toFixed(1)}; day ${x.d.nearWhitePct.toFixed(3)}%, ${x.d.meanChroma.toFixed(1)}`);
      for (const w of [x.n, x.d]) {
        expect(w.nearWhitePct, label).toBeLessThan(0.5);
        expect(w.meanChroma, label).toBeGreaterThan(55);
      }
    }
  });

  test('M4 images', async ({ page }, info) => {
    await open(page);
    for (const p of PALETTES) await shotOf(page, info, `M4-palette-${p}-${PALETTE_NAMES[p]}`, { ...REF, palette: p });
    await shotOf(page, info, 'M4-peak-feel', { ...REF, palette: 0, feel: { aberration: 1, bloomGain: 1.25 } });
    await shotOf(page, info, 'M4-hit', { ...REF, palette: 0, feel: { flash: 0.6, glitch: 1 } });
    await shotOf(page, info, 'M4-glitch-35', { ...REF, palette: 0, feel: { glitch: 0.35 } });
    await shotOf(page, info, 'M4-flash-60', { ...REF, palette: 0, feel: { flash: 0.6 } });
    await page.evaluate((o) => { window.__shell!.frameAt(0, o); }, { ...REF, palette: 0 });
    const crop = info.outputPath('M4-sky-crop.png');
    await page.screenshot({ path: crop, clip: { x: 200, y: 40, width: 480, height: 270 } });
    console.log(`SCREENSHOT ${crop}`);
  });

  test('M4 haze', async ({ page }) => {
    await open(page);
    const r = await page.evaluate(([ref, palettes]) => {
      const s = window.__shell!;
      const fx = window.__fx!;
      const lift = (palette: number, bloomGain: number): number => {
        s.frameAt(0, { ...ref, palette, feel: { bloomGain } });
        const on = s.pixels();
        s.frameAt(0, { ...ref, palette, feel: { bloomGain: 0 } });
        return fx.metrics.hazeLift(on, s.pixels());
      };
      return { byPalette: palettes.map((p) => lift(p, 1)), gain125: lift(0, 1.25), gain150: lift(0, 1.5) };
    }, [REF, PALETTES] as const);
    console.log(`A15 ${JSON.stringify(r)}`);
    for (const h of [...r.byPalette, r.gain125, r.gain150]) expect(h).toBeLessThanOrEqual(20);
  });

  test('M4 haze control', async ({ page }, info) => {
    await open(page, { gainmax: 9 });
    const r = await page.evaluate((ref) => {
      const s = window.__shell!;
      const fx = window.__fx!;
      fx.debug.bloom.luminanceMaterial.threshold = 0.1;
      s.frameAt(0, { ...ref, palette: 0, feel: { bloomGain: 3.75 } });
      const on = s.pixels();
      const w = fx.metrics.washout(on);
      s.frameAt(0, { ...ref, palette: 0, feel: { bloomGain: 0 } });
      const haze = fx.metrics.hazeLift(on, s.pixels());
      s.frameAt(0, { ...ref, palette: 0, feel: { bloomGain: 3.75 } });
      return { haze, w };
    }, REF);
    console.log(`A15 control ${JSON.stringify(r)}`);
    expect(r.haze).toBeGreaterThan(25);
    expect(r.w.nearWhitePct).toBeLessThan(0.5);
    expect(r.w.meanChroma).toBeGreaterThan(55);
    await saveShot(page, info, 'M4-flood-control');
  });

  test('M4 near-white control', async ({ page }) => {
    await open(page, { over: 5 });
    const w = await page.evaluate((ref) => {
      const s = window.__shell!;
      s.frameAt(0, { ...ref, palette: 0 });
      return window.__fx!.metrics.washout(s.pixels());
    }, REF);
    console.log(`A16 ${JSON.stringify(w)}`);
    expect(w.nearWhitePct).toBeGreaterThan(0.5);
  });

  test('M4 flash', async ({ page }) => {
    await open(page);
    const r = await page.evaluate(([night, day, palettes]) => {
      const s = window.__shell!;
      const fx = window.__fx!;
      const at = (o: typeof night | typeof day, palette: number) => {
        s.frameAt(0, { ...o, palette, feel: { flash: 0 } });
        const base = s.pixels();
        s.frameAt(0, { ...o, palette, feel: { flash: 0.6 } });
        const px = s.pixels();
        const dark = fx.metrics.darkSaturation(px, base, 64);
        return { ...fx.metrics.washout(px), litSat: fx.metrics.litSaturation(px, 32), litSat0: fx.metrics.litSaturation(base, 32), darkSat: dark.saturation, darkN: dark.pixels };
      };
      return palettes.map((p) => ({ p, night: at(night, p), day: at(day, p) }));
    }, [REF, DAY, PALETTES] as const);
    for (const x of r) {
      console.log(`A17 ${PALETTE_NAMES[x.p]} flash .6 night ${x.night.nearWhitePct.toFixed(3)}%, ${x.night.meanChroma.toFixed(1)}; day ${x.day.nearWhitePct.toFixed(3)}%, ${x.day.meanChroma.toFixed(1)}`);
      console.log(`A17 ${PALETTE_NAMES[x.p]} dark-surface saturation night ${x.night.darkSat.toFixed(3)} over ${x.night.darkN} px, day ${x.day.darkSat.toFixed(3)}; lit saturation night ${x.night.litSat.toFixed(3)} from ${x.night.litSat0.toFixed(3)}, day ${x.day.litSat.toFixed(3)} from ${x.day.litSat0.toFixed(3)}`);
    }
    const sunset = r[0]!;
    for (const w of [sunset.night, sunset.day]) {
      expect(w.meanChroma).toBeGreaterThan(55);
      expect(w.nearWhitePct).toBeLessThan(0.5);
      // Surfaces that were dark (max channel under 64) must keep their colour as the flash lights them. Measured
      // .696 night and .690 day; the additive flash this replaced, which greyed them, reads .560 and .552.
      expect(w.darkSat).toBeGreaterThanOrEqual(0.62);
    }
  });

  test('M4 chroma control', async ({ page }) => {
    await open(page, { flashwhite: 1 });
    const w = await page.evaluate((ref) => {
      const s = window.__shell!;
      s.frameAt(0, { ...ref, palette: 0, feel: { flash: 0.6 } });
      return window.__fx!.metrics.washout(s.pixels());
    }, REF);
    console.log(`A17 control ${JSON.stringify(w)}`);
    expect(w.meanChroma).toBeLessThan(55);
  });

  for (const [name, query, control] of [
    ['M4 hue', { card: 'hue' }, false],
    ['M4 hue control', { card: 'hue', equal: 1 }, true],
  ] as const) {
    test(name, async ({ page }) => {
      await open(page, query);
      const r = await page.evaluate((ref) => {
        const s = window.__shell!;
        const fx = window.__fx!;
        fx.post.forceVariant('min');
        fx.post.forceMsaa(0);
        s.frameAt(0, { ...ref, palette: 0 });
        const px = s.pixels();
        const lin = (v: number): number => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
        const luma = (x: number): number => {
          let sum = 0;
          // A 9-row mean around y 540, on both sides of the bar's centre, so the sum is symmetric under the vignette.
          for (let y = 536; y < 545; y++) {
            for (const xx of [x, x + 1]) {
              const i = (y * 1920 + xx) * 4;
              sum += 0.2126 * lin(px[i]!) + 0.7152 * lin(px[i + 1]!) + 0.0722 * lin(px[i + 2]!);
            }
          }
          return sum / 18;
        };
        return [60, 100, 160].map((d) => {
          const magenta = (luma(480 - d) + luma(480 + d)) / 2;
          const cyan = (luma(1440 - d) + luma(1440 + d)) / 2;
          return { d, magenta, cyan, ratio: magenta / cyan };
        });
      }, REF);
      console.log(`A18 ${name} ${JSON.stringify(r)}`);
      for (const x of r) {
        expect(x.cyan).toBeGreaterThan(0);
        if (control) expect(x.magenta).toBeLessThan(x.cyan * 0.01);
        else {
          expect(x.ratio).toBeGreaterThanOrEqual(0.8);
          expect(x.ratio).toBeLessThanOrEqual(1.25);
        }
      }
    });
  }

  test('M4 no-bloom sources', async ({ page }) => {
    await open(page, { card: 'surfaces' });
    const r = await page.evaluate(([ref, palettes]) => {
      const s = window.__shell!;
      const fx = window.__fx!;
      return palettes.map((palette) => {
        s.frameAt(0, { ...ref, palette, feel: { bloomGain: 1 } });
        const on = s.pixels();
        s.frameAt(0, { ...ref, palette, feel: { bloomGain: 0 } });
        return { palette, diff: fx.metrics.byteDiff(on, s.pixels()) };
      });
    }, [REF, PALETTES] as const);
    console.log(`A19 ${JSON.stringify(r)}`);
    for (const x of r) expect(x.diff.max, PALETTE_NAMES[x.palette]).toBeLessThanOrEqual(1);
  });

  test('M4 no-bloom control', async ({ page }) => {
    await open(page, { card: 'surfaces', over: 1.6 });
    const d = await page.evaluate((ref) => {
      const s = window.__shell!;
      s.frameAt(0, { ...ref, palette: 5, feel: { bloomGain: 1 } });
      const on = s.pixels();
      s.frameAt(0, { ...ref, palette: 5, feel: { bloomGain: 0 } });
      return window.__fx!.metrics.byteDiff(on, s.pixels());
    }, REF);
    console.log(`A19 control ${JSON.stringify(d)}`);
    expect(d.max).toBeGreaterThan(3);
  });

  for (const [name, query, control] of [
    ['M4 dither', { card: 'surfaces' }, false],
    ['M4 dither control', { card: 'surfaces', dither: 0 }, true],
  ] as const) {
    test(name, async ({ page }) => {
      await open(page, query);
      const step = await page.evaluate((ref) => {
        const s = window.__shell!;
        const fx = window.__fx!;
        fx.post.forceVariant('bare');
        fx.post.forceMsaa(0);
        s.frameAt(0, { ...ref, palette: 2 });
        // Rows 0 to 240 from the top of the image; pixels() is bottom-up.
        return fx.metrics.maxRowStep(s.pixels(), 1920, { x0: 928, x1: 992, y0: 840, y1: 1080 });
      }, REF);
      console.log(`A19b ${name} ${step}`);
      if (control) expect(step).toBeGreaterThanOrEqual(1);
      else expect(step).toBeLessThanOrEqual(0.75);
    });
  }

  test('M4 grain', async ({ page }) => {
    const rect = { x0: 560, x1: 1360, y0: 340, y1: 740 };
    // One scan phase: every third row, as gl rows, per the plan.
    const third = { ...rect, y0: 342 };
    const stdOf = async (v: number, reducedMotion: boolean): Promise<{ std: number; mean: number; max: number }> => {
      await open(page, { card: 'flat', v });
      return page.evaluate(([ref, rd, r]) => {
        const s = window.__shell!;
        const fx = window.__fx!;
        fx.post.forceVariant('noCa');
        s.frameAt(0, { ...ref, palette: 0, reducedMotion: rd });
        const px = s.pixels();
        let sum = 0;
        let max = 0;
        let n = 0;
        for (let y = r.y0; y < r.y1; y += 3) {
          for (let x = r.x0; x < r.x1; x++) {
            const g = px[(y * 1920 + x) * 4 + 1]!;
            sum += g;
            n++;
            if (g > max) max = g;
          }
        }
        return { std: fx.metrics.channelStd(px, 1920, r, 1, 3), mean: sum / n, max };
      }, [REF, reducedMotion, third] as const);
    };
    const black = await stdOf(0, false);
    const mid = await stdOf(0.2, false);
    const dark = await stdOf(0.02, false);
    const rmMid = await stdOf(0.2, true);
    const rmDark = await stdOf(0.02, true);
    console.log(`A19c v0 ${JSON.stringify(black)} v.2 ${JSON.stringify(mid)} v.02 ${JSON.stringify(dark)} reduced .2 ${JSON.stringify(rmMid)} reduced .02 ${JSON.stringify(rmDark)}`);
    expect(black.mean).toBeLessThanOrEqual(2);
    expect(black.max).toBeLessThanOrEqual(8);
    expect(mid.std).toBeGreaterThanOrEqual(0.8);
    expect(mid.std).toBeLessThanOrEqual(2.5);
    expect(dark.std).toBeLessThanOrEqual(5);
    expect(rmMid.std).toBeLessThanOrEqual(0.6);
    expect(rmDark.std).toBeLessThanOrEqual(0.6);

    await open(page, { card: 'flat', v: 0.2 });
    const same = await page.evaluate(([ref, order]) => {
      const s = window.__shell!;
      const fx = window.__fx!;
      // DI-73: the tick pair compares bytes at tier 3's MSAA 2, which holds only while the speed lines, the one
      // blended mesh, are hidden. Their visibility is recorded at each frame.
      const lines: boolean[] = [];
      const seen = (): void => { s.ctx.scene.traverse((m) => { if (m.renderOrder === order) lines.push(m.visible); }); };
      fx.post.forceVariant('noCa');
      s.frameAt(0, { ...ref, tick: 0, palette: 0 });
      const a = s.pixels();
      seen();
      s.frameAt(0, { ...ref, tick: 1, palette: 0 });
      const b = s.pixels();
      seen();
      s.frameAt(0, { ...ref, tick: 5, palette: 0 });
      const c = s.pixels();
      seen();
      return { msaa: fx.debug.composer.multisampling, lines, sameFrame: fx.metrics.byteDiff(a, b), nextFrame: fx.metrics.byteDiff(a, c) };
    }, [REF, RenderOrder.SPEED_LINES] as const);
    console.log(`A19c ticks ${JSON.stringify(same)}`);
    expect(same.sameFrame.bytes).toBeLessThanOrEqual(16);
    expect(same.nextFrame.bytes).toBeGreaterThan(1e6);
    expect(same.lines, 'speed lines hidden in all three frames (DI-73)').toEqual([false, false, false]);
  });

  test('M4 exposure', async ({ page }) => {
    await open(page, { card: 'flat', v: 0.2 });
    const r = await page.evaluate(() => {
      const s = window.__shell!;
      const fx = window.__fx!;
      const opts = { tick: 0, palette: 0, bend: { a: 0, c: 0 }, reducedMotion: true };
      const links = fx.links();
      const centre = (chunk: number): number => {
        s.frameAt(0, { ...opts, at: { chunk, local: 12.5 } });
        const px = s.pixels();
        let sum = 0;
        for (let y = 500; y < 580; y++) for (let x = 900; x < 1020; x++) sum += px[(y * 1920 + x) * 4 + 1]!;
        return sum / (80 * 120);
      };
      const night = centre(0);
      const day = centre(375);
      return { night, day, added: fx.links() - links };
    });
    console.log(`A19d ${JSON.stringify(r)}`);
    expect(r.day - r.night).toBeGreaterThanOrEqual(5);
    expect(r.day - r.night).toBeLessThanOrEqual(15);
    expect(r.added).toBe(0);
  });

  test('M4 glitch', async ({ page }) => {
    await open(page);
    const r = await page.evaluate(([ref, palettes]) => {
      const s = window.__shell!;
      const fx = window.__fx!;
      const out = [];
      for (const palette of palettes) {
        s.frameAt(0, { ...ref, palette, feel: { glitch: 0 } });
        const clean = fx.metrics.washout(s.pixels());
        for (const glitch of [1, 0.35]) {
          s.frameAt(0, { ...ref, palette, feel: { glitch } });
          const px = s.pixels();
          let opaque = 0;
          for (let i = 3; i < px.length; i += 4) if (px[i] === 255) opaque++;
          out.push({ palette, glitch, clean, w: fx.metrics.washout(px), opaque, total: px.length / 4, active: fx.debug.activeVariant });
        }
      }
      return out;
    }, [REF, PALETTES] as const);
    for (const x of r) {
      const dc = x.w.meanChroma - x.clean.meanChroma;
      console.log(`A19e ${PALETTE_NAMES[x.palette]} glitch ${x.glitch}: ${x.w.nearWhitePct.toFixed(3)}%, ${x.w.meanChroma.toFixed(2)} against ${x.clean.meanChroma.toFixed(2)} unglitched (${dc >= 0 ? '+' : ''}${dc.toFixed(2)}), alpha ${x.opaque}/${x.total}, ${x.active}`);
      expect(x.opaque).toBe(x.total);
      expect(x.active).toBe('full');
      // A permutation cannot move chroma on any palette. A mix read 73.1 on Sunset at .35 and grey bands 61.1 at 1.
      expect(Math.abs(dc), `${PALETTE_NAMES[x.palette]} glitch ${x.glitch}`).toBeLessThanOrEqual(1);
      if (x.palette === 0) {
        expect(x.w.nearWhitePct).toBeLessThan(0.5);
        expect(x.w.meanChroma).toBeGreaterThan(55);
      }
    }
  });

  // A swapped band is a channel permutation, so chroma cannot move while the bands themselves must. A dead glitch
  // fails the band count; a mix toward grey, or grey bands, fails the chroma check above (V1 verifier's conditions).
  test('M4 glitch liveness', async ({ page }) => {
    await open(page);
    const r = await page.evaluate((ref) => {
      const s = window.__shell!;
      const fx = window.__fx!;
      const tally: Record<string, { swapped: number; partial: number; rows: number }> = {};
      // Ticks 0, 5, .. 35 are grain frames 0 to 7, so eight independent draws of the 90 bands of 12 rows.
      for (let k = 0; k < 8; k++) {
        const tick = 5 * k;
        s.frameAt(0, { ...ref, tick, palette: 0, feel: { glitch: 0 } });
        const clean = s.pixels();
        for (const glitch of [0.35, 1]) {
          s.frameAt(0, { ...ref, tick, palette: 0, feel: { glitch } });
          const c = fx.metrics.rowChanges(clean, s.pixels(), 1920, 1);
          const t = (tally[String(glitch)] ??= { swapped: 0, partial: 0, rows: 0 });
          t.swapped += c.swapped;
          t.partial += c.partial;
          t.rows += c.rows;
        }
      }
      return tally;
    }, REF);
    const low = r['0.35']!;
    const high = r['1']!;
    console.log(`A19e liveness glitch .35 ${JSON.stringify(low)} (${(low.swapped / low.rows).toFixed(3)}); glitch 1 ${JSON.stringify(high)} (${(high.swapped / high.rows).toFixed(3)})`);
    // The Crt swaps a band when its hash is above 1 - .28 * glitch: .098 of 720 bands at .35, .28 at 1. Each range is
    // about 3.5 binomial standard deviations wide on either side.
    expect(low.swapped / low.rows).toBeGreaterThanOrEqual(0.06);
    expect(low.swapped / low.rows).toBeLessThanOrEqual(0.14);
    expect(high.swapped / high.rows).toBeGreaterThanOrEqual(0.22);
    expect(high.swapped / high.rows).toBeLessThanOrEqual(0.34);
  });

  test('M4 glitch images', async ({ page }, info) => {
    await open(page);
    for (const p of PALETTES) {
      await shotOf(page, info, `M4-glitch-35-${PALETTE_NAMES[p]}`, { ...REF, palette: p, feel: { glitch: 0.35 } });
    }
  });
});

test.describe('M5 speed lines', () => {
  test.beforeEach(({}, i) => { test.skip(i.project.name !== 'gpu', NEEDS_GPU); });

  test('M5 presence', async ({ page }) => {
    await open(page);
    const r = await page.evaluate((ref) => {
      const s = window.__shell!;
      const fx = window.__fx!;
      const changedPixels = (a: Uint8Array, b: Uint8Array): number => {
        let n = 0;
        for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++;
        return n;
      };
      const at = (speedLines: number): { calls: number; px: Uint8Array } => {
        s.frameAt(0, { ...ref, palette: 0, feel: { speedLines } });
        return { calls: s.stats().calls, px: s.pixels() };
      };
      fx.setTier(3);
      const off = at(0);
      const one = at(1);
      const eighth = at(0.125);
      const tiers = [];
      for (const t of [4, 3, 2, 1, 0] as const) {
        fx.setTier(t);
        s.frameAt(0, { ...ref, palette: 0, feel: { speedLines: 1 } });
        const scene = s.ctx.scene;
        let lines = null;
        for (const m of scene.children) {
          const g = (m as unknown as { geometry?: { instanceCount?: number; attributes?: Record<string, unknown> } }).geometry;
          if (g?.attributes?.['aSeed']) lines = { instanceCount: g.instanceCount, visible: m.visible };
        }
        tiers.push({ t, lines });
      }
      return {
        calls: [off.calls, one.calls], changedOne: changedPixels(off.px, one.px), changedEighth: changedPixels(off.px, eighth.px), tiers,
      };
    }, REF);
    console.log(`A20 ${JSON.stringify(r)}`);
    expect(r.calls[1]! - r.calls[0]!).toBe(1);
    expect(r.changedOne).toBeGreaterThan(500);
    const ratio = r.changedEighth / r.changedOne;
    expect(ratio).toBeGreaterThan(1 / 8 / 3);
    expect(ratio).toBeLessThan((1 / 8) * 3);
    expect(r.tiers.map((x) => x.lines?.instanceCount)).toEqual([96, 64, 32, 0, 0]);
    expect(r.tiers.map((x) => x.lines?.visible)).toEqual([true, true, true, false, false]);
  });

  test('M5 setVisible holds through frames', async ({ page }) => {
    await open(page);
    const r = await page.evaluate((ref) => {
      const s = window.__shell!;
      const fx = window.__fx!;
      const o = { ...ref, palette: 0, feel: { speedLines: 1 } };
      const calls = (): number => {
        s.frameAt(0, o);
        return s.stats().calls;
      };
      const shown = calls();
      fx.fx.setVisible(false);
      const hidden = calls();
      const stillHidden = calls();
      fx.fx.setVisible(true);
      const back = calls();
      return { shown, hidden, stillHidden, back };
    }, REF);
    console.log(`A20 setVisible ${JSON.stringify(r)}`);
    expect(r.hidden).toBe(r.shown - 1);
    expect(r.stillHidden).toBe(r.shown - 1);
    expect(r.back).toBe(r.shown);
  });

  test('M5 wash', async ({ page }) => {
    await open(page, { tier: 4 });
    const r = await page.evaluate((ref) => {
      const s = window.__shell!;
      const fx = window.__fx!;
      s.frameAt(0, { ...ref, palette: 0, feel: { speedLines: 1 } });
      const on = s.pixels();
      const w = fx.metrics.washout(on);
      s.frameAt(0, { ...ref, palette: 0, feel: { speedLines: 1, bloomGain: 0 } });
      return { w, haze: fx.metrics.hazeLift(on, s.pixels()), size: [s.stats().width, s.stats().height] };
    }, REF);
    console.log(`A21 ${JSON.stringify(r)}`);
    expect(r.w.nearWhitePct).toBeLessThan(0.5);
    expect(r.w.meanChroma).toBeGreaterThan(55);
    expect(r.haze).toBeLessThanOrEqual(20);
  });

  test('M5 depth', async ({ page }) => {
    await open(page, { wall: 1 });
    const r = await page.evaluate((ref) => {
      const s = window.__shell!;
      window.__fx!.post.forceVariant('bare');
      s.frameAt(0, { ...ref, palette: 0, feel: { speedLines: 0 } });
      const a = s.pixels();
      s.frameAt(0, { ...ref, palette: 0, feel: { speedLines: 1 } });
      const b = s.pixels();
      let inside = 0;
      let outside = 0;
      for (let y = 0; y < 1080; y++) {
        for (let x = 0; x < 1920; x++) {
          const i = (y * 1920 + x) * 4;
          if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2]) continue;
          if (x < 920) inside++;
          else if (x >= 1000) outside++;
        }
      }
      return { inside, outside };
    }, REF);
    console.log(`A22 wall ${JSON.stringify(r)}`);
    expect(r.inside).toBe(0);
    expect(r.outside).toBeGreaterThan(200);
  });

  test('M5 sun', async ({ page }) => {
    // The disc's centre and radius from the contract itself, so this test follows any change to them.
    const hero = readFileSync('src/contracts/glsl/hero.glsl', 'utf8');
    const c = /HERO_C\s*=\s*vec2\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/.exec(hero);
    const rad = /HERO_R\s*=\s*([\d.]+)/.exec(hero);
    expect(c, 'HERO_C in hero.glsl').not.toBeNull();
    expect(rad, 'HERO_R in hero.glsl').not.toBeNull();
    const disc0 = { cx: Number(c![1]), cy: Number(c![2]), r: Number(rad![1]) };
    await open(page);
    const r = await page.evaluate(([ref, d0]) => {
      const s = window.__shell!;
      window.__fx!.post.forceVariant('bare');
      s.frameAt(0, { ...ref, palette: 0, feel: { speedLines: 0 } });
      const a = s.pixels();
      s.frameAt(0, { ...ref, palette: 0, feel: { speedLines: 1 } });
      const b = s.pixels();
      // Each pixel's distance from the disc centre in disc radii, in the metric both the disc and the lines' fade use:
      // g = rd.xy / -rd.z, k = |g - HERO_C| / HERO_R. The disc is opaque at k < 1, and lines are exactly 0 below 1.15.
      const m = s.ctx.camera.matrixWorld.elements;
      const p = s.ctx.camera.projectionMatrix.elements;
      const kAt = (x: number, y: number): number => {
        const vx = ((x + 0.5) / 1920 * 2 - 1) / p[0]!;
        const vy = ((y + 0.5) / 1080 * 2 - 1) / p[5]!;
        const dx = vx * m[0]! + vy * m[4]! - m[8]!;
        const dy = vx * m[1]! + vy * m[5]! - m[9]!;
        const dz = vx * m[2]! + vy * m[6]! - m[10]!;
        const gz = Math.max(-dz, 1e-3);
        return Math.hypot(dx / gz - d0.cx, dy / gz - d0.cy) / d0.r;
      };
      let disc = 0;
      let changed = 0;
      let over1 = 0;
      let rim = 0;
      let rimChanged = 0;
      for (let y = 0; y < 1080; y++) {
        for (let x = 0; x < 1920; x++) {
          const i = (y * 1920 + x) * 4;
          const d = Math.max(Math.abs(a[i]! - b[i]!), Math.abs(a[i + 1]! - b[i + 1]!), Math.abs(a[i + 2]! - b[i + 2]!));
          const k = kAt(x, y);
          if (k <= 1) {
            disc++;
            if (d > 0) changed++;
            if (d > 1) over1++;
          } else if (k < 1.15) {
            rim++;
            if (d > 0) rimChanged++;
          }
        }
      }
      return { disc, changed, over1, rim, rimChanged };
    }, [REF, disc0] as const);
    console.log(`A22 sun ${JSON.stringify({ hero: disc0, ...r })}`);
    // The whole disc, to its full radius. Measured 0 changed; 16 at one level is the plan's same-frame allowance.
    expect(r.disc).toBeGreaterThan(100000);
    expect(r.over1).toBe(0);
    expect(r.changed).toBeLessThanOrEqual(16);
  });

  const FLAT = { card: 'flat', v: 0.02 };

  // The far pair is a same-state compare, so it runs at MSAA 0 (DI-67, DI-70): through D3D11, blended draws such as
  // the additive lines resolve differently between identical renders at MSAA 2 or 4. The wrap and step pairs compare
  // different states, so they keep the tier's MSAA.
  async function wrapPair(page: Page): Promise<{ wrap: number; step: number; far: { bytes: number; max: number; sum: number }; farMsaa: number[] }> {
    return page.evaluate(() => {
      const s = window.__shell!;
      const fx = window.__fx!;
      const count = (a: Uint8Array, b: Uint8Array): number => {
        let n = 0;
        for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++;
        return n;
      };
      const base = { tick: 0, palette: 0, bend: { a: 0, c: 0 }, zone: { dayPhase: 0 }, feel: { speedLines: 1 } };
      const f = (chunk: number, local: number): Uint8Array => {
        s.frameAt(0, { ...base, at: { chunk, local } });
        return s.pixels();
      };
      const farMsaa: number[] = [];
      const farFrame = (chunk: number, local: number): Uint8Array => {
        const px = f(chunk, local);
        farMsaa.push(fx.debug.composer.multisampling);
        return px;
      };
      fx.post.forceMsaa(0);
      const far = fx.metrics.byteDiff(farFrame(2 ** 40, 12.5), farFrame(0, 12.5));
      fx.post.forceMsaa(null);
      const wrap = count(f(63, 63.9), f(64, 0.2));
      const step = count(f(10, 10), f(10, 10.3));
      return { wrap, step, far, farMsaa };
    });
  }

  test('M5 continuity', async ({ page }, info) => {
    await open(page, FLAT);
    const r = await wrapPair(page);
    console.log(`A23 ${JSON.stringify(r)}`);
    expect(r.farMsaa, 'far pair MSAA').toEqual([0, 0]);
    expect(r.far.bytes).toBeLessThanOrEqual(16);
    expect(r.far.max).toBeLessThanOrEqual(1);
    expect(r.step).toBeGreaterThan(0);
    expect(r.wrap).toBeLessThanOrEqual(r.step * 2);
    expect(r.wrap).toBeGreaterThanOrEqual(r.step / 2);

    // Six consecutive frames at 150 u/s, in a 3 by 2 strip. Line light on a near-black card, so direction is plain.
    const strip = await page.evaluate(() => {
      const s = window.__shell!;
      const canvas = document.createElement('canvas');
      canvas.width = 1920;
      canvas.height = 720;
      const c = canvas.getContext('2d')!;
      for (let i = 0; i < 6; i++) {
        s.frameAt(0, { tick: i, palette: 0, bend: { a: 0, c: 0 }, zone: { dayPhase: 0 }, sim: { speed: 150 }, feel: { speedLines: 1 }, at: { chunk: 10, local: 2.5 * i } });
        c.drawImage(document.querySelector('canvas')!, (i % 3) * 640, Math.floor(i / 3) * 360, 640, 360);
      }
      return canvas.toDataURL('image/png');
    });
    saveDataUrl(info, 'M5-strip-flat', strip);
  });

  test('M5 continuity control', async ({ page }) => {
    await open(page, { ...FLAT, lineperiod: 250 });
    const r = await wrapPair(page);
    console.log(`A23 control ${JSON.stringify(r)}`);
    expect(r.wrap).toBeGreaterThan(r.step * 2);
  });

  // Lines must approach as travel rises: each line's light moves away from the vanishing point. Over all lines the
  // light-weighted radius is no test, since each line fades as a whole near its wrap, which reweights the lines; at
  // 10 to 10.3 it fell in every ring tried. One line alone, with a fade that is uniform along it, moves by geometry only.
  test('M5 direction', async ({ page }) => {
    await open(page, FLAT);
    const r = await page.evaluate(() => {
      const s = window.__shell!;
      const fx = window.__fx!;
      fx.post.forceVariant('bare');                            // no bloom, so only line pixels change
      const base = { tick: 0, palette: 0, bend: { a: 0, c: 0 }, zone: { dayPhase: 0 } };
      // The first n instances. Lines blend additively, so frame n + 1 over frame n is line n alone.
      const at = (travel: number, n: number): Uint8Array => {
        fx.fx.setQuality({ ...fx.TIERS[3]!, speedLines: n });
        s.frameAt(0, { ...base, at: { chunk: Math.floor(travel / 64), local: travel % 64 }, feel: { speedLines: 1 } });
        return s.pixels();
      };
      at(640, 0);
      // The vanishing point of world -z, which every line runs along, in readPixels coordinates.
      const m = s.ctx.camera.matrixWorld.elements;
      const p = s.ctx.camera.projectionMatrix.elements;
      // View coordinates of world (0, 0, -1): its dot product with each camera axis, the columns of matrixWorld.
      const vx = -m[2]!;
      const vy = -m[6]!;
      const vz = -m[10]!;
      const cx = ((p[0]! * vx + p[8]! * vz) / -vz + 1) / 2 * 1920;
      const cy = ((p[5]! * vy + p[9]! * vz) / -vz + 1) / 2 * 1080;
      // Lines 0 to 5, each at 8 positions 32 u apart over one line period of 256 u, stepping 0.3.
      const LINES = 6;
      const radii = (travel: number): { radius: number; light: number }[] => {
        const out = [];
        let prev = at(travel, 0);
        for (let n = 1; n <= LINES; n++) {
          const next = at(travel, n);
          out.push(fx.metrics.lightRadius(next, prev, 1920, cx, cy, 0, 1e9));
          prev = next;
        }
        return out;
      };
      const pairs = [];
      for (let j = 0; j < 8; j++) {
        const t0 = 650 + 32 * j;
        const a = radii(t0);
        const b = radii(t0 + 0.3);
        for (let line = 0; line < LINES; line++) {
          pairs.push({ line, t0, r0: a[line]!.radius, r1: b[line]!.radius, light0: a[line]!.light, light1: b[line]!.light });
        }
      }
      return { cx, cy, pairs };
    });
    console.log(`A23d vp ${r.cx.toFixed(1)}, ${r.cy.toFixed(1)}`);
    for (const x of r.pairs) {
      if (x.light0 === 0 && x.light1 === 0) continue;
      console.log(`A23d line ${x.line} ${x.t0} to ${x.t0 + 0.3}: radius ${x.r0.toFixed(2)} to ${x.r1.toFixed(2)} (${x.r1 - x.r0 >= 0 ? '+' : ''}${(x.r1 - x.r0).toFixed(3)}), light ${x.light0} to ${x.light1}`);
    }
    // A line counts where it adds at least 1000 code values in both frames; fainter ones are slivers at the sun fade.
    const seen = r.pairs.filter((x) => x.light0 >= 1000 && x.light1 >= 1000);
    const grew = seen.filter((x) => x.r1 > x.r0);
    console.log(`A23d ${grew.length} of ${seen.length} visible pairs moved outward`);
    expect(seen.length).toBeGreaterThanOrEqual(15);
    expect(grew.length).toBe(seen.length);
  });

  test('M5 images', async ({ page }, info) => {
    await open(page);
    for (const t of [4, 3, 2] as const) {
      await page.evaluate((tier) => { window.__fx!.setTier(tier); }, t);
      for (const k of [0.125, 0.5, 1]) {
        await shotOf(page, info, `M5-tier${t}-lines-${k}`, { ...REF, palette: 0, sim: { speed: 150 }, feel: { speedLines: k } });
      }
    }
    const strip = await page.evaluate((ref) => {
      const s = window.__shell!;
      window.__fx!.setTier(3);
      const canvas = document.createElement('canvas');
      canvas.width = 1920;
      canvas.height = 720;
      const c = canvas.getContext('2d')!;
      for (let i = 0; i < 6; i++) {
        s.frameAt(0, { ...ref, at: { chunk: 10, local: 2.5 * i }, tick: i, palette: 0, sim: { speed: 150 }, feel: { speedLines: 1 } });
        c.drawImage(document.querySelector('canvas')!, (i % 3) * 640, Math.floor(i / 3) * 360, 640, 360);
      }
      return canvas.toDataURL('image/png');
    }, REF);
    saveDataUrl(info, 'M5-strip-scene', strip);
  });
});

const DPR_CASES: readonly (readonly [number, Tier])[] = [[1, 3], [1, 2], [1.25, 3], [1.25, 2], [1.5, 4], [1.5, 3], [1.5, 2], [2, 4], [2, 3], [2, 2]];

test.describe('M6 tiers', () => {
  test.beforeEach(({}, i) => { test.skip(i.project.name !== 'gpu', NEEDS_GPU); });

  for (const dpr of [1, 1.25, 1.5, 2] as const) {
    test.describe(`DPR ${dpr}`, () => {
      test.use({ deviceScaleFactor: dpr, viewport: { width: 1920, height: 1080 } });

      for (const [d, tier] of DPR_CASES.filter(([x]) => x === dpr)) {
        test(`M6 DPR scan ${d} tier ${tier}`, async ({ page }) => {
          await open(page, { card: 'flat', v: 0.2, tier });
          await page.evaluate((ref) => { window.__shell!.frameAt(0, { ...ref, palette: 0, reducedMotion: true }); }, REF);
          const size = await page.evaluate(() => {
            const s = window.__shell!.stats();
            return { w: s.width, h: s.height, ratio: window.__fx!.debug.pixelRatio, dpr: window.devicePixelRatio };
          });
          const r = pixelRatioFor(TIERS[tier]!, 1920, 1080, d);
          expect(size.ratio).toBeCloseTo(r, 9);
          expect(size.w).toBe(Math.floor(1920 * r));
          expect(size.dpr).toBe(d);
          // A central strip, wide enough in CSS px for 64 by 512 device px at every DPR.
          const png = await page.screenshot({ clip: { x: 900, y: 240, width: 120, height: 600 } });
          const rows = await page.evaluate(async (b64) => {
            const fx = window.__fx!;
            const im = await fx.decodePng(b64);
            const cx = im.width >> 1;
            const cy = im.height >> 1;
            return Array.from(fx.metrics.rowMeans(im.data, im.width, { x0: cx - 32, x1: cx + 32, y0: cy - 256, y1: cy + 256 }, 1));
          }, png.toString('base64'));
          const sp = spectrum(rows);
          const want = (scanPeriodFor(r) * d) / r;
          console.log(`A24 dpr ${d} tier ${tier}: ratio ${r.toFixed(4)}, buffer ${size.w}x${size.h}, period want ${want.toFixed(3)} got ${sp.period.toFixed(3)}, amp ${sp.amp.toFixed(3)}, low ${sp.low.toFixed(3)}`);
          expect(Math.abs(sp.period - want) / want).toBeLessThanOrEqual(0.03);
          expect(sp.low).toBeLessThanOrEqual(0.5);
        });
      }

      if (dpr !== 1.25) {
        for (const query of [{}, { scanperiod: 3 }] as const) {
          for (const tier of [3, 4] as const) {
            const tag = 'scanperiod' in query ? 'fixed3' : 'rule';
            test(`M6 DPR look ${dpr} tier ${tier} ${tag}`, async ({ page }, info) => {
              await open(page, { ...query, tier });
              await page.evaluate((ref) => { window.__shell!.frameAt(0, { ...ref, palette: 0 }); }, REF);
              const ratio = await page.evaluate(() => window.__fx!.debug.pixelRatio);
              const path = info.outputPath(`M6-dpr${dpr}-tier${tier}-${tag}.png`);
              // 1:1 device pixels. A 480 by 270 CSS crop at DPR 2 is 960 by 540, under the review size limit.
              await page.screenshot({ path, clip: { x: 720, y: 380, width: 480, height: 270 } });
              console.log(`SCREENSHOT ${path}`);
              console.log(`A25 dpr ${dpr} tier ${tier} ${tag}: buffer ratio ${ratio.toFixed(4)}, period ${tag === 'rule' ? scanPeriodFor(ratio) : 3}`);
            });
          }
        }
      }

      if (dpr === 1) {
        test('M6 DPR scan control', async ({ page }) => {
          await open(page, { card: 'flat', v: 0.2, scanperiod: 2.2 });
          await page.evaluate((ref) => { window.__shell!.frameAt(0, { ...ref, palette: 0, reducedMotion: true }); }, REF);
          const png = await page.screenshot({ clip: { x: 900, y: 240, width: 120, height: 600 } });
          const rows = await page.evaluate(async (b64) => {
            const fx = window.__fx!;
            const im = await fx.decodePng(b64);
            const cx = im.width >> 1;
            const cy = im.height >> 1;
            return Array.from(fx.metrics.rowMeans(im.data, im.width, { x0: cx - 32, x1: cx + 32, y0: cy - 256, y1: cy + 256 }, 1));
          }, png.toString('base64'));
          const sp = spectrum(rows);
          console.log(`A24 control ${JSON.stringify(sp)}`);
          expect(sp.low).toBeGreaterThan(0.5);
        });
      }
    });
  }

  test('M6 tier switch', async ({ page }) => {
    await open(page);
    const r = await page.evaluate((ref) => {
      const s = window.__shell!;
      const fx = window.__fx!;
      const o = { ...ref, palette: 0 };
      const out = [];
      for (const [a, b] of [[4, 3], [3, 2], [2, 1], [1, 0], [0, 1], [1, 2], [2, 3], [3, 4]] as const) {
        fx.setTier(a);
        s.frameAt(0, o);
        const A = fx.compositeTo(960, 540);
        const links = fx.links();
        const t0 = performance.now();
        fx.setTier(b);
        s.frameAt(0, o);
        const ms = performance.now() - t0;
        const px = s.pixels();
        const B = fx.compositeTo(960, 540);
        let opaque = 0;
        for (let i = 3; i < px.length; i += 4) if (px[i] === 255) opaque++;
        let sum = 0;
        for (let i = 0; i < A.length; i += 4) sum += Math.abs(A[i]! - B[i]!) + Math.abs(A[i + 1]! - B[i + 1]!) + Math.abs(A[i + 2]! - B[i + 2]!);
        out.push({
          a, b, mad: sum / ((A.length / 4) * 3), ms, added: fx.links() - links,
          opaque, total: px.length / 4, w: s.stats().width, h: s.stats().height, active: fx.debug.activeVariant,
        });
      }
      return out;
    }, REF);
    for (const x of r) {
      console.log(`A26 ${x.a} to ${x.b}: mean abs diff ${x.mad.toFixed(2)}, ${x.ms.toFixed(1)} ms, ${x.w}x${x.h}, ${x.active}, links +${x.added}`);
      const ratio = pixelRatioFor(TIERS[x.b]!, 1920, 1080, 1);
      expect(x.w).toBe(Math.floor(1920 * ratio));
      expect(x.h).toBe(Math.floor(1080 * ratio));
      expect(x.opaque).toBe(x.total);
      expect(x.added).toBe(0);
    }
    expect(r[0]!.mad).toBeLessThanOrEqual(6);
    expect(r[1]!.mad).toBeLessThanOrEqual(6);
  });

  test('M6 forces', async ({ page }, info) => {
    await open(page);
    const r = await page.evaluate((ref) => {
      const s = window.__shell!;
      const fx = window.__fx!;
      const d = fx.debug;
      const renderer = d.composer.getRenderer();
      const o = { ...ref, palette: 0 };
      const sizes: boolean[] = [];
      const check = (): void => { sizes.push(d.composer.inputBuffer.width === renderer.domElement.width); };
      const anyPass = (): boolean => (['full', 'noCa', 'min', 'bare'] as const).some((v) => d.variants[v].enabled);
      const out: Record<string, unknown> = {};

      const linksBeforeOff = fx.links();
      fx.post.forceVariant('off');
      s.frameAt(0, o);
      check();
      // Not one of the four variants: the direct path is compiled on first use, in harness runs only.
      out['offLinks'] = fx.links() - linksBeforeOff;
      out['offAutoClear'] = renderer.autoClear;
      out['offAnyPass'] = anyPass();
      const offPx = s.pixels();
      let lit = 0;
      for (let i = 0; i < offPx.length; i += 4) if (offPx[i]! + offPx[i + 1]! + offPx[i + 2]! > 30) lit++;
      out['offLit'] = lit;
      out['offCalls'] = s.stats().calls;

      fx.post.forceVariant('bare');
      fx.setTier(3);
      s.frameAt(0, o);
      check();
      const crt = d.crt.uniforms;
      out['bareScan'] = crt.get('uScan')!.value;
      out['bareGrain'] = crt.get('uGrain')!.value;
      out['bareActive'] = d.activeVariant;
      fx.setTier(2);
      s.frameAt(0, o);
      check();
      out['keptUnderSetQuality'] = d.activeVariant;
      fx.post.forceVariant(null);
      s.frameAt(0, o);
      check();
      out['profileBack'] = d.activeVariant;

      fx.setTier(3);
      fx.post.forceMsaa(4);
      s.frameAt(0, o);
      check();
      out['msaa4'] = d.composer.multisampling;
      fx.post.forceMsaa(null);
      s.frameAt(0, o);
      check();
      out['msaaBack'] = d.composer.multisampling;
      out['sizes'] = sizes;
      return out;
    }, REF);
    console.log(`A27 ${JSON.stringify(r)}`);
    expect(r['offAutoClear']).toBe(false);
    expect(r['offAnyPass']).toBe(false);
    expect(r['offLit']).toBeGreaterThan(100000);
    expect(r['offCalls']).toBe(2);
    expect(r['bareScan']).toBe(0);
    expect(r['bareGrain']).toBe(0);
    expect(r['bareActive']).toBe('bare');
    expect(r['keptUnderSetQuality']).toBe('bare');
    expect(r['profileBack']).toBe('noCa');
    expect(r['msaa4']).toBe(4);
    expect(r['msaaBack']).toBe(2);
    expect((r['sizes'] as boolean[]).every(Boolean)).toBe(true);
    await page.evaluate((ref) => {
      window.__fx!.post.forceVariant('off');
      window.__shell!.frameAt(0, { ...ref, palette: 0 });
    }, REF);
    await saveShot(page, info, 'M6-post-off');
  });

  test('M6 resize', async ({ page }) => {
    await open(page);
    const r = await page.evaluate((ref) => {
      const s = window.__shell!;
      const fx = window.__fx!;
      const d = fx.debug;
      let calls = 0;
      const real = d.composer.setSize.bind(d.composer);
      d.composer.setSize = (...a: Parameters<typeof d.composer.setSize>): void => { calls++; real(...a); };
      fx.post.resize(1920, 1080, 1);
      fx.post.resize(1920, 1080, 1);
      s.frameAt(0, { ...ref, palette: 0 });
      const equal = calls;
      fx.post.resize(0, 0, 1);
      s.frameAt(0, { ...ref, palette: 0 });
      const zero = calls;
      return { equal, zero, w: s.stats().width };
    }, REF);
    console.log(`A28 ${JSON.stringify(r)}`);
    expect(r.equal).toBe(0);
    expect(r.zero).toBe(0);
    expect(r.w).toBe(1920);

    await page.setViewportSize({ width: 1280, height: 720 });
    const after = await page.evaluate((ref) => {
      const s = window.__shell!;
      s.frameAt(0, { ...ref, palette: 0 });
      const px = s.pixels();
      let opaque = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i] === 255) opaque++;
      return { w: s.stats().width, h: s.stats().height, opaque, total: px.length / 4, input: window.__fx!.debug.composer.inputBuffer.width };
    }, REF);
    console.log(`A28 viewport ${JSON.stringify(after)}`);
    expect(after.w).toBe(1280);
    expect(after.h).toBe(720);
    expect(after.input).toBe(1280);
    expect(after.opaque).toBe(after.total);
  });

  // The byte compares run at MSAA 0 (DI-67, DI-70), since the lines blend additively and D3D11 resolves blended draws
  // at MSAA 2 differently between identical renders. That tier 3 gets its MSAA 2 back after the restore is a separate
  // state assertion, read before the compare forces 0, and the restored MSAA 2 targets get a coarse liveness check.
  const LIVE_LUMA = 0.5;   // code values of mean Rec.709 luma
  const LIVE_LIT = 0.01;   // fraction of the pre-loss lit pixel count
  test('M6 restore', async ({ page }) => {
    await open(page);
    const r = await page.evaluate(async (ref) => {
      const s = window.__shell!;
      const fx = window.__fx!;
      const d = fx.debug;
      const o = { ...ref, palette: 0, feel: { speedLines: 1 } };
      const names = ['full', 'noCa', 'min', 'bare'] as const;
      const pre: Partial<Record<(typeof names)[number], Uint8Array>> = {};
      const preMsaa: number[] = [];
      // DI-73 (3): the byte compares run at MSAA 0, and forceMsaa(0) disposes the composer's buffers, so they never read
      // the restored multisampled targets. These frames do, at tier 3's own MSAA, with no force. Coarse on purpose: mean
      // Rec.709 luma, and lit pixels, whose largest channel is at least 32 as in litSaturation.
      const live = (v: (typeof names)[number]): { v: string; msaa: number; luma: number; lit: number } => {
        fx.post.forceVariant(v);
        s.frameAt(0, o);
        const px = s.pixels();
        let lit = 0;
        for (let i = 0; i < px.length; i += 4) if (Math.max(px[i]!, px[i + 1]!, px[i + 2]!) >= 32) lit++;
        return { v, msaa: d.composer.multisampling, luma: fx.metrics.meanLuma(px), lit };
      };
      const liveBefore = names.map(live);
      fx.post.forceMsaa(0);
      for (const v of names) {
        fx.post.forceVariant(v);
        s.frameAt(0, o);
        pre[v] = s.pixels();
        preMsaa.push(d.composer.multisampling);
      }
      fx.post.forceVariant(null);
      fx.post.forceMsaa(null);
      fx.setTier(2);
      s.frameAt(0, o);

      const renderer = d.composer.getRenderer();
      const canvas = renderer.domElement;
      const gl = renderer.getContext();
      const ext = gl.getExtension('WEBGL_lose_context')!;
      const lost = new Promise<void>((ok) => { canvas.addEventListener('webglcontextlost', () => { ok(); }, { once: true }); });
      const restored = new Promise<void>((ok) => { canvas.addEventListener('webglcontextrestored', () => { ok(); }, { once: true }); });
      ext.loseContext();
      await lost;
      // Restoring inside the loss event is the section 11.3 trap, so yield a task first.
      await new Promise((ok) => setTimeout(ok, 50));
      fx.setTier(3);
      ext.restoreContext();
      await restored;

      fx.post.rebuild();
      await fx.post.precompile();
      const msaa = d.composer.multisampling;
      const liveAfter = names.map(live);
      const liveness = names.map((v, i) => ({
        v, msaa: [liveBefore[i]!.msaa, liveAfter[i]!.msaa],
        dLuma: liveAfter[i]!.luma - liveBefore[i]!.luma, lumaBefore: liveBefore[i]!.luma,
        dLit: liveAfter[i]!.lit - liveBefore[i]!.lit, litBefore: liveBefore[i]!.lit,
      }));
      const postMsaa: number[] = [];
      const diffs = [];
      fx.post.forceMsaa(0);
      for (const v of names) {
        fx.post.forceVariant(v);
        s.frameAt(0, o);
        diffs.push({ v, ...fx.metrics.byteDiff(pre[v]!, s.pixels()) });
        postMsaa.push(d.composer.multisampling);
      }
      fx.post.forceVariant(null);
      fx.post.forceMsaa(null);
      const links = fx.links();
      for (const t of [4, 3, 2, 1, 0, 1, 2, 3] as const) {
        fx.setTier(t);
        s.frameAt(0, o);
      }
      return { msaa, preMsaa, postMsaa, diffs, cycleLinks: fx.links() - links, errors: s.shaderErrors.length, liveness };
    }, REF);
    console.log(`A29 ${JSON.stringify(r)}`);
    expect(r.msaa, 'tier 3 MSAA after the restore, before any force').toBe(2);
    expect(r.preMsaa, 'pre-loss compare frames').toEqual([0, 0, 0, 0]);
    expect(r.postMsaa, 'post-restore compare frames').toEqual([0, 0, 0, 0]);
    expect(r.cycleLinks).toBe(0);
    expect(r.errors).toBe(0);
    for (const x of r.diffs) {
      expect(x.bytes, x.v).toBeLessThanOrEqual(16);
      expect(x.max, x.v).toBeLessThanOrEqual(1);
    }
    // DI-73 (3): coarse MSAA 2 liveness after the restore, against the pre-loss MSAA 2 frame of the same variant. 20
    // repeats read 0 and 0 on all four. DI-67's worst same-state D3D11 MSAA reading on this machine, 173 B, can move mean
    // luma by at most 173 * .7152 * 255 / 2073600 = .0152 and the lit count by at most 173, so both limits sit over 30
    // times above it. The floor keeps the reference itself from being a dark frame.
    for (const x of r.liveness) {
      expect(x.msaa, `${x.v} liveness frames at MSAA 2`).toEqual([2, 2]);
      expect(x.litBefore, `${x.v} pre-loss MSAA 2 frame is lit`).toBeGreaterThan(0.5 * 1920 * 1080);
      expect(Math.abs(x.dLuma), `${x.v} mean luma change after the restore`).toBeLessThanOrEqual(LIVE_LUMA);
      expect(Math.abs(x.dLit), `${x.v} lit pixel change after the restore`).toBeLessThanOrEqual(LIVE_LIT * x.litBefore);
    }
  });

  test('M6 boots under post=off', async ({ page }) => {
    await open(page, { post: 'off' });
    const r = await page.evaluate((ref) => {
      const s = window.__shell!;
      const fx = window.__fx!;
      const d = fx.debug;
      s.frameAt(0, { ...ref, palette: 0 });
      const px = s.pixels();
      let lit = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i]! + px[i + 1]! + px[i + 2]! > 30) lit++;
      const any = (['full', 'noCa', 'min', 'bare'] as const).some((v) => d.variants[v].enabled);
      fx.post.forceVariant(null);
      const before = fx.links();
      s.frameAt(0, { ...ref, palette: 0 });
      return { lit, any, active: d.activeVariant, addedOnReturn: fx.links() - before, autoClear: d.composer.getRenderer().autoClear };
    }, REF);
    console.log(`A27 post=off ${JSON.stringify(r)}`);
    expect(r.lit).toBeGreaterThan(100000);
    expect(r.any).toBe(false);
    expect(r.active).toBe('full');
    expect(r.addedOnReturn).toBe(0);
    expect(r.autoClear).toBe(false);
  });

  test('M6 dispose', async ({ page }) => {
    await open(page);
    const r = await page.evaluate((ref) => {
      const s = window.__shell!;
      s.frameAt(0, { ...ref, palette: 0 });
      // The shared effects are disposed once per variant holding them, which must not throw.
      s.dispose();
      return window.__shell === undefined;
    }, REF);
    expect(r).toBe(true);
  });
});

test('software tier 0', async ({ page }, info) => {
  test.skip(info.project.name !== 'software', 'runs on SwiftShader');
  await open(page, { tier: 0 });
  const r = await page.evaluate((ref) => {
    const s = window.__shell!;
    const fx = window.__fx!;
    const ms = s.frameAt(0, { ...ref, palette: 0 });
    const px = s.pixels();
    let opaque = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] === 255) opaque++;
    return { ms, active: fx.debug.activeVariant, opaque, total: px.length / 4, w: s.stats().width, h: s.stats().height, renderer: s.rendererInfo().renderer };
  }, REF);
  console.log(`A30 ${JSON.stringify(r)}`);
  expect(r.active).toBe('bare');
  expect(r.opaque).toBe(r.total);
  expect(r.w).toBe(640);
  expect(r.h).toBe(360);
  await saveShot(page, info, 'A30-software-tier0');
});

test.describe('M7 governor', () => {
  test.beforeEach(({}, i) => { test.skip(i.project.name !== 'gpu', NEEDS_GPU); });

  test('M7 governor loop', async ({ page }) => {
    test.setTimeout(300_000);
    await open(page, { governor: 1, bootp95: 20 });
    const r = await page.evaluate(async (ref) => {
      const s = window.__shell!;
      const fx = window.__fx!;
      const o = { ...ref, palette: 0 };
      const start = { tier: fx.governor!.profile.tier, links: fx.links(), w: s.stats().width };
      const events: { tier: number; deltaIndex: number; w: number; h: number; active: string }[] = [];
      const series = (i: number): number => (i < 300 ? 33 : 1000 / 60);
      const total = 300 + 4200;
      for (let i = 0; i < total; i++) {
        const out = fx.governorStep(series(i));
        const w = s.stats().width;
        s.frameAt(0, o);
        if (out !== null) {
          const st = s.stats();
          events.push({ tier: out, deltaIndex: i, w: st.width, h: st.height, active: fx.debug.activeVariant });
          if (st.width === w && out < 3) throw new Error('buffer did not follow');
        }
        // Yield now and then, so the page stays responsive to the runner.
        if (i % 500 === 499) await new Promise((ok) => setTimeout(ok, 0));
      }
      return { start, events, added: fx.links() - start.links };
    }, REF);
    console.log(`A31 ${JSON.stringify(r)}`);
    expect(r.start.tier).toBe(2);
    expect(r.events.map((e) => e.tier)).toEqual([1, 2]);
    const t1 = pixelRatioFor(TIERS[1]!, 1920, 1080, 1);
    const t2 = pixelRatioFor(TIERS[2]!, 1920, 1080, 1);
    expect(r.events[0]!.w).toBe(Math.floor(1920 * t1));
    expect(r.events[1]!.w).toBe(Math.floor(1920 * t2));
    expect(r.events[0]!.active).toBe('min');
    expect(r.events[1]!.active).toBe('noCa');
    expect(r.added).toBe(0);
  });

  test('M7 tiers', async ({ page }, info) => {
    await open(page);
    for (const t of [4, 3, 2, 1, 0] as const) {
      await page.evaluate((tier) => { window.__fx!.setTier(tier); }, t);
      await shotOf(page, info, `M7-tier-${t}`, { ...REF, palette: 0 });
    }
  });
});
