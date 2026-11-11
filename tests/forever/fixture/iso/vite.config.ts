// Builds one of the two isolation fixtures, chosen by ISO_MODE: dynamic mirrors the seam, static is the negative control.
// outDir is under test-results/T09-iso, which no Playwright --output folder clears.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const mode = process.env['ISO_MODE'] === 'static' ? 'static' : 'dynamic';

export default defineConfig({
  root: resolve(here, mode),
  base: './',
  // Its own folder, so a build touches neither node_modules nor a running dev server's optimizer folder.
  cacheDir: resolve(here, '../../../../test-results/T09-iso/.vite'),
  logLevel: 'warn',
  build: {
    outDir: resolve(here, '../../../../test-results/T09-iso', mode),
    emptyOutDir: true,
    chunkSizeWarningLimit: 100_000,
  },
});
