import { defineConfig } from 'vite';

function resolvePort(): number {
  const fromEnv = process.env['TERRAIN_PORT'];
  if (fromEnv) return Number(fromEnv);
  const i = process.argv.indexOf('--port');
  const fromArg = i >= 0 ? process.argv[i + 1] : undefined;
  return fromArg ? Number(fromArg) : 5100;
}

const port = resolvePort();

export default defineConfig({
  base: './',
  // A wrong dev path is a 404 rather than a silent SPA fallback.
  appType: 'mpa',
  // One optimizer folder per port, so parallel servers do not share one.
  cacheDir: `node_modules/.vite/p${port}`,
  // No reload on first import.
  optimizeDeps: { include: ['three', 'postprocessing'] },
  server: { host: '127.0.0.1', port, strictPort: true },
  preview: { host: '127.0.0.1', port, strictPort: true },
});
