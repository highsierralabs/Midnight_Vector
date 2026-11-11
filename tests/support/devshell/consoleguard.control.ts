// The bare test behind A11f's negative control. devshell.spec.ts runs it in a child Playwright process through
// consoleguard.config.ts and reads why it failed. It is meant to fail: the bad shader logs SHADER_ERROR, and pw.ts's
// console guard, left at its defaults, fails the test at teardown. Not a *.spec.ts file, so no suite collects it.
import { test } from '../pw';

test('the bad shader page, with allowConsoleErrors at its default', async ({ page }) => {
  await page.goto('/tests/support/devshell/smoke.html?bad=1&manual=1');
  await page.waitForFunction(() => (window.__shell?.shaderErrors.length ?? 0) > 0);
});
