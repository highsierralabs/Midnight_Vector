// PNG encode and decode with node:zlib only (plan section 3). RGBA 8-bit out; RGB or RGBA 8-bit, non-interlaced in.
// Chromium's screenshots use every filter type, so the decoder handles all five.
import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

/** RGBA rows top-down to a PNG. Each row uses the Sub filter, which compresses render output well. */
export function encodePng(w: number, h: number, rgba: Uint8Array, level = 6): Buffer {
  if (rgba.length !== w * h * 4) throw new Error(`encodePng: ${rgba.length} bytes for ${w}x${h}`);
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (stride + 1);
    raw[o] = 1;
    const src = y * stride;
    for (let i = 0; i < stride; i++) {
      const left = i >= 4 ? rgba[src + i - 4]! : 0;
      raw[o + 1 + i] = (rgba[src + i]! - left) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level })), chunk('IEND', new Uint8Array(0))]);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** PNG to RGBA rows top-down. Throws on anything but 8-bit RGB or RGBA without interlace. */
export function decodePng(buf: Buffer): { w: number; h: number; rgba: Uint8Array } {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('decodePng: not a PNG');
  let pos = 8;
  let w = 0, h = 0, colourType = 0;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error(`decodePng: bit depth ${data[8]}`);
      colourType = data[9]!;
      if (colourType !== 2 && colourType !== 6) throw new Error(`decodePng: colour type ${colourType}`);
      if (data[12] !== 0) throw new Error('decodePng: interlaced');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  const bpp = colourType === 6 ? 4 : 3;
  const stride = w * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const px = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i]!;
      const a = i >= bpp ? px[dst + i - bpp]! : 0;
      const b = y > 0 ? px[dst - stride + i]! : 0;
      const c = i >= bpp && y > 0 ? px[dst - stride + i - bpp]! : 0;
      let v: number;
      switch (f) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: v = x + paeth(a, b, c); break;
        default: throw new Error(`decodePng: filter ${f}`);
      }
      px[dst + i] = v & 0xff;
    }
  }
  if (bpp === 4) return { w, h, rgba: px };
  const rgba = new Uint8Array(w * h * 4);
  for (let p = 0, q = 0; p < px.length; p += 3, q += 4) {
    rgba[q] = px[p]!;
    rgba[q + 1] = px[p + 1]!;
    rgba[q + 2] = px[p + 2]!;
    rgba[q + 3] = 255;
  }
  return { w, h, rgba };
}
