import { defineConfig } from 'vitest/config';

export default defineConfig({
  cacheDir: `node_modules/.vite/vitest-${process.env['TERRAIN_TASK'] ?? 'all'}`,
  test: {
    environment: 'node',
    // T01 to T09 share these CPUs, and a limit near a test's idle time turns machine load into a red gate (T00 section 11).
    testTimeout: 30_000,
    include: ['tests/unit/**/*.test.ts', 'tests/boundaries/*.test.ts'],
    exclude: ['tests/boundaries/fixtures/**', 'node_modules/**'],
  },
});
