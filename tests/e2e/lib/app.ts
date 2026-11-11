// T10's e2e helpers. The waits here never grant user activation before a gesture: only addInitScript, page.on('console')
// and page.waitForEvent('console') are safe (plan section 10), so readiness is the MV_READY console line.
import type { ConsoleMessage, Page } from 'playwright/test';
import type {} from '../../../src/app/testHook';   // brings window.__mvE2e into the program
import type {} from '../../../src/harness/index';  // brings window.__mv and window.__mvLab into the program

export interface ConsoleLog {
  readonly lines: string[];
  /** Lines of one type, such as 'error' or 'warning'. */
  of(type: string): string[];
}

/** Collects every console line, prefixed by its type, from now on. Grants nothing. */
export function collectConsole(page: Page): ConsoleLog {
  const lines: string[] = [];
  page.on('console', (m: ConsoleMessage) => { lines.push(`${m.type()} ${m.text()}`); });
  return {
    lines,
    of(type) { return lines.filter((l) => l.startsWith(`${type} `)).map((l) => l.slice(type.length + 1)); },
  };
}

function readyWait(page: Page, timeout: number): Promise<ConsoleMessage> {
  return page.waitForEvent('console', { predicate: (m) => m.text() === 'MV_READY', timeout });
}

/**
 * Registers the console listener, opens /?harness plus query, and waits for MV_READY. The caller may use evaluate
 * afterwards. query starts with '&' or is empty.
 */
export async function openApp(page: Page, query = '', timeout = 60_000): Promise<ConsoleLog> {
  const log = collectConsole(page);
  const ready = readyWait(page, timeout);
  await page.goto(`/?harness${query}`);
  await ready;
  return log;
}

/**
 * The same wait and nothing else: no evaluate, no locator, no waitFor*, no expectRasterizer, so the page has no
 * activation when it returns. For gesture tests. Pauses afterwards use a Node-side timer.
 */
export async function openAppUntouched(page: Page, query = '', timeout = 60_000): Promise<ConsoleLog> {
  return openApp(page, query, timeout);
}

/** Node-side pause, which touches the page not at all. */
export function nodeWait(ms: number): Promise<void> {
  return new Promise((r) => { setTimeout(r, ms); });
}

export interface R1Bad { why: 'backward' | 'flat' | 'camera' | 'speed'; seg: string; d?: number; u?: number; v?: number }
export interface R1State { seg: string; samples: Record<string, number>; bad: R1Bad[]; floor: number }

declare global {
  interface Window {
    __r1?: R1State & { last: { c: number; l: number } | null; lastT: number; lastU: number; warp: number; stop: boolean };
    __mvLoseExt?: WEBGL_lose_context | null;
    __mvLinks?: number;
  }
}

/**
 * Plan M5's sampler, in the page: never backward on any rAF, and strictly rising across every 50 ms, for sim travel
 * and for uTravel.y, which is what every shader scrolls by. A warp is a jump by design and restarts the comparison.
 */
export async function installR1Sampler(page: Page, floor = 45): Promise<void> {
  await page.evaluate((f) => {
    const hook = window.__mvE2e!;
    const r: NonNullable<Window['__r1']> = { seg: 'demo', samples: {}, bad: [], floor: f, last: null, lastT: 0, lastU: 0, warp: hook.sim.warpSerial, stop: false };
    window.__r1 = r;
    (function tick(t: number) {
      if (r.stop) return;
      requestAnimationFrame(tick);
      const tr = hook.sim.travel;
      const u = hook.host.ctx.shared.uTravel.value[1]!;
      if (hook.sim.warpSerial !== r.warp) { r.warp = hook.sim.warpSerial; r.last = null; }
      if (r.last === null) { r.last = { c: tr.chunk, l: tr.local }; r.lastT = t; r.lastU = u; return; }
      const d = (tr.chunk - r.last.c) * 64 + (tr.local - r.last.l);
      if (d < 0) r.bad.push({ why: 'backward', seg: r.seg, d });
      if (t - r.lastT >= 50) {
        if (!(d > 0)) r.bad.push({ why: 'flat', seg: r.seg, d });
        if (!(((u - r.lastU + 4096) % 4096) > 0)) r.bad.push({ why: 'camera', seg: r.seg, u });
        if (hook.sim.speed < r.floor) r.bad.push({ why: 'speed', seg: r.seg, v: hook.sim.speed });
        r.samples[r.seg] = (r.samples[r.seg] ?? 0) + 1;
        r.last = { c: tr.chunk, l: tr.local }; r.lastT = t; r.lastU = u;
      }
    })(performance.now());
  }, floor);
}

/**
 * Names the segment the next samples belong to. restart drops the comparison baseline, for use only after a segment that
 * stopped the loop on purpose (the manual(true) control), whose last baseline would otherwise make the first resumed
 * window read flat. Every other boundary keeps comparing across it, since R1 must hold through user actions.
 */
export async function setSegment(page: Page, seg: string, floor?: number, restart = false): Promise<void> {
  await page.evaluate(({ s, f, restart }) => {
    const r = window.__r1!;
    r.seg = s;
    if (f !== undefined) r.floor = f;
    if (restart) r.last = null;
  }, { s: seg, f: floor, restart });
}

export async function readR1(page: Page): Promise<R1State> {
  return page.evaluate(() => {
    const r = window.__r1!;
    return { seg: r.seg, samples: { ...r.samples }, bad: r.bad.slice(), floor: r.floor };
  });
}

/**
 * Keeps the WEBGL_lose_context object from before the loss, loses the context, waits for the event, then yields a task
 * before returning, so a restore is never requested inside the loss dispatch (section 11.3's fourth trap).
 * Resolves to `counters.rendered` as read inside the loss event, after the app's own handler, which boot registered first
 * (DI-114). A count read by the caller before this call also holds the frames drawn while the call reached the page, and those
 * were drawn before the loss.
 */
export async function loseContext(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const renderer = window.__mvE2e!.host.ctx.renderer;
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_lose_context');
    window.__mvLoseExt = ext;
    if (!ext) throw new Error('no WEBGL_lose_context');
    const canvas = renderer.domElement;
    let atLoss = -1;
    const lost = new Promise<void>((res) => {
      canvas.addEventListener('webglcontextlost', () => { atLoss = window.__mvE2e!.counters.rendered; res(); }, { once: true });
    });
    ext.loseContext();
    await lost;
    await new Promise((r) => { setTimeout(r, 0); });
    return atLoss;
  });
}

/** Restores through the object kept by loseContext, and resolves on webglcontextrestored. */
export async function restoreContext(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const ext = window.__mvLoseExt;
    if (!ext) throw new Error('loseContext was not called');
    const canvas = window.__mvE2e!.host.ctx.renderer.domElement;
    const restored = new Promise<void>((res) => { canvas.addEventListener('webglcontextrestored', () => { res(); }, { once: true }); });
    ext.restoreContext();
    await restored;
  });
}

/** Init script: counts gl.linkProgram calls in window.__mvLinks (T06's method). */
export function linkSpyScript(): void {
  window.__mvLinks = 0;
  if (typeof WebGL2RenderingContext === 'undefined') return;
  const proto = WebGL2RenderingContext.prototype;
  const original = proto.linkProgram;
  proto.linkProgram = function linkProgram(this: WebGL2RenderingContext, program: WebGLProgram): void {
    window.__mvLinks = (window.__mvLinks ?? 0) + 1;
    original.call(this, program);
  };
}

/**
 * Init script: reports AudioContext construction, source starts and context state calls through console.log only, so
 * the Node side can read it without touching the page. In Chromium AudioBufferSourceNode.prototype has its own start(),
 * so both it and AudioScheduledSourceNode.prototype.start are wrapped (T07). Logs activation every 50 ms.
 */
export function audioRecorderScript(): void {
  const log = (s: string): void => { console.log(`AUDIOREC ${s}`); };
  const w = window as unknown as Record<string, unknown>;
  for (const name of ['AudioContext', 'webkitAudioContext']) {
    const C = w[name] as (new (...a: unknown[]) => AudioContext) | undefined;
    if (typeof C !== 'function') continue;
    const Wrapped = class extends C {
      constructor(...a: unknown[]) {
        super(...a);
        log(`new ${name} ${this.state}`);
        this.addEventListener('statechange', () => { log(`state ${this.state}`); });
      }
    };
    w[name] = Wrapped;
  }
  const wrap = (proto: object, method: string, label: string): void => {
    const p = proto as Record<string, unknown>;
    const own = Object.prototype.hasOwnProperty.call(p, method) ? p[method] : undefined;
    const base = (own ?? p[method]) as ((...a: unknown[]) => unknown) | undefined;
    if (typeof base !== 'function') return;
    p[method] = function wrapped(this: unknown, ...a: unknown[]) {
      log(label);
      return base.apply(this, a);
    };
  };
  if (typeof AudioScheduledSourceNode !== 'undefined') wrap(AudioScheduledSourceNode.prototype, 'start', 'start source');
  if (typeof AudioBufferSourceNode !== 'undefined' && Object.prototype.hasOwnProperty.call(AudioBufferSourceNode.prototype, 'start')) {
    wrap(AudioBufferSourceNode.prototype, 'start', 'start buffer');
  }
  if (typeof BaseAudioContext !== 'undefined' && typeof AudioContext !== 'undefined') {
    wrap(AudioContext.prototype, 'suspend', 'call suspend');
    wrap(AudioContext.prototype, 'resume', 'call resume');
    wrap(AudioContext.prototype, 'close', 'call close');
  }
  setInterval(() => {
    const u = navigator.userActivation;
    console.log(`UA ${u.hasBeenActive} ${u.isActive}`);
  }, 50);
}

/** Counts distinct WebGL contexts created by getContext, in window.__mvContexts. */
export function contextCountScript(): void {
  const seen: unknown[] = [];
  const w = window as unknown as { __mvContexts: number };
  w.__mvContexts = 0;
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement, ...a: Parameters<typeof original>) {
    const ctx = (original as (...x: unknown[]) => unknown).apply(this, a);
    if (ctx && (a[0] === 'webgl2' || a[0] === 'webgl' || a[0] === 'experimental-webgl') && !seen.includes(ctx)) {
      seen.push(ctx);
      w.__mvContexts = seen.length;
    }
    return ctx;
  } as typeof original;
}

/**
 * For the length of one screenshot, T08's UI layer is fully transparent, so the capture holds the canvas alone. Opacity
 * on `#mv-ui` itself, which no descendant can override, and no layout change. Playwright 1.64.1 appends this as a style
 * tag before the capture and removes it after (`inPagePrepareForScreenshots`, `_restorePageAfterScreenshot`).
 */
export const HIDE_UI_STYLE = '#mv-ui { opacity: 0 !important; }';

/**
 * The floor band of the viewport, y 62% to 82%, as PNG bytes, for a clip that must change between two moments or must
 * not. The canvas only: T08's popups sit at 64%, inside this band, and animate on CSS for .9 s whether or not the loop
 * runs, so a popup starting near A18n's stop changed the band with the loop stopped (T08 section 10). withUi keeps the
 * UI layer, for the control that shows a popup did move in the band.
 */
export async function floorClip(page: Page, withUi = false): Promise<Buffer> {
  const vp = page.viewportSize()!;
  const y = Math.round(vp.height * 0.62);
  const clip = { x: 0, y, width: vp.width, height: Math.round(vp.height * 0.2) };
  return withUi ? page.screenshot({ clip }) : page.screenshot({ clip, style: HIDE_UI_STYLE });
}

/** T08's two warm panels (DI-89), and the token in `#mv-ui`'s `data-view` that shows each. */
export type WarmPanel = 'hud' | 'cruise';
export interface PanelState { shown: boolean; view: string; ariaHidden: string | null; inert: boolean; opacity: number }

/**
 * Whether a player sees the HUD or the CRUISE card (D-012, DI-89). T08 lays both out and draws them during DEMO at
 * opacity .001, inert and aria-hidden, so Playwright's toBeVisible() is true for them in every mode and cannot tell a
 * player's view from a warm panel. Shown means all three of T08's signals agree: `#mv-ui`'s `data-view` names the panel,
 * the element is not aria-hidden, and its computed opacity is above .5. Uses evaluate, so only after a gesture or where
 * activation does not matter.
 */
export async function panelState(page: Page, panel: WarmPanel): Promise<PanelState> {
  return page.evaluate((p) => {
    const root = document.getElementById('mv-ui')!;
    const el = root.querySelector<HTMLElement>(`[data-mv="${p}"]`)!;
    const view = root.getAttribute('data-view') ?? '';
    const ariaHidden = el.getAttribute('aria-hidden');
    const opacity = Number(getComputedStyle(el).opacity);
    const named = view.split(' ').includes(p === 'hud' ? 'hud' : 'menu');
    return { shown: named && ariaHidden !== 'true' && opacity > 0.5, view, ariaHidden, inert: el.hasAttribute('inert'), opacity };
  }, panel);
}
