// Config for the child run of A11f's negative control only (devshell.spec.ts). No npm script uses it. It keeps the
// repo's gpu project and `use`, and runs only consoleguard.control.ts. It has no webServer, because the parent run's
// Vite server is already up on TERRAIN_PORT, and a shorter timeout than the parent's, so a hung child ends first.
import { defineConfig } from 'playwright/test';
import root from '../../../playwright.config';

export default defineConfig({
  testDir: '.',
  testMatch: 'consoleguard.control.ts',
  outputDir: '../../../test-results/default',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: 'list',
  use: { ...root.use },
  projects: (root.projects ?? []).filter((p) => p.name === 'gpu'),
});
