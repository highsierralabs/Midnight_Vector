// A normal visit never fetches the harness (section 11.3), and this test can tell. Two throwaway builds: dynamic mirrors
// the seam, static does what must never happen. A built chunk is found by the marker a side effect writes, so a build that
// removes it fails the test rather than passing on nothing.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Page } from 'playwright/test';
import { expect, test } from '../support/pw';
import { serveDist, type DistServer } from './support/distServer';
import { armedOnly } from './support/open';

const ISO = resolve('test-results/T09-iso');
const MARKER = 'MV-HARNESS-CHUNK';

function build(mode: 'dynamic' | 'static'): void {
  const r = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--config', 'tests/forever/fixture/iso/vite.config.ts'], {
    env: { ...process.env, ISO_MODE: mode },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
}

/** The files holding the marker, as paths relative to the build root. */
function markedFiles(root: string): string[] {
  const assets = join(root, 'assets');
  if (!existsSync(assets)) return [];
  return readdirSync(assets)
    .filter((f) => f.endsWith('.js') && readFileSync(join(assets, f), 'utf8').includes(MARKER))
    .map((f) => `assets/${f}`);
}

interface Visit { requests: string[]; marker: unknown; mv: unknown; out: string | null }

async function visit(page: Page, url: string): Promise<Visit> {
  const requests: string[] = [];
  const onRequest = (r: { url(): string }): void => { requests.push(r.url()); };
  page.on('request', onRequest);
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('#out')?.textContent !== 'booting');
  page.off('request', onRequest);
  const got = await page.evaluate(() => ({
    marker: window.__mvHarnessChunk,
    mv: window.__mv,
    out: document.querySelector('#out')?.textContent ?? null,
  }));
  return { requests, ...got };
}

function fetched(v: Visit, file: string): number {
  return v.requests.filter((u) => new URL(u).pathname.endsWith(`/${file}`)).length;
}

test.describe('built fixture', () => {
  let dynamicServer: DistServer;
  let staticServer: DistServer;
  let dynamicMarked: string[];
  let staticMarked: string[];

  test.beforeAll(async ({}, info) => {
    test.skip(info.project.name !== 'gpu', 'one rasterizer is enough');
    test.setTimeout(240_000);
    build('dynamic');
    build('static');
    dynamicMarked = markedFiles(join(ISO, 'dynamic'));
    staticMarked = markedFiles(join(ISO, 'static'));
    console.log(`ISO marked dynamic ${JSON.stringify(dynamicMarked)} static ${JSON.stringify(staticMarked)}`);
    dynamicServer = await serveDist(join(ISO, 'dynamic'));
    staticServer = await serveDist(join(ISO, 'static'));
  });

  test.afterAll(async () => {
    await dynamicServer?.close();
    await staticServer?.close();
  });

  test('the marker is in exactly one file of each build, or this test would be vacuous (A16)', () => {
    expect(dynamicMarked.length, 'zero means the marker was tree-shaken').toBe(1);
    expect(staticMarked.length, 'zero means the marker was tree-shaken').toBe(1);
  });

  test('normal visits to the dynamic build fetch no harness, from a nested path (A16)', async ({ page }) => {
    const file = dynamicMarked[0]!;
    for (const suffix of ['', '?harnessx=1', '#harness']) {
      const v = await visit(page, `${dynamicServer.url}${suffix}`);
      console.log(`ISO dynamic "${suffix}": ${v.requests.length} requests, marked file ${fetched(v, file)}, ${v.out}`);
      expect(fetched(v, file), `visit "${suffix}"`).toBe(0);
      expect(v.marker, `visit "${suffix}"`).toBeUndefined();
      expect(v.mv, `visit "${suffix}"`).toBeUndefined();
      expect(v.out).toContain('no harness');
      expect(v.requests.every((u) => new URL(u).pathname.startsWith('/some/nested/path/'))).toBe(true);
    }
  });

  test('positive control: ?harness fetches it exactly once, so the log can see it (A16)', async ({ page }) => {
    const file = dynamicMarked[0]!;
    const v = await visit(page, `${dynamicServer.url}?harness`);
    console.log(`ISO dynamic "?harness": ${v.requests.length} requests, marked file ${fetched(v, file)}, ${v.out}`);
    expect(fetched(v, file)).toBe(1);
    expect(v.marker).toBe(MARKER);
    expect(v.out).toContain('harness function');
  });

  test('negative control: a static import reaches a normal visit (A16)', async ({ page }) => {
    const file = staticMarked[0]!;
    const v = await visit(page, staticServer.url);
    console.log(`ISO static "": ${v.requests.length} requests, marked file ${fetched(v, file)}, ${v.out}`);
    expect(fetched(v, file), 'the assertion of the normal-visit test must fail here').toBe(1);
    expect(v.marker).toBe(MARKER);
  });
});

test.describe('the real build', () => {
  test('dist and the dev server fetch no harness on a normal visit, and do under ?harness (B2)', async ({ page }, info) => {
    armedOnly();
    test.skip(info.project.name !== 'gpu', 'one rasterizer is enough');
    test.setTimeout(240_000);
    const built = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    expect(built.status, `${built.stdout}${built.stderr}`).toBe(0);
    const marked = markedFiles(resolve('dist'));
    expect(marked.length, 'zero means the marker was tree-shaken').toBe(1);
    const file = marked[0]!;

    const server = await serveDist('dist');
    try {
      const requests: string[] = [];
      page.on('request', (r) => { requests.push(r.url()); });
      await page.goto(server.url);
      await page.waitForLoadState('networkidle');
      expect(requests.filter((u) => new URL(u).pathname.endsWith(`/${file}`))).toEqual([]);
      expect(await page.evaluate(() => window.__mv)).toBeUndefined();
      requests.length = 0;
      await page.goto(`${server.url}?harness`);
      await page.waitForFunction(() => window.__mv?.ready === true, undefined, { timeout: 60_000 });
      expect(requests.filter((u) => new URL(u).pathname.endsWith(`/${file}`)).length).toBeGreaterThanOrEqual(1);
    } finally {
      await server.close();
    }

    const dev: string[] = [];
    page.on('request', (r) => { dev.push(r.url()); });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(dev.filter((u) => /\/src\/harness\//.test(u))).toEqual([]);
    expect(await page.evaluate(() => window.__mv)).toBeUndefined();
    dev.length = 0;
    await page.goto('/?harness');
    await page.waitForFunction(() => window.__mv?.ready === true, undefined, { timeout: 60_000 });
    expect(dev.filter((u) => /\/src\/harness\//.test(u)).length).toBeGreaterThanOrEqual(1);
  });
});
