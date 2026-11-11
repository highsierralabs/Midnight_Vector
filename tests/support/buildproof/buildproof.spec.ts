import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, resolve } from 'node:path';
import { expect, test } from '../pw';

const OUT = resolve('test-results/T00/build-proof');
const PREFIX = '/some/nested/path/';
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

function serve(): Promise<Server> {
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    if (!path.startsWith(PREFIX)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const rel = normalize(path.slice(PREFIX.length) || 'index.html');
    const file = join(OUT, rel);
    if (!file.startsWith(OUT) || !existsSync(file)) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((done) => { server.listen(0, '127.0.0.1', () => done(server)); });
}

// Every test here reads the build, so it happens before any of them, and no test depends on a leftover or on test order.
test.beforeAll(({}, info) => {
  if (info.project.name !== 'gpu') return;
  const built = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--config', 'tests/support/buildproof/vite.config.ts'], { encoding: 'utf8' });
  expect(built.status, `${built.stdout}${built.stderr}`).toBe(0);
});

test('the production bundle runs from a nested path, with relative URLs (A14b)', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', 'one rasterizer is enough');
  const html = readFileSync(join(OUT, 'index.html'), 'utf8');
  expect(html).toContain('src="./assets/');
  expect(html).not.toMatch(/(?:src|href)="\/(?!\/)/);

  const server = await serve();
  const failed: string[] = [];
  page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
  page.on('requestfailed', (r) => { failed.push(`failed ${r.url()}`); });
  try {
    const { port } = server.address() as AddressInfo;
    await page.goto(`http://127.0.0.1:${port}${PREFIX}`);
    await expect(page.locator('#out')).toHaveText(/^build proof ok: three r187, common \d+ chars$/);
    console.log(`BUILDPROOF ${await page.locator('#out').textContent()}`);
    expect(failed).toEqual([]);
  } finally {
    await new Promise((done) => { server.close(done); });
  }
});

test.describe('negative control', () => {
  test.use({ allowConsoleErrors: true });

  test('the request log sees a 404, so "no failed request" can fail (A14b)', async ({ page }, info) => {
    test.skip(info.project.name !== 'gpu', 'one rasterizer is enough');
    const server = await serve();
    const failed: string[] = [];
    page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
    try {
      const { port } = server.address() as AddressInfo;
      await page.goto(`http://127.0.0.1:${port}${PREFIX}`);
      const status = await page.evaluate((url) => fetch(url).then((r) => r.status), `${PREFIX}assets/missing.js`);
      expect(status).toBe(404);
      expect(failed.length).toBe(1);
      expect(failed[0]).toContain('missing.js');
    } finally {
      await new Promise((done) => { server.close(done); });
    }
  });
});
