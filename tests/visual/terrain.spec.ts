// Browser acceptance for T03 (plans/T03-terrain.md, section 7). Every test opens dev/terrain.html through the shell and renders in
// manual mode. Page functions passed to evaluate are self-contained, because Playwright serialises them. Pixels are read in the same
// task as the render (section 11.3). Rows are counted from the top of the image; pixels() itself is bottom-up.
import { existsSync } from 'node:fs';
import type { Page, TestInfo } from 'playwright/test';
import type { BufferGeometry, Mesh, ShaderMaterial } from 'three';
import {
  CAMERA_FOV, CAMERA_FOV_MAX, CAMERA_PITCH, CHUNK_LIMIT, CRACK_CONTROL_GROW, PLAY_HALF_X, SHIP_FORWARD,
  type PostVariant, type QualityProfile, type RenderLayer,
} from '../../src/contracts/index';
import type { HdrRect, HdrStats, readHdr } from '../../src/render/terrain/dev/devTools';
import { fakeProfile } from '../../src/testing/scriptedFrame';
import { expect, openDevPage, saveShot, test } from '../support/pw';

/** What dev/terrain.html's post stack was last given: the profile, a forced variant and a forced sample count (null when not forced). */
interface PostState { quality: Readonly<QualityProfile> | null; variant: PostVariant | 'off' | null; msaa: 0 | 2 | 4 | null }

declare global {
  interface Window {
    __terrain?: { layer: RenderLayer; frameMs: number[]; readHdr: typeof readHdr; postState: PostState };
    __refPixels?: Uint8Array;
    __msaaSamples?: number[];
  }
}

const PAGE = '/dev/terrain.html';
const NEEDS_GPU = 'needs the 1080p viewport and the real GPU';
const FLAT = { a: 0, c: 0 };
const FULL = { a: 8e-5, c: -1.2e-5 };
const RIGHT = FULL;
const LEFT = { a: -8e-5, c: 1.2e-5 };
const MID_BEND = { a: 4e-5, c: -6e-6 };
const CRACK_CHUNKS = [0, 15625000, 15625000000000];
const DIST_CHUNKS: readonly (readonly [string, number])[] = [
  ['z0', 3], ['z1e9', 15625000], ['z1e12', 15625000000], ['z1e15', 15625000000000], ['zlimit', CHUNK_LIMIT - 1],
];
const CROP_NEAR = { x: 400, y: 700, width: 1120, height: 380 };
const CROP_MID = { x: 0, y: 330, width: 800, height: 300 };
const CROP_FAR = { x: 560, y: 520, width: 800, height: 140 };
const CROP_HORIZON = { x: 1045, y: 585, width: 145, height: 45 };

type Bend = { a: number; c: number };
type Query = Record<string, string | number>;

async function open(page: Page, query: Query = {}): Promise<void> {
  await openDevPage(page, PAGE, { manual: 1, ...query });
  await page.evaluate(() => { window.__shell!.setManual(true); });
}

async function clipShot(page: Page, info: TestInfo, name: string, clip: { x: number; y: number; width: number; height: number }): Promise<void> {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, clip });
  console.log(`SCREENSHOT ${path}`);
}

async function renderOnly(page: Page, o: { chunk: number; local: number; tick: number; palette?: number; bend: Bend; fovDeg?: number; camX?: number }): Promise<void> {
  await page.evaluate((a) => {
    window.__shell!.frameAt(0, {
      at: { chunk: a.chunk, local: a.local }, tick: a.tick, palette: a.palette ?? 0, bend: a.bend,
      ...(a.fovDeg !== undefined ? { feel: { fovDeg: a.fovDeg } } : {}),
      ...(a.camX !== undefined ? { camX: a.camX } : {}),
    });
  }, o);
}

// ---- crack detector ----

/** camX and fovDeg are for the DI-88 row; left out, the frame is the shell's default (camera x 0, FOV 58), as A5 to A8 use. */
interface CrackArgs { chunks: number[]; frames: number; bend: Bend; pitch: number; grow?: number; camX?: number; fovDeg?: number }
interface CrackResult { chunk: number; bad: number; badFrames: number; skyShare: number; width: number; height: number }

/** Inside one evaluate, so pixels come from the same task as the render. A sky pixel below the first non-sky pixel of its column is a crack. */
function crackRun(a: CrackArgs): CrackResult[] {
  const s = window.__shell!;
  s.setManual(true);
  s.ctx.renderer.setClearColor(0xff00ff, 1);
  s.setDebugMode('crack');
  if (a.grow !== undefined) window.__terrain!.layer.setCrackControl!(a.grow);
  const out: CrackResult[] = [];
  for (const chunk0 of a.chunks) {
    let chunk = chunk0;
    let local = 0;
    let bad = 0;
    let badFrames = 0;
    let sky = 0;
    let W = 0;
    let H = 0;
    for (let i = 0; i < a.frames; i++) {
      local += 2.5;
      if (local >= 64) { local -= 64; chunk += 1; }
      s.frameAt(0, {
        at: { chunk, local }, tick: i, palette: 0, bend: a.bend,
        feel: { shakeY: -a.pitch, ...(a.fovDeg !== undefined ? { fovDeg: a.fovDeg } : {}) },
        ...(a.camX !== undefined ? { camX: a.camX } : {}),
      });
      const px = s.pixels();
      const st = s.stats();
      W = st.width;
      H = st.height;
      sky = 0;
      let badHere = 0;
      for (let x = 0; x < W; x++) {
        let seen = false;
        for (let row = 0; row < H; row++) {
          const at = ((H - 1 - row) * W + x) * 4;
          const mg = px[at]! > 200 && px[at + 1]! < 60 && px[at + 2]! > 200;
          if (mg) sky++;
          if (mg && seen) badHere++;
          else if (!mg) seen = true;
        }
      }
      bad += badHere;
      if (badHere > 0) badFrames++;
    }
    out.push({ chunk: chunk0, bad, badFrames, skyShare: sky / (W * H), width: W, height: H });
  }
  return out;
}

async function crack(page: Page, a: Omit<CrackArgs, 'pitch'>): Promise<CrackResult[]> {
  const r = await page.evaluate(crackRun, { ...a, pitch: CAMERA_PITCH });
  for (const line of r) console.log(`CRACK ${page.url().split('?')[1]} bend ${a.bend.a} ${JSON.stringify(line)}`);
  return r;
}

test('stats (A4): 6 draws, 120456 triangles, one program, nothing grows', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_GPU);
  test.setTimeout(180_000);
  // Live GL buffers, for the dispose check below. Installed before the page's own scripts, so it sees every buffer three creates.
  await page.addInitScript(() => {
    const live = new Set<WebGLBuffer>();
    (window as unknown as { __glLive: Set<WebGLBuffer> }).__glLive = live;
    const proto = WebGL2RenderingContext.prototype;
    const create = proto.createBuffer;
    const remove = proto.deleteBuffer;
    proto.createBuffer = function (this: WebGL2RenderingContext): WebGLBuffer {
      const b = create.call(this);
      live.add(b);
      return b;
    };
    proto.deleteBuffer = function (this: WebGL2RenderingContext, b: WebGLBuffer | null): void {
      if (b) live.delete(b);
      remove.call(this, b);
    };
  });
  await open(page, { sky: 0, post: 'off', tier: 3 });
  // Every index object terrain renders with, recorded after each frame, so the dispose check knows how many buffers it must free.
  await page.evaluate(() => {
    const s = window.__shell!;
    const seen = new Set<object>();
    (window as unknown as { __seenIndex: Set<object> }).__seenIndex = seen;
    const inner = s.frameAt.bind(s);
    s.frameAt = (t, o) => {
      const ms = inner(t, o);
      for (const m of s.ctx.scene.children as Mesh<BufferGeometry, ShaderMaterial>[]) if (m.geometry?.index) seen.add(m.geometry.index);
      return ms;
    };
  });
  const r = await page.evaluate(() => {
    const s = window.__shell!;
    const at = (i: number) => ({ chunk: 40 + Math.floor(i / 8), local: (i % 8) * 8 });
    s.frameAt(0, { at: at(0), tick: 0, palette: 0, bend: { a: 8e-5, c: -1.2e-5 } });
    const first = s.stats();
    const meshes = s.ctx.scene.children as Mesh<BufferGeometry, ShaderMaterial>[];
    const programs = new Set(meshes.map((m) => {
      const p = s.ctx.renderer.properties.get(m.material) as { currentProgram?: object };
      return p.currentProgram;
    }));
    for (let i = 1; i <= 600; i++) s.frameAt(0, { at: at(i), tick: i, palette: 0, bend: { a: 8e-5, c: -1.2e-5 } });
    const after600 = s.stats();
    return { first, programCount: programs.size, hasProgram: !programs.has(undefined), meshCount: meshes.length, after600 };
  });
  console.log(`STATS ${JSON.stringify(r)}`);
  expect(r.first.calls).toBe(6);
  expect(r.first.triangles).toBe(120456);
  expect(r.meshCount).toBe(6);
  expect(r.hasProgram).toBe(true);
  expect(r.programCount).toBe(1);
  expect(r.after600.programs).toBe(r.first.programs);
  expect(r.after600.geometries).toBe(r.first.geometries);
  expect(r.after600.textures).toBe(r.first.textures);

  // The layer alone gets the trip here, because the shell's setTier also makes DevPost drop bloom targets it never redraws under
  // post=off, which moves the counters by itself (section 10). The full setTier path runs with post on below.
  const trip = await page.evaluate(({ to1, to3 }) => {
    const s = window.__shell!;
    const layer = window.__terrain!.layer;
    const frame = (i: number) => s.frameAt(0, { at: { chunk: 100, local: i * 0.01 }, tick: i, palette: 0, bend: { a: 0, c: 0 } });
    frame(0);
    const t3 = s.stats();
    layer.setQuality(to1);
    for (let i = 1; i <= 40; i++) frame(i);
    const t1 = s.stats();
    layer.setQuality(to3);
    for (let i = 41; i <= 80; i++) frame(i);
    const back = s.stats();
    return { t3, t1, back };
  }, { to1: fakeProfile(1), to3: fakeProfile(3) });
  console.log(`TRIP ${JSON.stringify(trip)}`);
  expect(trip.t1.triangles).toBe(30264);
  expect(trip.back.triangles).toBe(120456);
  for (const key of ['programs', 'geometries', 'textures'] as const) {
    expect(trip.t1[key]).toBe(trip.t3[key]);
    expect(trip.back[key]).toBe(trip.t3[key]);
  }

  const vis = await page.evaluate(() => {
    const s = window.__shell!;
    s.setLayerVisible('terrain', false);
    s.frameAt(0, { at: { chunk: 100, local: 1 }, tick: 1, palette: 0, bend: { a: 0, c: 0 } });
    const hidden = s.stats();
    s.setLayerVisible('terrain', true);
    s.frameAt(0, { at: { chunk: 100, local: 1 }, tick: 1, palette: 0, bend: { a: 0, c: 0 } });
    const shown = s.stats();
    // The crack control binds one more index variant, so dispose has the stride trip's and this one to free.
    const layer = window.__terrain!.layer;
    layer.setCrackControl!(4);
    s.frameAt(0, { at: { chunk: 100, local: 1 }, tick: 1, palette: 0, bend: { a: 0, c: 0 } });
    layer.setCrackControl!(0);
    s.frameAt(0, { at: { chunk: 100, local: 1 }, tick: 1, palette: 0, bend: { a: 0, c: 0 } });
    const w = window as unknown as { __glLive: Set<WebGLBuffer>; __seenIndex: Set<object> };
    const liveBefore = new Set(w.__glLive);
    layer.dispose();
    s.frameAt(0, { at: { chunk: 100, local: 1 }, tick: 1, palette: 0, bend: { a: 0, c: 0 } });
    const disposed = s.stats();
    let freed = 0;
    for (const b of liveBefore) if (!w.__glLive.has(b)) freed++;
    let made = 0;
    for (const b of w.__glLive) if (!liveBefore.has(b)) made++;
    return { hidden, shown, disposed, buffers: { indexVariants: w.__seenIndex.size, liveBefore: liveBefore.size, freed, made, liveAfter: w.__glLive.size } };
  });
  console.log(`VISIBLE ${JSON.stringify(vis)}`);
  expect(vis.shown.calls - vis.hidden.calls).toBe(6);
  // The shell's baseline is everything but terrain's 2 geometries and 1 texture.
  expect(vis.shown.geometries - vis.disposed.geometries).toBe(2);
  expect(vis.shown.textures - vis.disposed.textures).toBe(1);
  expect(vis.disposed.calls).toBe(0);
  // GL buffers: dispose frees the shared position buffer and every index variant terrain ever rendered with, not only the two bound
  // now. Stride 1 and 2 for each geometry, the ramp's even hole and the grown hole make 6 variants; fewer means the trip did not run.
  expect(vis.buffers.indexVariants).toBe(6);
  expect(vis.buffers.made).toBe(0);
  expect(vis.buffers.freed).toBe(vis.buffers.indexVariants + 1);

  await open(page, { sky: 0, post: 'off', tier: 1 });
  const t1 = await page.evaluate(() => {
    const s = window.__shell!;
    s.frameAt(0, { at: { chunk: 40, local: 0 }, tick: 0, palette: 0, bend: { a: 0, c: 0 } });
    return s.stats();
  });
  expect(t1.calls).toBe(6);
  expect(t1.triangles).toBe(30264);

  // The shell's real setTier, post on. Geometries are T03's promise (section 9.3); the rest is printed for T06.
  await open(page, { tier: 3 });
  const real = await page.evaluate(() => {
    const s = window.__shell!;
    const frame = (i: number) => s.frameAt(0, { at: { chunk: 100, local: i * 0.01 }, tick: i, palette: 0, bend: { a: 0, c: 0 } });
    frame(0);
    const t3 = s.stats();
    s.setTier(1);
    for (let i = 1; i <= 40; i++) frame(i);
    const t1 = s.stats();
    s.setTier(3);
    for (let i = 41; i <= 80; i++) frame(i);
    return { t3, t1, back: s.stats() };
  });
  console.log(`TRIP post on ${JSON.stringify(real)}`);
  expect(real.t1.geometries).toBe(real.t3.geometries);
  expect(real.back.geometries).toBe(real.t3.geometries);
  expect(real.back.programs).toBe(real.t3.programs);
});

test('crack coverage (A5): 0 bad pixels, direct path', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_GPU);
  test.setTimeout(900_000);
  for (const tier of [3, 1]) {
    await open(page, { post: 'off', sky: 0, tier, world: 'ref' });
    for (const bend of [FLAT, FULL]) {
      for (const r of await crack(page, { chunks: CRACK_CHUNKS, frames: 300, bend })) {
        expect(r.bad).toBe(0);
        expect(r.skyShare).toBeGreaterThan(0.2);
      }
    }
  }
  await open(page, { post: 'off', sky: 0, tier: 3, world: 'fake' });
  for (const r of await crack(page, { chunks: CRACK_CHUNKS, frames: 300, bend: FLAT })) {
    expect(r.bad).toBe(0);
    expect(r.skyShare).toBeGreaterThan(0.2);
  }
});

test('crack depth (A6): 0 bad pixels with DevPost, depth and MSAA 0', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_GPU);
  test.setTimeout(900_000);
  for (const tier of [2, 1]) {
    await open(page, { sky: 0, tier, world: 'ref' });
    for (const r of await crack(page, { chunks: CRACK_CHUNKS, frames: 300, bend: FULL })) {
      expect(r.bad).toBe(0);
      expect(r.skyShare).toBeGreaterThan(0.2);
    }
  }
  await open(page, { sky: 0, tier: 2, world: 'ref' });
  for (const r of await crack(page, { chunks: [CHUNK_LIMIT - 13], frames: 300, bend: FULL })) expect(r.bad).toBe(0);
});

test('crack ramp: 0 bad pixels through a stride ramp and back, with the camera moving', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_GPU);
  test.setTimeout(300_000);
  for (const query of [{ post: 'off', sky: 0, tier: 3 }, { sky: 0, tier: 2 }] as Query[]) {
    await open(page, query);
    const r = await page.evaluate(({ to2, to1, pitch }) => {
      const s = window.__shell!;
      s.ctx.renderer.setClearColor(0xff00ff, 1);
      s.setDebugMode('crack');
      const layer = window.__terrain!.layer;
      let bad = 0;
      let frames = 0;
      let chunk = 15625000;
      let local = 0;
      const seen = new Set<number>();
      const run = (n: number): void => {
        for (let i = 0; i < n; i++) {
          local += 2.5;
          if (local >= 64) { local -= 64; chunk += 1; }
          s.frameAt(0, { at: { chunk, local }, tick: frames, palette: 0, bend: { a: 8e-5, c: -1.2e-5 }, feel: { shakeY: -pitch } });
          const px = s.pixels();
          const { width: W, height: H, triangles } = s.stats();
          seen.add(triangles);
          for (let x = 0; x < W; x++) {
            let hit = false;
            for (let row = 0; row < H; row++) {
              const at = ((H - 1 - row) * W + x) * 4;
              const mg = px[at]! > 200 && px[at + 1]! < 60 && px[at + 2]! > 200;
              if (mg && hit) bad++;
              else if (!mg) hit = true;
            }
          }
          frames++;
        }
      };
      run(2);
      layer.setQuality(to2);
      run(40);
      layer.setQuality(to1);
      run(40);
      return { bad, frames, triangles: [...seen] };
    }, { to2: fakeProfile(1), to1: fakeProfile(3), pitch: CAMERA_PITCH });
    console.log(`CRACK RAMP ${JSON.stringify(query)} ${JSON.stringify(r)}`);
    expect(r.frames).toBe(82);
    expect(r.bad).toBe(0);
    expect(r.triangles.length).toBeGreaterThanOrEqual(2);
  }
});

test('crack control (A7): the detector fails at grow 4 and at grow 3, holds at grow 2', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_GPU);
  test.setTimeout(900_000);
  expect(CRACK_CONTROL_GROW).toBe(4);
  for (const query of [{ post: 'off', sky: 0, tier: 3 }, { sky: 0, tier: 2 }] as Query[]) {
    await open(page, { ...query, grow: 4 });
    for (const r of await crack(page, { chunks: CRACK_CHUNKS, frames: 300, bend: FULL })) {
      expect(r.bad).toBeGreaterThan(100_000);
      expect(r.badFrames).toBe(300);
    }
    await saveShot(page, info, query['post'] === 'off' ? 'crack-grow4-direct' : 'crack-grow4-post');

    await open(page, { ...query, grow: 2 });
    for (const r of await crack(page, { chunks: CRACK_CHUNKS, frames: 300, bend: FULL })) expect(r.bad).toBe(0);

    await open(page, { ...query, grow: 3 });
    for (const r of await crack(page, { chunks: CRACK_CHUNKS, frames: 300, bend: FULL })) expect(r.bad).toBeGreaterThan(0);
  }
});

test('crack control runtime (A8): 0, then non-zero, then 0 on one page', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_GPU);
  test.setTimeout(300_000);
  await open(page, { post: 'off', sky: 0, tier: 3 });
  const [a] = await crack(page, { chunks: [15625000], frames: 60, bend: FULL });
  expect(a!.bad).toBe(0);
  const [b] = await crack(page, { chunks: [15625000], frames: 60, bend: FULL, grow: CRACK_CONTROL_GROW });
  expect(b!.bad).toBeGreaterThan(0);
  expect(b!.badFrames).toBe(60);
  const [c] = await crack(page, { chunks: [15625000], frames: 60, bend: FULL, grow: 0 });
  expect(c!.bad).toBe(0);
});

// ---- edge paint ----

/**
 * roll and walk are for the DI-88 row. Left out, the run is A9's: 12 frames at jumped positions, roll 0. walk: that many frames
 * stepping 2.5 u (150 u/s at 60 fps) from chunk 15625000, so level 5's 128 u row phase is swept and a one-frame far-edge flash
 * would be counted. redFrames counts frames with any red pixel.
 */
interface EdgeArgs { bend: Bend; camX: number; fovDeg: number; fogEnd?: number; roll?: number; walk?: number }
interface EdgeResult { red: number; redFrames: number; greenMin: number; green: number; frames: number; width: number; height: number }

function edgeRun(a: EdgeArgs): EdgeResult {
  const s = window.__shell!;
  s.ctx.renderer.setClearColor(0xff00ff, 1);
  s.setDebugMode('edge-paint');
  const fog = s.ctx.shared.uFog.value;
  const fogEnd = fog[1]!;
  if (a.fogEnd !== undefined) fog[1] = a.fogEnd;
  let red = 0;
  let redFrames = 0;
  let green = 0;
  let greenMin = Infinity;
  let W = 0;
  let H = 0;
  const n = a.walk ?? 12;
  let chunk = 15625000;
  let local = 0;
  for (let i = 0; i < n; i++) {
    if (a.walk !== undefined) {
      local += 2.5;
      if (local >= 64) { local -= 64; chunk += 1; }
    }
    const at = a.walk !== undefined ? { chunk, local } : { chunk: 3 + i * 97, local: (i * 5.3) % 64 };
    s.frameAt(0, { at, tick: i, palette: 0, bend: a.bend, camX: a.camX, feel: { fovDeg: a.fovDeg, roll: a.roll ?? 0 } });
    const px = s.pixels();
    let g = 0;
    let r = 0;
    for (let p = 0; p < px.length; p += 4) {
      const R = px[p]!, G = px[p + 1]!, B = px[p + 2]!;
      if (R > 200 && G < 60 && B < 60) r++;
      else if (G > 200 && R < 60) g++;
    }
    red += r;
    if (r > 0) redFrames++;
    green += g;
    if (g < greenMin) greenMin = g;
    const st = s.stats();
    W = st.width;
    H = st.height;
  }
  fog[1] = fogEnd;
  return { red, redFrames, green, greenMin, frames: n, width: W, height: H };
}

test('edge paint (A9, A9b, A10): every boundary cell is fully fogged, and lengthening the fog fails', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_GPU);
  test.setTimeout(300_000);
  const query: Query = { tier: 4, post: 'off', sky: 0 };
  await page.setViewportSize({ width: 2520, height: 1080 });
  await open(page, query);
  const a0 = { a: 8e-5, c: 0 };
  const rows: readonly (readonly [string, EdgeArgs])[] = [
    ['(8e-5, 0) cam 0', { bend: a0, camX: 0, fovDeg: 68 }],
    ['(8e-5, 0) cam -28.8', { bend: a0, camX: -28.8, fovDeg: 68 }],
    ['(-8e-5, 0) cam 28.8', { bend: { a: -8e-5, c: 0 }, camX: 28.8, fovDeg: 68 }],
    ['(8e-5, -1.2e-5) cam -28.8', { bend: FULL, camX: -28.8, fovDeg: 68 }],
  ];
  for (const [label, args] of rows) {
    const r = await page.evaluate(edgeRun, args);
    console.log(`EDGE 21:9 ${label} ${JSON.stringify(r)}`);
    expect(r.width).toBe(2520);
    expect(r.red).toBe(0);
    expect(r.greenMin).toBeGreaterThanOrEqual(1000);
    if (label.startsWith('(8e-5, -1.2e-5)')) await saveShot(page, info, 'edge-paint-21x9');
  }
  // A10: the same frames with a longer fog must show red, down to about 100 u.
  for (const fogEnd of [4600, 4400]) {
    const r = await page.evaluate(edgeRun, { bend: a0, camX: -28.8, fovDeg: 68, fogEnd });
    console.log(`EDGE control FOG_END ${fogEnd} ${JSON.stringify(r)}`);
    expect(r.red).toBeGreaterThan(0);
    if (fogEnd === 4600) await saveShot(page, info, 'edge-paint-fog4600');
  }

  await page.setViewportSize({ width: 1920, height: 1080 });
  await open(page, { tier: 3, post: 'off', sky: 0 });
  const r169 = await page.evaluate(edgeRun, { bend: FLAT, camX: 0, fovDeg: 58 });
  console.log(`EDGE 16:9 ${JSON.stringify(r169)}`);
  expect(r169.red).toBe(0);
  expect(r169.greenMin).toBeGreaterThanOrEqual(1000);

  // A9b: wider than 21:9 the cap must reduce the FOV, so the same request stays bounded.
  await page.setViewportSize({ width: 3840, height: 1080 });
  await open(page, query);
  const r329 = await page.evaluate(edgeRun, { bend: a0, camX: 0, fovDeg: 68 });
  const cam = await page.evaluate(() => {
    const c = window.__shell!.ctx.camera;
    return { fov: c.fov, aspect: c.aspect };
  });
  console.log(`EDGE 32:9 ${JSON.stringify(r329)} ${JSON.stringify(cam)}`);
  expect(r329.red).toBe(0);
  expect(Math.tan((cam.fov / 2) * Math.PI / 180) * cam.aspect).toBeCloseTo(1.574, 3);
});

// ---- DI-88: the follow wall at 16:9 and 16:10 ----

/**
 * DI-88's follow gain (section 6.1), as tests/unit/terrain/fogbound.test.ts computes it: .793 at 16:9, .8176 at 16:10. T05's
 * ship half sizes, 1.6 wide and 2.2 long, are written in, since this spec imports neither src/render/props nor src/app.
 */
function followGain(aspect: number): number {
  const halfTan = Math.tan((CAMERA_FOV / 2) * Math.PI / 180) * aspect;
  return Math.max(0.72, 1 - (0.85 * halfTan * (SHIP_FORWARD - 2.2) - 1.6) / PLAY_HALF_X);
}

/** Name, viewport, and a control camera x at which the boundary cell's inner edge enters under FOG_END (fogbound.test.ts: 4244.3, 4251.5). */
const WALL_SHAPES = [['16:9', 1920, 1080, 300], ['16:10', 1728, 1080, 400]] as const;
/** BANK_ROLL_MAX plus SHAKE_ROLL_MAX (src/feel/tuning.ts, read): the most roll feel can give at the wall. */
const WALL_ROLL = 0.07;

test('edge paint at the follow wall (A9c, DI-88): 16:9 and 16:10 at their own gain, FOV 68, full bend, and a camera x that fails', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_GPU);
  test.setTimeout(600_000);
  const right = { a: 8e-5, c: 0 };
  const left = { a: -8e-5, c: 0 };
  for (const [name, w, h, control] of WALL_SHAPES) {
    await page.setViewportSize({ width: w, height: h });
    await open(page, { tier: 3, post: 'off', sky: 0 });
    const wallX = followGain(w / h) * PLAY_HALF_X;
    const fovDeg = CAMERA_FOV_MAX;
    const rows: readonly (readonly [string, EdgeArgs])[] = [
      ['(8e-5, 0) cam -wall', { bend: right, camX: -wallX, fovDeg }],
      ['(-8e-5, 0) cam +wall', { bend: left, camX: wallX, fovDeg }],
      ['(8e-5, -1.2e-5) cam -wall', { bend: FULL, camX: -wallX, fovDeg }],
      ['(-8e-5, 1.2e-5) cam +wall', { bend: LEFT, camX: wallX, fovDeg }],
      ['(8e-5, 0) cam -wall roll +.07', { bend: right, camX: -wallX, fovDeg, roll: WALL_ROLL }],
      ['(8e-5, 0) cam -wall roll -.07', { bend: right, camX: -wallX, fovDeg, roll: -WALL_ROLL }],
      ['(8e-5, -1.2e-5) cam -wall walk', { bend: FULL, camX: -wallX, fovDeg, walk: 300 }],
      ['(-8e-5, 1.2e-5) cam +wall walk', { bend: LEFT, camX: wallX, fovDeg, walk: 300 }],
    ];
    for (const [label, args] of rows) {
      const r = await page.evaluate(edgeRun, args);
      const cam = await page.evaluate(() => {
        const c = window.__shell!.ctx.camera;
        return { fov: c.fov, aspect: c.aspect, x: c.position.x, roll: c.rotation.z };
      });
      console.log(`EDGE DI-88 ${name} ${label} gain ${followGain(w / h).toFixed(4)} ${JSON.stringify(r)} ${JSON.stringify(cam)}`);
      expect(cam.fov).toBe(CAMERA_FOV_MAX);
      expect(cam.aspect).toBeCloseTo(w / h, 6);
      expect(cam.x).toBeCloseTo(args.camX, 6);
      expect(r.width).toBe(w);
      expect(r.red).toBe(0);
      expect(r.greenMin).toBeGreaterThanOrEqual(1000);
    }
    await saveShot(page, info, `edge-paint-wall-${name.replace(':', 'x')}`);
    // Control: the same frames at a camera x the arithmetic puts under FOG_END must show red, on both sides.
    for (const [label, args] of [
      [`(8e-5, 0) cam -${control}`, { bend: right, camX: -control, fovDeg }],
      [`(-8e-5, 0) cam +${control}`, { bend: left, camX: control, fovDeg }],
    ] as const) {
      const r = await page.evaluate(edgeRun, args);
      console.log(`EDGE DI-88 control ${name} ${label} ${JSON.stringify(r)}`);
      expect(r.red).toBeGreaterThan(0);
    }
    await saveShot(page, info, `edge-paint-control-${name.replace(':', 'x')}`);
  }
});

test('crack at the follow wall (A9c, DI-88): 0 bad pixels at 16:9 and 16:10, FOV 68, full bend, wall camera x', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_GPU);
  test.setTimeout(900_000);
  for (const [name, w, h] of WALL_SHAPES) {
    await page.setViewportSize({ width: w, height: h });
    const wallX = followGain(w / h) * PLAY_HALF_X;
    // The direct path proves coverage at both shapes; at 16:9 the depth path (DevPost, tier 2, MSAA 0) as A6 does.
    const paths: Query[] = name === '16:9' ? [{ post: 'off', sky: 0, tier: 3 }, { sky: 0, tier: 2 }] : [{ post: 'off', sky: 0, tier: 3 }];
    for (const query of paths) {
      await open(page, query);
      for (const [bend, camX] of [[FULL, -wallX], [LEFT, wallX]] as const) {
        for (const r of await crack(page, { chunks: CRACK_CHUNKS, frames: 300, bend, camX, fovDeg: CAMERA_FOV_MAX })) {
          console.log(`CRACK DI-88 ${name} camX ${camX.toFixed(2)} ${JSON.stringify(r)}`);
          expect(r.bad).toBe(0);
          expect(r.skyShare).toBeGreaterThan(0.2);
          expect(r.width / r.height).toBeCloseTo(w / h, 2);
        }
      }
      if (query['post'] === 'off') await saveShot(page, info, `crack-wall-${name.replace(':', 'x')}`);
    }
  }
  // Control at the 16:9 wall pose: holes grown by CRACK_CONTROL_GROW must fail in every frame, on both sides.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await open(page, { post: 'off', sky: 0, tier: 3, grow: CRACK_CONTROL_GROW });
  const wall169 = followGain(16 / 9) * PLAY_HALF_X;
  for (const [bend, camX] of [[FULL, -wall169], [LEFT, wall169]] as const) {
    const [r] = await crack(page, { chunks: [15625000], frames: 60, bend, camX, fovDeg: CAMERA_FOV_MAX });
    console.log(`CRACK DI-88 control grow ${CRACK_CONTROL_GROW} camX ${camX.toFixed(2)} ${JSON.stringify(r)}`);
    expect(r!.bad).toBeGreaterThan(0);
    expect(r!.badFrames).toBe(60);
  }
  await saveShot(page, info, 'crack-wall-control-grow4');
});

// ---- the look ----

test('look distances (A11): the same picture at every distance', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_GPU);
  test.setTimeout(300_000);
  await open(page, { world: 'ref', tier: 3 });
  for (const [name, chunk] of DIST_CHUNKS) {
    await renderOnly(page, { chunk, local: 20, tick: 504, bend: FLAT });
    await saveShot(page, info, `${name}-flat`);
    await clipShot(page, info, `${name}-flat-near`, CROP_NEAR);
    await clipShot(page, info, `${name}-flat-mid`, CROP_MID);
    await clipShot(page, info, `${name}-flat-far`, CROP_FAR);
    await renderOnly(page, { chunk, local: 20, tick: 504, bend: RIGHT });
    await saveShot(page, info, `${name}-right`);
    await clipShot(page, info, `${name}-right-far`, CROP_FAR);
    await clipShot(page, info, `${name}-right-horizon`, CROP_HORIZON);
    await renderOnly(page, { chunk, local: 20, tick: 504, bend: LEFT });
    await saveShot(page, info, `${name}-left`);
    await clipShot(page, info, `${name}-left-far`, CROP_FAR);
  }
});

test('look worlds and palettes (A11)', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_GPU);
  test.setTimeout(300_000);
  await open(page, { world: 'fake', tier: 3 });
  await renderOnly(page, { chunk: 3, local: 20, tick: 504, bend: FLAT });
  await saveShot(page, info, 'fake');

  await open(page, { world: 'ref', tier: 3 });
  for (let palette = 0; palette <= 5; palette++) {
    await renderOnly(page, { chunk: 40, local: 20, tick: 504, palette, bend: MID_BEND });
    await saveShot(page, info, `pal${palette}`);
  }

  await open(page, { world: 'ref', rise: 180, tier: 3 });
  await renderOnly(page, { chunk: 40, local: 20, tick: 504, bend: FLAT });
  await saveShot(page, info, 'canyon');
});

test('look shapes (A11): wide and portrait', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_GPU);
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 2520, height: 1080 });
  await open(page, { world: 'ref', tier: 4 });
  await renderOnly(page, { chunk: 40, local: 20, tick: 504, bend: { a: 8e-5, c: 0 }, fovDeg: 68, camX: -28.8 });
  await saveShot(page, info, 'wide');

  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, { world: 'ref', tier: 2 });
  await renderOnly(page, { chunk: 40, local: 20, tick: 504, bend: MID_BEND });
  await saveShot(page, info, 'portrait');
});

test('look motion (A11): far crops 1.33 u apart, and pulses over the bar', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_GPU);
  test.setTimeout(180_000);
  await open(page, { world: 'ref', tier: 3 });
  for (let i = 0; i < 6; i++) {
    await renderOnly(page, { chunk: 40, local: 20 + i * 1.33, tick: 504, bend: FLAT });
    await clipShot(page, info, `seq${i}`, CROP_FAR);
  }
  for (let i = 0; i < 4; i++) {
    await renderOnly(page, { chunk: 40, local: 20, tick: i * 72, bend: FLAT });
    await saveShot(page, info, `pulse${i}`);
  }
});

test('look real world (M9): T01 through this layer, once its file exists', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_GPU);
  test.skip(!existsSync('src/world/index.ts'), 'T01 has not landed');
  test.setTimeout(600_000);
  await open(page, { world: 'real', tier: 3 });
  for (const chunk of [50, 150, 250, 350, 450, 550, 15625000000000]) {
    // The world's own zone, palette and bend, so this is what T10 will show.
    await page.evaluate((c) => { window.__shell!.frameAt(0, { at: { chunk: c, local: 20 }, tick: 504 }); }, chunk);
    await saveShot(page, info, `real-${chunk}`);
  }
  await open(page, { world: 'real', post: 'off', sky: 0, tier: 3 });
  for (const r of await crack(page, { chunks: [50, 350, 15625000000000], frames: 120, bend: FULL })) expect(r.bad).toBe(0);
  await open(page, { world: 'real', sky: 0, tier: 1 });
  for (const r of await crack(page, { chunks: [50, 350, 15625000000000], frames: 120, bend: FULL })) expect(r.bad).toBe(0);
  await open(page, { world: 'real', period: 1024, post: 'off', tier: 3 });
  const chunks = [1024 * 3, 1024 * 977, 1024 * 15258789062];
  const id = await page.evaluate(identityRun, { chunks, local: 13.25, tick: 504, bend: FULL });
  console.log(`REAL identity ${JSON.stringify(id)}`);
  expect(id.selfBytes).toBe(0);
  for (const d of id.diffs) expect(d.bytes).toBe(0);
});

function silhouetteStd(chunk: number): number {
  const s = window.__shell!;
  s.ctx.renderer.setClearColor(0xff00ff, 1);
  s.setDebugMode('crack');
  s.frameAt(0, { at: { chunk, local: 20 }, tick: 504, palette: 0, bend: { a: 0, c: 0 } });
  const px = s.pixels();
  const { width: W, height: H } = s.stats();
  let sum = 0;
  let sq = 0;
  for (let x = 0; x < W; x++) {
    let first = H;
    for (let row = 0; row < H; row++) {
      const at = ((H - 1 - row) * W + x) * 4;
      if (!(px[at]! > 200 && px[at + 1]! < 60 && px[at + 2]! > 200)) { first = row; break; }
    }
    sum += first;
    sq += first * first;
  }
  return Math.sqrt(Math.max(sq / W - (sum / W) ** 2, 0));
}

test('look non-flat (A11): silhouette varies at every distance, and not on the flat world', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_GPU);
  test.setTimeout(120_000);
  await open(page, { world: 'ref', post: 'off', sky: 0, tier: 3 });
  for (const [name, chunk] of DIST_CHUNKS) {
    const std = await page.evaluate(silhouetteStd, chunk);
    console.log(`SILHOUETTE ${name} std ${std.toFixed(2)}`);
    expect(std).toBeGreaterThan(10);
  }
  await open(page, { world: 'flat', post: 'off', sky: 0, tier: 3 });
  const flat = await page.evaluate(silhouetteStd, 3);
  console.log(`SILHOUETTE flat world std ${flat.toFixed(2)}`);
  expect(flat).toBeLessThan(1);
});

// ---- far grid ----

interface RowStat { row: number; mean: number; std: number }

function gridRows(): RowStat[] {
  const s = window.__shell!;
  s.frameAt(0, { at: { chunk: 40, local: 20 }, tick: 504, palette: 0, bend: { a: 0, c: 0 } });
  const px = s.pixels();
  const { width: W, height: H } = s.stats();
  const out: RowStat[] = [];
  for (let row = 591; row <= 598; row++) {
    let sum = 0;
    let sq = 0;
    let n = 0;
    for (let x = 660; x <= 1259; x++) {
      const v = px[((H - 1 - row) * W + x) * 4]! / 255;
      sum += v;
      sq += v * v;
      n++;
    }
    out.push({ row, mean: sum / n, std: Math.sqrt(Math.max(sq / n - (sum / n) ** 2, 0)) });
  }
  return out;
}

/** The pristine band of A12: mean coverage within .01 of 1 - .96^2 and row std at most .04. */
function inPristineBand(r: RowStat): boolean {
  return r.mean >= 0.0684 && r.mean <= 0.0884 && r.std <= 0.04;
}

test('far grid rows (A12): the floor\'s grid converges to coverage, and the three bad variants do not', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_GPU);
  test.setTimeout(120_000);
  const run = async (probe: string): Promise<RowStat[]> => {
    await open(page, { post: 'off', sky: 0, tier: 3, probe });
    const rows = await page.evaluate(gridRows);
    console.log(`GRID ${probe} ${rows.map((r) => `${r.row}:${r.mean.toFixed(4)}/${r.std.toFixed(4)}`).join(' ')}`);
    return rows;
  };
  // 'pristine' runs the production gridLines from grid.glsl, the same text terrain.frag.glsl draws with.
  for (const r of await run('pristine')) {
    expect(r.mean).toBeGreaterThanOrEqual(0.0684);
    expect(r.mean).toBeLessThanOrEqual(0.0884);
    expect(r.std).toBeLessThanOrEqual(0.04);
  }
  expect(Math.max(...(await run('hard-step')).map((r) => r.std))).toBeGreaterThan(0.15);
  expect(Math.max(...(await run('unfaded')).map((r) => r.mean))).toBeGreaterThan(0.15);
  // The faithful bug, pristineLines with derivatives taken after fract: at least one row must leave the pristine band.
  const afterFract = await run('after-fract');
  console.log(`GRID after-fract rows outside the pristine band: ${afterFract.filter((r) => !inPristineBand(r)).length} of ${afterFract.length}`);
  expect(afterFract.some((r) => !inPristineBand(r))).toBe(true);
});

test('hdr (A13): finite, far lines under the bloom threshold, near lines over 1', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_GPU);
  test.setTimeout(120_000);
  await open(page, { world: 'ref', tier: 3 });
  for (const bend of [FLAT, FULL]) {
    const rects: HdrRect[] = [
      { name: 'far', x0: 200, x1: 700, y0: 592, y1: 601 },
      { name: 'column', x0: 860, x1: 1060, y0: 592, y1: 601 },
      { name: 'near', x0: 0, x1: 1920, y0: 800, y1: 1001 },
    ];
    const r: HdrStats = await page.evaluate(({ b, rs }) => {
      const s = window.__shell!;
      s.frameAt(0, { at: { chunk: 40, local: 20 }, tick: 504, palette: 0, bend: b });
      return window.__terrain!.readHdr(s.ctx, rs);
    }, { b: bend, rs: rects });
    console.log(`HDR bend ${bend.a} ${JSON.stringify(r)}`);
    expect(r.nonFinite).toBe(0);
    expect(r.negative).toBe(0);
    expect(r.regions[0]!.maxL).toBeLessThan(0.95);
    expect(r.regions[2]!.maxL).toBeGreaterThan(1);
  }
});

interface ShimmerArgs { chunk: number; pairs: number; step: number; bands: readonly (readonly [number, number])[] }

/** Tick held fixed, or it also measures anything that animates (T09 M5). local advances through chunk, so nothing jumps. */
function shimmerRun(a: ShimmerArgs): number[] {
  const s = window.__shell!;
  const sums = a.bands.map(() => 0);
  let chunk = a.chunk;
  let local = 20;
  let prev: Uint8Array | null = null;
  const { width: W, height: H } = s.stats();
  for (let i = 0; i <= a.pairs; i++) {
    s.frameAt(0, { at: { chunk, local }, tick: 504, palette: 0, bend: { a: 0, c: 0 } });
    const px = s.pixels();
    if (prev) {
      a.bands.forEach((band, b) => {
        let d = 0;
        for (let row = band[0]; row < band[1]; row++) {
          const from = (H - 1 - row) * W * 4;
          for (let at = from; at < from + W * 4; at += 4) {
            d += Math.abs(px[at]! - prev![at]!) + Math.abs(px[at + 1]! - prev![at + 1]!) + Math.abs(px[at + 2]! - prev![at + 2]!);
          }
        }
        sums[b]! += d / ((band[1] - band[0]) * W * 3);
      });
    }
    prev = px;
    local += a.step;
    if (local >= 64) { local -= 64; chunk += 1; }
  }
  return sums.map((v) => v / a.pairs);
}

test('shimmer (A14): filtered at most 8, distance within 1.25x, naive over 8', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_GPU);
  test.setTimeout(300_000);
  const bands = [[615, 650], [592, 615], [650, 720], [720, 1080], [440, 590]] as const;
  const run = (chunk: number): Promise<number[]> => page.evaluate(shimmerRun, { chunk, pairs: 60, step: 1.17, bands });
  await open(page, { world: 'ref', tier: 3 });
  const world0 = await run(3);
  console.log(`SHIMMER world 0 bands ${JSON.stringify(bands)} ${world0.map((v) => v.toFixed(2)).join(' ')}`);
  expect(world0[0]).toBeLessThanOrEqual(8);
  for (const [label, chunk] of [['1e9', 15625000], ['1e12', 15625000000], ['1e15', 15625000000000]] as const) {
    const r = await run(chunk);
    console.log(`SHIMMER ${label} ${r.map((v) => v.toFixed(2)).join(' ')}`);
    expect(r[0]).toBeLessThanOrEqual(world0[0]! * 1.25);
  }
  await open(page, { world: 'ref', tier: 3, grid: 'naive' });
  const naive = await run(3);
  console.log(`SHIMMER naive ${naive.map((v) => v.toFixed(2)).join(' ')}`);
  expect(naive[0]).toBeGreaterThan(8);
});

// ---- the T = 4096 rule (A26) ----

interface WrapPairSpec { name: string; chunk: number; at: number }
interface WrapArgs { h: number; bend: Bend; pairs: readonly WrapPairSpec[] }
interface WrapPairResult { name: string; d: number[] }

/**
 * Each pair is two frames h u apart, straddling travel chunk * 64 + at, at one fixed tick, so position is the only change. Returns
 * the mean absolute difference per channel over the frame, read in the same task as the render. The first state renders four
 * times: the first is a jump, which rebuilds, so the compared step streams as a moving camera does.
 */
function wrapRun(a: WrapArgs): WrapPairResult[] {
  const s = window.__shell!;
  s.setManual(true);
  const render = (chunk: number, t: number): Uint8Array => {
    const n = Math.floor(t / 64);
    s.frameAt(0, { at: { chunk: chunk + n, local: t - n * 64 }, tick: 504, palette: 0, bend: a.bend });
    return s.pixels();
  };
  const out: WrapPairResult[] = [];
  for (const p of a.pairs) {
    const t0 = p.at - a.h / 2;
    for (let i = 0; i < 3; i++) render(p.chunk, t0);
    const before = render(p.chunk, t0);
    const after = render(p.chunk, t0 + a.h);
    let dr = 0, dg = 0, db = 0;
    for (let i = 0; i < before.length; i += 4) {
      dr += Math.abs(after[i]! - before[i]!);
      dg += Math.abs(after[i + 1]! - before[i + 1]!);
      db += Math.abs(after[i + 2]! - before[i + 2]!);
    }
    const px = before.length / 4;
    out.push({ name: p.name, d: [dr / px, dg / px, db / px] });
  }
  return out;
}

const WRAP_H = 0.05;
const WRAP_C15 = 15625000000000;   // 1e15 u, a multiple of 64 chunks, so travel mod 4096 is 0 there
/**
 * Level k's grid snaps every 2 s_k u (4, 8, 16, 32, 64, 128), and each snap changes a few far pixels by itself (section 10), so a
 * step across a chunk boundary is compared with a step that carries the same snaps, not with its neighbours. Local 32 snaps levels
 * 0 to 3. A boundary into an odd chunk adds level 4 and wraps uTravel.x; one into an even chunk adds level 5; one into a multiple of
 * 64 chunks also wraps uTravel.y. Three sites: chunk 40, the first 4096 wrap, and 1e15 u.
 */
const WRAP_PAIRS: readonly WrapPairSpec[] = [
  { name: 'c40 l32', chunk: 40, at: 32 }, { name: 'c40|41', chunk: 40, at: 64 }, { name: 'c41|42', chunk: 41, at: 64 },
  { name: 'c62 l32', chunk: 62, at: 32 }, { name: 'c62|63', chunk: 62, at: 64 }, { name: 'c61|62', chunk: 61, at: 64 }, { name: 'c63|64', chunk: 63, at: 64 },
  { name: 'e15-2 l32', chunk: WRAP_C15 - 2, at: 32 }, { name: 'e15-2|-1', chunk: WRAP_C15 - 2, at: 64 },
  { name: 'e15-3|-2', chunk: WRAP_C15 - 3, at: 64 }, { name: 'e15-1|0', chunk: WRAP_C15 - 1, at: 64 },
  { name: 'c40 l2', chunk: 40, at: 2 },   // no snap and no wrap, for the record
];
/**
 * [pair, reference], gated. uTravel.x wraps at every chunk boundary alike, so an odd boundary against local 32 of its chunk tests it,
 * with only level 4's snap between them. uTravel.y wraps only at a 4096 boundary, so one against the even boundary beside it, which
 * carries the same six snaps and uTravel.x's wrap, tests uTravel.y alone.
 */
const WRAP_GATES = [
  ['c40|41', 'c40 l32'], ['c62|63', 'c62 l32'], ['e15-2|-1', 'e15-2 l32'],
  ['c63|64', 'c61|62'], ['e15-1|0', 'e15-3|-2'],
] as const;
/** For the record only: an even or 4096 boundary against local 32 differs by the snaps of levels 4 and 5 as well. */
const WRAP_NOTED = [['c41|42', 'c40 l32'], ['c61|62', 'c62 l32'], ['c63|64', 'c62 l32'], ['e15-1|0', 'e15-2 l32']] as const;
/** [A] The worst channel's ratio to its reference, set from the probes and first runs in plan section 9. */
const WRAP_LIMIT = 1.5;

function wrapRatios(r: readonly WrapPairResult[], gates: readonly (readonly [string, string])[] = WRAP_GATES): { pair: string; ref: string; ratio: number; refMin: number }[] {
  const by = new Map(r.map((x) => [x.name, x.d]));
  return gates.map(([pair, ref]) => {
    const p = by.get(pair)!, q = by.get(ref)!;
    return { pair, ref, ratio: Math.max(p[0]! / q[0]!, p[1]! / q[1]!, p[2]! / q[2]!), refMin: Math.min(...q) };
  });
}

async function wrapSite(page: Page, label: string, bend: Bend): Promise<{ pair: string; ref: string; ratio: number; refMin: number }[]> {
  const r = await page.evaluate(wrapRun, { h: WRAP_H, bend, pairs: WRAP_PAIRS });
  for (const x of r) console.log(`WRAP ${label} bend ${bend.a} ${x.name} RGB ${x.d.map((v) => v.toFixed(4)).join(' ')}`);
  const g = wrapRatios(r);
  console.log(`WRAP ${label} bend ${bend.a} ratios ${g.map((x) => `${x.pair}/${x.ref} ${x.ratio.toFixed(3)}`).join(', ')}`);
  console.log(`WRAP ${label} bend ${bend.a} noted ${wrapRatios(r, WRAP_NOTED).map((x) => `${x.pair}/${x.ref} ${x.ratio.toFixed(3)}`).join(', ')}`);
  return g;
}

test('wrap (A26): frame pairs across a chunk boundary and the 4096 wrap change no more than a step with the same snaps', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_GPU);
  test.setTimeout(240_000);
  // The floor's own patterns (grid 8 and 64, dashes 16, pulses 512, ripple 4096 / k) on the flat world, where nothing else moves
  // with travel, and on ref height. Post off and the stand-in sky, which does not read travel; palette 0, whose accent carries the
  // pulses in green while the grid is red and blue.
  for (const world of ['flat', 'ref']) {
    await open(page, { world, tier: 3, post: 'off' });
    for (const bend of [FLAT, FULL]) {
      for (const g of await wrapSite(page, world, bend)) {
        expect(g.refMin, `${world} ${g.ref} is not a vacuous reference`).toBeGreaterThan(0.002);
        expect(g.ratio, `${world} bend ${bend.a}: ${g.pair} against ${g.ref}`).toBeLessThanOrEqual(WRAP_LIMIT);
      }
    }
  }
  // Negative controls: B11's form, which jumps at every chunk boundary, and a pulse period of 500, which jumps at each 4096 wrap only.
  const must: Record<string, readonly (readonly [string, string])[]> = {
    'wrap-64': [['c40|41', 'c40 l32'], ['c62|63', 'c62 l32'], ['e15-2|-1', 'e15-2 l32']],
    'wrap-4096': [['c63|64', 'c61|62'], ['e15-1|0', 'e15-3|-2']],
  };
  for (const world of ['flat', 'ref']) {
    for (const fault of ['wrap-64', 'wrap-4096'] as const) {
      await open(page, { world, tier: 3, post: 'off', fault });
      for (const bend of [FLAT, FULL]) {
        const g = await wrapSite(page, `${world} fault ${fault}`, bend);
        for (const [pair, ref] of must[fault]!) {
          const x = g.find((y) => y.pair === pair && y.ref === ref)!;
          expect(x.ratio, `control ${fault}, ${world} bend ${bend.a}: ${pair} against ${ref}`).toBeGreaterThan(WRAP_LIMIT);
        }
      }
    }
  }
});

// ---- exactness ----

interface IdentityArgs { chunks: readonly number[]; local: number; tick: number; bend: Bend; control?: number }
interface IdentityResult { lit: number; selfBytes: number; diffs: { chunk: number; bytes: number; maxDelta: number; first: string }[]; control: number }

function identityRun(a: IdentityArgs): IdentityResult {
  const s = window.__shell!;
  const at = (chunk: number, local: number) => ({ at: { chunk, local }, tick: a.tick, palette: 0, bend: a.bend });
  // A frame can differ from itself by one level at a few fixed pixels for about 2 s after a load (plan section 10). Rendering through
  // that window, as T09's settle does, leaves one try and 0 bytes meaningful. It changes when the reference is taken, not what must hold.
  const settledAt = performance.now();
  while (performance.now() - settledAt < 3000) s.frameAt(0, at(a.chunks[0]!, a.local));
  s.frameAt(0, at(a.chunks[0]!, a.local));
  const ref = s.pixels();
  let lit = 0;
  for (let i = 0; i < ref.length; i += 4) if (ref[i]! + ref[i + 1]! + ref[i + 2]! > 30) lit++;
  const { width: W, height: H } = s.stats();
  const compare = (px: Uint8Array): { bytes: number; maxDelta: number; first: string } => {
    let bytes = 0;
    let maxDelta = 0;
    let first = '';
    for (let i = 0; i < px.length; i++) {
      const d = Math.abs(px[i]! - ref[i]!);
      if (d > 0) {
        bytes++;
        if (d > maxDelta) maxDelta = d;
        // Column, row from the top, channel, the two values: enough to tell a stale atlas row from a stray pixel.
        if (bytes <= 8) first += `(${Math.floor(i / 4) % W},${H - 1 - Math.floor(i / 4 / W)})c${i % 4}:${px[i]}/${ref[i]} `;
      }
    }
    return { bytes, maxDelta, first };
  };
  s.frameAt(0, at(a.chunks[0]!, a.local));
  const selfBytes = compare(s.pixels()).bytes;
  const diffs = a.chunks.slice(1).map((chunk) => {
    s.frameAt(0, at(chunk, a.local));
    return { chunk, ...compare(s.pixels()) };
  });
  let control = 0;
  if (a.control !== undefined) {
    s.frameAt(0, at(a.chunks[0]!, a.control));
    control = compare(s.pixels()).bytes;
  }
  return { lit, selfBytes, diffs, control };
}

test('identity (A15): 0 bytes between frames 1e15 u apart, post off', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_GPU);
  test.setTimeout(240_000);
  const chunks = [1024 * 3, 1024 * 977, 1024 * 15259, 1024 * 976562500, 1024 * 15258789062];
  await open(page, { world: 'ref', period: 1024, post: 'off', tier: 3 });
  const r = await page.evaluate(identityRun, { chunks, local: 13.25, tick: 504, bend: FULL, control: 14.25 });
  console.log(`IDENTITY post off ${JSON.stringify(r)}`);
  expect(r.lit).toBeGreaterThan(1_000_000);
  expect(r.selfBytes).toBe(0);
  expect(r.diffs.length).toBe(4);
  for (const d of r.diffs) expect(d.bytes).toBe(0);
  expect(r.control).toBeGreaterThan(1000);

  // DI-67, DI-70 and DI-73(2): a gated same-state compare on gpu runs at MSAA 0, post on or off. The row keeps tier 3, the tier it
  // tests, and forces MSAA 0 with DevPost's forceMsaa(0), which ?msaa=0 calls before the composer is built. Switching to tier 2
  // instead (repair R2) also changed maxPixels, bloom levels and the post variant. Everything is printed before any assertion, so a
  // failing run still shows its bytes.
  await spyMsaa(page);
  await open(page, { world: 'ref', period: 1024, tier: 3, msaa: 0 });
  const onState = await page.evaluate(() => {
    const s = window.__shell!;
    const meshes = s.ctx.scene.children as Mesh<BufferGeometry, ShaderMaterial>[];
    const mirror = meshes.find((m) => m.material.uniforms['uMirror'] !== undefined)!.material.uniforms['uMirror']!.value as number;
    const { width, height } = s.stats();
    return { ...window.__terrain!.postState, mirror, width, height };
  });
  const on = await page.evaluate(identityRun, { chunks, local: 13.25, tick: 504, bend: FULL });
  const onSamples = await page.evaluate(() => [...(window.__msaaSamples ?? [])]);
  console.log(`IDENTITY post on, page ${JSON.stringify(onState)}`);
  console.log(`IDENTITY post on, MSAA 0 ${JSON.stringify(on)} multisampled buffers ${JSON.stringify(onSamples)}`);
  // State: the chain under test is tier 3's. The post stack got tier 3's profile (post 'full', bloom levels 6, maxPixels 2073600) with
  // no forced variant, the drawing buffer is tier 3's 1920x1080, and the layer has tier 3's mirror transparency.
  expect(onState.quality).toEqual(fakeProfile(3));
  expect(onState.variant).toBeNull();
  expect([onState.width, onState.height]).toEqual([1920, 1080]);
  expect(onState.mirror).toBe(1);
  // State: MSAA 0 was forced, and nothing on this page allocated a multisampled buffer, so the compare ran at MSAA 0.
  expect(onState.msaa).toBe(0);
  expect(onSamples.filter((n) => n > 0)).toEqual([]);
  expect(on.lit).toBeGreaterThan(1_000_000);
  for (const d of on.diffs) {
    expect(d.bytes).toBeLessThanOrEqual(16);
    expect(d.maxDelta).toBeLessThanOrEqual(1);
  }

  // State only, no byte compare (DI-70): tier 3's post really runs at MSAA 2, from its own profile with nothing forced.
  await open(page, { world: 'ref', period: 1024, tier: 3 });
  const t3 = await page.evaluate(() => ({ samples: [...(window.__msaaSamples ?? [])], forced: window.__terrain!.postState.msaa, msaa: window.__terrain!.postState.quality?.msaa }));
  console.log(`IDENTITY tier 3 multisampled buffers ${JSON.stringify(t3.samples)}, forced ${String(t3.forced)}, profile msaa ${String(t3.msaa)}`);
  expect(t3.forced).toBeNull();
  expect(t3.msaa).toBe(2);
  expect(t3.samples.length).toBeGreaterThan(0);
  expect(new Set(t3.samples)).toEqual(new Set([2]));
});

/** Records the sample count of every multisampled renderbuffer a page allocates, from its first script, on every navigation. */
async function spyMsaa(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const samples: number[] = [];
    window.__msaaSamples = samples;
    const proto = WebGL2RenderingContext.prototype;
    const real = proto.renderbufferStorageMultisample;
    proto.renderbufferStorageMultisample = function (this: WebGL2RenderingContext, target: GLenum, n: GLsizei, format: GLenum, w: GLsizei, h: GLsizei): void {
      samples.push(n);
      real.call(this, target, n, format, w, h);
    };
  });
}

type Step = { chunk: number; local: number };
interface WalkArgs { settle: Step; walk: readonly Step[]; hideUntilLast?: boolean }

/**
 * Renders `settle` for 3 s, then each step of `walk`, and returns the pixels of the walk's own last frame, read in the same task with no
 * re-render. The settle comes first: a frame can differ from itself by one level for about 2 s after a load (plan section 10), and a
 * settle after the walk would compare a re-render of the last state, which hides a defect a repeat repairs, such as a one-frame lag of
 * the per-level uniforms (V1-T03's M1). With `hideUntilLast`, terrain is hidden for every step but the last.
 */
function pixelsB64(a: WalkArgs): string {
  const s = window.__shell!;
  const render = (p: Step): void => {
    s.frameAt(0, { at: { chunk: p.chunk, local: p.local }, tick: 504, palette: 0, bend: { a: 8e-5, c: -1.2e-5 } });
  };
  const settledAt = performance.now();
  while (performance.now() - settledAt < 3000) render(a.settle);
  if (a.hideUntilLast) s.setLayerVisible('terrain', false);
  for (let i = 0; i < a.walk.length; i++) {
    if (a.hideUntilLast && i === a.walk.length - 1) s.setLayerVisible('terrain', true);
    render(a.walk[i]!);
  }
  const px = s.pixels();
  let bin = '';
  for (let i = 0; i < px.length; i += 0x8000) bin += String.fromCharCode(...px.subarray(i, i + 0x8000));
  return btoa(bin);
}

function differingBytes(a: string, b: string): number {
  const x = Buffer.from(a, 'base64');
  const y = Buffer.from(b, 'base64');
  expect(x.length).toBe(y.length);
  let n = 0;
  for (let i = 0; i < x.length; i++) {
    if (x[i] === y[i]) continue;
    n++;
    if (n <= 8) console.log(`DIFF byte ${i} pixel ${Math.floor(i / 4)} channel ${i % 4}: ${x[i]} vs ${y[i]}`);
  }
  return n;
}

test('warp (A17): a walked state equals a fresh page, and a stale update range does not', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_GPU);
  test.setTimeout(180_000);
  // From a running state: 10 frames at chunk 3, jump, then 40 frames at 150 u/s. Both pages settle at the walk's start state; the
  // fresh page then jumps straight to the last state, which the shell rebuilds, and the walked page streams its way there.
  const walk: Step[] = [];
  for (let i = 0; i < 10; i++) walk.push({ chunk: 3, local: i * 2.5 });
  for (let i = 0; i < 40; i++) walk.push({ chunk: 15625000 + Math.floor((i * 2.5) / 64), local: (i * 2.5) % 64 });
  const settle = walk[0]!;
  const last = walk[walk.length - 1]!;

  const query: Query = { world: 'ref', post: 'off', tier: 3 };
  await open(page, query);
  const fresh = await page.evaluate(pixelsB64, { settle, walk: [last] });
  await open(page, query);
  const clean = differingBytes(await page.evaluate(pixelsB64, { settle, walk }), fresh);
  await open(page, { ...query, fault: 'keep-ranges' });
  const stale = differingBytes(await page.evaluate(pixelsB64, { settle, walk }), fresh);
  console.log(`WARP clean ${clean} of ${Buffer.from(fresh, 'base64').length}, fault ${stale}`);
  expect(clean).toBe(0);
  expect(stale).toBeGreaterThan(1000);

  // A layer hidden for a long walk falls back to one full upload when it is shown, then streams single rows again. The shown frame is
  // the walk's last, compared with no re-render.
  const hiddenWalk: Step[] = [];
  for (let i = 0; i < 300; i++) hiddenWalk.push({ chunk: 15625000 + Math.floor((i * 2.5) / 64), local: (i * 2.5) % 64 });
  const hiddenLast = hiddenWalk[hiddenWalk.length - 1]!;
  await open(page, query);
  const hiddenFresh = await page.evaluate(pixelsB64, { settle, walk: [hiddenLast] });
  await open(page, query);
  const hiddenDiff = differingBytes(await page.evaluate(pixelsB64, { settle, walk: hiddenWalk, hideUntilLast: true }), hiddenFresh);
  const ranges = await page.evaluate(() => {
    const meshes = window.__shell!.ctx.scene.children as Mesh<BufferGeometry, ShaderMaterial>[];
    const terrain = meshes.find((m) => m.material.uniforms['uH'] !== undefined)!;
    return (terrain.material.uniforms['uH']!.value as { updateRanges: unknown[] }).updateRanges.length;
  });
  console.log(`WARP hidden ${hiddenDiff} bytes, pending ranges after the render ${ranges}`);
  expect(hiddenDiff).toBe(0);
  expect(ranges).toBe(0);
});

/** The terrain atlas's pending update ranges, after the last render. */
function pendingRanges(): number {
  const meshes = window.__shell!.ctx.scene.children as Mesh<BufferGeometry, ShaderMaterial>[];
  const terrain = meshes.find((m) => m.material.uniforms['uH'] !== undefined)!;
  return (terrain.material.uniforms['uH']!.value as { updateRanges: unknown[] }).updateRanges.length;
}

/**
 * Settles at `start`, loses and restores the context, rebuilds at `start` as section 10.2 step 1 does, then renders `next`, which crosses
 * rows, as the restored context's first render. Returns that frame's pixels, read in the same task. A render between the rebuild and
 * `next` would upload the whole atlas and hide the defect this tests, so the new context gets 3 s with no render instead of a settle.
 */
async function restoreThenStep(a: { start: Step; next: Step }): Promise<string> {
  const s = window.__shell!;
  const render = (p: Step): void => {
    s.frameAt(0, { at: { chunk: p.chunk, local: p.local }, tick: 504, palette: 0, bend: { a: 8e-5, c: -1.2e-5 } });
  };
  const settledAt = performance.now();
  while (performance.now() - settledAt < 3000) render(a.start);
  const canvas = s.ctx.renderer.domElement;
  const lost = new Promise((resolve) => canvas.addEventListener('webglcontextlost', resolve, { once: true }));
  const restored = new Promise((resolve) => canvas.addEventListener('webglcontextrestored', resolve, { once: true }));
  const ext = s.ctx.renderer.getContext().getExtension('WEBGL_lose_context')!;
  ext.loseContext();
  await lost;
  // Yield a task: restoring inside the loss event is ignored (section 11.3).
  await new Promise((resolve) => setTimeout(resolve, 0));
  ext.restoreContext();
  await restored;
  await new Promise((resolve) => setTimeout(resolve, 0));
  s.rebuild();
  const waitedAt = performance.now();
  while (performance.now() - waitedAt < 3000) { /* no render, see above */ }
  render(a.next);
  const px = s.pixels();
  let bin = '';
  for (let i = 0; i < px.length; i += 0x8000) bin += String.fromCharCode(...px.subarray(i, i + 0x8000));
  return btoa(bin);
}

test('rebuild then stream (A17b): rows crossed after a rebuild and before the next render still get the whole atlas', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_GPU);
  test.setTimeout(180_000);
  // three 0.187 uploads only the listed rows when updateRanges is not empty, so a range added after a rebuild's full-upload request
  // would leave the rest of the GPU atlas stale (repair R2, V2-T03's finding). Each case compares the frame with a fresh page.
  const query: Query = { world: 'ref', post: 'off', tier: 3 };

  // Hidden: the jump rebuilds terrain while it is hidden, so the full upload waits for the first shown render, and 10 steps of 2.5 u
  // stream rows before it. The last step is shown and compared with no re-render.
  const settle = { chunk: 3, local: 0 };
  const walk: Step[] = [];
  for (let i = 0; i <= 10; i++) walk.push({ chunk: 15625000, local: i * 2.5 });
  const last = walk[walk.length - 1]!;
  await open(page, query);
  const fresh = await page.evaluate(pixelsB64, { settle, walk: [last] });
  await open(page, query);
  const hidden = differingBytes(await page.evaluate(pixelsB64, { settle, walk, hideUntilLast: true }), fresh);
  const ranges = await page.evaluate(pendingRanges);
  // The negative control: a stale range kept by the rebuild must show in the same compare.
  await open(page, { ...query, fault: 'keep-ranges' });
  const stale = differingBytes(await page.evaluate(pixelsB64, { settle, walk, hideUntilLast: true }), fresh);

  // Restore: section 10.2 rebuilds in the restored handler, and the next frame may cross rows before the new context's first render.
  const start = { chunk: 40, local: 23 };
  const next = { chunk: 40, local: 25.5 };
  await open(page, query);
  const freshStep = await page.evaluate(pixelsB64, { settle: start, walk: [next] });
  await open(page, query);
  const restored = differingBytes(await page.evaluate(restoreThenStep, { start, next }), freshStep);
  const restoredRanges = await page.evaluate(pendingRanges);

  console.log(`REBUILD-STREAM hidden ${hidden} of ${Buffer.from(fresh, 'base64').length}, ranges ${ranges}, fault ${stale}; restore ${restored}, ranges ${restoredRanges}`);
  expect(hidden).toBe(0);
  expect(ranges).toBe(0);
  expect(stale).toBeGreaterThan(1000);
  expect(restored).toBe(0);
  expect(restoredRanges).toBe(0);
});

test('context (A19): restored and rebuilt, 0 bytes with post off', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_GPU);
  test.setTimeout(120_000);
  await open(page, { world: 'ref', post: 'off', tier: 3 });
  const r = await page.evaluate(async () => {
    const s = window.__shell!;
    const o = { at: { chunk: 40, local: 21 }, tick: 504, palette: 0, bend: { a: 8e-5, c: -1.2e-5 } };
    const settle = (): void => {
      const t0 = performance.now();
      while (performance.now() - t0 < 3000) s.frameAt(0, o);
      s.frameAt(0, o);
    };
    settle();
    const before = s.pixels();
    const canvas = s.ctx.renderer.domElement;
    const lost = new Promise((resolve) => canvas.addEventListener('webglcontextlost', resolve, { once: true }));
    const restored = new Promise((resolve) => canvas.addEventListener('webglcontextrestored', resolve, { once: true }));
    const ext = s.ctx.renderer.getContext().getExtension('WEBGL_lose_context')!;
    ext.loseContext();
    await lost;
    // Yield a task: restoring inside the loss event is ignored (section 11.3).
    await new Promise((resolve) => setTimeout(resolve, 0));
    ext.restoreContext();
    await restored;
    await new Promise((resolve) => setTimeout(resolve, 0));
    s.rebuild();
    settle();
    const after = s.pixels();
    let bytes = 0;
    for (let i = 0; i < after.length; i++) if (after[i] !== before[i]) bytes++;
    return { bytes, total: after.length, errors: [...s.shaderErrors] };
  });
  console.log(`CONTEXT ${JSON.stringify(r)}`);
  expect(r.errors).toEqual([]);
  expect(r.total).toBe(8_294_400);
  expect(r.bytes).toBe(0);
});

interface MirrorResult { floorDiffers: boolean; mountainDiff: number; mountainPixels: number; terrainDiff: number; terrainPixels: number; programs: number; width: number; height: number }

/** Black clear against magenta clear with the sky hidden: a difference on a terrain pixel means that pixel is not opaque. */
function mirrorRun(): MirrorResult {
  const s = window.__shell!;
  const o = { at: { chunk: 40, local: 21 }, tick: 504, palette: 0, bend: { a: 0, c: 0 } };
  const r = s.ctx.renderer;
  r.setClearColor(0xff00ff, 1);
  s.setDebugMode('crack');
  s.frameAt(0, o);
  const mask = s.pixels();
  s.setDebugMode('none');
  r.setClearColor(0xff00ff, 1);
  // A difference here means "not opaque", so the one-level flip of plan section 10 must not be in the window.
  const settledAt = performance.now();
  while (performance.now() - settledAt < 3000) s.frameAt(0, o);
  s.frameAt(0, o);
  const magenta = s.pixels();
  r.setClearColor(0x000000, 1);
  s.frameAt(0, o);
  const black = s.pixels();
  const { width: W, height: H, programs } = s.stats();
  let terrainDiff = 0, terrainPixels = 0, mountainDiff = 0, mountainPixels = 0, floorDiffers = false;
  const horizonRow = Math.round((560 / 1080) * H);
  for (let row = 0; row < H; row++) {
    for (let x = 0; x < W; x++) {
      const at = ((H - 1 - row) * W + x) * 4;
      const terrain = !(mask[at]! > 200 && mask[at + 1]! < 60 && mask[at + 2]! > 200);
      if (!terrain) continue;
      terrainPixels++;
      const differs = magenta[at] !== black[at] || magenta[at + 1] !== black[at + 1] || magenta[at + 2] !== black[at + 2];
      if (differs) terrainDiff++;
      // Above the horizon only surfaces above eye level can show, and those have rise 1, so they are mountains.
      if (row < horizonRow) {
        mountainPixels++;
        if (differs) mountainDiff++;
      }
      if (differs && row > 0.85 * H && Math.abs(x - W / 2) < 0.2 * W) floorDiffers = true;
    }
  }
  return { floorDiffers, mountainDiff, mountainPixels, terrainDiff, terrainPixels, programs, width: W, height: H };
}

test('mirror (A20): floor partly transparent at tier 3, nothing at tier 2, no recompile', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_GPU);
  test.setTimeout(120_000);
  await open(page, { world: 'ref', post: 'off', sky: 0, tier: 3 });
  const t3 = await page.evaluate(mirrorRun);
  console.log(`MIRROR tier 3 ${JSON.stringify(t3)}`);
  expect(t3.floorDiffers).toBe(true);
  expect(t3.mountainPixels).toBeGreaterThan(10_000);
  expect(t3.mountainDiff).toBe(0);

  await open(page, { world: 'ref', post: 'off', sky: 0, tier: 2 });
  const t2 = await page.evaluate(mirrorRun);
  console.log(`MIRROR tier 2 ${JSON.stringify(t2)}`);
  expect(t2.terrainPixels).toBeGreaterThan(100_000);
  expect(t2.terrainDiff).toBe(0);

  // The layer alone, as in A4: the shell's setTier also moves DevPost's bloom programs under post=off.
  const toggle = await page.evaluate(({ tier3, tier2 }) => {
    const s = window.__shell!;
    const layer = window.__terrain!.layer;
    const o = { at: { chunk: 40, local: 21 }, tick: 504, palette: 0, bend: { a: 0, c: 0 } };
    s.frameAt(0, o);
    const a = s.stats().programs;
    layer.setQuality(tier3);
    s.frameAt(0, o);
    const b = s.stats().programs;
    layer.setQuality(tier2);
    s.frameAt(0, o);
    return { a, b, c: s.stats().programs };
  }, { tier3: fakeProfile(3), tier2: fakeProfile(2) });
  console.log(`MIRROR programs ${JSON.stringify(toggle)}`);
  expect(toggle.b).toBe(toggle.a);
  expect(toggle.c).toBe(toggle.a);
});

interface RampArgs { to2: Readonly<QualityProfile>; bend: Bend; chunk: number; local: number }
interface RampResult { swap: number; swapOver16: number; firstOver16: number; rampMeans: number[]; rows: number[]; triangles: number[] }

/** The layer alone gets the new quality, so the composer keeps its size and only terrain changes. The camera holds still. */
function rampRun(q: RampArgs): RampResult {
  const s = window.__shell!;
  const o = { at: { chunk: q.chunk, local: q.local }, tick: 504, palette: 0, bend: q.bend };
  s.frameAt(0, o);
  s.frameAt(0, o);
  let prev = s.pixels();
  window.__terrain!.layer.setQuality(q.to2);
  const means: number[] = [];
  const over: number[] = [];
  const triangles: number[] = [];
  const histogram: number[][] = [];
  const { width: W, height: H } = s.stats();
  for (let i = 0; i < 30; i++) {
    s.frameAt(0, o);
    const px = s.pixels();
    let sum = 0;
    let big = 0;
    const rows = new Array<number>(Math.ceil(H / 60)).fill(0);
    for (let at = 0; at < px.length; at += 4) {
      const dr = Math.abs(px[at]! - prev[at]!), dg = Math.abs(px[at + 1]! - prev[at + 1]!), db = Math.abs(px[at + 2]! - prev[at + 2]!);
      sum += dr + dg + db;
      if (Math.max(dr, dg, db) > 16) {
        big++;
        rows[Math.floor((H - 1 - Math.floor(at / 4 / W)) / 60)]!++;
      }
    }
    means.push(sum / (W * H * 3));
    over.push(big / (W * H));
    histogram.push(rows);
    triangles.push(s.stats().triangles);
    prev = px;
  }
  // The swap is the frame whose triangle count fell.
  let at = -1;
  for (let i = 1; i < triangles.length; i++) if (triangles[i]! < triangles[i - 1]!) at = i;
  return {
    swap: at >= 0 ? means[at]! : -1, swapOver16: at >= 0 ? over[at]! : -1, firstOver16: over[0]!, rampMeans: means.filter((_, i) => i !== at),
    rows: at >= 0 ? histogram[at]! : [], triangles,
  };
}

test('stride (A21): the swap frame changes less than a ramp step', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_GPU);
  test.setTimeout(180_000);
  const to2 = { ...fakeProfile(3), terrainStride: 2 } as const;
  const scenes = [['3 flat', FLAT, 3], ['3 full', FULL, 3], ['40 full', FULL, 40], ['15625000 flat', FLAT, 15625000], ['15625000 full', FULL, 15625000]] as const;
  for (const [label, bend, chunk] of scenes) {
    for (const local of [1, 21]) {
      await open(page, { world: 'ref', tier: 3 });
      const r = await page.evaluate(rampRun, { to2, bend, chunk, local });
      const largest = Math.max(...r.rampMeans);
      console.log(`STRIDE ${label} local ${local} swap ${r.swap.toFixed(4)} over16 ${(r.swapOver16 * 100).toFixed(3)}% largest ramp ${largest.toFixed(4)} first ramp step ${r.rampMeans[0]!.toFixed(4)} over16 ${(r.firstOver16 * 100).toFixed(3)}% rows-by-60 ${r.rows.join(' ')} triangles ${r.triangles[0]}..${r.triangles[r.triangles.length - 1]}`);
      expect(r.swap).toBeGreaterThanOrEqual(0);
      expect(r.swap).toBeLessThan(largest);
      expect(r.swap).toBeLessThan(0.5);
      expect(r.swapOver16).toBeLessThan(0.002);
    }
  }
  await saveShot(page, info, 'stride2-after-swap');
});

test('software (A22): tier 0 on SwiftShader', async ({ page }, info) => {
  test.skip(info.project.name !== 'software', 'SwiftShader only');
  test.setTimeout(300_000);
  await open(page, { world: 'ref', tier: 0, post: 'off' });
  const r = await page.evaluate(() => {
    const s = window.__shell!;
    const ms: number[] = [];
    for (let i = 0; i < 30; i++) ms.push(s.frameAt(0, { at: { chunk: 40, local: 20 + i * 0.5 }, tick: 504, palette: 0, bend: { a: 8e-5, c: -1.2e-5 } }));
    ms.sort((a, b) => a - b);
    return { p50: ms[15]!, stats: s.stats(), renderer: s.rendererInfo().renderer };
  });
  console.log(`SOFTWARE post off ${JSON.stringify(r)}`);
  expect(r.renderer).toContain('SwiftShader');
  expect(r.p50).toBeLessThan(50);
  await open(page, { world: 'ref', tier: 0 });
  await renderOnly(page, { chunk: 40, local: 20, tick: 504, bend: MID_BEND });
  await saveShot(page, info, 'software-tier0');
});

interface Tier0Result {
  meshes: number; defines: string[]; programs: number; sun: boolean[]; slope: boolean[]; sameProgram: boolean;
  p50: number; tier: number; triangles: number; width: number; height: number; renderer: string;
}

/** Inside one evaluate. Reads the six terrain meshes' compiled programs, optionally gives the layer tier 0 at runtime, then times frames. */
function tier0Run(a: { switchTo0: boolean; frames: number }): Tier0Result {
  const s = window.__shell!;
  s.setManual(true);
  const meshes = (s.ctx.scene.children as Mesh<BufferGeometry, ShaderMaterial>[]).filter((m) => m.renderOrder >= 100 && m.renderOrder <= 105);
  const program = (m: Mesh<BufferGeometry, ShaderMaterial>): { cacheKey: string } | undefined =>
    (s.ctx.renderer.properties.get(m.material) as { currentProgram?: { cacheKey: string } }).currentProgram;
  const pose = (i: number) => ({ at: { chunk: 40, local: 20 + (i % 30) * 0.5 }, tick: 504, palette: 0, bend: { a: 8e-5, c: -1.2e-5 } });
  s.frameAt(0, pose(0));
  const before = meshes.map(program);
  if (a.switchTo0) s.setTier(0);
  // The 30-frame ramp to stride 2, so both pages time the same mesh. Both pages run it, so both are equally warm when timing starts.
  for (let i = 0; i < 31; i++) s.frameAt(0, pose(i));
  const ms: number[] = [];
  for (let i = 0; i < a.frames; i++) ms.push(s.frameAt(0, pose(i)));
  ms.sort((x, y) => x - y);
  const after = meshes.map(program);
  const keys = [...new Set(after.map((p) => p?.cacheKey ?? ''))];
  const st = s.stats();
  return {
    meshes: meshes.length,
    defines: meshes.map((m) => Object.keys(m.material.defines ?? {}).sort().join(',')),
    programs: new Set(after).size,
    sun: keys.map((k) => k.includes('NO_SUN_COLUMN')), slope: keys.map((k) => k.includes('NO_SLOPE_NORMAL')),
    sameProgram: after.every((p, i) => p !== undefined && p === before[i]),
    // The tier the shell last gave every layer and the post stack, as dev/terrain.html records it (repair R3).
    p50: ms[Math.floor(ms.length / 2)]!, tier: window.__terrain!.postState.quality?.tier ?? -1,
    triangles: st.triangles, width: st.width, height: st.height,
    renderer: s.rendererInfo().renderer,
  };
}

/**
 * D-007 (T10's register): tier 0 missed section 9.2's 50 ms on the app, and the floor's sunDisc was the largest part of terrain's
 * share. Page A boots at tier 0, as a software boot does: the layer's first setQuality sets NO_SUN_COLUMN and NO_SLOPE_NORMAL before
 * any compile. The control, page B, boots at tier 3 and is then given tier 0 at runtime: the same profile, stride 2 after the ramp,
 * and the full shader, with no recompile, because the defines never flip after the first call. Terrain alone (sky=0, post off),
 * so the timing compares the two floor shaders.
 */
test('tier-0 shading (A22b, D-007): a tier 0 boot drops the sun column, and tier 0 at runtime keeps the full shader', async ({ page }, info) => {
  test.skip(info.project.name !== 'software', 'SwiftShader only');
  test.setTimeout(300_000);
  await open(page, { world: 'ref', tier: 0, post: 'off', sky: 0 });
  const cut = await page.evaluate(tier0Run, { switchTo0: false, frames: 60 });
  console.log(`TIER0 boot-0 ${JSON.stringify(cut)}`);
  await open(page, { world: 'ref', tier: 3, post: 'off', sky: 0 });
  const full = await page.evaluate(tier0Run, { switchTo0: true, frames: 60 });
  console.log(`TIER0 boot-3-then-0 ${JSON.stringify(full)}`);
  console.log(`TIER0 p50 ratio ${(cut.p50 / full.p50).toFixed(3)}`);
  for (const r of [cut, full]) {
    expect(r.renderer).toContain('SwiftShader');
    expect(r.meshes).toBe(6);
    expect(r.programs).toBe(1);
    expect(r.sameProgram).toBe(true);
    expect(r.tier).toBe(0);
    expect(r.triangles).toBe(30264);
    expect([r.width, r.height]).toEqual([640, 360]);
  }
  expect(cut.defines).toEqual(Array(6).fill('NO_SLOPE_NORMAL,NO_SUN_COLUMN'));
  expect(cut.sun).toEqual([true]);
  expect(cut.slope).toEqual([true]);
  expect(full.defines).toEqual(Array(6).fill(''));
  expect(full.sun).toEqual([false]);
  expect(full.slope).toEqual([false]);
  // [A] The cut must show in the time, not only in the program: about .5 of the full shader in the D-007 probes (section 9).
  expect(cut.p50).toBeLessThan(0.8 * full.p50);

  // The look: both pictures at tier 0, with the stand-in sky and DevPost, the second being the control's full shader.
  await open(page, { world: 'ref', tier: 0 });
  await renderOnly(page, { chunk: 40, local: 20, tick: 504, bend: MID_BEND });
  await saveShot(page, info, 'software-tier0-boot0');
  await open(page, { world: 'ref', tier: 3 });
  await page.evaluate(() => {
    const s = window.__shell!;
    s.setTier(0);
    for (let i = 0; i < 31; i++) s.frameAt(0, { at: { chunk: 40, local: 20 }, tick: 504, palette: 0, bend: { a: 4e-5, c: -6e-6 } });
  });
  await saveShot(page, info, 'software-tier0-runtime-full');
});

test('wash-out (A24): near-white and chroma on six palettes', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_GPU);
  test.setTimeout(120_000);
  await open(page, { world: 'ref', tier: 3 });
  for (let palette = 0; palette <= 5; palette++) {
    const r = await page.evaluate((p) => {
      const s = window.__shell!;
      s.frameAt(0, { at: { chunk: 40, local: 20 }, tick: 504, palette: p, bend: { a: 4e-5, c: -6e-6 } });
      const px = s.pixels();
      let white = 0;
      let chroma = 0;
      const n = px.length / 4;
      for (let i = 0; i < px.length; i += 4) {
        const a = px[i]!, b = px[i + 1]!, c = px[i + 2]!;
        if (Math.min(a, b, c) > 235) white++;
        chroma += Math.max(a, b, c) - Math.min(a, b, c);
      }
      return { nearWhite: white / n, chroma: chroma / n };
    }, palette);
    console.log(`WASHOUT palette ${palette} nearWhite ${(r.nearWhite * 100).toFixed(3)}% chroma ${r.chroma.toFixed(1)}`);
    expect(r.nearWhite).toBeLessThan(0.005);
    expect(r.chroma).toBeGreaterThan(55);
  }
});

test('cost (A23): streaming, rebuild and synced frame', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', NEEDS_GPU);
  test.setTimeout(180_000);
  await open(page, { world: 'ref', tier: 3 });
  // One pass: from chunk 40, 60 untimed frames, then 600 timed at 150 u/s with full bend. Its first frame is a jump, so the shell
  // rebuilds there, untimed, and a second pass replays exactly the same frames.
  const pass = (): Promise<{ rowsP50: number; rowsP99: number; rowsMax: number; syncedP50: number; syncedP95: number; syncedP99: number }> => page.evaluate(() => {
    const s = window.__shell!;
    const t = window.__terrain!;
    const bend = { a: 8e-5, c: -1.2e-5 };
    let chunk = 40;
    let local = 0;
    const step = (i: number): number => {
      local += 2.5;
      if (local >= 64) { local -= 64; chunk += 1; }
      return s.frameAt(0, { at: { chunk, local }, tick: i, palette: 0, bend });
    };
    for (let i = 0; i < 60; i++) step(i);
    t.frameMs.length = 0;
    const synced: number[] = [];
    for (let i = 0; i < 600; i++) synced.push(step(i));
    const rows = [...t.frameMs].sort((a, b) => a - b);
    synced.sort((a, b) => a - b);
    const q = (v: number[], p: number): number => v[Math.min(v.length - 1, Math.floor(v.length * p))]!;
    return {
      rowsP50: q(rows, 0.5), rowsP99: q(rows, 0.99), rowsMax: rows[rows.length - 1]!,
      syncedP50: q(synced, 0.5), syncedP95: q(synced, 0.95), syncedP99: q(synced, 0.99),
    };
  });
  // DI-86(3), as T05's A30 takes it: the first pass after a page load is noisy, so it runs once as a warm-up and its synced frames
  // are not gated; the next pass of the same frames is. The warm-up's row writes are still gated, and the nine rebuilds still follow
  // it, so the synced line is the only one that moved. Limits unchanged.
  const warm = await pass();
  const rb = await page.evaluate(() => {
    const s = window.__shell!;
    const rebuilds: number[] = [];
    for (let i = 0; i < 9; i++) {
      const t0 = performance.now();
      s.rebuild();
      rebuilds.push(performance.now() - t0);
    }
    rebuilds.sort((a, b) => a - b);
    return { rebuildP50: rebuilds[4]!, rebuildMax: rebuilds[8]! };
  });
  const r = await pass();
  console.log(`COST warm-up pass, synced not gated ${JSON.stringify(warm)}`);
  console.log(`COST ${JSON.stringify({ ...r, ...rb })}`);
  expect(warm.rowsP99).toBeLessThanOrEqual(2);
  expect(r.rowsP99).toBeLessThanOrEqual(2);
  // Section 9.2: a warp or full refill takes at most 30 ms, each time. The slowest of the nine is gated, so one slow rebuild fails.
  expect(rb.rebuildMax).toBeLessThanOrEqual(30);
  expect(r.syncedP95).toBeLessThanOrEqual(2);
});
