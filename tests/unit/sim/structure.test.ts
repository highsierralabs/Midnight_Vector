// A15: text gates over src/sim, each shown failing on a violating string, plus the worlds that prove the sim does not know
// about the bend and that a world's exception is not swallowed.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { createSim } from '../../../src/sim/index';
import { NOBODY } from './fixtures/drive';
import { emptyWorld, gauntletWorld, noBendWorld, throwingWorld } from './fixtures/worlds';

const SIM_DIR = fileURLToPath(new URL('../../../src/sim/', import.meta.url));
const SRC_DIR = fileURLToPath(new URL('../../../src/', import.meta.url));
const FIXTURE_DIR = fileURLToPath(new URL('../../../test-results/T02/structure-fixture/', import.meta.url));

// The V1 verifier's condition on SimProbe: production code, T10's app included, constructs through createSim only, so
// createSimInternal, SimProbe and the module that holds them are reachable from tests alone.
const TEST_ONLY = /\bcreateSimInternal\b|\bSimProbe\b|['"][^'"\n]*\bsim\/sim(?:\.[jt]s)?['"]/;

/** Every .ts file under `dir`, by path relative to it with forward slashes, except those under its sim/ folder. */
function sourcesOutsideSim(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const entry of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
    const rel = entry.replaceAll('\\', '/');
    if (!rel.endsWith('.ts') || rel.startsWith('sim/')) continue;
    files.set(rel, readFileSync(dir + entry, 'utf8'));
  }
  return files;
}

/** Returns each file that reaches a test-only name, with what it reached. */
function testOnlyProblems(files: ReadonlyMap<string, string>): string[] {
  const problems: string[] = [];
  for (const [name, text] of files) {
    const m = TEST_ONLY.exec(text);
    if (m !== null) problems.push(`${name}: reaches ${m[0]}`);
  }
  return problems;
}
const BANNED = ['bendAt', '.height(', 'timeScale', 'Math.random', 'Date.now', 'performance.', 'localStorage', 'document', 'window'] as const;

/** Returns what is wrong with these sources, by file name, or an empty list. */
function structureProblems(files: ReadonlyMap<string, string>): string[] {
  const problems: string[] = [];
  let advances = 0;
  for (const [name, text] of files) {
    advances += text.split('advance(').length - 1;
    for (const word of BANNED) if (text.includes(word)) problems.push(`${name}: contains ${word}`);
  }
  if (advances !== 1) problems.push(`advance( appears ${advances} times, not once`);
  return problems;
}

function simSources(): Map<string, string> {
  const files = new Map<string, string>();
  for (const name of readdirSync(SIM_DIR)) if (name.endsWith('.ts')) files.set(name, readFileSync(SIM_DIR + name, 'utf8'));
  return files;
}

describe('text gates', () => {
  test('src/sim has the seven named files', () => {
    expect([...simSources().keys()].sort()).toEqual(['autopilot.ts', 'collision.ts', 'index.ts', 'objectives.ts', 'rules.ts', 'sim.ts', 'tuning.ts']);
  });

  test('src/sim passes', () => {
    expect(structureProblems(simSources())).toEqual([]);
  });

  test('index.ts exports createSim and nothing else', () => {
    const text = simSources().get('index.ts')!;
    expect(text.match(/\bexport\b/g)!.length).toBe(1);
    expect(text).toMatch(/export const createSim\b/);
  });

  test.each(BANNED.map((w) => [w]))('negative control: a file containing %s fails', (word) => {
    const good = new Map([['ok.ts', 'advance(travel, d);']]);
    expect(structureProblems(good)).toEqual([]);
    const bad = new Map([['ok.ts', 'advance(travel, d);'], ['bad.ts', `const x = ${word};`]]);
    expect(structureProblems(bad)).toEqual([`bad.ts: contains ${word}`]);
  });

  test.each([
    ['no call', 'const a = 1;'],
    ['two calls', 'advance(t, d); advance(t, d);'],
  ])('negative control: %s of advance( fails', (_name, text) => {
    expect(structureProblems(new Map([['a.ts', text]]))[0]).toMatch(/advance\( appears/);
  });
});

describe('createSimInternal and SimProbe stay test-only', () => {
  test('no file under src outside src/sim names them or imports sim/sim', () => {
    const files = sourcesOutsideSim(SRC_DIR);
    expect(files.size).toBeGreaterThan(10);
    expect(files.has('contracts/index.ts')).toBe(true);
    expect(testOnlyProblems(files)).toEqual([]);
  });

  test('negative control: a nested file that reaches them is reported, one under sim/ is not, and createSim passes', () => {
    mkdirSync(FIXTURE_DIR + 'app/deep', { recursive: true });
    mkdirSync(FIXTURE_DIR + 'sim', { recursive: true });
    const cases: readonly (readonly [string, string, string | null])[] = [
      ['app/clean.ts', "import { createSim } from '../sim/index';\nexport const s = createSim;\n", null],
      ['app/internal.ts', "import { createSimInternal } from '../sim/sim';\n", 'createSimInternal'],
      ['app/deep/probe.ts', "import type { SimProbe } from '../../sim/sim';\n", 'SimProbe'],
      ['app/deep/path.ts', "export * from '../../sim/sim.ts';\n", "'../../sim/sim.ts'"],
      ['main.ts', "const m = await import('./sim/sim');\n", "'./sim/sim'"],
      ['sim/sim.ts', 'export function createSimInternal(): void {}\n', null],
    ];
    for (const [name, text] of cases) writeFileSync(FIXTURE_DIR + name, text);
    const files = sourcesOutsideSim(FIXTURE_DIR);
    expect(files.has('sim/sim.ts')).toBe(false);
    const expected = cases.filter((c) => c[2] !== null && files.has(c[0])).map((c) => `${c[0]}: reaches ${c[2]}`).sort();
    expect(expected.length).toBe(4);
    expect(testOnlyProblems(files).sort()).toEqual(expected);
  });
});

describe('the bend', () => {
  test('1e6 DEMO steps on a world whose bendAt and height throw', () => {
    const sim = createSim(noBendWorld(gauntletWorld({ seed: 7, density: 0.6 })));
    for (let i = 0; i < 1e6; i++) {
      sim.step(NOBODY);
      sim.events.count = 0;
    }
    expect(sim.state.tick).toBe(1e6);
  }, 120000);

  test('negative control: that world does throw when asked', () => {
    const world = noBendWorld(emptyWorld());
    expect(() => world.height(0, 0, 1, 0)).toThrow(/height/);
    expect(() => world.bendAt({ chunk: 0, local: 0 }, { a: 0, c: 0, vMax: 1 })).toThrow(/bendAt/);
  });
});

describe('a world that throws', () => {
  test('travel has already risen in the throwing step, and the exception reaches the caller', () => {
    const sim = createSim(throwingWorld(emptyWorld(), 12));
    let before = { chunk: sim.state.travel.chunk, local: sim.state.travel.local };
    let tick = sim.state.tick;
    let threw = false;
    for (let i = 0; i < 2000 && !threw; i++) {
      before = { chunk: sim.state.travel.chunk, local: sim.state.travel.local };
      tick = sim.state.tick;
      try {
        sim.step(NOBODY);
      } catch (e) {
        threw = true;
        expect(String(e)).toMatch(/throwingWorld/);
      }
    }
    expect(threw).toBe(true);
    expect(sim.state.tick).toBe(tick + 1);
    expect(sim.state.travel.chunk).toBe(before.chunk + 1);
    expect(sim.state.travel.chunk + 5).toBe(12);
  });
});
