// Opening the real page under the harness, moving to a sample, and reading frames back (plan sections 4 and M1).
// Waits never grant activation before a gesture: openHarness waits on the MV_READY console line, as T10's openApp does.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { Page, TestInfo } from 'playwright/test';
import { type FeelState, type HeroMode, type LayerName, type PostVariant, type Tier } from '../../../src/contracts/index';
import type {} from '../../../src/app/testHook';
import type {} from '../../../src/harness/index';
import { checkRasterizer } from '../../support/rasterizer';
import { tickFor, type Sample } from './combos';

export { tickFor, type Sample };

export interface Rgba { w: number; h: number; rgba: Uint8Array }
export interface FrameOptions { post?: PostVariant | 'off'; layers?: Partial<Record<LayerName, boolean>>; feel?: Partial<FeelState> }
/** T11's calibration seed: every threshold, the fixed pose (POSE_TICK) and the round bases r00 to final were
 * measured at 1985. It stays 1985 when the product's DEFAULT_SEED moves (DI-102); first10 and pack follow DEFAULT_SEED,
 * because they show the real opening. */
export const ART_SEED = 1985;

export interface OpenOptions { seed?: number; tier?: Tier; period?: number; timeoutMs?: number }
/** shipX, shipY: the sim's prevX, prevY when manual mode began. renderState takes camX and camY from them, so they frame every renderAt on this page; the DEMO autopilot leaves them where it was at MV_READY (Surprises, M2). */
export interface OpenInfo { renderer: string; seed: number; tier: Tier; period: number; firstFrameMs: number; consoleErrors: string[]; shipX: number; shipY: number }

/** Builds the harness URL: /?harness&period=0&tier=3&seed=<int> by default (plan section 4 seams, T10's URL table). */
export function harnessUrl(o: OpenOptions = {}): string {
  const seed = o.seed ?? ART_SEED;
  const period = o.period ?? 0;
  const tier = o.tier ?? 3;
  return `/?harness&period=${period}&tier=${tier}&seed=${seed}`;
}

/**
 * The sim tick every harness page is stepped to before measuring, so the ship and camera pose is the same on every load (r01).
 * Chosen by a scan of ticks 1200 to 14400 at seed 1985 for the pose nearest the road centre and at rest: x -.079, y 7.46, lateral
 * step under .01 u. The DEMO autopilot never flies at y 6 after boot; at tick 1200 the ship sat at x 25.2.
 */
export const POSE_TICK = 2717;

/**
 * Opens the page, waits for MV_READY then __mv.ready, asserts the rasterizer from the page's own boot record (one
 * context per page), checks __mvE2e exists, turns manual mode on and steps the sim to POSE_TICK. Throws loudly if T10's hook is missing.
 */
export async function openHarness(page: Page, info: TestInfo, o: OpenOptions = {}, url?: string): Promise<OpenInfo> {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const ready = page.waitForEvent('console', { predicate: (m) => m.text() === 'MV_READY', timeout: o.timeoutMs ?? 90_000 });
  await page.goto(url ?? harnessUrl(o));
  await ready;
  const got = await page.evaluate((POSE_TICK) => {
    const e2e = window.__mvE2e;
    const mv = window.__mv;
    if (!mv || !mv.ready) return { ok: false as const, why: 'window.__mv missing or not ready' };
    if (!e2e) return { ok: false as const, why: 'window.__mvE2e missing: T10 offers it to T11 (plan section 4 seams)' };
    if (!e2e.host || !e2e.host.ctx || !e2e.host.ctx.world || typeof e2e.host.ctx.world.zoneAt !== 'function') {
      return { ok: false as const, why: 'window.__mvE2e.host.ctx.world.zoneAt missing (plan section 4 seams, CCR-T11-2)' };
    }
    mv.manual(true);
    // T11 r01: a fixed pose. renderState frames every renderAt from the sim's prevX and prevY, which the DEMO autopilot left
    // wherever it was at MV_READY, so two page loads differed by up to 2 u of camera x (Surprises). The sim is deterministic
    // from boot, so stepping it to one tick gives one pose on every load, as T09's shimmer and wash-out rows do (V2-T09).
    const lab = (window as unknown as { __mvLab?: { stepToTick(t: number): number } }).__mvLab;
    if (!lab || typeof lab.stepToTick !== 'function') return { ok: false as const, why: 'window.__mvLab.stepToTick missing (T09 harness lab)' };
    lab.stepToTick(POSE_TICK);
    const t = POSE_TICK;
    const gl = e2e.host.ctx.renderer.getContext();
    return { ok: true as const, renderer: e2e.boot.rendererString, firstFrameMs: e2e.boot.firstFrameMs, webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext, tier: mv.stats().tier, shipX: e2e.sim.prevX, shipY: e2e.sim.prevY, poseTick: t };
  }, POSE_TICK);
  if (!got.ok) throw new Error(`openHarness: ${got.why}`);
  const problem = checkRasterizer(info.project.name, got.webgl2, got.renderer);
  if (problem) throw new Error(`openHarness: ${problem}`);
  console.log(`openHarness: ship at x ${got.shipX.toFixed(3)}, y ${got.shipY.toFixed(3)} at sim tick ${got.poseTick}, the fixed pose`);
  return { renderer: got.renderer, seed: o.seed ?? ART_SEED, tier: got.tier, period: o.period ?? 0, firstFrameMs: got.firstFrameMs, consoleErrors: errors, shipX: got.shipX, shipY: got.shipY };
}

/** Warps the sim to the sample, then asserts stats().chunk and .local straight after the warp (plan section 4). */
export async function goto(page: Page, s: Sample): Promise<void> {
  const r = await page.evaluate(({ chunk, local }) => {
    const mv = window.__mv!;
    const ok = mv.warp(chunk, local);
    const st = mv.stats();
    return { ok, chunk: st.chunk, local: st.local };
  }, { chunk: s.chunk, local: s.local });
  if (!r.ok || r.chunk !== s.chunk || r.local !== s.local) {
    throw new Error(`goto: warp(${s.chunk}, ${s.local}) gave ok ${r.ok}, stats ${r.chunk}, ${r.local}`);
  }
}

function flipToTopDown(w: number, h: number, bottomUp: Uint8Array): Uint8Array {
  const out = new Uint8Array(bottomUp.length);
  const stride = w * 4;
  for (let y = 0; y < h; y++) out.set(bottomUp.subarray((h - 1 - y) * stride, (h - y) * stride), y * stride);
  return out;
}

/**
 * Renders the sample with these options through renderAt, reads pixels() in the same task, and returns RGBA rows
 * top-down. Every call sets post, all four layers and feel explicitly, so no state leaks between frames. forceZone
 * and forceBend have no clearing call on HarnessApi, so specs that use them do so on a page of their own.
 * Raw rows (bottom-up, as pixels() gives them) are returned when raw is true.
 */
export async function frame(page: Page, s: Sample, o: FrameOptions = {}, raw = false): Promise<Rgba & { ms: number }> {
  const res = await page.evaluate((a) => {
    const mv = window.__mv!;
    mv.setPost(a.post);
    for (const [name, on] of a.layers) mv.setLayerVisible(name, on);
    mv.forceFeel(a.feel);
    const ms = mv.renderAt(a.chunk, a.local, a.tick);
    const px = mv.pixels();
    const st = mv.stats();
    let bin = '';
    const CH = 0x8000;
    for (let i = 0; i < px.length; i += CH) bin += String.fromCharCode.apply(null, px.subarray(i, i + CH) as unknown as number[]);
    return { b64: btoa(bin), w: st.width, h: st.height, ms };
  }, {
    chunk: s.chunk, local: s.local, tick: s.tick,
    post: o.post ?? 'full',
    layers: (['sky', 'terrain', 'props', 'fx'] as const).map((n): [LayerName, boolean] => [n, o.layers?.[n] ?? true]),
    feel: o.feel ?? null,
  });
  const bu = new Uint8Array(Buffer.from(res.b64, 'base64'));
  if (bu.length !== res.w * res.h * 4) throw new Error(`frame: ${bu.length} bytes for ${res.w}x${res.h}`);
  return { w: res.w, h: res.h, rgba: raw ? bu : flipToTopDown(res.w, res.h, bu), ms: res.ms };
}

/** A24: the ship's own triangles in pixels (top-down), and the pose they were projected from. */
export interface ShipProjection {
  w: number; h: number;
  /** x, y per vertex, 6 numbers per triangle, both ship draws (body and engine glow). */
  xy: number[];
  triangles: number; behind: number; meshes: number;
  pos: number[]; rot: number[]; engine: number[]; bend: number[];
}

/**
 * A24: projects the ship's two meshes exactly as src/render/props/glsl/ship.vert.glsl does (the glow's engine stretch, bank about
 * z, pitch about x, + uShipPos, bendV, then projectionMatrix * viewMatrix), on the CPU, from the page's own geometry, ship
 * uniforms, camera matrices and uBend. Call it straight after a frame() that drew props, so the uniforms are that frame's.
 * Read-only: it reads T10's hook and writes nothing (plan section 4, the hook is read-only for T11). Throws if no ship is found.
 */
export async function shipProjection(page: Page): Promise<ShipProjection> {
  const r = await page.evaluate(() => {
    const host = window.__mvE2e!.host;
    const st = window.__mv!.stats();
    const W = st.width, H = st.height;
    const cam = host.ctx.camera;
    const P = cam.projectionMatrix.elements, V = cam.matrixWorldInverse.elements;
    const bend = host.ctx.shared.uBend.value;
    const a = bend[0]!, c = bend[1]!, vMax = bend[2]!;
    const xy: number[] = [];
    let meshes = 0, triangles = 0, behind = 0;
    let pos: number[] = [], rot: number[] = [], engine: number[] = [];
    type U = { value: Float32Array };
    type M = { isMesh?: boolean; visible: boolean; geometry: { index: { array: ArrayLike<number> } | null; getAttribute(n: string): { array: ArrayLike<number> } }; material: { uniforms?: Record<string, unknown>; defines?: Record<string, unknown> } };
    host.ctx.scene.traverse((o) => {
      const m = o as unknown as M;
      if (!m.isMesh || !m.visible || !m.material || !m.material.uniforms || !m.material.uniforms['uShipPos']) return;
      meshes++;
      const u = m.material.uniforms as Record<string, U>;
      const sp = u['uShipPos']!.value, sr = u['uShipRot']!.value, se = u['uShipEngine']!.value;
      pos = [sp[0]!, sp[1]!, sp[2]!]; rot = [sr[0]!, sr[1]!]; engine = [se[0]!, se[1]!];
      const glow = !!(m.material.defines && m.material.defines['SHIP_GLOW'] !== undefined);
      const stretch = (0.5 + 2.4 * se[0]!) * se[1]!;
      const cb = Math.cos(sr[0]!), sb = Math.sin(sr[0]!), cp = Math.cos(sr[1]!), spp = Math.sin(sr[1]!);
      const pa = m.geometry.getAttribute('position').array;
      const idx = m.geometry.index ? m.geometry.index.array : null;
      const n = idx ? idx.length : pa.length / 3;
      const vert = (i: number): [number, number, number] | null => {
        let lx = pa[i * 3]!, ly = pa[i * 3 + 1]!, lz = pa[i * 3 + 2]!;
        if (glow) lz = 2.18 + (lz - 2.18) * stretch;
        const bx = cb * lx - sb * ly, by = sb * lx + cb * ly;
        lx = bx; ly = cp * by + spp * lz; lz = -spp * by + cp * lz;
        let px = sp[0]! + lx, py = sp[1]! + ly;
        const pz = sp[2]! + lz;
        const v = Math.max(-pz, 0), b = Math.min(v, vMax), q = b * b + 2 * vMax * (v - b);
        px += a * q; py += c * q;
        const ex = V[0]! * px + V[4]! * py + V[8]! * pz + V[12]!, ey = V[1]! * px + V[5]! * py + V[9]! * pz + V[13]!;
        const ez = V[2]! * px + V[6]! * py + V[10]! * pz + V[14]!, ew = V[3]! * px + V[7]! * py + V[11]! * pz + V[15]!;
        const cx = P[0]! * ex + P[4]! * ey + P[8]! * ez + P[12]! * ew, cy = P[1]! * ex + P[5]! * ey + P[9]! * ez + P[13]! * ew;
        const cw = P[3]! * ex + P[7]! * ey + P[11]! * ez + P[15]! * ew;
        if (!(cw > 0)) return null;
        return [(cx / cw * 0.5 + 0.5) * W, (0.5 - cy / cw * 0.5) * H, 0];
      };
      for (let t = 0; t + 2 < n; t += 3) {
        const i0 = idx ? idx[t]! : t, i1 = idx ? idx[t + 1]! : t + 1, i2 = idx ? idx[t + 2]! : t + 2;
        const A = vert(i0), B = vert(i1), C = vert(i2);
        if (!A || !B || !C) { behind++; continue; }
        xy.push(A[0], A[1], B[0], B[1], C[0], C[1]);
        triangles++;
      }
    });
    return { w: W, h: H, xy, triangles, behind, meshes, pos, rot, engine, bend: [a, c, vMax] };
  });
  if (r.meshes === 0 || r.triangles === 0) throw new Error(`shipProjection: no visible ship mesh with uShipPos (meshes ${r.meshes}, triangles ${r.triangles})`);
  return r;
}

/** forceZone: palette, hero and the sky's biome key only (section 8.1). Persists for the page; use a page of its own. */
export async function forceZone(page: Page, palette: number, biome: number, hero: HeroMode): Promise<void> {
  await page.evaluate((a) => { window.__mv!.forceZone(a.palette, a.biome, a.hero); }, { palette, biome, hero });
}

/** forceBend: persists for the page; use a page of its own. */
export async function forceBend(page: Page, a: number, c: number): Promise<void> {
  await page.evaluate((b) => { window.__mv!.forceBend(b.a, b.c); }, { a, c });
}

/** The zone the page itself renders at (chunk, local), through T10's hook, built in the page. */
export async function pageZone(page: Page, chunk: number, local: number): Promise<{ paletteA: number; biomeA: number; paletteMix: number; biomeMix: number; heroA: number; index: number; dayPhase: number }> {
  return page.evaluate(({ chunk, local }) => {
    const out = {
      index: 0, biomeA: 0, biomeB: 0, biomeMix: 0, paletteA: 0, paletteB: 0, paletteMix: 0,
      palette: new Float32Array(21), heroA: 0 as 0 | 1 | 2 | 3, heroB: 0 as 0 | 1 | 2 | 3, heroMix: 0,
      objective: 0 as 0 | 1 | 2 | 3 | 4, objectiveTarget: 0, musicKey: 0, dayPhase: 0,
    };
    window.__mvE2e!.host.ctx.world.zoneAt({ chunk, local }, out);
    return { paletteA: out.paletteA, biomeA: out.biomeA, paletteMix: out.paletteMix, biomeMix: out.biomeMix, heroA: out.heroA, index: out.index, dayPhase: out.dayPhase };
  }, { chunk, local });
}

/** A sample at an arbitrary state, for frames that are not one of the 180. */
export function at(chunk: number, local: number, tick = tickFor(chunk, local)): Sample {
  return { chunk, local, tick, palette: -1, biome: -1, into: chunk % 100 };
}

const DIST_PREFIX = '/art/';
const DIST_TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

/**
 * Serves a built folder (dist/) with node:http under /art/ on a free port, as T00's build proof does, so a page loads the
 * production build from a nested path with no dev server and no harness (plan section 4, T10 `dist/` seam). No caching.
 */
export function serveDist(folder: string): Promise<{ url: string; close(): Promise<void> }> {
  const root = resolve(folder);
  const server: Server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    const file = path.startsWith(DIST_PREFIX) ? join(root, normalize(path.slice(DIST_PREFIX.length) || 'index.html')) : '';
    if (!file || !(file === root || file.startsWith(root + sep)) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': DIST_TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(readFileSync(file));
  });
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      done({ url: `http://127.0.0.1:${port}${DIST_PREFIX}`, close: () => new Promise((c) => { server.closeAllConnections(); server.close(() => { c(); }); }) });
    });
  });
}
