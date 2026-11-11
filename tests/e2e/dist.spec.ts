// A27: the production build from a nested path. Every request same-origin under the prefix, no harness on a normal visit,
// one with ?harness, a real launch with audio, the gzip budget, no test code in the shipped chunks, no asset files.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect, test } from '../support/pw';
import { NESTED_PREFIX, serveDist } from '../forever/support/distServer';
import { audioRecorderScript, collectConsole, nodeWait } from './lib/app';

const DIST = resolve('dist');
const MARKER = 'MV-HARNESS-CHUNK';
const BUDGET_KB = 260;

/** Every file under root, as forward-slash paths relative to it. */
function listing(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(root, p).replaceAll('\\', '/'));
    }
  };
  walk(root);
  return out.sort();
}

/** Files a static site may ship under section 2 and R5: the page, scripts and styles only. */
function nonCode(files: readonly string[]): string[] {
  return files.filter((f) => !(f === 'index.html' || /\.(?:js|css)$/.test(f)));
}

test.describe('dist', () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== 'gpu', 'gpu only'); });

  test('the build runs from /some/nested/path/ with every request under it, and the budget holds (A27)', async ({ page }) => {
    test.setTimeout(180_000);
    const b = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    expect(b.status, `${b.stdout}${b.stderr}`).toBe(0);

    const files = listing(DIST);
    console.log(`A27 dist ${JSON.stringify(files)}`);
    expect(nonCode(files)).toEqual([]);
    // The listing helper's negative control: a planted image in a copied listing is reported.
    expect(nonCode([...files, 'assets/x.png'])).toEqual(['assets/x.png']);

    const js = files.filter((f) => f.endsWith('.js'));
    const html = readFileSync(join(DIST, 'index.html'), 'utf8');
    const entry = /src="\.\/(assets\/[^"]+\.js)"/.exec(html)?.[1];
    expect(entry).toBeDefined();
    const harness = js.filter((f) => readFileSync(join(DIST, f), 'utf8').includes(MARKER));
    expect(harness.length).toBe(1);
    const app = js.filter((f) => f !== entry && !harness.includes(f) && !/testHook/.test(f));
    expect(app.length).toBe(1);
    const gz = (f: string): number => gzipSync(readFileSync(join(DIST, f)), { level: 9 }).length / 1024;
    const shipped = [entry!, ...app];
    const total = shipped.reduce((s, f) => s + gz(f), 0);
    console.log(`A27 gzip -9: entry ${gz(entry!).toFixed(2)} KB, app ${gz(app[0]!).toFixed(2)} KB, sum ${total.toFixed(2)} KB of ${BUDGET_KB}; harness ${gz(harness[0]!).toFixed(2)} KB separately`);
    expect(total).toBeLessThanOrEqual(BUDGET_KB);
    for (const f of shipped) {
      const src = readFileSync(join(DIST, f), 'utf8');
      for (const name of ['createFakeHost', 'startDevShell', 'testCard', MARKER]) expect(src.includes(name), `${name} in ${f}`).toBe(false);
    }

    const server = await serveDist(DIST);
    try {
      const origin = new URL(server.url).origin;
      for (const query of ['', '?harness']) {
        const urls: string[] = [];
        const bad: string[] = [];
        const onReq = (r: { url(): string }): void => { if (!r.url().startsWith('data:')) urls.push(r.url()); };
        const onRes = (r: { url(): string; status(): number }): void => { if (r.status() > 399) bad.push(`${r.status()} ${r.url()}`); };
        page.on('request', onReq);
        page.on('response', onRes);
        const ready = query ? page.waitForEvent('console', { predicate: (m) => m.text() === 'MV_READY', timeout: 60_000 }) : null;
        await page.goto(`${server.url}${query}`);
        if (ready) await ready;
        else await expect(page.locator('html')).toHaveAttribute('data-mv-boot', 'running', { timeout: 30_000 });
        await nodeWait(500);
        page.off('request', onReq);
        page.off('response', onRes);
        const harnessFetches = urls.filter((u) => harness.some((h) => u.endsWith(h))).length;
        console.log(`A27 visit '${query}': ${urls.length} requests, harness fetches ${harnessFetches}, bad ${JSON.stringify(bad)}`);
        expect(bad).toEqual([]);
        for (const u of urls) {
          expect(new URL(u).origin).toBe(origin);
          expect(new URL(u).pathname.startsWith(NESTED_PREFIX), u).toBe(true);
        }
        expect(harnessFetches).toBe(query ? 1 : 0);
      }
    } finally {
      await server.close();
    }
  });

  test('a real click on the built site launches, km rises, audio starts (A27)', async ({ page }) => {
    test.setTimeout(60_000);
    await page.addInitScript(audioRecorderScript);
    const server = await serveDist(DIST);
    try {
      const log = collectConsole(page);
      await page.goto(server.url);
      await expect(page.locator('html')).toHaveAttribute('data-mv-boot', 'running', { timeout: 30_000 });
      await page.mouse.click(960, 700);
      await expect(page.locator('html')).toHaveAttribute('data-mv-mode', 'play');
      const km0 = Number.parseFloat((await page.locator('[data-mv="km"]').textContent()) ?? '0');
      await nodeWait(4000);
      const km1 = Number.parseFloat((await page.locator('[data-mv="km"]').textContent()) ?? '0');
      const audio = log.lines.filter((l) => l.includes('AUDIOREC'));
      console.log(`A27 built launch: km ${km0} -> ${km1}, audio ${JSON.stringify(audio.slice(0, 3))}`);
      expect(km1).toBeGreaterThan(km0);
      expect(audio[0]).toBe('log AUDIOREC new AudioContext running');
      expect(audio.some((l) => /start (source|buffer)/.test(l))).toBe(true);
    } finally {
      await server.close();
    }
  });
});
