/**
 * PURPOSE
 *   The verbatim gate. Each path fence in architecture.md must appear in its file, every non-blank
 *   line present and in order. Approved additions pass, a removal, edit or reorder fails.
 * USAGE
 *   node scripts/contracts-check.ts              verify the seven files, exit 1 on any problem
 *   node scripts/contracts-check.ts --extract    write any of the seven files that does not exist
 * OUTPUT
 *   One line per file, for example `src/contracts/index.ts: 495 lines present in order, 0 added`.
 * VERSION HISTORY
 *   1.0  2026-11-05  T00: first version.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** T11's numeric exception (architecture.md section 8). Only the name is compared on these lines. */
export const NUMERIC_ALLOW = ['FOG_START', 'FOG_END', 'DEFAULT_SEED'] as const;
const HERO_PATH = 'src/contracts/glsl/hero.glsl';
/** After hand-off T04 owns hero.glsl, and only these three lines stay frozen. */
export const HERO_SIGNATURE = [
  'const vec2  HERO_C = vec2(0., .125);',
  'const float HERO_R = .215;',
  'vec4 sunDisc(vec3 rd, float yScale) {',
] as const;

export interface Fence { path: string; body: string }
export interface AdditiveResult { ok: boolean; present: number; added: number; problems: string[] }

/** Fences whose first line names a file. The section 8.1 signature fence names none, so it is not extracted. */
export function parseFences(archText: string): Fence[] {
  const fences: Fence[] = [];
  for (const m of archText.matchAll(/^```(\w+)\n([\s\S]*?)^```$/gm)) {
    const body = m[2]!;
    const first = /^\/\/ (src\/\S+|tests\/\S+)/.exec(body.split('\n', 1)[0] ?? '');
    if (first) fences.push({ path: first[1]!, body });
  }
  return fences;
}

function nonBlank(text: string): string[] {
  return text.split(/\r?\n/).filter((l) => l.trim() !== '');
}

function numericName(line: string): string | null {
  const m = /^export const (\w+) = -?[\d._eE+-]+;\s*(?:\/\/.*)?$/.exec(line);
  return m ? m[1]! : null;
}

function sameLine(want: string, have: string, allow: readonly string[]): boolean {
  if (want === have) return true;
  const name = numericName(want);
  return name !== null && allow.includes(name) && numericName(have) === name;
}

/** Every non-blank line of the fence must appear in the file, in the same order. Extra lines are counted. */
export function checkAdditive(archText: string, fileText: string, numericAllow: readonly string[]): AdditiveResult {
  const want = nonBlank(archText);
  const have = nonBlank(fileText);
  const problems: string[] = [];
  let present = 0;
  let cursor = 0;
  for (const line of want) {
    let found = -1;
    for (let j = cursor; j < have.length; j++) {
      if (sameLine(line, have[j]!, numericAllow)) { found = j; break; }
    }
    if (found < 0) {
      problems.push(`missing or out of order: ${line.trim().slice(0, 100)}`);
      continue;
    }
    present++;
    cursor = found + 1;
  }
  return { ok: problems.length === 0, present, added: have.length - present, problems };
}

/** hero.glsl: only the three signature lines are frozen, in order. */
export function checkHero(fileText: string): { ok: boolean; problems: string[] } {
  const r = checkAdditive(HERO_SIGNATURE.join('\n'), fileText, []);
  return { ok: r.ok, problems: r.problems };
}

export function runCheck(root: string): { ok: boolean; lines: string[]; fences: number } {
  const fences = parseFences(readFileSync(join(root, 'architecture.md'), 'utf8'));
  const lines: string[] = [];
  let ok = true;
  for (const fence of fences) {
    const file = join(root, fence.path);
    if (!existsSync(file)) {
      ok = false;
      lines.push(`${fence.path}: MISSING`);
      continue;
    }
    const text = readFileSync(file, 'utf8');
    if (fence.path === HERO_PATH) {
      const hero = checkHero(text);
      const full = checkAdditive(fence.body, text, []);
      const added = full.ok ? String(full.added) : 'n/a';
      lines.push(`${fence.path}: ${HERO_SIGNATURE.length} signature lines checked, ${hero.ok ? 'present in order' : 'PROBLEM'}, ${added} added`);
      for (const p of hero.problems) lines.push(`  ${p}`);
      ok = ok && hero.ok;
      continue;
    }
    const r = checkAdditive(fence.body, text, NUMERIC_ALLOW);
    lines.push(`${fence.path}: ${r.present} lines present in order, ${r.added} added`);
    for (const p of r.problems) lines.push(`  ${p}`);
    ok = ok && r.ok;
  }
  if (fences.length !== 7) {
    ok = false;
    lines.push(`expected 7 path fences in architecture.md, found ${fences.length}`);
  }
  return { ok, lines, fences: fences.length };
}

function extract(root: string): number {
  const fences = parseFences(readFileSync(join(root, 'architecture.md'), 'utf8'));
  for (const fence of fences) {
    const file = join(root, fence.path);
    if (existsSync(file)) {
      console.log(`${fence.path}: exists, not overwritten`);
      continue;
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, fence.body, { encoding: 'utf8' });
    console.log(`${fence.path}: written, ${fence.body.length} chars`);
  }
  return 0;
}

if (import.meta.main) {
  const root = process.cwd();
  if (process.argv.includes('--extract')) {
    process.exit(extract(root));
  }
  const r = runCheck(root);
  for (const line of r.lines) console.log(line);
  console.log(r.ok ? `contracts:check PASS, ${r.fences} files` : 'contracts:check FAIL');
  process.exit(r.ok ? 0 : 1);
}
