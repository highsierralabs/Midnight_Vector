// Round folders and their summaries (plan M1 and section 8). test-results/T11-art/<round>/ is not a Playwright
// output folder, so --output never wipes it. Each spec writes its own metrics-<spec>.json and gates-<spec>.json, so a
// re-run overwrites only that spec's files; gates.txt and delta.txt are rebuilt from every spec's file each time.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from './png';
import { imageVariety } from './metrics';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const ART_ROOT = join(ROOT, 'test-results', 'T11-art');

export function roundName(): string {
  const r = process.env['TERRAIN_ROUND'] ?? 'dev';
  if (!/^[A-Za-z0-9_-]+$/.test(r)) throw new Error(`TERRAIN_ROUND must be a plain name, got ${r}`);
  return r;
}

/** The round delta.txt compares against: TERRAIN_BASE_ROUND, else r00 unless this is r00. */
export function baseRound(): string | null {
  const b = process.env['TERRAIN_BASE_ROUND'];
  if (b) return b;
  return roundName() === 'r00' ? null : 'r00';
}

export function roundDir(...sub: string[]): string {
  const d = join(ART_ROOT, roundName(), ...sub);
  mkdirSync(d, { recursive: true });
  return d;
}

export function roundFile(name: string, round = roundName()): string {
  const d = join(ART_ROOT, round);
  mkdirSync(d, { recursive: true });
  return join(d, name);
}

export interface GateRow {
  gate: string;
  /** The worst value over the samples the gate covers. */
  value: number;
  limit: number;
  dir: 'max' | 'min';
  pass: boolean;
  /** Which pair and sample gave the worst value. */
  worst: string;
  /** Samples covered. */
  n: number;
  /** How many samples failed. */
  failing: number;
  reportOnly?: boolean;
  note?: string;
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  return a >= 100 ? v.toFixed(1) : a >= 1 ? v.toFixed(3) : v.toFixed(4);
}

export function gateLine(r: GateRow): string {
  const verdict = r.reportOnly ? 'REPORT' : r.pass ? 'PASS' : 'FAIL';
  return `${verdict.padEnd(6)} ${r.gate.padEnd(10)} worst ${fmt(r.value).padStart(9)} ${r.dir === 'max' ? '<=' : '>='} ${fmt(r.limit).padEnd(8)} n=${String(r.n).padEnd(4)} failing=${String(r.failing).padEnd(4)} at ${r.worst}${r.note ? `  (${r.note})` : ''}`;
}

/** Noise floor for delta.txt: half a code value on code-value summaries, otherwise half a percent of the limit. */
function noise(r: GateRow): number {
  return Math.abs(r.limit) >= 5 ? 0.5 : Math.max(1e-6, Math.abs(r.limit) * 0.005);
}

function readGates(round: string): Map<string, GateRow> {
  const out = new Map<string, GateRow>();
  const d = join(ART_ROOT, round);
  if (!existsSync(d)) return out;
  for (const f of readdirSync(d).filter((n) => /^gates-.*\.json$/.test(n)).sort()) {
    const spec = f.slice(6, -5);
    for (const r of JSON.parse(readFileSync(join(d, f), 'utf8')) as GateRow[]) out.set(`${spec}:${r.gate}`, r);
  }
  return out;
}

function rebuildSummaries(): void {
  const round = roundName();
  const now = readGates(round);
  const lines: string[] = [`T11 round ${round}, gates from every spec file in this folder, rebuilt ${new Date().toISOString()}`];
  let spec = '';
  for (const [k, r] of now) {
    const s = k.split(':')[0]!;
    if (s !== spec) { lines.push(`-- ${s}`); spec = s; }
    lines.push(gateLine(r));
  }
  writeFileSync(roundFile('gates.txt'), `${lines.join('\n')}\n`);
  const base = baseRound();
  const dl: string[] = [];
  if (!base) {
    dl.push(`T11 round ${round}: no base round, so no delta.`);
  } else {
    const was = readGates(base);
    dl.push(`T11 round ${round} against ${base}. Differences under the noise floor (0.5 on code values, .5% of the limit otherwise) are not listed.`);
    for (const [k, r] of now) {
      const b = was.get(k);
      if (!b) { dl.push(`NEW     ${k} ${fmt(r.value)}`); continue; }
      const d = r.value - b.value;
      const better = r.dir === 'max' ? d < 0 : d > 0;
      const flip = b.pass !== r.pass ? `  verdict ${b.pass ? 'PASS' : 'FAIL'} -> ${r.pass ? 'PASS' : 'FAIL'}` : '';
      if (Math.abs(d) < noise(r) && !flip) continue;
      dl.push(`${(better ? 'BETTER' : 'WORSE').padEnd(7)} ${k.padEnd(22)} ${fmt(b.value)} -> ${fmt(r.value)} (${d >= 0 ? '+' : ''}${fmt(d)})${flip}`);
    }
    for (const k of was.keys()) if (!now.has(k)) dl.push(`GONE    ${k}`);
  }
  writeFileSync(roundFile('delta.txt'), `${dl.join('\n')}\n`);
}

/** Writes this spec's metrics and gate rows, then rebuilds gates.txt and delta.txt. Prints the rows. */
export function writeSpecResults(spec: string, metrics: unknown, gates: readonly GateRow[]): void {
  writeFileSync(roundFile(`metrics-${spec}.json`), JSON.stringify(metrics, null, 1));
  writeFileSync(roundFile(`gates-${spec}.json`), JSON.stringify(gates, null, 1));
  rebuildSummaries();
  for (const r of gates) console.log(`GATE ${spec} ${gateLine(r)}`);
}

/** Writes a text file into the round folder and returns its path. */
export function writeRoundText(name: string, text: string): string {
  const p = roundFile(name);
  writeFileSync(p, text);
  return p;
}

/** A4's check of one image: at most 1920 wide, luma standard deviation over 5, over 16 distinct colours. */
export function checkImage(path: string): { ok: boolean; why: string; w: number; h: number; lumaStd: number; colours: number } {
  if (!existsSync(path)) return { ok: false, why: 'missing', w: 0, h: 0, lumaStd: 0, colours: 0 };
  const { w, h, rgba } = decodePng(readFileSync(path));
  const v = imageVariety(w, h, rgba);
  const why = w > 1920 ? `width ${w} over 1920` : v.lumaStd <= 5 ? `luma std ${v.lumaStd.toFixed(2)} <= 5` : v.colours <= 16 ? `${v.colours} colours <= 16` : '';
  return { ok: why === '', why, w, h, lumaStd: v.lumaStd, colours: v.colours };
}

/** Builds one gate row from per-sample values: worst value, failing count, label of the worst. */
export function gateRow(gate: string, limit: { value: number; dir: 'max' | 'min'; reportOnly?: boolean }, values: readonly { v: number; at: string }[], note?: string): GateRow {
  let worst = values[0];
  let failing = 0;
  for (const x of values) {
    const bad = !Number.isFinite(x.v) || (limit.dir === 'max' ? x.v > limit.value : x.v < limit.value);
    if (bad) failing++;
    if (!worst || (limit.dir === 'max' ? x.v > worst.v : x.v < worst.v) || !Number.isFinite(x.v)) worst = x;
  }
  const row: GateRow = {
    gate, value: worst ? worst.v : Number.NaN, limit: limit.value, dir: limit.dir,
    pass: values.length > 0 && failing === 0, worst: worst ? worst.at : 'none', n: values.length, failing,
  };
  if (limit.reportOnly) row.reportOnly = true;
  if (note) row.note = note;
  return row;
}
