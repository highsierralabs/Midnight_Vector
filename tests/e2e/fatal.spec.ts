// A17: every route to the fatal page, and the load failure, each opaque over the poster with Reload focused.
import type { Page } from 'playwright/test';
import { expect, saveShot, test } from '../support/pw';
import { audioRecorderScript, collectConsole, nodeWait, openApp } from './lib/app';

test.beforeEach(({}, info) => { test.skip(info.project.name !== 'gpu', 'gpu only'); });
test.use({ allowConsoleErrors: true });

async function fatalState(page: Page): Promise<{ reason: string | null; heading: string; canvas: boolean; focused: string | null; opaque: string; poster: string }> {
  await expect(page.locator('[data-mv="fatal"]')).toBeVisible({ timeout: 30_000 });
  return page.evaluate(() => {
    const f = document.querySelector('[data-mv="fatal"]') as HTMLElement;
    return {
      reason: f.getAttribute('data-reason'),
      heading: f.querySelector('h1')?.textContent ?? '',
      canvas: document.querySelector('#mv-stage canvas') !== null,
      focused: document.activeElement?.getAttribute('data-mv') ?? null,
      opaque: getComputedStyle(f).backgroundColor + ' ' + getComputedStyle(f).backgroundImage.slice(0, 40),
      poster: getComputedStyle(document.getElementById('mv-poster')!).display,
    };
  });
}

test('runtime: a layer that throws gives THE ROAD BROKE, stops the loop, removes the canvas, disposes audio (A17)', async ({ page }, info) => {
  await page.addInitScript(audioRecorderScript);
  const log = await openApp(page);
  await page.mouse.click(960, 540);
  await nodeWait(500);
  await page.evaluate(() => {
    const layer = window.__mvE2e!.host.layers[0]!;
    layer.frame = () => { throw new Error('deliberate sky failure'); };
  });
  const st = await fatalState(page);
  const f0 = await page.evaluate(() => window.__mvE2e!.counters.frames);
  await nodeWait(400);
  const f1 = await page.evaluate(() => window.__mvE2e!.counters.frames);
  console.log(`A17 runtime ${JSON.stringify(st)} frames ${f0} -> ${f1}`);
  expect(st.reason).toBe('runtime-error');
  expect(st.heading).toBe('THE ROAD BROKE');
  expect(st.canvas).toBe(false);
  expect(st.focused).toBe('reload');
  expect(st.poster).toBe('none');
  expect(f1).toBe(f0);
  expect(log.of('error').some((l) => l.startsWith('FATAL runtime-error'))).toBe(true);
  expect(log.lines.some((l) => l.includes('AUDIOREC call close'))).toBe(true);
  await saveShot(page, info, 'fatal-runtime');
});

test('shader: a failed link gives BAD TAPE and SHADER_ERROR on the console (A17)', async ({ page }, info) => {
  await page.addInitScript(() => {
    const proto = WebGL2RenderingContext.prototype;
    const get = proto.getProgramParameter;
    proto.getProgramParameter = function getProgramParameter(this: WebGL2RenderingContext, p: WebGLProgram, name: number) {
      if (name === this.LINK_STATUS) return false;
      return get.call(this, p, name);
    } as typeof get;
  });
  const log = collectConsole(page);
  await page.goto('/?harness');
  const st = await fatalState(page);
  console.log(`A17 shader ${JSON.stringify(st)} errors ${log.of('error').length}: ${log.of('error').slice(0, 2).map((l) => l.slice(0, 80)).join(' | ')}`);
  expect(st.reason).toBe('shader-error');
  expect(st.heading).toBe('BAD TAPE');
  expect(st.canvas).toBe(false);
  expect(st.focused).toBe('reload');
  expect(log.of('error').some((l) => l.startsWith('SHADER_ERROR'))).toBe(true);
  await saveShot(page, info, 'fatal-shader');
});

test('renderer: a second getContext returning null gives NO SIGNAL from T08 (A17)', async ({ page }, info) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    let calls = 0;
    HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement, ...a: Parameters<typeof original>) {
      if (a[0] === 'webgl2' && ++calls >= 2) return null;
      return (original as (...x: unknown[]) => unknown).apply(this, a);
    } as typeof original;
  });
  const log = collectConsole(page);
  await page.goto('/');
  const st = await fatalState(page);
  console.log(`A17 renderer ${JSON.stringify(st)} errors ${JSON.stringify(log.of('error').map((l) => l.slice(0, 80)))}`);
  expect(st.reason).toBe('no-webgl2');
  expect(st.heading).toBe('NO SIGNAL');
  expect(st.canvas).toBe(false);
  expect(st.focused).toBe('reload');
  await saveShot(page, info, 'fatal-renderer');
});

/**
 * A17b (VI-r1): a GL fault during boot after ui.mount reaches the fatal route, not main.ts's poster copy. Before the fix
 * boot.ts rethrew to main.ts, which wrote only the poster's "failed to load" text, so T08's live title stayed drawn over
 * it, the canvas stayed, input stayed attached, there was no Reload, and a click built a running AudioContext. The two
 * faults are VI-r1's: createTexture throwing from its 7th call (inside three's setupRenderTarget during boot), and
 * getProgramParameter(COMPLETION_STATUS) throwing (inside WebGLProgram.isReady during post.precompile). The page is
 * opened under ?harness, so a fault that only struck after the first frame would log MV_READY; none may.
 */
const BOOT_FAULTS: Record<string, { message: string; script: () => void }> = {
  'createTexture throws from its 7th call': {
    message: 'A17b createTexture fault',
    script: () => {
      const p = WebGL2RenderingContext.prototype;
      const original = p.createTexture;
      let n = 0;
      p.createTexture = function createTexture(this: WebGL2RenderingContext) {
        if (++n > 6) throw new Error('A17b createTexture fault');
        return original.call(this);
      } as typeof original;
    },
  },
  'getProgramParameter(COMPLETION_STATUS) throws': {
    message: 'A17b COMPLETION_STATUS fault',
    script: () => {
      const p = WebGL2RenderingContext.prototype;
      const original = p.getProgramParameter;
      p.getProgramParameter = function getProgramParameter(this: WebGL2RenderingContext, prog: WebGLProgram, name: number) {
        if (name === 0x91B1) throw new Error('A17b COMPLETION_STATUS fault');   // COMPLETION_STATUS_KHR
        return original.call(this, prog, name);
      } as typeof original;
    },
  },
};

for (const [name, fault] of Object.entries(BOOT_FAULTS)) {
  test(`boot fault after ui.mount, ${name}: the fatal page covers the title, and a real click builds no AudioContext (A17b)`, async ({ page }, info) => {
    await page.addInitScript(fault.script);
    await page.addInitScript(audioRecorderScript);
    const log = collectConsole(page);
    // A console wait only, so the page reaches its failed state before anything here touches it.
    const settled = page.waitForEvent('console', { predicate: (m) => /^(FATAL|BOOT_FAILED|MV_READY)/.test(m.text()), timeout: 30_000 });
    await page.goto('/?harness');
    await settled;
    await nodeWait(500);
    // Read before the gesture: a click on the fatal page moves focus off Reload.
    const fatal = await page.locator('[data-mv="fatal"]').count();
    const st = fatal > 0 ? await fatalState(page) : null;
    // A real click where the title's launch button was, kept off the Reload button, then a launch key.
    const at = await page.evaluate(() => {
      const r = document.querySelector('[data-mv="launch"]')?.getBoundingClientRect();
      const rl = document.querySelector('[data-mv="reload"]')?.getBoundingClientRect();
      const p = r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: innerWidth / 2, y: innerHeight * 0.9 };
      const onReload = rl !== undefined && p.x >= rl.left && p.x <= rl.right && p.y >= rl.top && p.y <= rl.bottom;
      return onReload ? { x: innerWidth / 2, y: innerHeight * 0.97 } : p;
    });
    const n0 = log.lines.length;
    await page.mouse.click(at.x, at.y);
    await page.keyboard.press('KeyA');
    await nodeWait(1500);
    const audioAfter = log.lines.slice(n0).filter((l) => l.includes('AUDIOREC new'));
    // What a player sees of the title: every rendered element's centre is hit-tested, and none may be topmost.
    const title = await page.evaluate(() => {
      const t = document.querySelector('[data-mv="title"]');
      if (!t) return { present: false, points: 0, topmost: 0 };
      let points = 0;
      let topmost = 0;
      for (const el of [t, ...Array.from(t.querySelectorAll('*'))]) {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
        points++;
        const top = document.elementFromPoint(x, y);
        if (top !== null && t.contains(top)) topmost++;
      }
      return { present: true, points, topmost };
    });
    const boot = await page.locator('html').getAttribute('data-mv-boot');
    const fatalLines = log.of('error').filter((l) => l.startsWith('FATAL'));
    console.log(`A17b ${name}: fatal ${JSON.stringify(st)}, title ${JSON.stringify(title)}, boot ${boot}, audio after the click ${JSON.stringify(audioAfter)}, errors ${JSON.stringify(log.of('error').map((l) => l.slice(0, 90)))}`);
    expect(st, 'no [data-mv="fatal"] page: the boot fault did not reach the fatal route').not.toBeNull();
    expect(st!.reason).toBe('runtime-error');
    expect(st!.heading).toBe('THE ROAD BROKE');
    expect(st!.canvas).toBe(false);
    expect(st!.focused).toBe('reload');
    expect(st!.poster).toBe('none');
    expect(boot).toBe('running');
    expect(fatalLines.length, 'one FATAL line').toBe(1);
    expect(fatalLines[0], 'the FATAL line carries the injected fault, so the row tested this fault').toContain(fault.message);
    expect(log.of('error').some((l) => l.startsWith('BOOT_FAILED')), 'BOOT_FAILED is for failures before ui.mount only').toBe(false);
    expect(log.lines.some((l) => l.endsWith('MV_READY')), 'the fault struck during boot, before the first frame').toBe(false);
    expect(title.points, 'the title must still be in the DOM for the occlusion check to mean anything').toBeGreaterThan(3);
    expect(title.topmost, 'no part of the title is visible over the fatal page').toBe(0);
    expect(audioAfter, 'a real click and a launch key on the dead page build no AudioContext').toEqual([]);
    await saveShot(page, info, `fatal-boot-${fault.message.split(' ')[1]!.toLowerCase()}`);
  });
}

test('load failure: the app chunk 404 shows the poster with the load-failure text and logs BOOT_FAILED (A17)', async ({ page }, info) => {
  await page.route(/\/src\/app\/index\.ts/, (route) => route.fulfill({ status: 404, body: 'not found' }));
  const log = collectConsole(page);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-mv-boot', 'failed', { timeout: 30_000 });
  await expect(page.locator('#mv-poster')).toBeVisible();
  await expect(page.locator('#mv-poster .copy')).toBeVisible();
  await expect(page.locator('#mv-poster-msg')).toHaveText('The game failed to load. Reloading the page may help.');
  expect(log.of('error').some((l) => l.startsWith('BOOT_FAILED'))).toBe(true);
  await saveShot(page, info, 'fatal-load');
});
