// Print-only, DI-67: post-on identity at MSAA 2 under ANGLE's Vulkan backend, on the same GPU. DI-67 moved every gated
// same-state compare to MSAA 0, because through D3D11 a blended MSAA resolve differs between identical renders by up to
// 173 B, while Vulkan read 0 (T05's repair). This run keeps MSAA 2 in view through a backend without that effect, so a
// reader can tell the driver from the code. Nothing about the frames is asserted, by DI-67's terms ("recorded, not
// gated"). The one assertion is that the run really was Vulkan, so the print cannot be mislabelled.
//
// Its own file because launchOptions is a worker option, which Playwright accepts only at the top of a file, never in a
// describe group [O: node_modules/playwright/lib/common/index.js, "because it forces a new worker"]. T00's
// playwright.config.ts is unchanged: this use() value replaces the gpu project's launch options for this file alone, so
// the executable comes from T00's findChromium and the one GPU flag that matters here is repeated.
//
// DI-71(2): where the launched renderer is not Vulkan, the test skips and prints why, instead of failing. A software
// rasterizer counts as not Vulkan, though SwiftShader's string names Vulkan (support/backend.ts). The backend is read on
// a blank page before the harness opens, so a launch that fell back to SwiftShader or to no WebGL skips there rather
// than failing openHarness's rasterizer check. Skip messages start NOT VULKAN, which B1 tells apart from UNARMED.
import { findChromium } from '../support/browser';
import { expect, test } from '../support/pw';
import { EXACT, GPU_SAME_STATE } from '../../src/harness/sweeps';
import { notVulkanReason } from './support/backend';
import { openHarness } from './support/open';

const KS = [977, 15259, 976562500, 15258789063] as const;
const NEAR = { chunk: 5, local: 12.5, tick: 28800 };

const exe = findChromium('gpu');
test.use({ launchOptions: { ...(exe === undefined ? {} : { executablePath: exe }), args: ['--ignore-gpu-blocklist', '--use-angle=vulkan'] } });

test.setTimeout(240_000);

// In beforeAll, so no browser is launched with these options under any other project.
test.beforeAll(({}, info) => {
  test.skip(info.project.name !== 'gpu', 'print-only, gpu project: Vulkan is a GPU backend');
});

test('identity vulkan, print-only: full, MSAA 2, under --use-angle=vulkan (DI-67, DI-71)', async ({ page }, info) => {
  // The page is still about:blank: one throwaway context reads the backend, then is released.
  const launched = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return { webgl2: false, renderer: '' };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { webgl2: true, renderer };
  });
  const why = notVulkanReason(launched.webgl2, launched.renderer);
  if (why !== null) console.log(`IDENTITY vulkan SKIPPED ${why}`);
  test.skip(why !== null, why ?? '');
  await openHarness(page, info);
  const r = await page.evaluate(({ keys, near, exact }) => {
    const mv = window.__mv!;
    const lab = window.__mvLab!;
    mv.manual(true);
    mv.setPost('full');
    mv.setMsaa(2);
    lab.settle(near);
    // EXACT, so compareAt reports the raw bytes and stops early only on a real difference.
    const results = keys.map((k) => ({ k, ...lab.compareAt(near, { chunk: 5 + 1024 * k, local: near.local, tick: near.tick }, { tolerance: exact }) }));
    return { renderer: lab.rendererInfo().renderer, results };
  }, { keys: [...KS], near: NEAR, exact: { ...EXACT } });
  console.log(`IDENTITY vulkan renderer ${r.renderer}`);
  for (const e of r.results) {
    const withinBound = e.selfBytes <= GPU_SAME_STATE.bytes && e.selfMax <= GPU_SAME_STATE.max && e.crossBytes <= GPU_SAME_STATE.bytes && e.crossMax <= GPU_SAME_STATE.max;
    console.log(`IDENTITY vulkan post-on MSAA 2 k=${e.k} exactPass=${e.pass} withinDI58=${withinBound} ${JSON.stringify(e)}`);
  }
  info.annotations.push({ type: 'print-only', description: 'DI-67: post-on MSAA 2 identity under Vulkan, recorded and not gated' });
  // The harness page must have run on the backend the blank page saw, or this print is mislabelled.
  expect(notVulkanReason(true, r.renderer), 'the run must really be on hardware Vulkan, or this print is mislabelled').toBeNull();
});
