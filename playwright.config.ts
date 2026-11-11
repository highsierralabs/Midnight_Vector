import { defineConfig } from 'playwright/test';
import { findChromium } from './tests/support/browser';

const port = process.env['TERRAIN_PORT'] ?? '5100';

function executable(kind: 'gpu' | 'software'): string {
  const path = findChromium(kind);
  if (!path) {
    throw new Error('No cached Chromium found. Set TERRAIN_CHROMIUM / TERRAIN_HEADLESS_SHELL, or run: npx playwright install chromium');
  }
  return path;
}

const GPU_ARGS = ['--ignore-gpu-blocklist', ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : [])];
const TIMING = /\.timing\.spec\.ts$/;
const NOWEBGL = /\.nowebgl\.spec\.ts$/;

export default defineConfig({
  testDir: 'tests',
  testMatch: '**/*.spec.ts',
  // With no --output flag a stray run stays in this folder, because Playwright clears its output folder at start.
  outputDir: 'test-results/default',
  snapshotPathTemplate: 'test-refs/{projectName}/{testFileName}/{arg}{ext}',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${port}`, headless: true },
  webServer: {
    command: `npx vite --port ${port} --strictPort`,
    // Not `/`, which is 404 until T10, and Playwright does not accept 404 as ready.
    url: `http://127.0.0.1:${port}/@vite/client`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'gpu',
      testIgnore: [TIMING, NOWEBGL],
      use: {
        viewport: { width: 1920, height: 1080 },
        launchOptions: { executablePath: executable('gpu'), args: GPU_ARGS },
      },
    },
    {
      name: 'gpu-timing',
      testMatch: TIMING,
      use: {
        viewport: { width: 1920, height: 1080 },
        launchOptions: {
          executablePath: executable('gpu'),
          args: [...GPU_ARGS, '--disable-gpu-vsync', '--disable-frame-rate-limit', '--enable-precise-memory-info', '--js-flags=--expose-gc'],
        },
      },
    },
    {
      name: 'software',
      testIgnore: [TIMING, NOWEBGL],
      use: {
        viewport: { width: 640, height: 360 },
        launchOptions: { executablePath: executable('software'), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
      },
    },
    {
      name: 'no-webgl',
      testMatch: NOWEBGL,
      use: {
        launchOptions: { executablePath: executable('gpu'), args: ['--disable-3d-apis'] },
      },
    },
  ],
});
