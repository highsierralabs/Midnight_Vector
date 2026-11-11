import type { FakeHost } from '../../../src/testing/fakeHost';
import { expect, test } from '../pw';

declare global { interface Window { __host?: FakeHost } }

test('createFakeHost has a real renderer and draws a pure function of state (A12)', async ({ page }) => {
  await page.goto('/tests/support/devshell/fakehost.html');
  await page.waitForFunction(() => window.__host !== undefined);
  const r = await page.evaluate(() => {
    const host = window.__host!;
    const gl = host.ctx.renderer.getContext();
    const read = (chunk: number, local: number, tick: number): Uint8Array => {
      host.renderState(chunk, local, tick);
      const out = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, out);
      return out;
    };
    const differ = (a: Uint8Array, b: Uint8Array): number => {
      let n = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
      return n;
    };
    const base = read(5, 3, 120);
    return {
      realRenderer: gl instanceof WebGL2RenderingContext,
      length: base.length,
      expected: gl.drawingBufferWidth * gl.drawingBufferHeight * 4,
      distant: differ(read(1024 + 5, 3, 120), base),
      farther: differ(read(1024 * 2 ** 30 + 5, 3, 120), base),
      nextRow: differ(read(6, 3, 120), base),
      nextLocal: differ(read(5, 3.5, 120), base),
      nextTick: differ(read(5, 3, 121), base),
      again: differ(read(5, 3, 120), base),
      nonBlack: base.some((v, i) => i % 4 !== 3 && v !== 0),
      calls: host.calls.renderState.length,
    };
  });
  console.log(`FAKEHOST ${JSON.stringify(r)}`);
  expect(r.realRenderer).toBe(true);
  expect(r.length).toBe(r.expected);
  expect(r.nonBlack).toBe(true);
  expect(r.distant).toBe(0);
  expect(r.farther).toBe(0);
  expect(r.again).toBe(0);
  expect(r.nextRow).toBeGreaterThan(0);
  expect(r.nextLocal).toBeGreaterThan(0);
  expect(r.nextTick).toBeGreaterThan(0);
  expect(r.calls).toBe(7);
});

test('scriptedFrame stays three-free in a browser, for T07 and T08 pages', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto('/tests/support/devshell/blank.html');
  const zoneIndex = await page.evaluate(async () => {
    const url = '/src/testing/scriptedFrame.ts';
    const m = await import(/* @vite-ignore */ url) as typeof import('../../../src/testing/scriptedFrame');
    return m.scriptedFrame(0, { at: { chunk: 300, local: 0 } }).zone.index;
  });
  expect(zoneIndex).toBe(3);
  expect(requests.some((u) => u.includes('scriptedFrame'))).toBe(true);
  expect(requests.filter((u) => /three|postprocessing/.test(u))).toEqual([]);
});
