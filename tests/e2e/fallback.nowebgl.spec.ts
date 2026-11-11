// A1: under --disable-3d-apis the poster stays, says why, and the engine is never fetched.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, saveShot, test } from '../support/pw';

test('no WebGL2: the poster says NO SIGNAL and no engine module is requested (A1)', async ({ page }, info) => {
  const requests: string[] = [];
  page.on('request', (r) => { requests.push(new URL(r.url()).pathname); });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-mv-boot', 'unsupported');
  await expect(page.locator('#mv-poster')).toBeVisible();
  await expect(page.locator('#mv-poster-title')).toHaveText('NO SIGNAL');
  const msg = (await page.locator('#mv-poster-msg').textContent()) ?? '';
  expect(msg).toContain('WebGL2');
  expect(msg).toContain('floating-point');
  // The same key phrases are in T08's no-webgl2 copy, read from disk.
  const copy = readFileSync(resolve('src/ui/copy.ts'), 'utf8');
  const body = /'no-webgl2':\s*\{[^}]*body:\s*'([^']*)'/.exec(copy)?.[1] ?? '';
  expect(body).toContain('WebGL2');
  expect(body).toContain('floating-point');
  await page.waitForTimeout(1000);
  console.log(`REQUESTS ${JSON.stringify(requests)}`);
  expect(requests).toContain('/');
  expect(requests).toContain('/src/main.ts');
  expect(requests.filter((p) => /\/src\/app\/|three|postprocessing/.test(p))).toEqual([]);
  await saveShot(page, info, 'nowebgl-poster');
});
