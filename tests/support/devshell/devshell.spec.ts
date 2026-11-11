import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PALETTE_FLOATS, PHASE_PERIOD_TICKS } from '../../../src/contracts/index';
import { writeFakePalette } from '../../../src/testing/fakeWorld';
import { expect, openDevPage, saveShot, test } from '../pw';

const SMOKE = '/tests/support/devshell/smoke.html';
const NEEDS_1080P = 'needs the 1080p viewport and the real GPU';

interface Metrics {
  width: number; height: number; notOpaque: number; nearWhite: number; meanChroma: number; blackP10: number;
}

test('renders sky, sun and grid with a clean console (A11)', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_1080P);
  await openDevPage(page, SMOKE, { manual: 1 });
  const r = await page.evaluate((): Metrics & { stats: { calls: number } } => {
    const shell = window.__shell!;
    shell.setManual(true);
    shell.frameAt(4.2);
    const px = shell.pixels();
    const { width, height } = shell.stats();
    let notOpaque = 0;
    let nearWhite = 0;
    let chroma = 0;
    const luma = new Uint8Array(width * height);
    for (let i = 0, p = 0; i < px.length; i += 4, p++) {
      const a = px[i]!, b = px[i + 1]!, c = px[i + 2]!;
      if (px[i + 3] !== 255) notOpaque++;
      const lo = Math.min(a, b, c), hi = Math.max(a, b, c);
      if (lo > 235) nearWhite++;
      chroma += hi - lo;
      luma[p] = Math.round(0.2126 * a + 0.7152 * b + 0.0722 * c);
    }
    luma.sort();
    return {
      width, height, notOpaque, nearWhite: nearWhite / (width * height), meanChroma: chroma / (width * height),
      blackP10: luma[Math.floor(luma.length * 0.1)]!, stats: shell.stats(),
    };
  });
  console.log(`PICTURE ${JSON.stringify(r)}`);
  // With info.autoReset left on, calls would read only the composer's last pass, 1 (Agents.md).
  expect(r.stats.calls).toBeGreaterThan(3);
  expect(r.width).toBe(1920);
  expect(r.height).toBe(1080);
  expect(r.notOpaque).toBe(0);
  // Section 6.7's probe limits, as a floor for the picture T03 to T05 will judge against.
  expect(r.nearWhite).toBeLessThan(0.005);
  expect(r.meanChroma).toBeGreaterThan(55);
  expect(r.blackP10).toBeLessThanOrEqual(25);
  const path = await saveShot(page, info, 'devshell-picture');
  expect(readFileSync(path).length).toBeGreaterThan(10_000);
});

test('one createDevPost frame at fakeProfile(0) does not throw, T03 A22 path (A11, DI-46)', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_1080P);
  await openDevPage(page, SMOKE, { manual: 1, tier: 0 });
  const r = await page.evaluate(() => {
    const shell = window.__shell!;
    shell.setManual(true);
    shell.frameAt(4.2);
    const px = shell.pixels();
    let lit = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i]! + px[i + 1]! + px[i + 2]! > 30) lit++;
    return { lit, stats: shell.stats() };
  });
  console.log(`TIER0 ${JSON.stringify(r)}`);
  expect(r.lit).toBeGreaterThan(1000);
  // The first build keeps six bloom levels, so the mip chain draws: 15 calls on this scene, against 4 if it were built at 0.
  expect(r.stats.calls).toBeGreaterThan(10);
  await saveShot(page, info, 'devshell-tier0');
});

test('moving to fakeProfile(0) after a tier with bloom does not throw, because levels stay unchanged (A11, DI-46)', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_1080P);
  await openDevPage(page, SMOKE, { manual: 1 });
  const r = await page.evaluate(() => {
    const shell = window.__shell!;
    shell.setManual(true);
    shell.frameAt(4.2);
    shell.setTier(0);
    shell.frameAt(4.2);
    const px = shell.pixels();
    let lit = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i]! + px[i + 1]! + px[i + 2]! > 30) lit++;
    return { lit, stats: shell.stats() };
  });
  console.log(`TIER3TO0 ${JSON.stringify(r)}`);
  expect(r.stats.width).toBe(640);
  expect(r.lit).toBeGreaterThan(1000);
});

function findHorizon(frame: { bend: { a: number; c: number }; feel?: { shakeY: number } }): { horizon: number; peak: number; profile: number[] } {
  const shell = window.__shell!;
  shell.setManual(true);
  shell.frameAt(4.2, frame);
  const px = shell.pixels();
  const { width, height } = shell.stats();
  const lumaAt = (x: number, rowFromTop: number): number => {
    const i = ((height - 1 - rowFromTop) * width + x) * 4;
    return 0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!;
  };
  // At x = 100 the sky brightens steadily down to the horizon, so the horizon is where the running peak first falls away.
  const x = 100;
  let peak = 0;
  let horizon = -1;
  for (let row = 300; row < height; row++) {
    const l = lumaAt(x, row);
    if (l > peak) peak = l;
    if (l < peak * 0.9) { horizon = row; break; }
  }
  const profile: number[] = [];
  for (let row = horizon - 6; row < horizon + 6; row++) profile.push(Math.round(lumaAt(x, row)));
  return { horizon, peak, profile };
}

test('the horizon sits near row 590 (A11b)', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_1080P);
  await openDevPage(page, SMOKE, { manual: 1 });
  const r = await page.evaluate(findHorizon, { bend: { a: 0, c: 0 } });
  console.log(`HORIZON ${JSON.stringify(r)}`);
  expect(r.horizon).toBeGreaterThanOrEqual(587);
  expect(r.horizon).toBeLessThanOrEqual(593);
  // Negative control: zero pitch must move the horizon out of that range, to the middle of the frame.
  const flat = await page.evaluate(findHorizon, { bend: { a: 0, c: 0 }, feel: { shakeY: -0.05 } });
  console.log(`HORIZON zero pitch ${JSON.stringify(flat)}`);
  expect(flat.horizon).toBeGreaterThanOrEqual(538);
  expect(flat.horizon).toBeLessThanOrEqual(546);
});

const FRAME = { at: { chunk: 1, local: 0 }, tick: 0, bend: { a: 0, c: 0 } };
function readPixelAt(frame: typeof FRAME): number[] {
  const shell = window.__shell!;
  shell.setManual(true);
  shell.frameAt(0, frame);
  const px = shell.pixels();
  const { width, height } = shell.stats();
  const i = ((height - 1 - 560) * width + 960) * 4;
  return [px[i]!, px[i + 1]!, px[i + 2]!, px[i + 3]!];
}

test('DevPost has a depth buffer: the near quad wins (A11c)', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_1080P);
  await openDevPage(page, SMOKE, { manual: 1, depth: 1 });
  const c = await page.evaluate(readPixelAt, FRAME);
  console.log(`DEPTH post on: ${c.join(',')}`);
  expect(c[1]!).toBeGreaterThan(c[0]! + 100);
  expect(c[1]!).toBeGreaterThan(c[2]! + 100);
});

test('negative control: post off has no depth buffer, so the far quad drawn last wins (A11c)', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_1080P);
  await openDevPage(page, SMOKE, { manual: 1, depth: 1, post: 'off' });
  const c = await page.evaluate(readPixelAt, FRAME);
  const depthBits = await page.evaluate(() => window.__shell!.rendererInfo().depthBits);
  console.log(`DEPTH post off: ${c.join(',')}, canvas depth bits ${depthBits}`);
  expect(c).toEqual([255, 0, 0, 255]);
  expect(depthBits).toBe(0);
});

function repeats(t: number): { differingBytes: number; maxDelta: number; frames: number } {
  const shell = window.__shell!;
  shell.setManual(true);
  shell.frameAt(t);
  const base = shell.pixels();
  let differingBytes = 0;
  let maxDelta = 0;
  for (let f = 1; f < 16; f++) {
    shell.frameAt(t);
    const px = shell.pixels();
    for (let i = 0; i < px.length; i++) {
      const d = Math.abs(px[i]! - base[i]!);
      if (d > 0) {
        differingBytes++;
        if (d > maxDelta) maxDelta = d;
      }
    }
  }
  return { differingBytes, maxDelta, frames: 16 };
}

test('post off is deterministic: 16 repeats differ by 0 bytes (A11d)', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_1080P);
  await openDevPage(page, SMOKE, { manual: 1, post: 'off' });
  const r = await page.evaluate(repeats, 4.2);
  console.log(`DETERMINISM post off: ${JSON.stringify(r)}`);
  expect(r.differingBytes).toBe(0);
});

test('post on differs by at most 16 bytes, each by at most 1 (A11d)', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_1080P);
  await openDevPage(page, SMOKE, { manual: 1 });
  const r = await page.evaluate(repeats, 4.2);
  console.log(`DETERMINISM post on: ${JSON.stringify(r)}`);
  expect(r.differingBytes).toBeLessThanOrEqual(16);
  expect(r.maxDelta).toBeLessThanOrEqual(1);
});

test('a different t differs by over 1000 bytes, so the comparison can fail (A11d)', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_1080P);
  await openDevPage(page, SMOKE, { manual: 1 });
  const n = await page.evaluate(() => {
    const shell = window.__shell!;
    shell.setManual(true);
    shell.frameAt(4.2);
    const a = shell.pixels();
    shell.frameAt(4.3);
    const b = shell.pixels();
    let count = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) count++;
    return count;
  });
  console.log(`DETERMINISM different t: ${n} differing bytes`);
  expect(n).toBeGreaterThan(1000);
});

test('frames at chunk 2^40 and chunk 0 are identical, and neither is blank (A11e)', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_1080P);
  await openDevPage(page, SMOKE, { manual: 1, post: 'off' });
  const r = await page.evaluate(() => {
    const shell = window.__shell!;
    shell.setManual(true);
    const frame = (chunk: number, local: number): Uint8Array => {
      shell.frameAt(0, { at: { chunk, local }, tick: 120, palette: 0, bend: { a: 0, c: 0 } });
      return shell.pixels();
    };
    const a = frame(2 ** 40, 12.5);
    const b = frame(0, 12.5);
    let differing = 0;
    let aLit = 0;
    let bLit = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) differing++;
      if (i % 4 !== 3) {
        if (a[i]! > 8) aLit++;
        if (b[i]! > 8) bLit++;
      }
    }
    // Negative control: a different local moves the grid, so the comparison can see a change.
    const c = frame(0, 15);
    let controlDiffering = 0;
    for (let i = 0; i < b.length; i++) if (b[i] !== c[i]) controlDiffering++;
    return { differing, aLit, bLit, controlDiffering };
  });
  console.log(`DISTANCE ${JSON.stringify(r)}`);
  expect(r.differing).toBe(0);
  expect(r.aLit).toBeGreaterThan(100_000);
  expect(r.bLit).toBeGreaterThan(100_000);
  expect(r.controlDiffering).toBeGreaterThan(1000);
});

test('lifecycle order, rebuild on a jump, and deferred DevPost changes (A11g)', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_1080P);
  await openDevPage(page, SMOKE, { manual: 1, recordpost: 1 });
  const r = await page.evaluate(() => {
    const w = window as unknown as {
      __layerLog: string[]; __postLog: string[];
      __post: { setQuality(q: unknown): void; resize(w: number, h: number, d: number): void };
      __fakeProfile(t: number): unknown;
    };
    const shell = window.__shell!;
    shell.setManual(true);
    const bootLayer = [...w.__layerLog];
    const bootPost = [...w.__postLog];
    const rebuilds = (): number => w.__layerLog.filter((n) => n === 'rebuild').length;
    const postRebuilds = (): number => w.__postLog.filter((n) => n === 'rebuild').length;

    const before = rebuilds();
    const serial0 = shell.warpSerial;
    for (let i = 1; i <= 20; i++) shell.frameAt(i * 0.05);
    const afterSteps = rebuilds();
    const serialSteps = shell.warpSerial;

    shell.frameAt(0, { at: { chunk: 500, local: 0 }, tick: 0 });
    const afterJump = rebuilds();
    const serialJump = shell.warpSerial;
    const postAfterJump = postRebuilds();

    shell.frameAt(0, { at: { chunk: 400, local: 0 }, tick: 0 });
    const afterBack = rebuilds();
    const serialBack = shell.warpSerial;

    const gl = shell.ctx.renderer.getContext();
    const w0 = gl.drawingBufferWidth;
    w.__post.setQuality(w.__fakeProfile(1));
    const afterQualityCall = gl.drawingBufferWidth;
    w.__post.resize(640, 360, 1);
    const afterResizeCall = gl.drawingBufferWidth;
    shell.frameAt(0, { at: { chunk: 400, local: 0 }, tick: 1 });
    const afterFrame = gl.drawingBufferWidth;
    return { bootLayer, bootPost, before, afterSteps, serial0, serialSteps, afterJump, serialJump, postAfterJump, afterBack, serialBack, w0, afterQualityCall, afterResizeCall, afterFrame };
  });
  console.log(`LIFECYCLE ${JSON.stringify(r)}`);
  expect(r.bootLayer.slice(0, 4)).toEqual(['attach', 'setQuality', 'rebuild', 'frame']);
  expect(r.bootPost.slice(0, 4)).toEqual(['attach', 'setQuality', 'resize', 'precompile']);
  expect(r.bootPost.slice(4, 6)).toEqual(['frame', 'render']);
  expect(r.afterSteps).toBe(r.before);
  expect(r.serialSteps).toBe(r.serial0);
  expect(r.afterJump).toBe(r.afterSteps + 1);
  expect(r.serialJump).toBe(r.serialSteps + 1);
  expect(r.postAfterJump).toBe(1);
  expect(r.afterBack).toBe(r.afterJump + 1);
  expect(r.serialBack).toBe(r.serialJump + 1);
  expect(r.w0).toBe(1920);
  expect(r.afterQualityCall).toBe(1920);
  expect(r.afterResizeCall).toBe(1920);
  expect(r.afterFrame).toBeLessThan(1920);
});

test('a window resize applies before the next draw, and the aspect follows (M7)', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_1080P);
  await openDevPage(page, SMOKE, { manual: 1 });
  await page.setViewportSize({ width: 1280, height: 720 });
  const r = await page.evaluate(() => {
    const shell = window.__shell!;
    shell.setManual(true);
    const before = shell.stats().width;
    shell.frameAt(1);
    return { before, after: shell.stats().width, height: shell.stats().height, aspect: shell.ctx.camera.aspect };
  });
  expect(r.before).toBe(1920);
  expect(r.after).toBe(1280);
  expect(r.height).toBe(720);
  expect(r.aspect).toBeCloseTo(16 / 9, 9);
});

test('the paths T03 leans on: post-off clear, a passed world, debug forwarding, the jump limit, wide aspect, final alpha (A11h)', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_1080P);

  function notOpaque(): { total: number; notOpaque: number } {
    const shell = window.__shell!;
    shell.setManual(true);
    shell.frameAt(4.2);
    const px = shell.pixels();
    let count = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] !== 255) count++;
    return { total: px.length / 4, notOpaque: count };
  }

  await test.step('post off clears to the clear colour with the layer hidden, the false-result trap of section 11.3', async () => {
    await openDevPage(page, SMOKE, { manual: 1, post: 'off' });
    const r = await page.evaluate(() => {
      const shell = window.__shell!;
      shell.setManual(true);
      shell.ctx.renderer.setClearColor(0xff00ff, 1);
      shell.setLayerVisible('sky', false);
      shell.frameAt(1);
      shell.frameAt(1);
      const px = shell.pixels();
      let wrong = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i] !== 255 || px[i + 1] !== 0 || px[i + 2] !== 255 || px[i + 3] !== 255) wrong++;
      }
      return { total: px.length / 4, wrong, calls: shell.stats().calls };
    });
    console.log(`POST-OFF CLEAR ${JSON.stringify(r)}`);
    expect(r.total).toBe(1920 * 1080);
    expect(r.wrong).toBe(0);
    expect(r.calls).toBe(0);
  });

  await test.step('a passed world reaches the frame and ctx.world', async () => {
    const vMax = (): { uniform: number; ctx: number } => {
      const shell = window.__shell!;
      shell.setManual(true);
      shell.frameAt(1);
      const out = { a: 0, c: 0, vMax: 0 };
      shell.ctx.world.bendAt({ chunk: 0, local: 0 }, out);
      return { uniform: shell.ctx.shared.uBend.value[2]!, ctx: out.vMax };
    };
    await openDevPage(page, SMOKE, { manual: 1, markworld: 1 });
    expect(await page.evaluate(vMax)).toEqual({ uniform: 1200, ctx: 1200 });
    // Control: 1200 is the mark, and the shell's own world reads otherwise.
    await openDevPage(page, SMOKE, { manual: 1 });
    expect(await page.evaluate(vMax)).toEqual({ uniform: 1500, ctx: 1500 });
  });

  await test.step('setDebugMode reaches the layers', async () => {
    const log = await page.evaluate(() => {
      const before = window.__layerLog!.includes('setDebugMode');
      window.__shell!.setDebugMode('crack');
      return { before, after: window.__layerLog!.includes('setDebugMode') };
    });
    expect(log).toEqual({ before: false, after: true });
  });

  await test.step('a forward step of exactly CHUNK_LEN does not rebuild, and 64.5 does', async () => {
    const r = await page.evaluate(() => {
      const shell = window.__shell!;
      const rebuilds = (): number => window.__layerLog!.filter((n) => n === 'rebuild').length;
      shell.frameAt(0, { at: { chunk: 10, local: 0 }, tick: 0 });
      const r0 = rebuilds();
      const s0 = shell.warpSerial;
      shell.frameAt(0, { at: { chunk: 11, local: 0 }, tick: 0 });
      const r1 = rebuilds();
      const s1 = shell.warpSerial;
      shell.frameAt(0, { at: { chunk: 12, local: 0.5 }, tick: 0 });
      return { step64: r1 - r0, serial64: s1 - s0, step645: rebuilds() - r1, serial645: shell.warpSerial - s1 };
    });
    expect(r).toEqual({ step64: 0, serial64: 0, step645: 1, serial645: 1 });
  });

  await test.step('the camera follows a wider window, and section 6.4 caps the angle', async () => {
    // 16:9 to 16:9 cannot show this: the aspect is the same before and after.
    await page.setViewportSize({ width: 3840, height: 1080 });
    const r = await page.evaluate(() => {
      const shell = window.__shell!;
      shell.frameAt(1, { feel: { fovDeg: 68 } });
      const { aspect, fov } = shell.ctx.camera;
      return { aspect, fov, halfTan: Math.tan((fov * Math.PI) / 360) * aspect };
    });
    console.log(`WIDE ${JSON.stringify(r)}`);
    expect(r.aspect).toBeCloseTo(3840 / 1080, 6);
    expect(r.halfTan).toBeCloseTo(1.574, 6);
    expect(r.fov).toBeLessThan(68);
    await page.setViewportSize({ width: 1920, height: 1080 });
  });

  await test.step('DevPost hides a floor alpha below 1, which A11 cannot see on a floor that writes only 1', async () => {
    await openDevPage(page, SMOKE, { manual: 1, alpha: 1 });
    const on = await page.evaluate(notOpaque);
    console.log(`ALPHA post on ${JSON.stringify(on)}`);
    expect(on.total).toBe(1920 * 1080);
    expect(on.notOpaque).toBe(0);
    // Control: with post off nothing rewrites alpha, so the page really does write below 1.
    await openDevPage(page, SMOKE, { manual: 1, alpha: 1, post: 'off' });
    const off = await page.evaluate(notOpaque);
    console.log(`ALPHA post off ${JSON.stringify(off)}`);
    expect(off.notOpaque).toBeGreaterThan(100_000);
  });
});

test('what section 4 promises the siblings: the query string, the projection, HDR and MSAA, a tier change, the public calls, the rAF loop (A11i)', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_1080P);

  await test.step('the query string reaches the frame and the uniforms', async () => {
    const read = (): { hero: number[]; pal: number[]; phase3: number; tick: number; biome: number; palette: number } => {
      const { uHero, uPal, uPhases } = window.__shell!.ctx.shared;
      const v = window.__lastView!;
      return { hero: Array.from(uHero.value), pal: Array.from(uPal.value), phase3: uPhases.value[3]!, tick: v.tick, biome: v.zone.biomeA, palette: v.zone.paletteA };
    };
    const want = new Float32Array(PALETTE_FLOATS);
    writeFakePalette(2, want);
    await openDevPage(page, SMOKE, { manual: 1, palette: 2, biome: 3, hero: 1, t: 4.2 });
    const r = await page.evaluate(read);
    expect(r.hero).toEqual([1, 1, 0]);
    expect(r.pal).toEqual(Array.from(want));
    expect(r.tick).toBe(504);
    expect(r.phase3).toBeCloseTo((504 % PHASE_PERIOD_TICKS[3]) / PHASE_PERIOD_TICKS[3], 5);
    expect(r.biome).toBe(3);
    expect(r.palette).toBe(2);
    // Control: without the query the same reads give other values, so each of them can fail.
    await openDevPage(page, SMOKE, { manual: 1 });
    const plain = await page.evaluate(read);
    expect(plain.hero).toEqual([0, 0, 0]);
    expect(plain.pal).not.toEqual(Array.from(want));
    expect(plain.tick).toBe(0);
    expect(plain.biome).toBe(0);
    expect(plain.palette).toBe(0);
  });

  await test.step('a changed fovDeg reaches the projection matrix, not only camera.fov', async () => {
    await openDevPage(page, SMOKE, { manual: 1 });
    const r = await page.evaluate(() => {
      const shell = window.__shell!;
      shell.setManual(true);
      const at = (fovDeg: number): number => {
        shell.frameAt(1, { feel: { fovDeg } });
        return shell.ctx.camera.projectionMatrix.elements[5]!;
      };
      return [at(58), at(68), at(58)];
    });
    console.log(`PROJECTION ${JSON.stringify(r)}`);
    expect(r[0]!).toBeCloseTo(1 / Math.tan((29 * Math.PI) / 180), 6);
    expect(r[1]!).toBeCloseTo(1 / Math.tan((34 * Math.PI) / 180), 6);
    expect(r[2]!).toBeCloseTo(1 / Math.tan((29 * Math.PI) / 180), 6);
  });

  // set multisampling allocates a 1x1 RGBA8 probe in postprocessing's getSafeSamples, so the spy keeps real targets only.
  interface Allocation { samples: number; format: number }
  const spied = (): Allocation[] => (window as unknown as { __rb: Allocation[] }).__rb;
  const RGBA16F = 0x881a;

  await test.step('the composer is half-float, with MSAA from the profile, on the first build', async () => {
    await page.addInitScript(() => {
      const log: { samples: number; format: number }[] = [];
      (window as unknown as { __rb: unknown }).__rb = log;
      const proto = WebGL2RenderingContext.prototype;
      const real = proto.renderbufferStorageMultisample;
      proto.renderbufferStorageMultisample = function spy(target, samples, format, width, height): void {
        if (width > 1) log.push({ samples, format });
        real.call(this, target, samples, format, width, height);
      };
    });
    await openDevPage(page, SMOKE, { manual: 1 });
    const t3 = await page.evaluate(spied);
    console.log(`MSAA tier 3 ${JSON.stringify(t3)}`);
    expect(t3.length).toBeGreaterThan(0);
    expect(t3.every((a) => a.samples === 2)).toBe(true);
    expect(t3.filter((a) => a.format === RGBA16F).length).toBeGreaterThan(0);
    await openDevPage(page, SMOKE, { manual: 1, tier: 4 });
    const t4 = await page.evaluate(spied);
    console.log(`MSAA tier 4 ${JSON.stringify(t4)}`);
    expect(t4.length).toBeGreaterThan(0);
    expect(t4.every((a) => a.samples === 4)).toBe(true);
    expect(t4.filter((a) => a.format === RGBA16F).length).toBeGreaterThan(0);
    await openDevPage(page, SMOKE, { manual: 1, tier: 2 });
    expect(await page.evaluate(spied)).toEqual([]);
  });

  await test.step('a tier change reaches the bloom levels, the pixel ratio and the MSAA, and forceMsaa overrides the profile', async () => {
    await openDevPage(page, SMOKE, { manual: 1, recordpost: 1 });
    const r = await page.evaluate(() => {
      const log = (window as unknown as { __rb: { samples: number }[] }).__rb;
      const post = (window as unknown as { __post: { forceMsaa(n: 0 | 2 | 4 | null): void } }).__post;
      const shell = window.__shell!;
      shell.setManual(true);
      shell.frameAt(0.1);
      const t3 = shell.stats();
      shell.setTier(1);
      shell.frameAt(0.1);
      const t1 = shell.stats();
      const beforeHigh = log.length;
      shell.setTier(4);
      shell.frameAt(0.1);
      const t4 = shell.stats();
      const high = log.slice(beforeHigh).map((a) => a.samples);
      const beforeForced = log.length;
      post.forceMsaa(2);
      shell.frameAt(0.1);
      const forced = log.slice(beforeForced).map((a) => a.samples);
      return { t3, t1, t4, high, forced };
    });
    console.log(`TIER CHANGE ${JSON.stringify(r)}`);
    expect(r.t3.calls).toBe(15);
    expect(r.t3.width).toBe(1920);
    // Two calls per bloom level: tier 3 has 6, tier 1 has 3, tier 4 has 7.
    expect(r.t1.calls).toBe(9);
    expect(r.t1.width).toBe(1280);
    expect(r.t4.calls).toBe(17);
    expect(r.t4.width).toBe(1920);
    expect(r.high.length).toBeGreaterThan(0);
    expect(r.high.every((s) => s === 4)).toBe(true);
    expect(r.forced.length).toBeGreaterThan(0);
    expect(r.forced.every((s) => s === 2)).toBe(true);
  });

  await test.step('bloom adds light outside a source above its threshold', async () => {
    const band = (): number => {
      const shell = window.__shell!;
      shell.setManual(true);
      shell.frameAt(0, { at: { chunk: 1, local: 0 }, tick: 0, bend: { a: 0, c: 0 } });
      const px = shell.pixels();
      const { width, height } = shell.stats();
      let lumaSum = 0;
      for (let row = 420; row < 600; row++) {
        for (let x = 560; x < 700; x++) {
          const i = ((height - 1 - row) * width + x) * 4;
          lumaSum += 0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!;
        }
      }
      return lumaSum / (180 * 140);
    };
    const added = async (extra: Record<string, string | number>): Promise<number> => {
      await openDevPage(page, SMOKE, { manual: 1, depth: 1, ...extra });
      const plain = await page.evaluate(band);
      await openDevPage(page, SMOKE, { manual: 1, depth: 1, hot: 1, ...extra });
      return (await page.evaluate(band)) - plain;
    };
    const on = await added({});
    const off = await added({ post: 'off' });
    console.log(`BLOOM added ${on} code values with post on, ${off} with post off`);
    // Control: with post off the band does not change at all, so the band is outside the quad, and only bloom can reach it.
    expect(off).toBe(0);
    expect(on).toBeGreaterThan(20);
  });

  await test.step('the public rebuild reaches the layers and the stack, and is not a warp', async () => {
    await openDevPage(page, SMOKE, { manual: 1, recordpost: 1 });
    const r = await page.evaluate(() => {
      const count = (log: readonly string[], name: string): number => log.filter((n) => n === name).length;
      const postLog = (window as unknown as { __postLog: string[] }).__postLog;
      const shell = window.__shell!;
      const layer0 = count(window.__layerLog!, 'rebuild');
      const post0 = count(postLog, 'rebuild');
      const serial0 = shell.warpSerial;
      shell.rebuild();
      return { layer: count(window.__layerLog!, 'rebuild') - layer0, post: count(postLog, 'rebuild') - post0, serial: shell.warpSerial - serial0 };
    });
    expect(r).toEqual({ layer: 1, post: 1, serial: 0 });
  });

  await test.step('options.tier sets the tier, and the query outranks it', async () => {
    const read = (): { tier: number; width: number } => ({ tier: window.__lastView!.quality.tier, width: window.__shell!.stats().width });
    await openDevPage(page, SMOKE, { manual: 1, otier: 1 });
    expect(await page.evaluate(read)).toEqual({ tier: 1, width: 1280 });
    await openDevPage(page, SMOKE, { manual: 1, otier: 1, tier: 4 });
    expect(await page.evaluate(read)).toEqual({ tier: 4, width: 1920 });
  });

  await test.step('setManual cancels the pending loop and the rAF loop starts from its own first frame, on a paused clock so load cannot move it', async () => {
    await page.clock.install({ time: 0 });
    await openDevPage(page, SMOKE, { manual: 1, t: 4.2 });
    await page.clock.pauseAt(3_600_000);
    const read = (): { frames: number; tick: number; serial: number } => ({ frames: window.__frames!, tick: window.__lastView!.tick, serial: window.__shell!.warpSerial });
    const start = await page.evaluate(read);
    await page.clock.runFor(320);
    const idle = await page.evaluate(read);
    // Off then on inside one task. Without the cancel the first request stays pending, and two loops run from then on.
    await page.evaluate(() => {
      const shell = window.__shell!;
      shell.setManual(false);
      shell.setManual(true);
      shell.setManual(false);
    });
    await page.clock.runFor(320);
    const running = await page.evaluate(read);
    await page.evaluate(() => { window.__shell!.setManual(true); });
    await page.clock.runFor(320);
    const stopped = await page.evaluate(read);
    console.log(`RAF ${JSON.stringify({ start, idle, running, stopped })}`);
    expect(idle.frames).toBe(start.frames);
    expect(running.frames - idle.frames).toBe(20);
    expect(stopped.frames).toBe(running.frames);
    // ?t carries into the loop, and an hour of page clock before the first frame did not read as a camera jump.
    expect(running.tick).toBeGreaterThanOrEqual(504);
    expect(running.tick).toBeLessThan(504 + 60);
    expect(running.serial).toBe(0);
  });

  await test.step('dispose removes the canvas and the global', async () => {
    await page.clock.resume();
    await openDevPage(page, SMOKE, { manual: 1 });
    const r = await page.evaluate(() => {
      const before = document.querySelectorAll('canvas').length;
      window.__shell!.dispose();
      return { before, after: document.querySelectorAll('canvas').length, shell: window.__shell === undefined };
    });
    expect(r).toEqual({ before: 1, after: 0, shell: true });
  });
});

/** The parts of a child run's JSON report that A11f's negative control reads. */
interface ChildResult { status: string; error?: { message?: string }; errors: unknown[] }
interface ChildSuite { suites?: ChildSuite[]; specs?: { tests: { results: ChildResult[] }[] }[] }

function childResults(suites: readonly ChildSuite[], out: ChildResult[] = []): ChildResult[] {
  for (const s of suites) {
    for (const spec of s.specs ?? []) for (const t of spec.tests) out.push(...t.results);
    childResults(s.suites ?? [], out);
  }
  return out;
}

/** Runs node with these arguments, without blocking the worker, and kills it after `ms`. */
function runNode(args: readonly string[], env: NodeJS.ProcessEnv, ms: number): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'], timeout: ms });
    let output = '';
    child.stdout.on('data', (d: Buffer) => { output += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { output += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => { resolve({ code, output }); });
  });
}

test.describe('shader failures', () => {
  test.describe('with allowConsoleErrors', () => {
    test.use({ allowConsoleErrors: true });

    test('a bad shader reaches shaderErrors and the console (A11f)', async ({ page }, info) => {
      test.skip(info.project.name !== 'gpu', NEEDS_1080P);
      const logged: string[] = [];
      page.on('console', (m) => { if (m.type() === 'error') logged.push(m.text()); });
      await page.goto(`${SMOKE}?bad=1&manual=1`);
      await page.waitForFunction(() => (window.__shell?.shaderErrors.length ?? 0) > 0);
      const n = await page.evaluate(() => window.__shell!.shaderErrors.length);
      expect(n).toBeGreaterThan(0);
      expect(logged.some((l) => l.includes('SHADER_ERROR'))).toBe(true);
    });
  });

  // A bare test.fail() here passed for other failures too, such as a fixture failing at teardown or an action's own
  // timeout (VI-gates). The claim is about a test's outcome, which only a run outside that test can read, so a child
  // Playwright run executes the bare test in consoleguard.control.ts, with pw.ts's fixture at its defaults, and this
  // test reads why it failed. A guard that never fails, or fails for any other reason, fails this test.
  test('negative control: without allowConsoleErrors the same page fails the test, for its shader errors alone (A11f)', async ({}, info) => {
    test.skip(info.project.name !== 'gpu', NEEDS_1080P);
    const here = dirname(info.file);
    const report = info.outputPath('child-report.json');
    const run = await runNode(
      [join(here, '../../../node_modules/playwright/cli.js'), 'test', '--config', join(here, 'consoleguard.config.ts'),
        '--reporter=json', `--output=${info.outputPath('child')}`],
      { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: report, FORCE_COLOR: '0' },
      50_000,
    );
    expect(existsSync(report), `no child report; exit ${run.code}:\n${run.output}`).toBe(true);
    const json = JSON.parse(readFileSync(report, 'utf8')) as { suites: ChildSuite[]; errors: unknown[] };
    const results = childResults(json.suites);
    const message = results[0]?.error?.message ?? '';
    const head = /^Error: (\d+) console errors:\n/.exec(message);
    const entries = message.match(/^(?:console\.error|pageerror): .*$/gm) ?? [];
    console.log(`GUARD CHILD ${JSON.stringify({ exit: run.code, statuses: results.map((r) => r.status), head: message.split('\n')[0], entries: entries.length })}`);
    expect(json.errors, run.output).toEqual([]);
    // One test, failed: not passed, and not timedOut, which is how a test timeout reports.
    expect(results.map((r) => r.status), message).toEqual(['failed']);
    expect(results[0]!.errors, message).toHaveLength(1);
    // The guard's own failure, listing every error it collected, and each of them a SHADER_ERROR.
    expect(head, message).not.toBeNull();
    expect(entries.length, message).toBe(Number(head![1]));
    expect(entries.filter((e) => !e.startsWith('console.error: SHADER_ERROR ')), message).toEqual([]);
    expect(run.code).toBe(1);
  });

  test.describe('openDevPage', () => {
    test.use({ allowConsoleErrors: true });

    test('fails early on a shader error', async ({ page }, info) => {
      test.skip(info.project.name !== 'gpu', NEEDS_1080P);
      let thrown = '';
      await openDevPage(page, SMOKE, { manual: 1, bad: 1 }).catch((e: unknown) => { thrown = String(e); });
      expect(thrown).toContain('shader error');
    });
  });
});

test('the GLSL motion twins agree with motion.ts on a float target (A13)', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_1080P);
  await page.goto('/tests/support/devshell/blank.html');
  const r = await page.evaluate(async () => {
    const motionUrl = '/src/core/motion.ts';
    const glslUrl = '/src/contracts/glsl.ts';
    const motion = await import(/* @vite-ignore */ motionUrl) as typeof import('../../../src/core/motion');
    const glsl = await import(/* @vite-ignore */ glslUrl) as typeof import('../../../src/contracts/glsl');
    // Inputs on T01's ItemRow domains: TRAFFIC travel 64, 96, 128 with a * k / 256 in 20 to 40 u/s; DRONE amp 3 to 8, k 1.
    const traffic: readonly [number, number, number, number][] = [
      [64, 100, 0.25, 0],
      [64, 160, 0.25, 0.123456],
      [64, 160, 0.625, 0.999],
      [96, 64, 0.625, 0.5],
      [96, 106, 0.875, 0.99999],
      [128, 48, 0.875, 0.999],
      [128, 80, 0, 0.25],
      [128, 80, 0.33, 0.99999],
    ];
    const drone: readonly [number, number, number, number][] = [
      [3, 1, 0, 0],
      [3, 1, 0.1, 0.05],
      [4, 1, 0.33, 0.77],
      [5.5, 1, 0.9, 0.31],
      [6, 1, 0.5, 0.25],
      [7, 1, 0.123, 0.999],
      [8, 1, 0.75, 0.5],
      [8, 1, 0.999, 0.99999],
    ];
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2')!;
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('no EXT_color_buffer_float');
    const compile = (type: number, src: string): WebGLShader => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(String(gl.getShaderInfoLog(s)));
      return s;
    };
    const vs = '#version 300 es\nvoid main() { gl_Position = vec4(float((gl_VertexID & 1) * 4 - 1), float((gl_VertexID & 2) * 2 - 1), 0., 1.); }';
    const fs = `#version 300 es
precision highp float;
precision highp int;
${glsl.COMMON_VERT}
uniform vec4 uSample;
out vec4 outColor;
void main() {
  outColor = vec4(trafficOffset(uSample.x, uSample.y, uSample.z, uSample.w), droneOffset(uSample.x, uSample.y, uSample.z, uSample.w), 0., 1.);
}`;
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(String(gl.getProgramInfoLog(program)));
    gl.useProgram(program);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 1, 1);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('float target incomplete');
    gl.viewport(0, 0, 1, 1);
    const loc = gl.getUniformLocation(program, 'uSample');
    const out = new Float32Array(4);
    const rows: { kind: string; gpu: number; js: number }[] = [];
    const draw = (v: readonly [number, number, number, number]): Float32Array => {
      gl.uniform4f(loc, v[0], v[1], v[2], v[3]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, out);
      return out;
    };
    for (const v of traffic) rows.push({ kind: 'traffic', gpu: draw(v)[0]!, js: motion.trafficOffset(v[0], v[1], v[2], v[3]) });
    for (const v of drone) rows.push({ kind: 'drone', gpu: draw(v)[1]!, js: motion.droneOffset(v[0], v[1], v[2], v[3]) });
    return rows;
  });
  const worstOf = (kind: string): number => Math.max(...r.filter((row) => row.kind === kind).map((row) => Math.abs(row.gpu - row.js)));
  console.log(`TWINS worst difference: traffic ${worstOf('traffic')} u, drone ${worstOf('drone')} u, over ${r.length} samples`);
  expect(r.filter((row) => row.kind === 'traffic').length).toBe(8);
  expect(r.filter((row) => row.kind === 'drone').length).toBe(8);
  expect(worstOf('traffic')).toBeLessThan(1e-3);
  expect(worstOf('drone')).toBeLessThan(1e-3);
  // The samples must exercise the functions: a shader that returned 0 would otherwise pass at phase 0 only.
  expect(r.filter((row) => Math.abs(row.js) > 1).length).toBeGreaterThan(8);
});
