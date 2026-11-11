import { expect, expectRasterizer, test } from '../pw';

test('no WebGL2 under --disable-3d-apis (A10d)', async ({ page }, info) => {
  await page.goto('/tests/support/devshell/blank.html');
  const webgl2 = await page.evaluate(() => document.createElement('canvas').getContext('webgl2') !== null);
  expect(webgl2).toBe(false);
  await expectRasterizer(page, info);
});

test.describe('the shell with no WebGL', () => {
  test.use({ allowConsoleErrors: true });

  test('leaves window.__shell absent and logs its error (M7)', async ({ page }) => {
    const logged: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') logged.push(m.text()); });
    await page.goto('/tests/support/devshell/smoke.html?manual=1');
    await expect.poll(() => logged.some((l) => l.includes('dev shell: WebGL renderer could not be created'))).toBe(true);
    expect(await page.evaluate(() => window.__shell === undefined)).toBe(true);
  });
});
