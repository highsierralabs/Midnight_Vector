// The shared Playwright fixture. Imports only types from src/testing, so it works on a page with no shell.
import { test as base, expect, type Page, type TestInfo } from 'playwright/test';
import type {} from '../../src/testing/devShell';   // brings window.__shell into the program
import { checkRasterizer } from './rasterizer';

interface Fixtures {
  /** Set with test.use({ allowConsoleErrors: true }) where a test expects a console error. */
  allowConsoleErrors: boolean;
  consoleGuard: void;
}

/**
 * playwright/test plus an auto fixture. It answers favicon.ico with 204, collects console.error and pageerror, and
 * fails the test at teardown if any appeared. It adds no evaluate before a test's own actions, because evaluate
 * grants user activation and would void a gesture test. console.warn and console.info do not fail a test.
 */
export const test = base.extend<Fixtures>({
  allowConsoleErrors: [false, { option: true }],
  consoleGuard: [async ({ page, allowConsoleErrors }, use) => {
    await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204 }));
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
    page.on('pageerror', (e) => { errors.push(`pageerror: ${e.message}`); });
    await use();
    if (!allowConsoleErrors && errors.length > 0) {
      throw new Error(`${errors.length} console errors:\n${errors.join('\n')}`);
    }
  }, { auto: true }],
});

export { expect };

function withQuery(path: string, query?: Record<string, string | number>): string {
  if (!query) return path;
  const q = new URLSearchParams(Object.entries(query).map(([k, v]): [string, string] => [k, String(v)])).toString();
  return q === '' ? path : `${path}${path.includes('?') ? '&' : '?'}${q}`;
}

/** For shell pages only: navigates, waits for window.__shell.ready, fails early on a shader error, asserts the rasterizer. */
export async function openDevPage(page: Page, path: string, query?: Record<string, string | number>): Promise<void> {
  await page.goto(withQuery(path, query));
  await page.waitForFunction(() => {
    const s = window.__shell;
    return s !== undefined && (s.ready || s.shaderErrors.length > 0);
  });
  const errors = await page.evaluate(() => [...(window.__shell?.shaderErrors ?? [])]);
  if (errors.length > 0) throw new Error(`shader error on ${path}:\n${errors.join('\n')}`);
  await expectRasterizer(page, test.info());
}

/** Asserts the page got the rasterizer the project claims. Uses the shell when one exists, otherwise a throwaway context. */
export async function expectRasterizer(page: Page, info: TestInfo): Promise<void> {
  const got = await page.evaluate(() => {
    const shell = window.__shell;
    if (shell) {
      const r = shell.rendererInfo();
      return { webgl2: r.webgl2, renderer: r.renderer };
    }
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return { webgl2: false, renderer: '' };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    // One context per page where possible: too many active contexts evicts the oldest.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { webgl2: true, renderer };
  });
  const problem = checkRasterizer(info.project.name, got.webgl2, got.renderer);
  expect(problem, `renderer string: ${got.renderer}`).toBeNull();
}

/** Saves a viewport PNG in the test's output folder and prints "SCREENSHOT <absolute path>", so it can be opened and viewed. */
export async function saveShot(page: Page, info: TestInfo, name: string): Promise<string> {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path });
  console.log(`SCREENSHOT ${path}`);
  return path;
}
