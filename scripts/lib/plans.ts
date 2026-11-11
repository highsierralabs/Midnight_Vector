/**
 * PURPOSE
 *   Shared helpers for the plan-reading gates: frontmatter parsing (no YAML dependency),
 *   owned-glob expansion, glob intersection and the architecture.md section 12 row parser.
 * USAGE
 *   import { readPlans, expandOwned, globsIntersect, parseTaskRows } from './lib/plans.ts';
 * OUTPUT
 *   None. A library for scripts/check-task.ts and scripts/plans-check.ts.
 * VERSION HISTORY
 *   1.0  2026-11-05  T00: first version.
 */
import { globSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const STATUSES = ['draft', 'approved', 'in-progress', 'blocked', 'done', 'abandoned'] as const;
export const REQUIRED_KEYS = ['id', 'title', 'status', 'owner', 'depends_on', 'owns', 'reads', 'updated'] as const;
export const HEADINGS = [
  'purpose',
  'context and orientation',
  'scope',
  'interfaces',
  'plan of work',
  'concrete steps',
  'validation and acceptance',
  'idempotence and recovery',
  'progress',
  'surprises and discoveries',
  'decision log',
  'contract change requests',
  'outcomes and retrospective',
  'revision notes',
] as const;

export interface PlanFile {
  /** T## taken from the file name. */
  task: string;
  file: string;
  text: string;
  front: Map<string, string | string[]> | null;
}

/** Drops a trailing `# comment` that starts after whitespace. */
function stripComment(value: string): string {
  const m = /(^|\s)#/.exec(value);
  return (m ? value.slice(0, m.index) : value).trim();
}

function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

/** Parses leading `---` frontmatter: `key: value`, a flow list on one line, or a block `- item` list. */
export function parseFrontmatter(text: string): Map<string, string | string[]> | null {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return null;
  const out = new Map<string, string | string[]>();
  let key: string | null = null;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '---') return out;
    if (line.trim() === '') continue;
    const item = /^\s+-\s+(.*)$/.exec(line) ?? /^-\s+(.*)$/.exec(line);
    if (item && key) {
      const prior = out.get(key);
      const list = Array.isArray(prior) ? prior : [];
      list.push(unquote(stripComment(item[1]!)));
      out.set(key, list);
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    key = kv[1]!;
    const raw = kv[2]!;
    const flow = /^\[(.*)\]\s*(#.*)?$/.exec(raw.trim());
    if (flow) {
      const body = flow[1]!.trim();
      out.set(key, body === '' ? [] : body.split(',').map((s) => unquote(s)));
    } else {
      const value = stripComment(raw);
      out.set(key, value === '' ? [] : unquote(value));
    }
  }
  return null;
}

/** Lists plans/T##-*.md under root. Other files in plans/, such as README.md and RECONCILIATION.md, are ignored. */
export function readPlans(root: string): PlanFile[] {
  const dir = join(root, 'plans');
  if (!existsSync(dir)) return [];
  const plans: PlanFile[] = [];
  for (const name of readdirSync(dir).sort()) {
    const m = /^(T\d\d)-.*\.md$/.exec(name);
    if (!m) continue;
    const file = join(dir, name);
    const text = readFileSync(file, 'utf8');
    plans.push({ task: m[1]!, file, text, front: parseFrontmatter(text) });
  }
  return plans;
}

export function ownsOf(plan: PlanFile): string[] | null {
  const owns = plan.front?.get('owns');
  return Array.isArray(owns) ? owns : null;
}

/** Expands owned globs against the disk: files only, POSIX paths relative to root. */
export function expandOwned(root: string, patterns: readonly string[]): string[] {
  const found = new Set<string>();
  for (const pattern of patterns) {
    for (const entry of globSync(pattern, { cwd: root, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      found.add(relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'));
    }
  }
  return [...found].sort();
}

/** True when two within-segment patterns (`*` only) can match one common string. */
function segmentsIntersect(a: string, b: string): boolean {
  const memo = new Map<number, boolean>();
  const rec = (i: number, j: number): boolean => {
    const k = i * (b.length + 1) + j;
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    let r: boolean;
    if (i === a.length && j === b.length) r = true;
    else if (a[i] === '*') r = rec(i + 1, j) || (j < b.length && rec(i, j + 1));
    else if (b[j] === '*') r = rec(i, j + 1) || (i < a.length && rec(i + 1, j));
    else if (i === a.length || j === b.length) r = false;
    else r = a[i] === b[j] && rec(i + 1, j + 1);
    memo.set(k, r);
    return r;
  };
  return rec(0, 0);
}

/** Static glob intersection, segment by segment: `**` spans zero or more segments, `*` stays within one. */
export function globsIntersect(a: string, b: string): boolean {
  const sa = a.split('/');
  const sb = b.split('/');
  const memo = new Map<number, boolean>();
  const rec = (i: number, j: number): boolean => {
    const k = i * (sb.length + 1) + j;
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    let r: boolean;
    if (i === sa.length && j === sb.length) r = true;
    else if (i < sa.length && sa[i] === '**') r = rec(i + 1, j) || (j < sb.length && rec(i, j + 1));
    else if (j < sb.length && sb[j] === '**') r = rec(i, j + 1) || (i < sa.length && rec(i + 1, j));
    else if (i === sa.length || j === sb.length) r = false;
    else r = segmentsIntersect(sa[i]!, sb[j]!) && rec(i + 1, j + 1);
    memo.set(k, r);
    return r;
  };
  return rec(0, 0);
}

export interface TaskRow { task: string; owns: string[]; planFile: string }

/**
 * Extracts the task rows of architecture.md section 12: lines that start `| **T##** |` and whose
 * final cell starts `` `plans/ ``. No cell in those rows contains a pipe, so splitting on `|` is enough.
 */
export function parseTaskRows(archText: string): TaskRow[] {
  const rows: TaskRow[] = [];
  for (const line of archText.split(/\r?\n/)) {
    const m = /^\| \*\*(T\d\d)\*\* \|/.exec(line);
    if (!m) continue;
    const cells = line.split('|').map((c) => c.trim());
    const planCell = cells[cells.length - 2] ?? '';
    if (!planCell.startsWith('`plans/')) continue;
    const owns = [...(cells[3] ?? '').matchAll(/`([^`]+)`/g)].map((t) => t[1]!);
    rows.push({ task: m[1]!, owns, planFile: planCell.replaceAll('`', '') });
  }
  return rows;
}

/** Headings outside code fences, normalised, for the template-order check. */
export function planHeadings(text: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('```')) { inFence = !inFence; continue; }
    if (inFence || !line.startsWith('## ')) continue;
    out.push(line.slice(3).replace(/^\d+\.\s*/, '').replace(/:\s*$/, '').trim().toLowerCase());
  }
  return out;
}
