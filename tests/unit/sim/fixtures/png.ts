// A dependency-free RGB canvas and PNG writer on node:zlib, for traces an agent can open and look at.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { deflateSync } from 'node:zlib';

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc(b: Uint8Array): number {
  let c = -1;
  for (const v of b) c = CRC_TABLE[(c ^ v) & 255]! ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const t = Buffer.from(type, 'latin1');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, sum]);
}

export type Rgb = readonly [number, number, number];

export interface Canvas {
  readonly width: number;
  readonly height: number;
  dot(x: number, y: number, c: Rgb, r?: number): void;
  hline(y: number, x0: number, x1: number, c: Rgb): void;
  vline(x: number, y0: number, y1: number, c: Rgb): void;
  fill(x0: number, y0: number, x1: number, y1: number, c: Rgb): void;
  save(path: string): void;
}

export function createCanvas(width: number, height: number, background: Rgb): Canvas {
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    rgb[i * 3] = background[0];
    rgb[i * 3 + 1] = background[1];
    rgb[i * 3 + 2] = background[2];
  }
  function set(x: number, y: number, c: Rgb): void {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const o = (y * width + x) * 3;
    rgb[o] = c[0];
    rgb[o + 1] = c[1];
    rgb[o + 2] = c[2];
  }
  const canvas: Canvas = {
    width,
    height,
    dot(x, y, c, r = 0): void {
      const cx = Math.floor(x);
      const cy = Math.floor(y);
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) set(cx + dx, cy + dy, c);
    },
    hline(y, x0, x1, c): void {
      const a = Math.floor(Math.min(x0, x1));
      const b = Math.floor(Math.max(x0, x1));
      for (let x = a; x <= b; x++) set(x, Math.floor(y), c);
    },
    vline(x, y0, y1, c): void {
      const a = Math.floor(Math.min(y0, y1));
      const b = Math.floor(Math.max(y0, y1));
      for (let y = a; y <= b; y++) set(Math.floor(x), y, c);
    },
    fill(x0, y0, x1, y1, c): void {
      for (let y = Math.floor(y0); y <= Math.floor(y1); y++) for (let x = Math.floor(x0); x <= Math.floor(x1); x++) set(x, y, c);
    },
    save(path): void {
      const raw = Buffer.alloc((width * 3 + 1) * height);
      for (let y = 0; y < height; y++) {
        raw[y * (width * 3 + 1)] = 0;
        rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
      }
      const ihdr = Buffer.alloc(13);
      ihdr.writeUInt32BE(width, 0);
      ihdr.writeUInt32BE(height, 4);
      ihdr[8] = 8;
      ihdr[9] = 2;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
      ]));
    },
  };
  return canvas;
}
