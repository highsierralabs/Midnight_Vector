// The per-machine shimmer baseline: test-refs/T09/shimmer.json. A missing key fails the test, because a baseline written
// silently on a first run would make that run vacuous. Writing takes TERRAIN_WRITE_BASELINE=1.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface BaselineEntry { mean: number; frames: number; stepU: number; writtenUtc: string }
export type BaselineFile = Record<string, BaselineEntry>;

export const BASELINE_PATH = resolve('test-refs/T09/shimmer.json');
export const NO_BASELINE = 'No shimmer baseline for this machine. Inspect a run, then set TERRAIN_WRITE_BASELINE=1';

export function baselineKey(renderer: string, target: string, w: number, h: number, r0: number, r1: number): string {
  return `${renderer}|${target}|${w}x${h}|${r0}-${r1}`;
}

export function readBaselines(): BaselineFile {
  if (!existsSync(BASELINE_PATH)) return {};
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as BaselineFile;
}

export function writeBaseline(key: string, entry: BaselineEntry): void {
  const all = readBaselines();
  all[key] = entry;
  mkdirSync(dirname(BASELINE_PATH), { recursive: true });
  writeFileSync(BASELINE_PATH, `${JSON.stringify(all, null, 2)}\n`);
}

export function writingBaseline(): boolean {
  return process.env['TERRAIN_WRITE_BASELINE'] === '1';
}
