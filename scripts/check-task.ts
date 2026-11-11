/**
 * PURPOSE
 *   The gates of `npm run check`, scoped to one task's owned files, so a sibling's half-written file cannot
 *   fail this task and this task cannot hide behind a sibling. Filtering CLI output would be unsound: tsc stops
 *   at syntax errors, so one syntax error elsewhere hides every type error everywhere. Hence the compiler API.
 * USAGE
 *   node scripts/check-task.ts T## [--root dir]
 * OUTPUT
 *   Diagnostics, one summary line per gate, then `check:task T## PASS` or `FAIL`. Exit 0, 1, or 2 on a bad plan.
 *   Playwright is not run here.
 * VERSION HISTORY
 *   1.0  2026-11-05  T00: first version.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import ts from 'typescript';
import { scanFiles } from './glsl-gate.ts';
import { expandOwned, ownsOf, readPlans } from './lib/plans.ts';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TS_SOURCE = /\.(?:ts|tsx|mts|cts)$/;
const LINTABLE = /\.(?:ts|mts|cts|js|mjs|cjs)$/;
const FIXTURES = 'tests/boundaries/fixtures/';

function key(path: string): string {
  const p = resolve(path).replaceAll('\\', '/');
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

function format(d: ts.Diagnostic): string {
  const text = ts.flattenDiagnosticMessageText(d.messageText, '\n');
  if (d.file && d.start !== undefined) {
    const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
    return `${d.file.fileName}(${line + 1},${character + 1}): error TS${d.code}: ${text}`;
  }
  return `error TS${d.code}: ${text}`;
}

interface GateResult { line: string; ok: boolean; vacuous: boolean }

function tscGate(root: string, owned: readonly string[]): GateResult {
  const ownedSources = owned.filter((p) => TS_SOURCE.test(p));
  const ownedKeys = new Map(ownedSources.map((p) => [key(join(root, p)), p]));
  const covered = new Set<string>();
  const out: string[] = [];
  let configs = 0;
  for (const name of ['tsconfig.json', 'tsconfig.node.json']) {
    const config = join(root, name);
    if (!existsSync(config)) continue;
    configs++;
    const configErrors: ts.Diagnostic[] = [];
    const host: ts.ParseConfigFileHost = {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (d) => configErrors.push(d),
    };
    const parsed = ts.getParsedCommandLineOfConfigFile(config, {}, host);
    if (!parsed) {
      for (const d of configErrors) out.push(format(d));
      continue;
    }
    for (const d of parsed.errors) {
      // TS18003 is "no inputs found": a config with nothing in it yet is not this task's error.
      if (d.code !== 18003) out.push(format(d));
    }
    const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
    for (const d of program.getOptionsDiagnostics()) out.push(format(d));
    for (const d of program.getGlobalDiagnostics()) out.push(format(d));
    for (const sf of program.getSourceFiles()) {
      if (!ownedKeys.has(key(sf.fileName))) continue;
      covered.add(key(sf.fileName));
      for (const d of program.getSyntacticDiagnostics(sf)) out.push(format(d));
      for (const d of program.getSemanticDiagnostics(sf)) out.push(format(d));
    }
  }
  for (const [k, p] of ownedKeys) {
    if (!covered.has(k)) out.push(`${p}: owned TypeScript file is in no program, so no tsconfig checks it`);
  }
  for (const line of out) console.log(line);
  if (ownedSources.length === 0) {
    return { line: `tsc: VACUOUS, 0 owned files type-checked (${configs} configs)`, ok: false, vacuous: true };
  }
  return {
    line: `tsc: ${ownedSources.length} owned files, ${configs} configs, ${out.length} problems`,
    ok: out.length === 0,
    vacuous: false,
  };
}

async function eslintGate(root: string, owned: readonly string[]): Promise<GateResult> {
  const files = owned.filter((p) => LINTABLE.test(p));
  if (files.length === 0) {
    return { line: 'eslint: VACUOUS, 0 owned files linted', ok: false, vacuous: true };
  }
  const eslint = new ESLint({ cwd: resolve(root) });
  const results = await eslint.lintFiles(files);
  let errors = 0;
  let warnings = 0;
  for (const r of results) {
    errors += r.errorCount;
    warnings += r.warningCount;
    for (const m of r.messages) {
      console.log(`${r.filePath}(${m.line},${m.column}): ${m.ruleId ?? 'parse error'}: ${m.message}`);
    }
  }
  return {
    line: `eslint: ${files.length} owned files, ${errors} errors, ${warnings} warnings`,
    ok: errors === 0 && warnings === 0,
    vacuous: false,
  };
}

function vitestGate(root: string, task: string, owns: readonly string[], owned: readonly string[]): GateResult {
  const tests = owned.filter((p) => p.endsWith('.test.ts'));
  const ownsTestPath = owns.some((p) => p.startsWith('tests/unit/') || p.startsWith('tests/boundaries/'));
  if (!ownsTestPath && tests.length === 0) {
    return { line: 'vitest: not applicable', ok: true, vacuous: false };
  }
  if (tests.length === 0) {
    return { line: 'vitest: VACUOUS, the plan owns a unit-test path with no *.test.ts under it', ok: false, vacuous: true };
  }
  const vitest = join(PROJECT_ROOT, 'node_modules/vitest/vitest.mjs');
  const r = spawnSync(process.execPath, [vitest, 'run', ...tests], {
    cwd: resolve(root),
    env: { ...process.env, TERRAIN_TASK: task },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  const ok = r.status === 0;
  return { line: `vitest: ${tests.length} owned files, exit ${r.status}`, ok, vacuous: false };
}

function glslGate(root: string, owned: readonly string[]): GateResult {
  const r = scanFiles(owned, root);
  for (const hit of r.hits) console.log(hit);
  return { line: `glsl: ${r.files} owned files scanned, ${r.hits.length} hits`, ok: r.hits.length === 0, vacuous: false };
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const at = args.indexOf('--root');
  const root = at >= 0 ? args[at + 1] : '.';
  const task = args.find((a, i) => /^T\d\d$/.test(a) && (at < 0 || i !== at + 1));
  if (!task || !root) {
    console.error('usage: check-task.ts T## [--root dir]');
    return 2;
  }
  const plan = readPlans(root).find((p) => p.task === task);
  if (!plan) {
    console.error(`check:task: no plan matches plans/${task}-*.md under ${root}`);
    return 2;
  }
  const owns = ownsOf(plan);
  if (!owns || owns.length === 0) {
    console.error(`check:task: ${plan.file} has no parsable owns list`);
    return 2;
  }
  // T00 owns tests/boundaries/**, and these files are deliberately broken and in no tsconfig.
  const owned = expandOwned(root, owns).filter((p) => !p.startsWith(FIXTURES));

  const gates = [
    tscGate(root, owned),
    await eslintGate(root, owned),
    vitestGate(root, task, owns, owned),
    glslGate(root, owned),
  ];
  for (const g of gates) console.log(g.line);
  console.log('playwright: not run by check:task');
  const ok = gates.every((g) => g.ok);
  console.log(`check:task ${task} ${ok ? 'PASS' : 'FAIL'}`);
  return ok ? 0 : 1;
}

process.exitCode = await main();
