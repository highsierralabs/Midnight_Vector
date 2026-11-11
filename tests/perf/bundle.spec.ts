// Dist JS by gzip level 9, section 9.3. The harness chunk does not ship to a normal visitor, so it is excluded by its marker.
// A lower limit too, so an empty build cannot pass. B21 builds what it measures: a production build of index.html with
// the project's own config, written to this test's own output folder. So it always measures the current sources, and it
// never reads or rewrites a dist/ that another run may be serving or building. It never skips for want of a build: with
// no index.html there is nothing to build, and it fails saying so (VI-gates: the old skip let it exit 0 measuring nothing).
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect, test } from '../support/pw';

const UPPER_KB = 260;
const LOWER_KB = 100;
const MARKER = 'MV-HARNESS-CHUNK';

test('dist JS gzip at most 260 KB, harness chunk excluded (B21)', ({}, info) => {
  test.skip(info.project.name !== 'software', 'needs no browser, so one project is enough');
  test.setTimeout(180_000);
  expect(existsSync(resolve('index.html')), 'B21 builds the site from index.html (T10), and there is none: nothing to build or measure').toBe(true);
  const out = info.outputPath('dist');
  const built = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', out, '--emptyOutDir'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  expect(built.status, `the build failed, so B21 has nothing to measure:\n${built.stdout}${built.stderr}`).toBe(0);
  expect(existsSync(join(out, 'index.html')), `the build wrote no index.html to ${out}`).toBe(true);
  console.log(`BUNDLE built ${out}`);
  const assets = join(out, 'assets');
  let total = 0;
  let harness = 0;
  for (const name of readdirSync(assets)) {
    if (!name.endsWith('.js')) continue;
    const bytes = readFileSync(join(assets, name));
    const gz = gzipSync(bytes, { level: 9 }).length;
    if (bytes.includes(MARKER)) {
      harness += gz;
      console.log(`BUNDLE ${name} ${gz} B gzip, harness chunk, excluded`);
    } else {
      total += gz;
      console.log(`BUNDLE ${name} ${gz} B gzip`);
    }
  }
  console.log(`BUNDLE sum ${(total / 1024).toFixed(1)} KB, harness ${(harness / 1024).toFixed(1)} KB`);
  expect(harness, 'no chunk holds the marker, so nothing was excluded and the sum means something else').toBeGreaterThan(0);
  expect(total / 1024).toBeLessThanOrEqual(UPPER_KB);
  expect(total / 1024).toBeGreaterThan(LOWER_KB);
});
