import { expect, expectRasterizer, openDevPage, saveShot, test } from '../pw';

const WANT: Record<string, RegExp> = {
  gpu: /NVIDIA|AMD|Intel|Apple|Direct3D|Vulkan|OpenGL/i,
  software: /SwiftShader/,
};

test('the project gets the rasterizer it claims, on a page with no shell (A10b)', async ({ page }, info) => {
  await page.goto('/tests/support/devshell/blank.html');
  await expectRasterizer(page, info);
  const renderer = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = innerWidth;
    canvas.height = innerHeight;
    canvas.style.display = 'block';
    document.body.append(canvas);
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true })!;
    gl.clearColor(0.1, 0.2, 0.6, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const ext = gl.getExtension('WEBGL_debug_renderer_info')!;
    return String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
  });
  console.log(`RENDERER ${info.project.name}: ${renderer}`);
  expect(renderer).toMatch(WANT[info.project.name] ?? /$^/);
  await saveShot(page, info, `raster-${info.project.name}`);
});

test('the shell reports the same rasterizer, through openDevPage (A10b)', async ({ page }, info) => {
  await openDevPage(page, '/tests/support/devshell/smoke.html', { manual: 1, tier: info.project.name === 'software' ? 0 : 3 });
  const r = await page.evaluate(() => window.__shell!.rendererInfo());
  console.log(`SHELL ${info.project.name}: ${JSON.stringify(r)}`);
  expect(r.webgl2).toBe(true);
  expect(r.depthBits).toBe(0);
  expect(r.renderer).toMatch(WANT[info.project.name] ?? /$^/);
  await saveShot(page, info, `shell-${info.project.name}`);
});
