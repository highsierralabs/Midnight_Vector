/**
 * PURPOSE
 *   Keeps parallel plans apart: frontmatter and template headings, each plan's owns equal to its row in
 *   architecture.md section 12, and no path owned by two plans, tested statically by glob intersection and again
 *   on disk. plans/README.md and plans/RECONCILIATION.md are not plans and are ignored.
 * USAGE
 *   node scripts/plans-check.ts [--root dir] [--arch file] [--allow-missing] [--approved]
 * OUTPUT
 *   One line per problem, then a count. Exit 0 or 1.
 * VERSION HISTORY
 *   1.0  2026-11-05  T00: first version.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HEADINGS, REQUIRED_KEYS, STATUSES, expandOwned, globsIntersect, ownsOf, parseTaskRows, planHeadings, readPlans,
  type PlanFile,
} from './lib/plans.ts';

const HERO = 'src/contracts/glsl/hero.glsl';
/** Every temporary path of T11 in section 12. T11 runs alone, so these may overlap anything. */
const T11_WINDOW: readonly string[] = [
  'src/render/**', 'src/world/palettes.ts', 'src/world/biomes.ts', HERO, 'src/feel/tuning.ts', 'src/sim/tuning.ts',
];

function legalOverlap(ta: string, pa: string, tb: string, pb: string): boolean {
  if (ta === 'T11' && T11_WINDOW.includes(pa)) return true;
  if (tb === 'T11' && T11_WINDOW.includes(pb)) return true;
  if (ta === 'T00' && tb === 'T04' && pb === HERO) return true;
  if (ta === 'T04' && tb === 'T00' && pa === HERO) return true;
  return false;
}

function frontProblems(plan: PlanFile): string[] {
  const out: string[] = [];
  if (!plan.front) return [`${plan.task}: no parsable frontmatter`];
  for (const k of REQUIRED_KEYS) {
    if (!plan.front.has(k)) out.push(`${plan.task}: frontmatter is missing ${k}`);
  }
  const status = plan.front.get('status');
  if (typeof status !== 'string' || !(STATUSES as readonly string[]).includes(status)) {
    out.push(`${plan.task}: status ${String(status)} is not in the lifecycle`);
  }
  return out;
}

function headingProblems(plan: PlanFile): string[] {
  const seen = planHeadings(plan.text).filter((h) => (HEADINGS as readonly string[]).includes(h));
  const want = HEADINGS.join(' > ');
  return seen.join(' > ') === want ? [] : [`${plan.task}: template headings are missing or out of order, found: ${seen.join(', ')}`];
}

function setProblems(task: string, owns: readonly string[], row: readonly string[]): string[] {
  const out: string[] = [];
  for (const p of row) if (!owns.includes(p)) out.push(`${task}: owns is missing ${p}, which its section 12 row has`);
  for (const p of owns) if (!row.includes(p)) out.push(`${task}: owns has ${p}, which its section 12 row does not`);
  return out;
}

function main(): number {
  const args = process.argv.slice(2);
  const opt = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const root = opt('--root') ?? '.';
  const arch = opt('--arch') ?? join(root, 'architecture.md');
  const allowMissing = args.includes('--allow-missing');
  const approved = args.includes('--approved');

  const plans = readPlans(root);
  const rows = parseTaskRows(readFileSync(arch, 'utf8'));
  const problems: string[] = [];

  for (const plan of plans) {
    problems.push(...frontProblems(plan), ...headingProblems(plan));
    if (approved) {
      const status = plan.front?.get('status');
      if (status !== 'approved' && status !== 'in-progress' && status !== 'done') {
        problems.push(`${plan.task}: status ${String(status)} is not approved, in-progress or done`);
      }
    }
  }

  for (const row of rows) {
    const plan = plans.find((p) => p.task === row.task);
    if (!plan) {
      if (!allowMissing) problems.push(`${row.task}: no plan file, expected ${row.planFile}`);
      continue;
    }
    problems.push(...setProblems(row.task, ownsOf(plan) ?? [], row.owns));
  }
  for (const plan of plans) {
    if (!rows.some((r) => r.task === plan.task)) problems.push(`${plan.task}: no row in architecture.md section 12`);
  }

  // Static overlap, so an overlap is found before any file exists.
  let pairs = 0;
  for (let i = 0; i < plans.length; i++) {
    for (let j = i + 1; j < plans.length; j++) {
      const a = plans[i]!;
      const b = plans[j]!;
      for (const pa of ownsOf(a) ?? []) {
        for (const pb of ownsOf(b) ?? []) {
          pairs++;
          if (!globsIntersect(pa, pb) || legalOverlap(a.task, pa, b.task, pb)) continue;
          problems.push(`overlap: ${a.task} ${pa} and ${b.task} ${pb}`);
        }
      }
    }
  }

  // On disk, so a pattern pair the static test cleared cannot still share a real file.
  const owners = new Map<string, { task: string; pattern: string }[]>();
  for (const plan of plans) {
    for (const pattern of ownsOf(plan) ?? []) {
      for (const file of expandOwned(root, [pattern])) {
        const list = owners.get(file) ?? [];
        if (!list.some((o) => o.task === plan.task)) list.push({ task: plan.task, pattern });
        owners.set(file, list);
      }
    }
  }
  for (const [file, list] of owners) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        if (!legalOverlap(a.task, a.pattern, b.task, b.pattern)) {
          problems.push(`overlap on disk: ${file} matches ${a.task} ${a.pattern} and ${b.task} ${b.pattern}`);
        }
      }
    }
  }

  for (const p of problems) console.log(p);
  console.log(`plans:check: ${plans.length} plans, ${pairs} pattern pairs, ${problems.length} problems`);
  return problems.length === 0 ? 0 : 1;
}

process.exitCode = main();
