// Contact sheets and plots for review (plan M1, "Sheets"). Tiles are box-filtered by an integer factor in Node; the
// sheet is an HTML page of data-URI PNGs with 12 px labels in a strip above each tile, rendered in a second blank page
// with setContent and screenshotted. The HTML is written beside the PNG for the operator. Everything stays <= 1920 wide.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Browser } from 'playwright/test';
import type { Box } from './metrics';
import { encodePng } from './png';

export interface Rgba { w: number; h: number; rgba: Uint8Array }
/** A tile is an image in memory, or a ready data URI (such as a screencast JPEG). */
export interface Tile { img?: Rgba; uri?: string; label?: string }

export const MAX_W = 1920;
const LABEL_H = 16;

/** Integer box filter: each output pixel is the mean of a factor x factor block. */
export function downscale(src: Rgba, factor: number): Rgba {
  if (!Number.isInteger(factor) || factor < 1) throw new Error(`downscale: factor ${factor}`);
  if (factor === 1) return { w: src.w, h: src.h, rgba: src.rgba.slice() };
  const w = Math.floor(src.w / factor), h = Math.floor(src.h / factor);
  const out = new Uint8Array(w * h * 4);
  const n = factor * factor;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < factor; dy++) {
        let i = ((y * factor + dy) * src.w + x * factor) * 4;
        for (let dx = 0; dx < factor; dx++, i += 4) { r += src.rgba[i]!; g += src.rgba[i + 1]!; b += src.rgba[i + 2]!; }
      }
      const o = (y * w + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = 255;
    }
  }
  return { w, h, rgba: out };
}

/** Nearest-neighbour integer upscale, for 2x strips that must not soften. */
export function upscale(src: Rgba, factor: number): Rgba {
  const w = src.w * factor, h = src.h * factor;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((Math.floor(y / factor) * src.w) + Math.floor(x / factor)) * 4;
      const o = (y * w + x) * 4;
      out[o] = src.rgba[i]!; out[o + 1] = src.rgba[i + 1]!; out[o + 2] = src.rgba[i + 2]!; out[o + 3] = 255;
    }
  }
  return { w, h, rgba: out };
}

export function crop(src: Rgba, box: Box): Rgba {
  const w = box.x1 - box.x0, h = box.y1 - box.y0;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) out.set(src.rgba.subarray(((box.y0 + y) * src.w + box.x0) * 4, ((box.y0 + y) * src.w + box.x1) * 4), y * w * 4);
  return { w, h, rgba: out };
}

/** Per-channel min-max stretch to 0..255, so one-level steps become visible (Agents.md, Definition of done item 3). */
export function stretch(src: Rgba): Rgba {
  const lo = [255, 255, 255], hi = [0, 0, 0];
  for (let i = 0; i < src.rgba.length; i += 4) for (let k = 0; k < 3; k++) { const v = src.rgba[i + k]!; if (v < lo[k]!) lo[k] = v; if (v > hi[k]!) hi[k] = v; }
  const out = new Uint8Array(src.rgba.length);
  for (let i = 0; i < src.rgba.length; i += 4) {
    for (let k = 0; k < 3; k++) out[i + k] = Math.round(((src.rgba[i + k]! - lo[k]!) * 255) / Math.max(1, hi[k]! - lo[k]!));
    out[i + 3] = 255;
  }
  return { w: src.w, h: src.h, rgba: out };
}

/** Writes a PNG, making folders, and prints SCREENSHOT <path> so it can be opened. */
export function writePng(path: string, img: Rgba): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePng(img.w, img.h, img.rgba));
  console.log(`SCREENSHOT ${path}`);
  return path;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function dataUri(img: Rgba): string {
  return `data:image/png;base64,${encodePng(img.w, img.h, img.rgba, 3).toString('base64')}`;
}

/** Renders a sheet of tiles, cols per row, each tileW x tileH under a label strip unless labels is false. */
export async function writeSheet(browser: Browser, tiles: readonly Tile[], o: { cols: number; tileW: number; tileH: number; path: string; labels?: boolean; title?: string; html?: boolean }): Promise<string> {
  const width = o.cols * o.tileW;
  if (width > MAX_W) throw new Error(`writeSheet: ${width} px wide, over ${MAX_W}`);
  const labels = o.labels !== false;
  const rows = Math.ceil(tiles.length / o.cols);
  const titleH = o.title ? 20 : 0;
  const height = titleH + rows * (o.tileH + (labels ? LABEL_H : 0));
  const src = (t: Tile): string => {
    if (t.uri) return t.uri;
    if (!t.img) throw new Error('writeSheet: a tile needs img or uri');
    return dataUri(t.img);
  };
  const cells = tiles.map((t) => `<div class="c">${labels ? `<div class="l">${esc(t.label ?? '')}</div>` : ''}<img src="${src(t)}" width="${o.tileW}" height="${o.tileH}"></div>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(o.title ?? o.path)}</title><style>
html,body{margin:0;padding:0;background:#000;width:${width}px}
.t{height:${titleH}px;font:13px/20px monospace;color:#ddd;padding-left:4px;overflow:hidden;white-space:nowrap}
.g{display:grid;grid-template-columns:repeat(${o.cols},${o.tileW}px);width:${width}px}
.c{width:${o.tileW}px}.l{height:${LABEL_H}px;font:12px/16px monospace;color:#eee;background:#111;padding-left:3px;overflow:hidden;white-space:nowrap}
img{display:block}
</style></head><body>${o.title ? `<div class="t">${esc(o.title)}</div>` : ''}<div class="g">${cells}</div></body></html>`;
  mkdirSync(dirname(o.path), { recursive: true });
  // html: false keeps a reviewer's folder to the PNG alone (DI-101's planted retest).
  if (o.html !== false) writeFileSync(o.path.replace(/\.png$/, '.html'), html);
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  try {
    const page = await ctx.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.screenshot({ path: o.path, clip: { x: 0, y: 0, width, height } });
  } finally {
    await ctx.close();
  }
  console.log(`SCREENSHOT ${o.path}`);
  return o.path;
}

export interface Series { name: string; colour: string; values: readonly number[]; limit?: number; limitDir?: 'max' | 'min' }
export interface Panel { title: string; series: readonly Series[] }

/** Line plots, one panel per row, against x, as SVG in a blank page. A limit draws as a dashed line. */
export async function writeCurves(browser: Browser, x: readonly number[], panels: readonly Panel[], o: { path: string; title: string; width?: number; panelH?: number; xLabel?: string }): Promise<string> {
  const W = Math.min(o.width ?? 1600, MAX_W), PH = o.panelH ?? 220, L = 70, R = 20, T = 28, B = 26;
  const xmin = Math.min(...x), xmax = Math.max(...x);
  const parts: string[] = [];
  panels.forEach((p, k) => {
    const y0 = k * PH;
    const vals = p.series.flatMap((s) => [...s.values, ...(s.limit !== undefined ? [s.limit] : [])]).filter((v) => Number.isFinite(v));
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.08;
    lo -= pad; hi += pad;
    const sx = (v: number): number => L + ((v - xmin) / Math.max(1e-9, xmax - xmin)) * (W - L - R);
    const sy = (v: number): number => y0 + T + (1 - (v - lo) / (hi - lo)) * (PH - T - B);
    parts.push(`<rect x="${L}" y="${y0 + T}" width="${W - L - R}" height="${PH - T - B}" fill="#0b0b10" stroke="#444"/>`);
    parts.push(`<text x="${L}" y="${y0 + 18}" fill="#ddd" font-size="13">${esc(p.title)}</text>`);
    for (const t of [lo, (lo + hi) / 2, hi]) parts.push(`<text x="4" y="${sy(t) + 4}" fill="#999" font-size="11">${t.toFixed(Math.abs(hi - lo) < 5 ? 3 : 1)}</text>`);
    p.series.forEach((s, j) => {
      const pts = s.values.map((v, i) => `${sx(x[i]!).toFixed(1)},${sy(v).toFixed(1)}`).join(' ');
      parts.push(`<polyline fill="none" stroke="${s.colour}" stroke-width="1.5" points="${pts}"/>`);
      parts.push(`<text x="${W - R - 260 + j * 0}" y="${y0 + 18 + j * 0}" fill="${s.colour}" font-size="12" dx="${j * 130}">${esc(s.name)}</text>`);
      if (s.limit !== undefined) parts.push(`<line x1="${L}" x2="${W - R}" y1="${sy(s.limit)}" y2="${sy(s.limit)}" stroke="${s.colour}" stroke-dasharray="6 4" stroke-width="1"/>`);
    });
    parts.push(`<text x="${L}" y="${y0 + PH - 6}" fill="#999" font-size="11">${esc(o.xLabel ?? '')} ${xmin.toFixed(1)} to ${xmax.toFixed(1)}</text>`);
  });
  const H = panels.length * PH + 24;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(o.title)}</title><style>html,body{margin:0;background:#000;font-family:monospace}</style></head><body>
<div style="color:#ddd;font:13px monospace;padding:4px">${esc(o.title)}</div><svg width="${W}" height="${H - 24}" xmlns="http://www.w3.org/2000/svg" font-family="monospace">${parts.join('')}</svg></body></html>`;
  mkdirSync(dirname(o.path), { recursive: true });
  writeFileSync(o.path.replace(/\.png$/, '.html'), html);
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  try {
    const page = await ctx.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.screenshot({ path: o.path, clip: { x: 0, y: 0, width: W, height: H } });
  } finally {
    await ctx.close();
  }
  console.log(`SCREENSHOT ${o.path}`);
  return o.path;
}
