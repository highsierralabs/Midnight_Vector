// Tools for looking at the moving build as stills (plan M7): contact sheets, slit-scans, a CDP screencast, and pixel
// measurements on images. Everything that decodes or encodes an image does so in a browser page, so no image library
// is needed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { inflateSync } from 'node:zlib';
import type { Browser, CDPSession, Page } from 'playwright/test';

/** Writes base64 or bytes to path, creating folders, and prints SCREENSHOT <path> so it can be opened. */
export function writeImage(path: string, data: Buffer | string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof data === 'string' ? Buffer.from(data, 'base64') : data);
  console.log(`SCREENSHOT ${path}`);
  return path;
}

export interface SheetTile { image: Buffer; label?: string }

/**
 * One contact sheet on a blank page: tiles at tileW x tileH, cols per row, a label under each, written as JPEG at most
 * 1920 px wide unless the caller asks wider.
 */
export async function saveContactSheet(browser: Browser, tiles: readonly SheetTile[], o: { cols: number; tileW: number; tileH: number; path: string; type?: 'jpeg' | 'png' }): Promise<string> {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const page = await ctx.newPage();
  await page.goto('about:blank');
  const data = tiles.map((t) => ({ b64: t.image.toString('base64'), mime: t.image[0] === 0xff ? 'image/jpeg' : 'image/png', label: t.label ?? '' }));
  const b64 = await page.evaluate(async ({ data, cols, tileW, tileH, type }) => {
    const labelH = 18;
    const rows = Math.ceil(data.length / cols);
    const canvas = document.createElement('canvas');
    canvas.width = cols * tileW;
    canvas.height = rows * (tileH + labelH);
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#111';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.font = '13px monospace';
    for (let i = 0; i < data.length; i++) {
      const d = data[i]!;
      const blob = await (await fetch(`data:${d.mime};base64,${d.b64}`)).blob();
      const bmp = await createImageBitmap(blob);
      const x = (i % cols) * tileW;
      const y = Math.floor(i / cols) * (tileH + labelH);
      g.drawImage(bmp, x, y, tileW, tileH);
      g.fillStyle = '#eee';
      g.fillText(d.label, x + 4, y + tileH + 13);
    }
    return canvas.toDataURL(type === 'png' ? 'image/png' : 'image/jpeg', 0.88).split(',')[1]!;
  }, { data, cols: o.cols, tileW: o.tileW, tileH: o.tileH, type: o.type ?? 'jpeg' });
  await ctx.close();
  return writeImage(o.path, b64);
}

export interface ScreencastFrame { file: string; t: number }
export interface Screencast { stop(): Promise<ScreencastFrame[]> }

/** CDP Page.startScreencast: every frame as JPEG quality 80, written to dir/NNNNN.jpg with its timestamp, acknowledged. */
export async function startScreencast(page: Page, dir: string): Promise<Screencast> {
  mkdirSync(dir, { recursive: true });
  const cdp: CDPSession = await page.context().newCDPSession(page);
  const frames: ScreencastFrame[] = [];
  cdp.on('Page.screencastFrame', (e: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
    const file = join(dir, `${String(frames.length).padStart(5, '0')}.jpg`);
    writeFileSync(file, Buffer.from(e.data, 'base64'));
    frames.push({ file, t: e.metadata.timestamp ?? Date.now() / 1000 });
    void cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => undefined);
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, everyNthFrame: 1 });
  return {
    async stop() {
      await cdp.send('Page.stopScreencast');
      await cdp.detach();
      return frames;
    },
  };
}

/** A dependency-free page that plays the JPEGs by their timestamps. */
export function writeFlipbook(path: string, frames: readonly ScreencastFrame[], relDir: string): string {
  const t0 = frames[0]?.t ?? 0;
  const list = frames.map((f, i) => [`${relDir}/${String(i).padStart(5, '0')}.jpg`, Math.round((f.t - t0) * 1000)]);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Midnight Vector session</title>
<style>body{margin:0;background:#000;color:#ccc;font:13px monospace}img{display:block;max-width:100vw;max-height:94vh;margin:0 auto}#bar{padding:4px}</style></head>
<body><div id="bar"></div><img id="f" alt="frame">
<script>
const F=${JSON.stringify(list)};const img=document.getElementById('f');const bar=document.getElementById('bar');
let i=0,start=performance.now();
function show(){const now=performance.now()-start;while(i<F.length-1&&F[i+1][1]<=now)i++;img.src=F[i][0];bar.textContent='frame '+i+' / '+F.length+'  t '+(F[i][1]/1000).toFixed(2)+' s';
if(i<F.length-1)requestAnimationFrame(show);else bar.textContent+='  (end; reload to replay)';}
const pre=F.map(f=>{const im=new Image();im.src=f[0];return im;});Promise.all(pre.map(im=>im.decode().catch(()=>{}))).then(()=>{start=performance.now();show();});
</script></body></html>`;
  writeFileSync(path, html);
  console.log(`FLIPBOOK ${path}`);
  return path;
}

export interface SlitScanResult { row: string; colA: string; colB: string; frames: number; ms: number }

/**
 * Fixed-step slit-scan: manual mode, then per frame host.runFrame(dt) and, in the same task, one gl.readPixels row and
 * two columns into image rows. Time runs down in the row image and right in the column images. hideAt hides one layer
 * (hideLayer, default 2, props) for exactly one frame, the positive control.
 */
export async function slitScan(page: Page, o: { frames: number; dt: number; row: number; colA: number; colB: number; hideAt?: number; hideLayer?: number; tierAt?: { frame: number; tier: 0 | 1 | 2 | 3 | 4 }[] }, paths: { row: string; colA: string; colB: string }): Promise<SlitScanResult> {
  const r = await page.evaluate(async (q) => {
    const hook = window.__mvE2e!;
    const host = hook.host;
    const renderer = host.ctx.renderer;
    const gl = renderer.getContext();
    // The image size is fixed by the first frame's buffer. A tier change can resize the buffer mid-run, so each frame
    // reads its own size and samples the same CSS-relative row and columns, resampled to the first frame's size.
    const W = gl.drawingBufferWidth;
    const H = gl.drawingBufferHeight;
    const rowImg = new ImageData(W, q.frames);
    const colA = new ImageData(q.frames, H);
    const colB = new ImageData(q.frames, H);
    let line = new Uint8Array(W * 4);
    let col = new Uint8Array(H * 4);
    const t0 = performance.now();
    host.setManual(true);
    for (let f = 0; f < q.frames; f++) {
      for (const t of q.tierAt ?? []) if (t.frame === f) host.governor.force(t.tier);
      if (q.hideAt !== undefined && f === q.hideAt) host.layers[q.hideLayer ?? 2]!.setVisible(false);
      host.runFrame(q.dt);
      renderer.setRenderTarget(null);
      const w = gl.drawingBufferWidth;
      const hh = gl.drawingBufferHeight;
      if (line.length !== w * 4) line = new Uint8Array(w * 4);
      if (col.length !== hh * 4) col = new Uint8Array(hh * 4);
      gl.readPixels(0, hh - 1 - Math.round((q.row * hh) / 1080), w, 1, gl.RGBA, gl.UNSIGNED_BYTE, line);
      for (let x = 0; x < W; x++) {
        const sx = Math.min(w - 1, Math.floor((x * w) / W)) * 4;
        const o = (f * W + x) * 4;
        rowImg.data[o] = line[sx]!; rowImg.data[o + 1] = line[sx + 1]!; rowImg.data[o + 2] = line[sx + 2]!; rowImg.data[o + 3] = 255;
      }
      for (const [cx, img] of [[q.colA, colA], [q.colB, colB]] as const) {
        gl.readPixels(Math.round((cx * w) / 1920), 0, 1, hh, gl.RGBA, gl.UNSIGNED_BYTE, col);
        for (let y = 0; y < H; y++) {
          const sy = Math.min(hh - 1, Math.floor((y * hh) / H));
          const src = (hh - 1 - sy) * 4;
          const dst = (y * q.frames + f) * 4;
          img.data[dst] = col[src]!; img.data[dst + 1] = col[src + 1]!; img.data[dst + 2] = col[src + 2]!; img.data[dst + 3] = 255;
        }
      }
      if (q.hideAt !== undefined && f === q.hideAt) host.layers[q.hideLayer ?? 2]!.setVisible(true);
    }
    const ms = performance.now() - t0;
    host.setManual(false);
    const enc = (img: ImageData): string => {
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      c.getContext('2d')!.putImageData(img, 0, 0);
      return c.toDataURL('image/png').split(',')[1]!;
    };
    return { row: enc(rowImg), colA: enc(colA), colB: enc(colB), ms };
  }, o);
  return { row: writeImage(paths.row, r.row), colA: writeImage(paths.colA, r.colA), colB: writeImage(paths.colB, r.colB), frames: o.frames, ms: r.ms };
}

export interface DiscMeasure { top: number; widestRow: number; centreX: number; radius: number; centreY: number }

/**
 * Finds the disc in a top-down RGBA frame: per row, the run of pixels with Rec.709 luma over threshold that contains the
 * centre column. The first row whose run is over 3% and under 40% of the width is the top; the widest run gives the radius.
 */
export function measureDisc(px: ArrayLike<number>, w: number, h: number, maxRow: number, threshold = 100): DiscMeasure | null {
  const luma = (x: number, y: number): number => {
    const i = (y * w + x) * 4;
    return 0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!;
  };
  const cx = Math.floor(w / 2);
  let top = -1;
  let best = 0;
  let bestRow = -1;
  let bestCentre = cx;
  for (let y = 0; y < Math.min(h, maxRow); y++) {
    if (luma(cx, y) <= threshold) continue;
    let l = cx;
    let r = cx;
    while (l > 0 && luma(l - 1, y) > threshold) l--;
    while (r < w - 1 && luma(r + 1, y) > threshold) r++;
    const run = r - l + 1;
    // A full-width bright band, such as the poster's horizon glow, is not the disc.
    if (run > 0.03 * w && run < 0.4 * w) {
      if (top < 0) top = y;
      if (run > best) { best = run; bestRow = y; bestCentre = (l + r) / 2; }
    }
  }
  if (top < 0) return null;
  const radius = best / 2;
  return { top, widestRow: bestRow, centreX: bestCentre, radius, centreY: top + radius };
}

/**
 * Reads an 8-bit, non-interlaced RGB or RGBA PNG, such as page.screenshot writes, into top-down RGBA. Node only, through
 * node:zlib, so no image library is needed.
 */
export function readPng(buf: Buffer): { w: number; h: number; px: Uint8Array } {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8;
  let w = 0;
  let h = 0;
  let type = 0;
  const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const kind = buf.toString('ascii', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (kind === 'IHDR') {
      w = body.readUInt32BE(0);
      h = body.readUInt32BE(4);
      if (body[8] !== 8 || body[12] !== 0) throw new Error('PNG must be 8-bit and not interlaced');
      type = body[9]!;
      if (type !== 2 && type !== 6) throw new Error(`PNG colour type ${type} is not RGB or RGBA`);
    } else if (kind === 'IDAT') {
      idat.push(body);
    } else if (kind === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = type === 6 ? 4 : 3;
  const stride = w * bpp;
  const cur = new Uint8Array(stride);
  const prev = new Uint8Array(stride);
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp]! : 0;
      const b = prev[i]!;
      const c = i >= bpp ? prev[i - bpp]! : 0;
      let v = line[i]!;
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      px[o] = cur[x * bpp]!; px[o + 1] = cur[x * bpp + 1]!; px[o + 2] = cur[x * bpp + 2]!; px[o + 3] = bpp === 4 ? cur[x * bpp + 3]! : 255;
    }
    prev.set(cur);
  }
  return { w, h, px };
}

/** Flips a bottom-up gl.readPixels buffer to top-down rows. */
export function flipRows(px: ArrayLike<number>, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w * 4;
    for (let i = 0; i < w * 4; i++) out[y * w * 4 + i] = px[src + i]!;
  }
  return out;
}
