// M10: the operator pack (plan M10, A25). Runs only with TERRAIN_PACK=1, at TERRAIN_ROUND (normally `final`, after
// `npm run test:art` has written that round). It writes test-results/T11-art/<round>/index.html over the round's own sheets,
// three clips through ffmpeg when one is found (encode.ts), or T10's flipbook when not, and screenshots of the index so the
// executor can view it. The page's prose is not written here: it is the plan's M10 section and section 13, and the T00
// owner's rulings on T11 from plans/RECONCILIATION.md ("## T11" and "## After T11", whatever entries they hold; the range
// in the headings is read from the rendered text), rendered from those files, so the pack and the plan cannot
// disagree. Two seeds (DI-102): the opening clip and the other two clips run at SEED (DEFAULT_SEED, the product's opening);
// the sheets and gates of the round were written at whatever seed each spec ran, read back from its metrics file.
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_SEED, PALETTE_NAMES, BIOME_NAMES, CHUNK_LEN } from '../../src/contracts/index';
import { startScreencast, writeFlipbook } from '../e2e/lib/view';
import { test, expect } from '../support/pw';
import { buildCombos, tickFor } from './support/combos';
import { ART_SEED, at, goto, openHarness, serveDist } from './support/capture';
import { findFfmpeg, openEncoder, resample } from './support/encode';
import { decodePng } from './support/png';
import { checkImage, roundDir, roundFile, roundName } from './support/round';
import { CRUISE_DU } from './support/thresholds';

const PACK = process.env['TERRAIN_PACK'] === '1';
const SEED = Number(process.env['TERRAIN_SEED'] ?? DEFAULT_SEED);
const FPS = 30;
const PLAN = resolve('plans', 'T11-art-pass.md');
const LEDGER = resolve('plans', 'RECONCILIATION.md');

test.describe.configure({ mode: 'serial' });
test.skip(!PACK, 'runs only with TERRAIN_PACK=1 (plan M10)');

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const ffmpeg = PACK ? findFfmpeg() : null;
const clipNotes: Record<string, string> = {};

test('clip-opening: 30 s of a cold load of dist/, no input', async ({ playwright }, info) => {
  test.setTimeout(300_000);
  const dist = resolve('dist');
  expect(existsSync(join(dist, 'index.html')), 'run npm run build first').toBe(true);
  const srv = await serveDist(dist);
  const launchOptions = (info.project.use as { launchOptions?: Parameters<typeof playwright.chromium.launch>[0] }).launchOptions ?? {};
  const cold = await playwright.chromium.launch(launchOptions);
  try {
    const ctx = await cold.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    await page.route('**/favicon.ico', (r) => r.fulfill({ status: 204 }));
    await page.setContent('<html style="background:#000"><body style="background:#000"></body></html>');
    const dir = roundDir('clip-opening-frames');
    for (const f of readdirSync(dir)) rmSync(join(dir, f));
    const cast = await startScreencast(page, dir);
    const t0 = Date.now() / 1000;
    await page.goto(`${srv.url}${SEED === DEFAULT_SEED ? '' : `?seed=${SEED}`}`);
    await sleep(30_400 - (Date.now() / 1000 - t0) * 1000);
    const frames = await cast.stop();
    expect(frames.length, 'screencast frames').toBeGreaterThan(300);
    const pick = resample(frames.map((f) => f.t), FPS, 30, t0);
    clipNotes['opening'] = `seed ${SEED}${SEED === DEFAULT_SEED ? ' (DEFAULT_SEED, no ?seed=)' : ''}; ` + await finishClip('clip-opening', frames.map((f) => f.file), pick, () => {
      writeFlipbook(roundFile('clip-opening-flipbook.html'), frames, 'clip-opening-frames');
    });
    console.log(`pack clip-opening: ${frames.length} screencast frames over ${(frames[frames.length - 1]!.t - t0).toFixed(1)} s, ${pick.length} clip frames at ${FPS} fps; ${clipNotes['opening']}`);
  } finally {
    await cold.close();
    await srv.close();
  }
});

/** JPEG frames to MP4 through ffmpeg; without ffmpeg, or if it fails, the frames stay and the flipbook is written instead. */
async function finishClip(name: string, files: readonly string[], pick: readonly number[], flipbook: () => void): Promise<string> {
  const out = roundFile(`${name}.mp4`);
  if (ffmpeg) {
    const enc = openEncoder(out, { kind: 'jpeg', fps: FPS });
    for (const i of pick) await enc.write(readFileSync(files[i]!));
    const r = await enc.close();
    if (r.code === 0 && existsSync(out)) {
      for (const f of new Set(files)) rmSync(f, { force: true });
      return `${name}.mp4, ${r.frames} frames by ${ffmpeg}`;
    }
    console.log(`pack ${name}: ffmpeg exit ${r.code}: ${r.stderr}`);
  }
  flipbook();
  return `no MP4 (${ffmpeg ? 'ffmpeg failed' : 'no ffmpeg on PATH'}); ${name}-flipbook.html plays the frames`;
}

test('clip-transition: 25 s across the lowest-chroma transition, harness, tier 3', async ({ page }, info) => {
  test.setTimeout(1_200_000);
  const combos = buildCombos(SEED);
  let pick = combos.transitions[0]!;
  let measuredAt = '';
  const mfile = roundFile('metrics-transition.json');
  if (existsSync(mfile)) {
    const m = JSON.parse(readFileSync(mfile, 'utf8')) as { seed?: number; mids: { a: number; b: number; zone: number; chroma: number }[] };
    const w = [...m.mids].sort((x, y) => x.chroma - y.chroma)[0]!;
    // Matched by its palette pair, not its zone number: transition.spec may have run at another seed (ART_SEED), where the
    // same ordered palette change first occurs in another zone, between other biomes. combos lists each ordered pair once.
    pick = combos.transitions.find((t) => t.a === w.a && t.b === w.b) ?? pick;
    measuredAt = `lowest X1 chroma ${w.chroma.toFixed(2)} at seed ${m.seed ?? '?'} zone ${w.zone}; shown at seed ${SEED} zone ${pick.zone}`;
  } else {
    console.log('pack clip-transition: no metrics-transition.json in this round; the first transition stands in');
  }
  await openHarness(page, info, { seed: SEED, tier: 3, period: 0 });
  const start = pick.zone * 100 + 72;
  await goto(page, at(start, 0));
  await page.evaluate(() => {
    const mv = window.__mv!;
    mv.setPost('full');
    for (const n of ['sky', 'terrain', 'props', 'fx'] as const) mv.setLayerVisible(n, true);
    mv.forceFeel(null);
  });
  const name = `${PALETTE_NAMES[pick.a]} > ${PALETTE_NAMES[pick.b]}, ${BIOME_NAMES[pick.biomeA]} > ${BIOME_NAMES[pick.biomeB]}, seed ${SEED} zone ${pick.zone}${measuredAt ? ` (${measuredAt})` : ''}`;
  const n = FPS * 25;
  const du = CRUISE_DU * (60 / FPS);
  if (!ffmpeg) {
    clipNotes['transition'] = `not made: no ffmpeg on PATH. The transition strips and curves stand in (${name})`;
    console.log(`pack clip-transition: ${clipNotes['transition']}`);
    return;
  }
  const out = roundFile('clip-transition.mp4');
  const enc = openEncoder(out, { kind: 'raw', w: 1920, h: 1080, fps: FPS, flipRows: true });
  for (let f = 0; f < n; f++) {
    const u = f * du;
    const chunk = start + Math.floor(u / CHUNK_LEN);
    const local = u - Math.floor(u / CHUNK_LEN) * CHUNK_LEN;
    const b64 = await page.evaluate((a) => {
      const mv = window.__mv!;
      mv.renderAt(a.chunk, a.local, a.tick);
      const px = mv.pixels();
      let bin = '';
      for (let i = 0; i < px.length; i += 0x8000) bin += String.fromCharCode.apply(null, px.subarray(i, i + 0x8000) as unknown as number[]);
      return btoa(bin);
    }, { chunk, local, tick: tickFor(chunk, local) });
    await enc.write(Buffer.from(b64, 'base64'));
  }
  const r = await enc.close();
  clipNotes['transition'] = r.code === 0 ? `clip-transition.mp4, ${r.frames} frames at ${FPS} fps, ${(n * du / CHUNK_LEN).toFixed(1)} chunks from into 72: ${name}` : `ffmpeg exit ${r.code}: ${r.stderr}`;
  console.log(`pack clip-transition: ${clipNotes['transition']}`);
  expect(r.code, r.stderr).toBe(0);
});

test('clip-boost: 10 s of PLAY holding boost, with the HUD', async ({ page }, info) => {
  test.setTimeout(600_000);
  await openHarness(page, info, { seed: SEED, tier: 3, period: 0 });
  const combos = buildCombos(SEED);
  const sunset = combos.pairs.filter((p) => p.palette === 0).sort((a, b) => a.z0 - b.z0)[0]!;
  const ok = await page.evaluate((c) => window.__mv!.warp(c, 20), sunset.tile.chunk);
  expect(ok).toBe(true);
  const box = await page.locator('[data-mv="launch"]').boundingBox();
  await page.mouse.click(box ? box.x + box.width / 2 : 960, box ? box.y + box.height / 2 : 700);
  await page.evaluate(() => { window.__mv!.stepFrames(30, 1 / 60); });
  const mode = await page.evaluate(() => document.documentElement.dataset['mvMode'] ?? '');
  expect(mode).toBe('play');
  await page.mouse.move(960, 650);
  const dir = roundDir('clip-boost-frames');
  for (const f of readdirSync(dir)) rmSync(join(dir, f));
  await page.keyboard.down('Space');
  const files: string[] = [];
  const times: number[] = [];
  for (let f = 0; f < FPS * 10; f++) {
    // A slow weave across the lanes, so the clip shows steering at speed, not a still road.
    await page.mouse.move(960 + 520 * Math.sin((f / (FPS * 10)) * Math.PI * 2), 650);
    await page.evaluate(() => { window.__mv!.stepFrames(60 / 30, 1 / 60); });
    const file = join(dir, `${String(f).padStart(5, '0')}.jpg`);
    writeFileSync(file, await page.screenshot({ type: 'jpeg', quality: 92 }));
    files.push(file);
    times.push(f / FPS);
  }
  await page.keyboard.up('Space');
  const pick = files.map((_, i) => i);
  clipNotes['boost'] = await finishClip('clip-boost', files, pick, () => {
    writeFlipbook(roundFile('clip-boost-flipbook.html'), files.map((file, i) => ({ file, t: times[i]! })), 'clip-boost-frames');
  });
  clipNotes['boost'] = `${PALETTE_NAMES[sunset.palette]} / ${BIOME_NAMES[sunset.biome]}, seed ${SEED} from chunk ${sunset.tile.chunk}; ${clipNotes['boost']}`;
  console.log(`pack clip-boost: page.screenshot after 2 sim frames each; ${clipNotes['boost']}`);
});

// ---- the index page ----

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(s: string): string {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2">$1</a>');
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
  return t;
}

/** A small Markdown renderer for the plan's own constructs: headings, tables, lists, fenced code, paragraphs. */
function mdToHtml(md: string): string {
  const lines = md.replace(/\r/g, '').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith('```')) body.push(lines[i++]!);
      i++;
      out.push(`<pre>${esc(body.join('\n'))}</pre>`);
    } else if (/^#{1,6} /.test(trimmed)) {
      const level = Math.min(6, trimmed.indexOf(' ') + 1);
      out.push(`<h${level}>${inline(trimmed.slice(trimmed.indexOf(' ') + 1))}</h${level}>`);
      i++;
    } else if (trimmed.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('|')) {
        const cells = lines[i]!.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim());
        if (!cells.every((c) => /^:?-+:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      out.push(`<table><thead><tr>${(head ?? []).map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    } else if (/^(- |\d+\. )/.test(trimmed)) {
      const ordered = /^\d+\. /.test(trimmed);
      const items: string[] = [];
      while (i < lines.length && /^\s*(- |\d+\. )/.test(lines[i]!)) {
        let item = lines[i]!.trim().replace(/^(- |\d+\. )/, '');
        i++;
        while (i < lines.length && lines[i]!.trim() !== '' && !/^\s*(- |\d+\. |\||#)/.test(lines[i]!) && !lines[i]!.trim().startsWith('```')) item += ` ${lines[i++]!.trim()}`;
        items.push(`<li>${inline(item)}</li>`);
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
    } else if (trimmed === '') {
      i++;
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i]!.trim() !== '' && !/^\s*(#{1,6} |\||- |\d+\. |```)/.test(lines[i]!)) para.push(lines[i++]!.trim());
      out.push(`<p>${inline(para.join(' '))}</p>`);
    }
  }
  return out.join('\n');
}

/** The text from a heading line to the next heading of the same or a higher level. */
function section(md: string, heading: string): string {
  const lines = md.replace(/\r/g, '').split('\n');
  const start = lines.findIndex((l) => l.startsWith(heading));
  if (start < 0) throw new Error(`pack: heading not found: ${heading}`);
  const level = heading.indexOf(' ');
  let end = start + 1;
  while (end < lines.length && !(lines[end]!.startsWith('#') && lines[end]!.indexOf(' ') <= level && /^#+ /.test(lines[end]!))) end++;
  return lines.slice(start, end).join('\n');
}

const GROUPS: readonly { title: string; test: RegExp; note: string }[] = [
  { title: 'Overview', test: /^sheet36\.png$/, note: 'All 36 palette and biome pairs at thumbnail size: rows palette, columns biome. An overview only (DI-101); judge from the 640 x 360 sheets below.' },
  { title: 'One palette across the six biomes', test: /^pal-\d\.png$/, note: 'The tile of each pair: the into 38 sample, fixed by rule before any frame was seen.' },
  { title: 'One biome across the six palettes', test: /^biome-\d\.png$/, note: '' },
  { title: 'Hero disc and sky', test: /^(hero-m\d|ring-palette|sky-[a-z]+|bend)\.png$/, note: 'The four hero modes, the landmark ring on approach, lightning, aurora and meteors, and the strongest road bend.' },
  { title: 'Zone transitions', test: /^(mid-\d|trans-\d-\d(-curves)?)\.png$/, note: 'Midpoints of all 30 ordered palette changes, and three full transitions as frames and as curves with their limit lines.' },
  { title: 'The opening and the first ten seconds', test: /^(first10|launch|opening-seed\d+)\.png$/, note: 'A cold load of the production build, no harness, at the seed a player gets (DEFAULT_SEED unless named in the file); the first four zones of that seed.' },
  { title: 'In play: UI, ship, hits and boost', test: /^(ui-[a-z-]+|ship-[0-9]+|ship-near|flash-\d|boost-worst)\.png$/, note: 'Real clicks and real frames. Flash and glitch frames are the designed hit effects at their peak.' },
  { title: 'Frames chosen by number as the worst for a gate', test: /^worst-[A-Za-z0-9]+-\d\.png$|^worst-[a-z]+\d?\.png$/, note: 'Read these, not the flattering ones. worst-floor0 is the boost run\'s worst floor black on a frame with no flash and no glitch, the frame W4allow fails on.' },
  { title: 'Instruments: O1\'s ship mask', test: /^ship-mask.*\.png$/, note: 'Not the look: what O1 leaves out. ship-mask is the mask O1 used in this round, in red over the disc in blue: at the calibration seed, the fixed artifact made from the ship\'s own projected geometry (A24). ship-mask-check, where the writer test ran, outlines it in green against the superseded r04 mask in red.' },
  { title: '1:1 crops', test: /^crop-.*\.png$/, note: '' },
  { title: 'Motion evidence', test: /^(strip|heat|slit)-.*\.png$/, note: 'Proxies only: they can show a defect, and a clean one does not show smooth motion. The live page is the review.' },
  { title: 'Quality tiers, screen shapes, reduced motion, software', test: /^(tiers-b\d|aspect|reduced|software)\.png$/, note: '' },
];

test('index: the pack page over this round, and screenshots of it', async ({ browser }) => {
  test.setTimeout(300_000);
  const round = roundName();
  const dir = roundDir();
  const files = readdirSync(dir).sort();
  const gates = existsSync(join(dir, 'gates.txt')) ? readFileSync(join(dir, 'gates.txt'), 'utf8') : 'gates.txt missing: run npm run test:art at this round first';
  const delta = existsSync(join(dir, 'delta.txt')) ? readFileSync(join(dir, 'delta.txt'), 'utf8') : '';
  const plan = readFileSync(PLAN, 'utf8');
  const recon = readFileSync(LEDGER, 'utf8');
  // The T00 owner's rulings on T11, verbatim: DI-101 (section "## T11") and every entry after T11's stop ("## After T11"),
  // DI-102 onward. The range named in the page's headings is read from the entries themselves, so it cannot go stale.
  const rulings = `${section(recon, '## T11')}\n\n${section(recon, '## After T11 (T00 owner')}`;
  const ruled = [...rulings.matchAll(/^\*\*DI-(\d+)\./gm)].map((m) => Number(m[1]));
  expect(ruled.length, 'rulings found in RECONCILIATION.md').toBeGreaterThan(0);
  const range = `DI-${Math.min(...ruled)} to DI-${Math.max(...ruled)}`;
  const after = `DI-${Math.min(...ruled.filter((n) => n > 101))} to DI-${Math.max(...ruled)}`;
  // Which seed each of this round's specs ran at, read back from its own metrics file, so the note cannot drift from the run.
  const bySeed = new Map<number, string[]>();
  for (const f of files.filter((n) => /^metrics-.*\.json$/.test(n))) {
    let s: unknown;
    try { s = (JSON.parse(readFileSync(join(dir, f), 'utf8')) as { seed?: unknown }).seed; } catch { s = undefined; }
    if (typeof s !== 'number') continue;
    bySeed.set(s, [...(bySeed.get(s) ?? []), f.slice(8, -5)]);
  }
  const seedRows = [...bySeed.entries()].sort((a, b) => a[0] - b[0]).map(([s, specs]) => `<tr><td>${s}${s === DEFAULT_SEED ? ' (<code>DEFAULT_SEED</code>, the product)' : s === ART_SEED ? ' (<code>ART_SEED</code>, calibration)' : ''}</td><td>${esc(specs.join(', '))}</td></tr>`).join('');
  const m10 = section(plan, '### M10. Operator review');
  const outcomes = section(plan, '## 13. Outcomes and retrospective');
  const status = /^status: (.*)$/m.exec(plan)?.[1] ?? '?';
  const used = new Set<string>();
  const gallery = GROUPS.map((g) => {
    const list = files.filter((f) => g.test.test(f) && !used.has(f));
    for (const f of list) used.add(f);
    if (list.length === 0) return '';
    const figs = list.map((f) => {
      const c = checkImage(join(dir, f));
      return `<figure><a href="${f}"><img src="${f}" loading="lazy" alt="${f}"></a><figcaption>${f} (${c.w} x ${c.h})</figcaption></figure>`;
    }).join('');
    return `<h3>${esc(g.title)}</h3>${g.note ? `<p class="note">${esc(g.note)}</p>` : ''}<div class="grid">${figs}</div>`;
  }).join('\n');
  const clip = (name: string, title: string): string => {
    if (existsSync(join(dir, `${name}.mp4`))) return `<figure class="clip"><video controls preload="metadata" src="${name}.mp4"></video><figcaption>${esc(title)}: <a href="${name}.mp4">${name}.mp4</a>. ${esc(clipNotes[name.replace('clip-', '')] ?? '')}</figcaption></figure>`;
    if (existsSync(join(dir, `${name}-flipbook.html`))) return `<p><a href="${name}-flipbook.html">${name}-flipbook.html</a>: ${esc(title)}, played from frames (no MP4).</p>`;
    return `<p>${esc(title)}: not made in this round. ${esc(clipNotes[name.replace('clip-', '')] ?? '')}</p>`;
  };
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Midnight Vector operator pack</title>
<style>
:root{--bg:#0d0a14;--fg:#e8e2f0;--dim:#a99fb8;--line:#3a2f4a;--accent:#ff4fd8;--panel:#171222}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,Segoe UI,sans-serif}
main{max-width:1600px;margin:0 auto;padding:16px 24px 64px}
h1{font-size:28px;margin:8px 0 4px}h2{border-bottom:1px solid var(--line);padding-bottom:4px;margin-top:40px}
h3{margin-top:28px}a{color:#7fdcff}code{background:var(--panel);padding:0 4px;border-radius:3px}
pre{background:var(--panel);padding:12px;overflow-x:auto;font-size:12.5px;line-height:1.35;border:1px solid var(--line)}
table{border-collapse:collapse;margin:12px 0;font-size:13.5px}td,th{border:1px solid var(--line);padding:4px 8px;vertical-align:top;text-align:left}
th{background:var(--panel)}.note{color:var(--dim)}.first{background:#2a0f2a;border:2px solid var(--accent);padding:12px 20px;margin:16px 0}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(460px,1fr));gap:12px}
figure{margin:0;background:var(--panel);padding:6px;border:1px solid var(--line)}figure img,figure video{width:100%;display:block}
figcaption{font-size:12px;color:var(--dim);padding-top:4px;word-break:break-all}.clip{max-width:960px;margin:12px 0}
nav a{margin-right:14px}
</style></head><body><main>
<h1>Midnight Vector: operator pack</h1>
<p class="note">T11 art pass, round <code>${esc(round)}</code>, written ${new Date().toISOString()}. Plan status: <code>${esc(status)}</code>. Everything here is generated from the round's own files, from <code>plans/T11-art-pass.md</code> and from the T00 owner's rulings in <code>plans/RECONCILIATION.md</code>.</p>
<div class="first" id="first"><h2 style="margin-top:4px;border:0">Before you look at anything in this pack</h2>
<p>Run the game first, cold, on your normal display, full screen, sound on: <code>npm run build</code>, then <code>$env:TERRAIN_PORT = '5111'; npm run preview</code>, and open <code>http://127.0.0.1:5111/</code>. Do not touch the input for 90 s. Then press a key or click and play for about 3 minutes, including a boost and at least one zone change. Only then come back here. You get one first look; the sheets below would spend it.</p></div>
<div class="first" id="seeds"><h2 style="margin-top:4px;border:0">Two seeds in this pack</h2>
<p>The game ships with seed <strong>${DEFAULT_SEED}</strong> (<code>DEFAULT_SEED</code>, DI-102): it opens on Sunset Drive / Boulevard under the banded sun, the poster's colours. <strong>The opening (first10, launch, the opening sheet) and the three clips are at seed ${SEED}</strong>, what you will see when you run it. <strong>Every other sheet and every gate is at the calibration seed ${ART_SEED}</strong> (<code>ART_SEED</code>), where the limits were set on real frames and the art was tuned; a seed changes which zone comes first and where, not how a palette or a biome is drawn. T09's harness suites (DI-108) and T05's A16b (DI-109) also measure at ${ART_SEED}; T09's B10 was run once at ${DEFAULT_SEED} as a report (DI-112; section 13's A24 table). The seed each spec in this round ran at, read from its own metrics file:</p>
<table><thead><tr><th>Seed</th><th>Specs in this round</th></tr></thead><tbody>${seedRows}<tr><td>${SEED}</td><td>clip-opening, clip-transition, clip-boost (this page's own run)</td></tr></tbody></table></div>
<nav><a href="#first">Before anything else</a><a href="#questions">Questions</a><a href="#rulings">Rulings ${range}</a><a href="#outcomes">Outcomes and register</a><a href="#gates">Gates</a><a href="#clips">Clips</a><a href="#images">Images</a></nav>
<section id="questions">${mdToHtml(m10)}</section>
<section id="rulings"><h2>The T00 owner's rulings on T11, verbatim (${range})</h2><p class="note">DI-101 is the ruling on what an agent's viewing can see; its measured result is in section 13 below, under "Viewing sensitivity". ${after} came after T11's agent stage, and each says what it gives up.</p>${mdToHtml(rulings)}</section>
<section id="outcomes">${mdToHtml(outcomes)}</section>
<section id="gates"><h2>Gates at round ${esc(round)}, with their limits</h2><p class="note">PASS and FAIL rows are gated; REPORT rows are printed only, by the plan's M2 rule. A gate catches regressions; it does not establish beauty.</p><pre>${esc(gates)}</pre>
${delta ? `<h3>Against the base round</h3><pre>${esc(delta)}</pre>` : ''}</section>
<section id="clips"><h2>Clips</h2><p class="note">An archive, not a judge: H.264 in yuv420p softens 1 px neon. The live page is the review.</p>
${clip('clip-opening', '30 s of a cold load of the production build, no input')}
${clip('clip-transition', '25 s across the lowest-chroma zone transition, harness at tier 3')}
${clip('clip-boost', '10 s of play holding boost, with the HUD')}</section>
<section id="images"><h2>Images</h2>${gallery}
<h3>Independent reviewer's folder</h3><p><a href="../review-m9/INDEX.txt">../review-m9/</a>: the images the M9 reviewer saw, with the planted test.</p></section>
</main></body></html>`;
  const index = roundFile('index.html');
  writeFileSync(index, html);
  console.log(`pack: ${index}, ${files.length} files in the round, ${used.size} images in the gallery`);
  // Screenshots of the page as the operator will see it, for the executor to open (each at most 1920 wide).
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(index).href);
  for (const [anchor, name] of [['first', 'pack-top'], ['seeds', 'pack-seeds'], ['rulings', 'pack-rulings'], ['outcomes', 'pack-outcomes'], ['gates', 'pack-gates'], ['clips', 'pack-clips'], ['images', 'pack-images']] as const) {
    await page.evaluate((a) => { document.getElementById(a)?.scrollIntoView(); }, anchor);
    await page.waitForTimeout(300);
    const png = await page.screenshot();
    writeFileSync(roundFile(`${name}.png`), png);
    const d = decodePng(png);
    expect(d.w).toBeLessThanOrEqual(1920);
  }
  await ctx.close();
  expect(gates.includes('FAIL'), 'a gated row is red in this round').toBe(false);
  expect(used.size, 'images in the gallery').toBeGreaterThan(60);
});
