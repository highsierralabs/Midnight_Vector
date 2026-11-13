// check:task and plans:check against small trees, run as the real scripts in a child process. Everything
// generated stays under test-results/T00/, and this file cleans its own temp dirs at the start of each run.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { HEADINGS, expandOwned, globsIntersect, parseFrontmatter, parseTaskRows } from '../../scripts/lib/plans.ts';
import { DEFAULT_SCOPE, scanFiles } from '../../scripts/glsl-gate.ts';

const TEMP = 'test-results/T00';
const CHECK_ROOT = 'tests/boundaries/fixtures/check-task';

function run(script: string, ...args: string[]): { code: number | null; out: string } {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const rows = parseTaskRows(readFileSync('architecture.md', 'utf8'));

interface PlanSpec { owns?: (owns: string[]) => string[]; headings?: (h: string[]) => string[]; }

function planText(task: string, owns: readonly string[], headings: readonly string[]): string {
  return [
    '---', `id: ${task}-fixture`, `title: ${task} fixture`, 'status: approved', 'owner: fixture', 'depends_on: []',
    `owns: [${owns.join(', ')}]`, 'reads: [architecture.md]', 'updated: 2026-11-05T00:00Z', '---', '',
    ...headings.flatMap((h) => [h, '', 'Text.', '']),
  ].join('\n');
}

const NUMBERED = HEADINGS.map((h, i) => `## ${i + 1}. ${h[0]!.toUpperCase()}${h.slice(1)}`);
const BARE = HEADINGS.map((h) => `## ${h}:`);

/** Writes a plan set from the section 12 table. Odd tasks use the second accepted heading form. */
function makePlans(name: string, specs: Record<string, PlanSpec | null> = {}, only?: readonly string[]): string {
  const root = join(TEMP, `plans-fixture-${name}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, 'plans'), { recursive: true });
  for (const [i, row] of rows.entries()) {
    if (only && !only.includes(row.task)) continue;
    const spec = specs[row.task];
    if (spec === null) continue;
    const owns = spec?.owns ? spec.owns([...row.owns]) : row.owns;
    const base = i % 2 === 0 ? NUMBERED : BARE;
    const headings = spec?.headings ? spec.headings([...base]) : base;
    writeFileSync(join(root, row.planFile), planText(row.task, owns, headings));
  }
  return root;
}

function touch(root: string, path: string): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, 'export {};\n');
}

function plansCheck(root: string, ...extra: string[]): { code: number | null; out: string } {
  return run('scripts/plans-check.ts', '--root', root, '--arch', 'architecture.md', ...extra);
}

beforeAll(() => {
  mkdirSync(TEMP, { recursive: true });
  for (const name of readdirSync(TEMP)) {
    if (name.startsWith('plans-fixture-') || name.startsWith('glsl-empty-')) {
      rmSync(join(TEMP, name), { recursive: true, force: true });
    }
  }
});

describe('section 12 rows', () => {
  it('finds 14 task rows with owned paths', () => {
    expect(rows.map((r) => r.task)).toEqual(['T00', 'T01', 'T02', 'T03', 'T04', 'T05', 'T06', 'T07', 'T08', 'T09', 'T10', 'T11', 'T12', 'T13']);
    expect(rows.every((r) => r.owns.length > 0)).toBe(true);
  });
});

describe('check:task fixture table', () => {
  const task = (id: string) => run('scripts/check-task.ts', id, '--root', CHECK_ROOT);

  it('T98: a clean task passes beside a broken sibling and a red sibling test', () => {
    const r = task('T98');
    expect(r.out).toContain('check:task T98 PASS');
    expect(r.out).not.toContain('TS1005');
    expect(r.out).not.toContain('TS2322');
    expect(r.code).toBe(0);
  }, 120_000);

  it('T97: owning the broken file fails, naming TS1005, TS2322 and a parse error', () => {
    const r = task('T97');
    expect(r.code).toBe(1);
    expect(r.out).toContain('TS1005');
    expect(r.out).toContain('TS2322');
    expect(r.out).toContain('parse error');
    expect(r.out).toContain('check:task T97 FAIL');
  }, 120_000);

  it('T96: a plan that owns nothing on disk is VACUOUS', () => {
    const r = task('T96');
    expect(r.code).toBe(1);
    expect(r.out).toContain('VACUOUS');
    expect(r.out).toContain('check:task T96 FAIL');
  }, 120_000);

  it('T95: clean code with a red owned test fails', () => {
    const r = task('T95');
    expect(r.code).toBe(1);
    expect(r.out).toContain('vitest: 1 owned files, exit 1');
    expect(r.out).toContain('check:task T95 FAIL');
  }, 120_000);

  it('T94: no such plan exits 2', () => {
    expect(task('T94').code).toBe(2);
  }, 120_000);

  it('T93: an owned type error is still found while a sibling has a syntax error', () => {
    const r = task('T93');
    expect(r.code).toBe(1);
    expect(r.out).toContain('TS2322');
    expect(r.out).toContain('bad.ts');
    expect(r.out).not.toContain('TS1005');
  }, 120_000);
});

describe('check:task, a tsconfig cannot silently skip an owned file', () => {
  it('T92: an owned .ts file in no program fails', () => {
    const r = run('scripts/check-task.ts', 'T92', '--root', CHECK_ROOT);
    expect(r.code).toBe(1);
    expect(r.out).toContain('other/orphan.ts: owned TypeScript file is in no program');
  }, 120_000);
});

describe('plans:check', () => {
  it('passes a clean plan set generated from section 12', () => {
    const r = plansCheck(makePlans('clean'));
    expect(r.out).toContain('14 plans');
    expect(r.out).toContain('0 problems');
    expect(r.code).toBe(0);
  });

  it('fails an overlap with T05 owning src/render/terrain/**, statically and on disk, naming both plans', () => {
    const root = makePlans('overlap', { T05: { owns: (o) => [...o, 'src/render/terrain/**'] } });
    const before = plansCheck(root);
    expect(before.code).toBe(1);
    expect(before.out).toContain('overlap: T03 src/render/terrain/** and T05 src/render/terrain/**');
    expect(before.out).not.toContain('overlap on disk');
    touch(root, 'src/render/terrain/a.ts');
    expect(plansCheck(root).out).toContain('overlap on disk: src/render/terrain/a.ts');
  });

  it('fails drift when dev/audio.html is dropped from T07', () => {
    const r = plansCheck(makePlans('drift', { T07: { owns: (o) => o.filter((p) => p !== 'dev/audio.html') } }));
    expect(r.code).toBe(1);
    expect(r.out).toContain('T07: owns is missing dev/audio.html');
  });

  it('fails an extra owned path, as drift the other way', () => {
    const r = plansCheck(makePlans('extra', { T07: { owns: (o) => [...o, 'dev/extra.html'] } }));
    expect(r.code).toBe(1);
    expect(r.out).toContain('T07: owns has dev/extra.html');
  });

  it('fails one missing plan, and --allow-missing lets it pass', () => {
    const root = makePlans('missing', { T09: null });
    const r = plansCheck(root);
    expect(r.code).toBe(1);
    expect(r.out).toContain('T09: no plan file');
    expect(plansCheck(root, '--allow-missing').code).toBe(0);
  });

  it('fails a heading out of order', () => {
    const swap = (h: string[]): string[] => { const c = [...h]; [c[2], c[3]] = [c[3]!, c[2]!]; return c; };
    const r = plansCheck(makePlans('order', { T02: { headings: swap } }));
    expect(r.code).toBe(1);
    expect(r.out).toContain('T02: template headings');
  });

  it('fails a missing heading', () => {
    const r = plansCheck(makePlans('dropped', { T02: { headings: (h) => h.slice(0, 13) } }));
    expect(r.code).toBe(1);
    expect(r.out).toContain('T02: template headings');
  });

  it('accepts the hero overlap between T00 and T04 only, statically and on disk', () => {
    const root = makePlans('hero', {}, ['T00', 'T04']);
    touch(root, 'src/contracts/glsl/hero.glsl');
    const r = plansCheck(root, '--allow-missing');
    expect(r.out).toContain('0 problems');
    expect(r.code).toBe(0);
  });

  it('rejects that same path from any other plan', () => {
    const r = plansCheck(makePlans('hero-bad', { T05: { owns: (o) => [...o, 'src/contracts/glsl/hero.glsl'] } }));
    expect(r.code).toBe(1);
    expect(r.out).toContain('overlap: T00 src/contracts/** and T05 src/contracts/glsl/hero.glsl');
  });

  it('ignores a plans/RECONCILIATION.md that has no frontmatter', () => {
    const root = makePlans('ledger');
    writeFileSync(join(root, 'plans/RECONCILIATION.md'), '# Ledger\n\nNot a plan.\n');
    writeFileSync(join(root, 'plans/README.md'), '# Index\n');
    const r = plansCheck(root);
    expect(r.out).toContain('14 plans');
    expect(r.code).toBe(0);
  });

  it('--approved fails a draft plan', () => {
    const root = makePlans('draft');
    const file = join(root, 'plans/T01-world.md');
    writeFileSync(file, readFileSync(file, 'utf8').replace('status: approved', 'status: draft'));
    expect(plansCheck(root).code).toBe(0);
    const r = plansCheck(root, '--approved');
    expect(r.code).toBe(1);
    expect(r.out).toContain('T01: status draft');
  });

  it('fails a status outside the lifecycle', () => {
    const root = makePlans('status');
    const file = join(root, 'plans/T01-world.md');
    writeFileSync(file, readFileSync(file, 'utf8').replace('status: approved', 'status: nearly'));
    expect(plansCheck(root).code).toBe(1);
  });
});

describe('glob intersection', () => {
  it.each([
    ['src/render/**', 'src/render/terrain/**', true],
    ['src/**', 'src/contracts/glsl/hero.glsl', true],
    ['src/render/terrain/**', 'src/render/sky/**', false],
    ['tsconfig*.json', 'tsconfig.node.json', true],
    ['tsconfig*.json', 'package.json', false],
    ['tests/unit/*/a.ts', 'tests/unit/core/*.ts', true],
    ['tests/**/x.ts', 'tests/a/b/x.ts', true],
    ['tests/**/x.ts', 'tests/a/b/y.ts', false],
    ['dev/terrain.html', 'dev/sky.html', false],
    ['a/*b', 'a/c*', true],
  ] as const)('%s and %s: %s', (a, b, want) => {
    expect(globsIntersect(a, b)).toBe(want);
    expect(globsIntersect(b, a)).toBe(want);
  });
});

describe('frontmatter', () => {
  it('reads a flow list on one line, with a trailing comment', () => {
    const f = parseFrontmatter('---\nid: T01\nstatus: draft      # draft | approved\nowns: [a/**, b.ts]   # the row\n---\nbody')!;
    expect(f.get('status')).toBe('draft');
    expect(f.get('owns')).toEqual(['a/**', 'b.ts']);
  });

  it('reads a block list', () => {
    const f = parseFrontmatter('---\nid: T01\nowns:\n  - a/**\n  - b.ts\nreads: []\n---\n')!;
    expect(f.get('owns')).toEqual(['a/**', 'b.ts']);
    expect(f.get('reads')).toEqual([]);
  });

  it('returns null with no frontmatter', () => {
    expect(parseFrontmatter('# Ledger\n')).toBeNull();
  });
});

describe('glsl gate', () => {
  const gate = (...args: string[]) => run('scripts/glsl-gate.ts', ...args);

  it('fails the banned fixture: 6 hits across 2 files', () => {
    const r = gate('--root', 'tests/boundaries/fixtures/glsl');
    expect(r.code).toBe(1);
    expect(r.out).toContain('2 files scanned, 6 hits');
    expect(r.out.split('\n').filter((l) => l.includes(': banned ')).length).toBe(6);
  });

  it('passes the near-miss fixture', () => {
    const r = gate('--root', 'tests/boundaries/fixtures/glsl-clean');
    expect(r.out).toContain('0 hits');
    expect(r.code).toBe(0);
  });

  it('an empty directory is VACUOUS and fails', () => {
    const empty = join(TEMP, 'glsl-empty-1');
    mkdirSync(empty, { recursive: true });
    const r = gate('--root', empty);
    expect(r.code).toBe(1);
    expect(r.out).toContain('VACUOUS');
  });

  // No exit code and no hit count here: this file runs in check:task T00, and the default scope covers siblings' paths.
  // Whole-repo cleanliness is the glsl:check step of npm run check.
  it('the default scope has files to scan', () => {
    expect(gate().out).toMatch(/[1-9]\d* files scanned/);
  });

  it("T00's own source and proof pages are clean", () => {
    const own = expandOwned('.', ['src/contracts/**', 'src/core/**', 'src/testing/**', 'tests/support/devshell/**']);
    const scan = scanFiles(own);
    expect(scan.files).toBeGreaterThan(0);
    expect(scan.hits).toEqual([]);
  });

  it('scans the whole default scope, including the proof pages', () => {
    expect(DEFAULT_SCOPE).toContain('tests/support/devshell/**/*.html');
    expect(DEFAULT_SCOPE).toContain('src/**/*.glsl');
    expect(DEFAULT_SCOPE).toContain('dev/**/*.html');
  });

  it('scanFiles skips other file types and does not count them', () => {
    expect(scanFiles(['package.json'], '.')).toEqual({ files: 0, hits: [] });
  });
});
