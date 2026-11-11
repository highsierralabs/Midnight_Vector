// tests/support/browser.ts
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const RELATIVE = {
  gpu: ['chrome-win64/chrome.exe', 'chrome-linux64/chrome', 'chrome-linux-arm64/chrome',
        'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'],
  software: ['chrome-headless-shell-win64/chrome-headless-shell.exe',
             'chrome-headless-shell-linux64/chrome-headless-shell',
             'chrome-headless-shell-linux-arm64/chrome-headless-shell',
             'chrome-headless-shell-mac-arm64/chrome-headless-shell',
             'chrome-headless-shell-mac-x64/chrome-headless-shell'],
} as const;

/** Env override first, then the newest cached revision. undefined means use Playwright's own default. */
export function findChromium(kind: 'gpu' | 'software'): string | undefined {
  const override = process.env[kind === 'gpu' ? 'TERRAIN_CHROMIUM' : 'TERRAIN_HEADLESS_SHELL'];
  if (override) {
    if (!existsSync(override)) throw new Error(`browser override does not exist: ${override}`);
    return override;
  }
  const prefix = kind === 'gpu' ? 'chromium-' : 'chromium_headless_shell-';
  const roots = [
    process.env['PLAYWRIGHT_BROWSERS_PATH'],
    process.env['LOCALAPPDATA'] && join(process.env['LOCALAPPDATA'], 'ms-playwright'),
    process.env['XDG_CACHE_HOME'] && join(process.env['XDG_CACHE_HOME'], 'ms-playwright'),
    join(homedir(), '.cache', 'ms-playwright'),
    join(homedir(), 'Library', 'Caches', 'ms-playwright'),
  ];
  let best: { revision: number; path: string } | undefined;
  for (const root of roots) {
    if (!root || !existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      if (!name.startsWith(prefix)) continue;
      const revision = Number(name.slice(prefix.length));
      if (!Number.isInteger(revision) || (best && revision <= best.revision)) continue;
      for (const rel of RELATIVE[kind]) {
        const path = join(root, name, rel);
        if (existsSync(path)) { best = { revision, path }; break; }
      }
    }
  }
  return best?.path;
}
