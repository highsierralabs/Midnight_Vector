// Which page a suite runs on, and how it opens. The shell target has T09's real GPU pixels and no game. The app target is
// the integrated build, and exists from T10. An armed spec needs the app target: it skips with UNARMED until index.html
// exists, then must run, and B1 fails on any skip.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page, TestInfo } from 'playwright/test';
import type { Tier } from '../../../src/contracts/index';
import type {} from '../../../src/harness/index';   // brings window.__mv and window.__mvLab into the program
import { EXACT, GPU_SAME_STATE, type Tolerance } from '../../../src/harness/sweeps';
import { FAKE_SEED } from '../../../src/testing/fakeWorld';
import { expect, test } from '../../support/pw';
import { checkRasterizer } from '../../support/rasterizer';
import { installSpies, isolateFromHmr } from './spies';

export type Target = 'app' | 'shell';

/**
 * follow is for the shell only, and ignored on the app, which always does it: the shell's camera follows its sim, as the
 * app's renderState takes camX from the sim's prevX (section 8.1). Without it the shell pins camX at 0, and a spec that
 * steps the sim between two compared frames passes there and fails on the app (V1-T09, B12 and B14).
 */
export interface HarnessQuery { period?: number; tier?: Tier; seed?: number; follow?: boolean }

/**
 * DI-58: when two renders of one state count as the same frame, for the project a test runs under. On gpu at most 64
 * bytes differ, none by more than 1 level; on any other project 0 bytes. A fresh object, so a spec can pass it to the page.
 */
export function sameStateTolerance(project: string): Tolerance {
  return project === 'gpu' ? { ...GPU_SAME_STATE } : { ...EXACT };
}

/** TERRAIN_HARNESS_TARGET, else 'app' when index.html exists, else 'shell'. */
export function target(): Target {
  const forced = process.env['TERRAIN_HARNESS_TARGET'];
  if (forced === 'app' || forced === 'shell') return forced;
  if (forced) throw new Error(`TERRAIN_HARNESS_TARGET must be app or shell, got ${forced}`);
  return existsSync(resolve('index.html')) ? 'app' : 'shell';
}

/**
 * Skips an armed test until T10. TERRAIN_ARMED_ON_SHELL=1 runs it on the shell instead, to smoke out mistakes in a spec
 * that has nothing else to run on yet. Such a run proves nothing about the game, and its failures are expected wherever
 * the shell has no terrain, props or UI.
 */
export function armedOnly(): void {
  test.skip(target() !== 'app' && process.env['TERRAIN_ARMED_ON_SHELL'] !== '1', 'UNARMED: needs T10');
}

/** T09's calibration seed. Every stored baseline and limit here (B10's shimmer, B11's flood control, the perf and
 * allocation budgets) was measured at 1985, so a harness page names it when a spec gives no seed (DI-108). The real
 * page's own default, DEFAULT_SEED, moved to 155 (DI-102); the smoke and e2e suites that open it without a seed see 155. */
export const HARNESS_SEED = FAKE_SEED;

/**
 * The seed a harness page opens at when its spec gives none: TERRAIN_HARNESS_SEED, else HARNESS_SEED. The variable is for a
 * report run at another seed, such as B10 at the shipped 155 (DI-112). A stored baseline still describes 1985, so such a run's
 * baseline rows compare two scenes and are not a verdict; its absolute limits are.
 */
export function harnessSeed(): number {
  const s = process.env['TERRAIN_HARNESS_SEED'];
  if (s === undefined || s === '') return HARNESS_SEED;
  if (!/^\d+$/.test(s)) throw new Error(`TERRAIN_HARNESS_SEED must be a non-negative integer, got ${s}`);
  return Number(s);
}

/** The page's path and query. No side effects, so a spec can print or build on it. on picks a target other than the run's. */
export function harnessUrl(q: HarnessQuery = {}, on: Target = target()): string {
  const parts: string[] = [];
  if (q.period !== undefined) parts.push(`period=${q.period}`);
  if (q.tier !== undefined) parts.push(`tier=${q.tier}`);
  parts.push(`seed=${q.seed ?? harnessSeed()}`);
  if (q.follow === true && on === 'shell') parts.push('follow=1');
  if (on === 'app') return `/?harness${parts.length > 0 ? `&${parts.join('&')}` : ''}`;
  return `/tests/forever/fixture/shell.html${parts.length > 0 ? `?${parts.join('&')}` : ''}`;
}

/** Installs the spies, navigates, waits for window.__mv.ready, and asserts the rasterizer. */
export async function openHarness(page: Page, info: TestInfo, q: HarnessQuery = {}, on: Target = target()): Promise<void> {
  await isolateFromHmr(page);
  await installSpies(page);
  await page.goto(harnessUrl(q, on));
  await page.waitForFunction(() => window.__mv?.ready === true, undefined, { timeout: 60_000 });
  const r = await page.evaluate(() => window.__mvLab!.rendererInfo());
  expect(checkRasterizer(info.project.name, r.webgl2, r.renderer), `renderer string: ${r.renderer}`).toBeNull();
}
