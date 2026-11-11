/**
 * PURPOSE
 *   The GLSL grep gate of architecture.md section 4.5. Three tokens are banned on any line, comments included:
 *   the time uniform, a camera-position swizzle that reaches z, and the model matrix.
 * USAGE
 *   node scripts/glsl-gate.ts                default scope: src, dev and tests/support/devshell
 *   node scripts/glsl-gate.ts --root <dir>   scan a fixture instead
 * OUTPUT
 *   `file:line: banned NAME` for each hit, then a count. Zero files scanned is a failure, printed as VACUOUS.
 * VERSION HISTORY
 *   1.0  2026-11-05  T00: first version.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expandOwned } from './lib/plans.ts';

const BANNED: readonly RegExp[] = [
  /\buTime\b/g,
  /\bcameraPosition\s*\.\s*[xyzrgbastpq]*[zbp]/g,
  /\bmodelMatrix\b/g,
];
const SCANNABLE = /\.(?:glsl|vert|frag|ts|tsx|html)$/;

export const DEFAULT_SCOPE: readonly string[] = [
  'src/**/*.glsl', 'src/**/*.vert', 'src/**/*.frag', 'src/**/*.ts', 'src/**/*.tsx',
  'dev/**/*.glsl', 'dev/**/*.html', 'dev/**/*.ts',
  'tests/support/devshell/**/*.html', 'tests/support/devshell/**/*.ts',
];
const FIXTURE_SCOPE: readonly string[] = ['**/*.glsl', '**/*.vert', '**/*.frag', '**/*.ts', '**/*.tsx', '**/*.html'];

export interface ScanResult { files: number; hits: string[] }

/** Scans the given paths, relative to root. Files of other types are skipped and not counted. */
export function scanFiles(paths: readonly string[], root = '.'): ScanResult {
  const hits: string[] = [];
  let files = 0;
  for (const path of paths) {
    if (!SCANNABLE.test(path)) continue;
    files++;
    const lines = readFileSync(resolve(root, path), 'utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      for (const re of BANNED) {
        for (const m of lines[i]!.matchAll(re)) hits.push(`${path}:${i + 1}: banned ${m[0]}`);
      }
    }
  }
  return { files, hits };
}

if (import.meta.main) {
  const at = process.argv.indexOf('--root');
  const root = at >= 0 ? process.argv[at + 1] : undefined;
  if (at >= 0 && !root) {
    console.error('usage: glsl-gate.ts [--root <dir>]');
    process.exit(2);
  }
  const scanRoot = root ?? '.';
  const paths = expandOwned(scanRoot, root ? FIXTURE_SCOPE : DEFAULT_SCOPE);
  const r = scanFiles(paths, scanRoot);
  for (const hit of r.hits) console.log(hit);
  if (r.files === 0) {
    console.log('glsl:check VACUOUS: 0 files scanned');
    process.exit(1);
  }
  console.log(`glsl:check: ${r.files} files scanned, ${r.hits.length} hits`);
  process.exit(r.hits.length === 0 ? 0 : 1);
}
