// A28: no program links after the first frame, across a full tier cycle, before and after a context restore. Counted on
// gl.linkProgram, T06's method, because renderer.info.programs.length does not show a recompile.
import type { Page } from 'playwright/test';
import { expect, test } from '../support/pw';
import { linkSpyScript, loseContext, nodeWait, openApp, restoreContext } from './lib/app';

test.beforeEach(({}, info) => { test.skip(info.project.name !== 'gpu', 'gpu only'); });

async function links(page: Page): Promise<number> {
  return page.evaluate(() => window.__mvLinks ?? -1);
}

/** Forces each tier in turn with real frames between, so T03's and T05's 30-frame ramps run to the end. */
async function tierCycle(page: Page): Promise<{ tier: number; links: number; rendered: number }[]> {
  const out: { tier: number; links: number; rendered: number }[] = [];
  for (const t of [4, 3, 2, 1, 0, 'auto'] as const) {
    await page.evaluate((tier) => { window.__mvE2e!.host.governor.force(tier); }, t);
    await page.evaluate(async () => {
      const h = window.__mvE2e!;
      const r0 = h.counters.rendered;
      await new Promise<void>((res) => {
        const tick = (): void => { if (h.counters.rendered >= r0 + 45) res(); else requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      });
    });
    out.push({ tier: await page.evaluate(() => window.__mv!.stats().tier), links: await links(page), rendered: await page.evaluate(() => window.__mvE2e!.counters.rendered) });
  }
  return out;
}

test('no link after the first frame across a tier cycle, and again after a restore; a new material does link (A28)', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(linkSpyScript);
  await openApp(page, '&tier=3');
  await nodeWait(500);
  const n0 = await links(page);
  const cycle1 = await tierCycle(page);
  await page.evaluate(() => { window.__mvE2e!.host.governor.force(3); });
  await nodeWait(300);
  await loseContext(page);
  await nodeWait(300);
  await restoreContext(page);
  await expect(page.locator('[data-mv="context-lost"]')).toBeHidden();
  await nodeWait(500);
  const n1 = await links(page);
  const cycle2 = await tierCycle(page);

  // Negative control: a new ShaderMaterial mesh, built from the classes already in the scene, links on first render.
  const control = await page.evaluate(async () => {
    const h = window.__mvE2e!;
    const scene = h.host.ctx.scene;
    interface Template { constructor: new (...a: unknown[]) => unknown; geometry: unknown; material: { constructor: new (o: object) => unknown } }
    const found: Template[] = [];
    scene.traverse((o) => {
      const m = o as unknown as { isMesh?: boolean; material?: { isShaderMaterial?: boolean } };
      if (found.length === 0 && m.isMesh && m.material?.isShaderMaterial) found.push(o as unknown as Template);
    });
    const t = found[0];
    if (!t) return { before: -1, after: -1 };
    const mat = new t.material.constructor({ vertexShader: 'void main() { gl_Position = vec4(0.0, 0.0, 0.0, 1.0); }', fragmentShader: 'void main() { gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0); }' });
    const mesh = new t.constructor(t.geometry, mat) as { frustumCulled: boolean; removeFromParent(): void };
    mesh.frustumCulled = false;
    const before = window.__mvLinks ?? -1;
    scene.add(mesh as never);
    const r0 = h.counters.rendered;
    await new Promise<void>((res) => {
      const tick = (): void => { if (h.counters.rendered >= r0 + 5) res(); else requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    const after = window.__mvLinks ?? -1;
    mesh.removeFromParent();
    return { before, after };
  });
  console.log(`A28 n0 ${n0}, cycle1 ${JSON.stringify(cycle1)}, n1 ${n1}, cycle2 ${JSON.stringify(cycle2)}, control ${JSON.stringify(control)}`);
  expect(n0).toBeGreaterThan(0);
  for (const c of cycle1) expect(c.links, `tier ${c.tier} before the loss`).toBe(n0);
  expect(n1).toBeGreaterThan(n0);
  for (const c of cycle2) expect(c.links, `tier ${c.tier} after the restore`).toBe(n1);
  expect(cycle1.map((c) => c.tier).slice(0, 5)).toEqual([4, 3, 2, 1, 0]);
  expect(control.after).toBeGreaterThan(control.before);
});
